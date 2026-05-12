"""
BuildSphere CV Service - YOLOv8 box-based glass panel detector.

YOLOv8 detects and highlights glass panels with bounding boxes only.
Python post-processing classifies each box as full or partial, counts only
full panels, and leaves the final verified count to the mobile user.
Gemini is used only to summarize the structured result.
"""

import base64
import logging
import time

import numpy as np
from PIL import Image
from ultralytics import YOLO

from app.config import settings
from app.models import Detection, DetectionResponse

# False-positive filter thresholds.
# Glass is transparent/reflective, so useful crops usually have color variance.
_MIN_COLOR_VARIANCE: float = 45.0
_MIN_REL_SIZE: float = 0.005
_PARTIAL_MARGIN_PX: int = 10

logger = logging.getLogger(__name__)


class GlassPanelDetector:
    """Encapsulates YOLOv8 object detection and box-based panel counting."""

    def __init__(self) -> None:
        self.model: YOLO | None = None
        self.device: str = "cpu"
        self.model_path: str = settings.MODEL_PATH
        self._is_loaded: bool = False

    def load_model(self) -> None:
        """Load the YOLO model into memory, preferring CUDA when available."""
        logger.info("Loading YOLO model: %s", self.model_path)

        try:
            self.model = YOLO(self.model_path)
            try:
                import torch

                if torch.cuda.is_available():
                    self.device = "cuda"
                    logger.info("CUDA available, using GPU: %s", torch.cuda.get_device_name(0))
                else:
                    self.device = "cpu"
                    logger.info("CUDA not available, using CPU")
            except ImportError:
                self.device = "cpu"
                logger.info("PyTorch CUDA not installed, using CPU")

            self._is_loaded = True
            logger.info("Model loaded successfully on %s (%s)", self.device, self.model_path)
        except Exception as exc:
            logger.error("Failed to load model: %s", exc)
            raise RuntimeError(f"Model loading failed: {exc}") from exc

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    def detect(self, image: Image.Image) -> DetectionResponse:
        """
        Run regular YOLOv8 object detection on a PIL Image.

        This intentionally uses bounding boxes only. Boxes near
        the image boundary are marked partial/cut-off and excluded from the AI
        count so the user can retake the photo or manually verify the count.
        """
        if not self._is_loaded or self.model is None:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        original_width, original_height = image.size

        start_time = time.perf_counter()
        results = self.model.predict(
            source=image,
            conf=settings.CONFIDENCE_THRESHOLD,
            iou=settings.NMS_IOU_THRESHOLD,
            imgsz=settings.INFERENCE_IMAGE_SIZE,
            max_det=settings.MAX_DETECTIONS,
            device=self.device,
            verbose=False,
        )
        inference_ms = (time.perf_counter() - start_time) * 1000

        import cv2

        cv_img = np.array(image.convert("RGB"))
        cv_img = cv_img[:, :, ::-1].copy()
        rgb_arr = np.array(image.convert("RGB"))

        detections: list[Detection] = []
        total_valid_panels = 0
        partial_panels = 0
        unclear_panels = 0
        excluded_low_confidence = 0
        excluded_duplicates = 0
        excluded_contained = 0
        excluded_small_boxes = 0
        excluded_unrealistic_shape = 0
        detection_mode = "box"

        if results and len(results) > 0:
            result = results[0]
            boxes = result.boxes

            if boxes is not None and len(boxes) > 0:
                logger.info("YOLOv8 box detector found %s raw boxes", len(boxes))
                raw_detections = []

                for i in range(len(boxes)):
                    xyxy = boxes.xyxy[i].cpu().numpy()
                    confidence = float(boxes.conf[i].cpu().numpy())
                    class_id = int(boxes.cls[i].cpu().numpy())

                    if settings.USE_PRETRAINED_COCO and class_id == 0:
                        continue

                    x_min, y_min, x_max, y_max = map(int, xyxy)

                    if confidence < settings.CONFIDENCE_THRESHOLD:
                        excluded_low_confidence += 1
                        continue

                    shape_rejection = self._box_rejection_reason(
                        x_min,
                        y_min,
                        x_max,
                        y_max,
                        original_width,
                        original_height,
                    )
                    if shape_rejection == "small":
                        excluded_small_boxes += 1
                        logger.info(
                            "Rejected detection at [%s,%s,%s,%s] (conf=%.2f): box too small",
                            x_min,
                            y_min,
                            x_max,
                            y_max,
                            confidence,
                        )
                        continue
                    if shape_rejection == "shape":
                        excluded_unrealistic_shape += 1
                        logger.info(
                            "Rejected detection at [%s,%s,%s,%s] (conf=%.2f): unrealistic aspect ratio",
                            x_min,
                            y_min,
                            x_max,
                            y_max,
                            confidence,
                        )
                        continue

                    if self._is_wall_or_column(
                        rgb_arr,
                        x_min,
                        y_min,
                        x_max,
                        y_max,
                        original_width,
                        original_height,
                    ):
                        logger.info(
                            "Rejected detection at [%s,%s,%s,%s] (conf=%.2f): low color variance or too small",
                            x_min,
                            y_min,
                            x_max,
                            y_max,
                            confidence,
                        )
                        continue

                    class_name = (
                        result.names[class_id]
                        if result.names and class_id in result.names
                        else "glass_panel"
                    )
                    raw_detections.append(
                        {
                            "xyxy": xyxy,
                            "conf": confidence,
                            "class_name": class_name,
                        }
                    )

                before_nms = len(raw_detections)
                raw_detections = self._perform_nms(raw_detections, settings.NMS_IOU_THRESHOLD)
                if len(raw_detections) < before_nms:
                    excluded_duplicates += before_nms - len(raw_detections)
                    logger.info("NMS suppressed %s overlapping boxes", before_nms - len(raw_detections))

                before_containment = len(raw_detections)
                raw_detections = self._remove_contained_boxes(
                    raw_detections,
                    settings.CONTAINMENT_THRESHOLD,
                )
                if len(raw_detections) < before_containment:
                    excluded_contained += before_containment - len(raw_detections)
                    logger.info(
                        "Containment filtering removed %s nested boxes",
                        before_containment - len(raw_detections),
                    )

                raw_detections.sort(key=lambda det: det["conf"], reverse=True)

                for det in raw_detections:
                    xyxy = det["xyxy"]
                    confidence = det["conf"]
                    x_min, y_min, x_max, y_max = map(int, xyxy)
                    is_partial = self._is_partial_box(
                        x_min,
                        y_min,
                        x_max,
                        y_max,
                        original_width,
                        original_height,
                    )

                    if is_partial:
                        status = "partial"
                        counted = False
                        partial_panels += 1
                        color = (0, 165, 255)  # BGR orange/yellow warning.
                        label_text = "Partial - Not Counted"
                    else:
                        status = "full"
                        counted = True
                        total_valid_panels += 1
                        color = (0, 0, 255)  # Existing counted color.
                        label_text = f"Counted #{total_valid_panels}"

                    detections.append(
                        Detection(
                            bounding_box=[
                                round(float(xyxy[0]), 1),
                                round(float(xyxy[1]), 1),
                                round(float(xyxy[2]), 1),
                                round(float(xyxy[3]), 1),
                            ],
                            confidence_score=round(confidence, 4),
                            label="glass_panel",
                            status=status,
                            counted=counted,
                        )
                    )

                    if counted:
                        overlay = cv_img.copy()
                        cv2.rectangle(overlay, (x_min, y_min), (x_max, y_max), color, -1)
                        cv2.addWeighted(overlay, 0.25, cv_img, 0.75, 0, cv_img)

                    cv2.rectangle(cv_img, (x_min, y_min), (x_max, y_max), color, 2)
                    self._draw_label(cv_img, cv2, x_min, y_min, label_text, color)

        avg_confidence = (
            sum(det.confidence_score for det in detections) / len(detections)
            if detections
            else 0.0
        )
        excluded_panels = (
            partial_panels
            + unclear_panels
            + excluded_low_confidence
            + excluded_duplicates
            + excluded_contained
            + excluded_small_boxes
            + excluded_unrealistic_shape
        )
        has_warnings = excluded_panels > 0
        warning_message = self._warning_message(
            partial_panels,
            unclear_panels,
            excluded_low_confidence,
            excluded_duplicates,
            excluded_contained,
            excluded_small_boxes,
            excluded_unrealistic_shape,
        )

        _, buffer = cv2.imencode(".jpg", cv_img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        encoded_image = base64.b64encode(buffer).decode("utf-8")
        annotated_image_base64 = f"data:image/jpeg;base64,{encoded_image}"

        logger.info(
            "Detected %s valid panels, %s partial panels, %s total detections in %.1fms (%sx%s, mode=%s)",
            total_valid_panels,
            partial_panels,
            len(detections),
            inference_ms,
            original_width,
            original_height,
            detection_mode,
        )

        return DetectionResponse(
            total_valid_panels=total_valid_panels,
            partial_panels=partial_panels,
            unclear_panels=unclear_panels,
            excluded_panels=excluded_panels,
            excluded_low_confidence=excluded_low_confidence,
            excluded_duplicates=excluded_duplicates,
            excluded_contained=excluded_contained,
            excluded_small_boxes=excluded_small_boxes,
            excluded_unrealistic_shape=excluded_unrealistic_shape,
            avg_confidence=round(avg_confidence, 4),
            detection_mode=detection_mode,
            has_warnings=has_warnings,
            warning_message=warning_message,
            detections=detections,
            annotated_image_base64=annotated_image_base64,
            image_width=original_width,
            image_height=original_height,
            inference_time_ms=round(inference_ms, 1),
            model_version=self.model_path,
            confidence_threshold=settings.CONFIDENCE_THRESHOLD,
            nms_iou_threshold=settings.NMS_IOU_THRESHOLD,
        )

    def draw_fallback_boxes(
        self,
        image: Image.Image,
        gemini_boxes: list[list[int]],
        inference_ms: float,
    ) -> DetectionResponse:
        """
        Emergency-only Gemini Vision fallback.

        Gemini fallback is used only when YOLO returns no boxes. Python still
        classifies the fallback boxes and the mobile user still verifies the
        final count before saving.
        """
        import cv2

        original_width, original_height = image.size
        cv_img = np.array(image.convert("RGB"))
        cv_img = cv_img[:, :, ::-1].copy()

        raw_detections = []
        for box in gemini_boxes:
            if len(box) != 4:
                continue

            ymin_norm, xmin_norm, ymax_norm, xmax_norm = box
            raw_detections.append(
                {
                    "xyxy": [
                        int((xmin_norm / 1000.0) * original_width),
                        int((ymin_norm / 1000.0) * original_height),
                        int((xmax_norm / 1000.0) * original_width),
                        int((ymax_norm / 1000.0) * original_height),
                    ],
                    "conf": 0.99,
                    "class_name": "glass_panel",
                }
            )

        before_nms = len(raw_detections)
        raw_detections = self._perform_nms(raw_detections, settings.NMS_IOU_THRESHOLD)
        after_nms = len(raw_detections)
        if len(raw_detections) < before_nms:
            # Diagnostic only: fallback boxes are still post-processed by Python.
            logger.info("NMS suppressed %s overlapping Gemini boxes", before_nms - len(raw_detections))

        before_containment = len(raw_detections)
        raw_detections = self._remove_contained_boxes(
            raw_detections,
            settings.CONTAINMENT_THRESHOLD,
        )

        detections: list[Detection] = []
        total_valid_panels = 0
        partial_panels = 0
        unclear_panels = 0
        excluded_low_confidence = 0
        excluded_duplicates = before_nms - after_nms
        excluded_contained = before_containment - len(raw_detections)
        excluded_small_boxes = 0
        excluded_unrealistic_shape = 0

        for det in raw_detections:
            x_min, y_min, x_max, y_max = map(int, det["xyxy"])
            shape_rejection = self._box_rejection_reason(
                x_min,
                y_min,
                x_max,
                y_max,
                original_width,
                original_height,
            )
            if shape_rejection == "small":
                excluded_small_boxes += 1
                continue
            if shape_rejection == "shape":
                excluded_unrealistic_shape += 1
                continue

            is_partial = self._is_partial_box(
                x_min,
                y_min,
                x_max,
                y_max,
                original_width,
                original_height,
            )

            if is_partial:
                status = "partial"
                counted = False
                partial_panels += 1
                color = (0, 165, 255)
                label_text = "Partial - Not Counted"
            else:
                status = "full"
                counted = True
                total_valid_panels += 1
                color = (0, 0, 255)
                label_text = f"Counted #{total_valid_panels}"

            detections.append(
                Detection(
                    bounding_box=[float(x_min), float(y_min), float(x_max), float(y_max)],
                    confidence_score=det["conf"],
                    label="glass_panel",
                    status=status,
                    counted=counted,
                )
            )

            if counted:
                overlay = cv_img.copy()
                cv2.rectangle(overlay, (x_min, y_min), (x_max, y_max), color, -1)
                cv2.addWeighted(overlay, 0.25, cv_img, 0.75, 0, cv_img)

            cv2.rectangle(cv_img, (x_min, y_min), (x_max, y_max), color, 2)
            self._draw_label(cv_img, cv2, x_min, y_min, label_text, color)

        avg_confidence = (
            sum(det.confidence_score for det in detections) / len(detections)
            if detections
            else 0.0
        )
        excluded_panels = (
            partial_panels
            + unclear_panels
            + excluded_low_confidence
            + excluded_duplicates
            + excluded_contained
            + excluded_small_boxes
            + excluded_unrealistic_shape
        )
        warning_message = self._warning_message(
            partial_panels,
            unclear_panels,
            excluded_low_confidence,
            excluded_duplicates,
            excluded_contained,
            excluded_small_boxes,
            excluded_unrealistic_shape,
        )

        _, buffer = cv2.imencode(".jpg", cv_img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        encoded_image = base64.b64encode(buffer).decode("utf-8")

        return DetectionResponse(
            total_valid_panels=total_valid_panels,
            partial_panels=partial_panels,
            unclear_panels=unclear_panels,
            excluded_panels=excluded_panels,
            excluded_low_confidence=excluded_low_confidence,
            excluded_duplicates=excluded_duplicates,
            excluded_contained=excluded_contained,
            excluded_small_boxes=excluded_small_boxes,
            excluded_unrealistic_shape=excluded_unrealistic_shape,
            avg_confidence=round(avg_confidence, 4),
            detection_mode="gemini-fallback",
            has_warnings=excluded_panels > 0,
            warning_message=warning_message,
            detections=detections,
            annotated_image_base64=f"data:image/jpeg;base64,{encoded_image}",
            image_width=original_width,
            image_height=original_height,
            inference_time_ms=round(inference_ms, 1),
            model_version="gemini-vision-fallback",
            confidence_threshold=0.0,
            nms_iou_threshold=settings.NMS_IOU_THRESHOLD,
        )

    @staticmethod
    def _is_partial_box(
        x_min: int,
        y_min: int,
        x_max: int,
        y_max: int,
        image_width: int,
        image_height: int,
    ) -> bool:
        """Return True when a detected panel touches or nearly touches the image edge."""
        margin = _PARTIAL_MARGIN_PX
        return (
            x_min <= margin
            or y_min <= margin
            or x_max >= image_width - margin
            or y_max >= image_height - margin
        )

    @staticmethod
    def _warning_message(
        partial_panels: int,
        unclear_panels: int,
        excluded_low_confidence: int,
        excluded_duplicates: int,
        excluded_contained: int,
        excluded_small_boxes: int,
        excluded_unrealistic_shape: int,
    ) -> str | None:
        excluded_filter_count = (
            excluded_low_confidence
            + excluded_duplicates
            + excluded_contained
            + excluded_small_boxes
            + excluded_unrealistic_shape
        )
        excluded = partial_panels + unclear_panels + excluded_filter_count
        if excluded == 0:
            return None
        if excluded_filter_count and not partial_panels and not unclear_panels:
            return (
                "Some detections were excluded because they appeared duplicated, too small, "
                "uncertain, or unrealistic for a glass panel."
            )
        if excluded_filter_count:
            return (
                f"{partial_panels} partial or cut-off panels were excluded from the AI count. "
                "Additional uncertain, duplicate, or small detections were filtered out."
            )
        if partial_panels and unclear_panels:
            return (
                f"{partial_panels} partial or cut-off glass panels and {unclear_panels} unclear panels "
                "were excluded from the AI count."
            )
        if partial_panels:
            return (
                f"{partial_panels} partial or cut-off glass panels were detected near the image edge "
                "and were excluded from the AI count."
            )
        return f"{unclear_panels} unclear panels were excluded from the AI count."

    @staticmethod
    def _box_rejection_reason(
        x_min: int,
        y_min: int,
        x_max: int,
        y_max: int,
        image_width: int,
        image_height: int,
    ) -> str | None:
        """Return why a box should be excluded before counting, or None if plausible."""
        box_w = max(0, x_max - x_min)
        box_h = max(0, y_max - y_min)
        image_area = max(1, image_width * image_height)
        box_area = box_w * box_h

        if (
            box_w < image_width * settings.MIN_BOX_WIDTH_RATIO
            or box_h < image_height * settings.MIN_BOX_HEIGHT_RATIO
            or box_area < image_area * settings.MIN_BOX_AREA_RATIO
        ):
            return "small"

        aspect_ratio = box_w / max(1, box_h)
        if (
            aspect_ratio < settings.MIN_BOX_ASPECT_RATIO
            or aspect_ratio > settings.MAX_BOX_ASPECT_RATIO
        ):
            return "shape"

        return None

    @staticmethod
    def _draw_label(cv_img: np.ndarray, cv2, x_min: int, y_min: int, label_text: str, color: tuple[int, int, int]) -> None:
        (text_width, text_height), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
        label_y = y_min if y_min > text_height + 12 else y_min + text_height + 12
        cv2.rectangle(
            cv_img,
            (x_min, label_y - text_height - 10),
            (x_min + text_width + 10, label_y),
            color,
            -1,
        )
        cv2.putText(
            cv_img,
            label_text,
            (x_min + 5, label_y - 7),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),
            2,
        )

    @staticmethod
    def _is_wall_or_column(
        rgb_arr: np.ndarray,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        img_w: int,
        img_h: int,
    ) -> bool:
        """Return True when the detected crop is too small or too visually uniform."""
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(img_w, x2)
        y2 = min(img_h, y2)

        if x2 <= x1 or y2 <= y1:
            return True

        box_w = x2 - x1
        box_h = y2 - y1
        if box_w < img_w * _MIN_REL_SIZE or box_h < img_h * _MIN_REL_SIZE:
            return True

        crop = rgb_arr[y1:y2, x1:x2]
        if crop.size == 0:
            return True

        variance = float(np.mean(np.std(crop.reshape(-1, 3).astype(np.float32), axis=0)))
        logger.debug("Box [%s,%s,%s,%s] color variance = %.1f", x1, y1, x2, y2, variance)
        return variance < _MIN_COLOR_VARIANCE

    @staticmethod
    def _remove_contained_boxes(detections: list[dict], containment_threshold: float) -> list[dict]:
        """
        Remove smaller boxes that are mostly inside larger boxes.

        This prevents frames, reflections, or subregions inside one physical
        glass panel from being counted as separate panels.
        """
        if not detections:
            return []

        def area(det: dict) -> float:
            x1, y1, x2, y2 = det["xyxy"]
            return max(0.0, float(x2 - x1)) * max(0.0, float(y2 - y1))

        kept: list[dict] = []
        for candidate in sorted(detections, key=area, reverse=True):
            candidate_area = area(candidate)
            if candidate_area <= 0:
                continue

            is_contained = False
            for existing in kept:
                smaller_area = min(candidate_area, area(existing))
                if smaller_area <= 0:
                    continue

                intersection = GlassPanelDetector._compute_intersection_area(
                    candidate["xyxy"],
                    existing["xyxy"],
                )
                if intersection / smaller_area >= containment_threshold:
                    is_contained = True
                    break

            if not is_contained:
                kept.append(candidate)

        return kept

    @staticmethod
    def _perform_nms(detections: list[dict], iou_threshold: float) -> list[dict]:
        """Perform non-maximum suppression on detections with xyxy boxes."""
        if not detections:
            return []

        sorted_dets = sorted(detections, key=lambda det: det["conf"], reverse=True)
        keep = []

        while sorted_dets:
            best_det = sorted_dets.pop(0)
            keep.append(best_det)

            remaining = []
            for det in sorted_dets:
                iou = GlassPanelDetector._compute_iou(best_det["xyxy"], det["xyxy"])
                if iou < iou_threshold:
                    remaining.append(det)
            sorted_dets = remaining

        return keep

    @staticmethod
    def _compute_intersection_area(box1: list | np.ndarray, box2: list | np.ndarray) -> float:
        """Compute intersection area between two [x1, y1, x2, y2] boxes."""
        x1_1, y1_1, x2_1, y2_1 = box1
        x1_2, y1_2, x2_2, y2_2 = box2

        x_i1 = max(x1_1, x1_2)
        y_i1 = max(y1_1, y1_2)
        x_i2 = min(x2_1, x2_2)
        y_i2 = min(y2_1, y2_2)

        inter_w = max(0, x_i2 - x_i1)
        inter_h = max(0, y_i2 - y_i1)
        return float(inter_w * inter_h)

    @staticmethod
    def _compute_iou(box1: list | np.ndarray, box2: list | np.ndarray) -> float:
        """Compute Intersection over Union for [x1, y1, x2, y2] boxes."""
        x1_1, y1_1, x2_1, y2_1 = box1
        x1_2, y1_2, x2_2, y2_2 = box2

        x_i1 = max(x1_1, x1_2)
        y_i1 = max(y1_1, y1_2)
        x_i2 = min(x2_1, x2_2)
        y_i2 = min(y2_1, y2_2)

        inter_area = GlassPanelDetector._compute_intersection_area(box1, box2)

        area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
        area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
        union_area = area1 + area2 - inter_area

        if union_area == 0:
            return 0.0

        return inter_area / union_area


detector = GlassPanelDetector()

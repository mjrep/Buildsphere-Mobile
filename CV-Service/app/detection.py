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
from pathlib import Path

import numpy as np
from PIL import Image
from ultralytics import YOLO

from app.config import settings
from app.models import Detection, DetectionResponse

# False-positive filter thresholds.
# Glass is transparent/reflective, so useful crops usually have color variance.
_MIN_COLOR_VARIANCE: float = 45.0
_MIN_REL_SIZE: float = 0.005

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

    def detect(self, image: Image.Image, file_size_bytes: int | None = None) -> DetectionResponse:
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
            conf=0.001,
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
        raw_yolo_count = 0
        after_confidence_count = 0
        after_size_count = 0
        after_duplicate_count = 0
        raw_detections: list[dict] = []
        confidence_detections: list[dict] = []
        size_filtered_detections: list[dict] = []
        filtered_detections: list[dict] = []
        excluded_debug: list[dict] = []
        partial_debug: list[dict] = []
        counted_debug: list[dict] = []
        debug_enabled = settings.GLASS_COUNTER_DEBUG
        debug_token = f"{int(time.time() * 1000)}"

        logger.info(
            "Glass analysis input | image_width=%s image_height=%s file_size_bytes=%s debug=%s",
            original_width,
            original_height,
            file_size_bytes,
            debug_enabled,
        )

        if results and len(results) > 0:
            result = results[0]
            boxes = result.boxes

            if boxes is not None and len(boxes) > 0:
                raw_yolo_count = len(boxes)
                logger.info("Glass analysis stage | raw_yolo_detections=%s", raw_yolo_count)

                for i in range(len(boxes)):
                    xyxy = boxes.xyxy[i].cpu().numpy()
                    confidence = float(boxes.conf[i].cpu().numpy())
                    class_id = int(boxes.cls[i].cpu().numpy())
                    x_min, y_min, x_max, y_max = map(int, xyxy)
                    class_name = (
                        result.names[class_id]
                        if result.names and class_id in result.names
                        else "glass_panel"
                    )
                    det = {
                        "raw_index": i + 1,
                        "xyxy": xyxy,
                        "conf": confidence,
                        "class_id": class_id,
                        "class_name": class_name,
                    }
                    raw_detections.append(det)

                    if debug_enabled:
                        logger.info(
                            "Glass debug raw #%s: x1=%s y1=%s x2=%s y2=%s confidence=%.4f class=%s",
                            i + 1,
                            x_min,
                            y_min,
                            x_max,
                            y_max,
                            confidence,
                            class_name,
                        )

                # YOLO proposes boxes. Python owns filtering and the final counted-box total.
                for det in raw_detections:
                    if settings.USE_PRETRAINED_COCO and det["class_id"] == 0:
                        rejected = {**det, "reason": "class_filter", "label": "EXCLUDED class"}
                        excluded_debug.append(rejected)
                        continue
                    if det["conf"] < settings.CONFIDENCE_THRESHOLD:
                        excluded_low_confidence += 1
                        rejected = {**det, "reason": "low_confidence", "label": "EXCLUDED low confidence"}
                        excluded_debug.append(rejected)
                        continue
                    confidence_detections.append(det)

                after_confidence_count = len(confidence_detections)
                logger.info(
                    "Glass analysis stage | after_confidence_filter=%s confidence_threshold=%.3f excluded_low_confidence=%s",
                    after_confidence_count,
                    settings.CONFIDENCE_THRESHOLD,
                    excluded_low_confidence,
                )

                for det in confidence_detections:
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
                        rejected = {**det, "reason": "small_box", "label": "EXCLUDED small"}
                        excluded_debug.append(rejected)
                        if debug_enabled:
                            logger.info(
                                "Glass debug excluded raw #%s as small_box: [%s,%s,%s,%s] conf=%.4f",
                                det["raw_index"],
                                x_min,
                                y_min,
                                x_max,
                                y_max,
                                det["conf"],
                            )
                        continue
                    if shape_rejection == "shape":
                        excluded_unrealistic_shape += 1
                        rejected = {**det, "reason": "unrealistic_shape", "label": "EXCLUDED shape"}
                        excluded_debug.append(rejected)
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
                        excluded_unrealistic_shape += 1
                        rejected = {**det, "reason": "low_variance", "label": "EXCLUDED low variance"}
                        excluded_debug.append(rejected)
                        continue

                    size_filtered_detections.append(det)

                after_size_count = len(size_filtered_detections)
                logger.info(
                    "Glass analysis stage | after_size_filter=%s excluded_small=%s excluded_shape_or_variance=%s min_area_ratio=%.4f min_width_ratio=%.4f min_height_ratio=%.4f",
                    after_size_count,
                    excluded_small_boxes,
                    excluded_unrealistic_shape,
                    settings.MIN_BOX_AREA_RATIO,
                    settings.MIN_BOX_WIDTH_RATIO,
                    settings.MIN_BOX_HEIGHT_RATIO,
                )

                duplicate_filtered, duplicate_excluded = self._perform_nms_with_exclusions(
                    size_filtered_detections,
                    settings.DUPLICATE_IOU_THRESHOLD,
                )
                excluded_duplicates += len(duplicate_excluded)
                excluded_debug.extend(
                    {**det, "reason": "duplicate", "label": "EXCLUDED duplicate"}
                    for det in duplicate_excluded
                )
                after_duplicate_count = len(duplicate_filtered)
                logger.info(
                    "Glass analysis stage | after_duplicate_filter=%s duplicate_iou_threshold=%.3f excluded_duplicates=%s",
                    after_duplicate_count,
                    settings.DUPLICATE_IOU_THRESHOLD,
                    excluded_duplicates,
                )

                filtered_detections, contained_excluded = self._remove_contained_boxes_with_exclusions(
                    duplicate_filtered,
                    settings.CONTAINMENT_THRESHOLD,
                )
                excluded_contained += len(contained_excluded)
                excluded_debug.extend(
                    {**det, "reason": "contained", "label": "EXCLUDED duplicate"}
                    for det in contained_excluded
                )
                logger.info(
                    "Glass analysis stage | after_containment_filter=%s containment_threshold=%.3f excluded_contained=%s",
                    len(filtered_detections),
                    settings.CONTAINMENT_THRESHOLD,
                    excluded_contained,
                )

                filtered_detections.sort(key=lambda det: det["conf"], reverse=True)

                for det in filtered_detections:
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
                        partial_debug.append({**det, "reason": "partial", "label": "PARTIAL not counted"})
                    else:
                        status = "full"
                        counted = True
                        total_valid_panels += 1
                        color = (0, 0, 255)  # Existing counted color.
                        label_text = f"Counted #{total_valid_panels}"
                        counted_debug.append({**det, "count_index": total_valid_panels, "label": f"COUNTED #{total_valid_panels}"})

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
            else:
                logger.info("Glass analysis stage | raw_yolo_detections=0")
                logger.info(
                    "Glass analysis stage | after_confidence_filter=0 confidence_threshold=%.3f excluded_low_confidence=0",
                    settings.CONFIDENCE_THRESHOLD,
                )
                logger.info(
                    "Glass analysis stage | after_size_filter=0 excluded_small=0 excluded_shape_or_variance=0 min_area_ratio=%.4f min_width_ratio=%.4f min_height_ratio=%.4f",
                    settings.MIN_BOX_AREA_RATIO,
                    settings.MIN_BOX_WIDTH_RATIO,
                    settings.MIN_BOX_HEIGHT_RATIO,
                )
                logger.info(
                    "Glass analysis stage | after_duplicate_filter=0 duplicate_iou_threshold=%.3f excluded_duplicates=0",
                    settings.DUPLICATE_IOU_THRESHOLD,
                )
                logger.info(
                    "Glass analysis stage | after_containment_filter=0 containment_threshold=%.3f excluded_contained=0",
                    settings.CONTAINMENT_THRESHOLD,
                )
        else:
            logger.info("Glass analysis stage | raw_yolo_detections=0")
            logger.info(
                "Glass analysis stage | after_confidence_filter=0 confidence_threshold=%.3f excluded_low_confidence=0",
                settings.CONFIDENCE_THRESHOLD,
            )
            logger.info(
                "Glass analysis stage | after_size_filter=0 excluded_small=0 excluded_shape_or_variance=0 min_area_ratio=%.4f min_width_ratio=%.4f min_height_ratio=%.4f",
                settings.MIN_BOX_AREA_RATIO,
                settings.MIN_BOX_WIDTH_RATIO,
                settings.MIN_BOX_HEIGHT_RATIO,
            )
            logger.info(
                "Glass analysis stage | after_duplicate_filter=0 duplicate_iou_threshold=%.3f excluded_duplicates=0",
                settings.DUPLICATE_IOU_THRESHOLD,
            )
            logger.info(
                "Glass analysis stage | after_containment_filter=0 containment_threshold=%.3f excluded_contained=0",
                settings.CONTAINMENT_THRESHOLD,
            )

        grid_boxes = self._detect_mullion_grid_cells(rgb_arr)
        if len(grid_boxes) > max(total_valid_panels, 1):
            logger.info(
                "Glass analysis grid fallback | replacing counted_boxes=%s with grid_cells=%s",
                total_valid_panels,
                len(grid_boxes),
            )
            detections = []
            total_valid_panels = 0
            partial_panels = 0
            unclear_panels = 0
            excluded_low_confidence = 0
            excluded_duplicates = 0
            excluded_contained = 0
            excluded_small_boxes = 0
            excluded_unrealistic_shape = 0
            detection_mode = "grid"
            cv_img = np.array(image.convert("RGB"))[:, :, ::-1].copy()

            for x_min, y_min, x_max, y_max in grid_boxes:
                total_valid_panels += 1
                detections.append(
                    Detection(
                        bounding_box=[float(x_min), float(y_min), float(x_max), float(y_max)],
                        confidence_score=0.85,
                        label="glass_panel",
                        status="full",
                        counted=True,
                    )
                )
                color = (0, 0, 255)
                overlay = cv_img.copy()
                cv2.rectangle(overlay, (x_min, y_min), (x_max, y_max), color, -1)
                cv2.addWeighted(overlay, 0.18, cv_img, 0.82, 0, cv_img)
                cv2.rectangle(cv_img, (x_min, y_min), (x_max, y_max), color, 2)

            if grid_boxes:
                x_min, y_min, _, _ = grid_boxes[0]
                self._draw_label(cv_img, cv2, x_min, y_min, f"Counted {total_valid_panels} panels", (0, 0, 255))

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
        logger.info(
            "Glass analysis summary | raw_yolo=%s after_confidence=%s after_size=%s after_duplicate=%s after_containment=%s partial=%s final_counted=%s",
            raw_yolo_count,
            after_confidence_count,
            after_size_count,
            after_duplicate_count,
            len(filtered_detections),
            partial_panels,
            total_valid_panels,
        )
        debug_info = None
        if debug_enabled:
            debug_paths = self._write_debug_images(
                image,
                debug_token,
                raw_detections,
                filtered_detections,
                counted_debug,
                excluded_debug,
                partial_debug,
            )
            logger.info(
                "Glass Counter Summary | Raw YOLO boxes: %s | After confidence filter: %s | After size filter: %s | After duplicate filter: %s | Partial panels: %s | Final counted panels: %s",
                raw_yolo_count,
                after_confidence_count,
                after_size_count,
                after_duplicate_count,
                partial_panels,
                total_valid_panels,
            )
            if raw_yolo_count == 0:
                logger.info("Glass Counter Summary | Reason: model did not detect any panel")
            debug_info = {
                "image_width": original_width,
                "image_height": original_height,
                "file_size_bytes": file_size_bytes,
                "raw_detections": raw_yolo_count,
                "after_confidence_filter": after_confidence_count,
                "after_duplicate_filter": after_duplicate_count,
                "after_size_filter": after_size_count,
                "after_edge_filter": total_valid_panels,
                "partial_panels": partial_panels,
                "final_counted": total_valid_panels,
                "excluded_reasons": self._summarize_excluded_reasons(excluded_debug),
                "debug_images": debug_paths,
                "raw_boxes": [self._debug_box_payload(det) for det in raw_detections],
                "filtered_boxes": [self._debug_box_payload(det) for det in filtered_detections],
                "partial_boxes": [self._debug_box_payload(det) for det in partial_debug],
                "counted_boxes": [self._debug_box_payload(det) for det in counted_debug],
            }

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
            nms_iou_threshold=settings.DUPLICATE_IOU_THRESHOLD,
            debug=debug_info,
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
        raw_detections = self._perform_nms(raw_detections, settings.DUPLICATE_IOU_THRESHOLD)
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
            nms_iou_threshold=settings.DUPLICATE_IOU_THRESHOLD,
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
        margin = settings.EDGE_MARGIN
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
    def _detect_mullion_grid_cells(rgb_arr: np.ndarray) -> list[tuple[int, int, int, int]]:
        """
        Count panes in clear gridded windows when YOLO keeps only one pane.

        The custom detector can under-count architectural windows because a
        single pane often receives the highest confidence. For obvious mullion
        grids, dark vertical and horizontal bars give a deterministic pane map:
        cells are the rectangles between consecutive grid lines.
        """
        import cv2

        img_h, img_w = rgb_arr.shape[:2]
        if img_w < 120 or img_h < 120:
            return []

        gray = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2GRAY)
        dark_mask = cv2.inRange(gray, 0, 95)

        vertical_kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT,
            (3, max(35, img_h // 18)),
        )
        horizontal_kernel = cv2.getStructuringElement(
            cv2.MORPH_RECT,
            (max(35, img_w // 18), 3),
        )
        vertical_lines = cv2.morphologyEx(dark_mask, cv2.MORPH_OPEN, vertical_kernel)
        horizontal_lines = cv2.morphologyEx(dark_mask, cv2.MORPH_OPEN, horizontal_kernel)

        x_positions = GlassPanelDetector._projection_clusters(
            np.count_nonzero(vertical_lines, axis=0),
            min_strength=max(45, int(img_h * 0.18)),
            min_gap=max(8, img_w // 160),
        )
        x_positions = GlassPanelDetector._largest_regular_line_group(x_positions, img_w)
        if len(x_positions) < 3:
            return []

        x_window_min = max(0, x_positions[0] - 10)
        x_window_max = min(img_w, x_positions[-1] + 10)
        window_width = max(1, x_window_max - x_window_min)
        y_positions = GlassPanelDetector._projection_clusters(
            np.count_nonzero(horizontal_lines[:, x_window_min:x_window_max], axis=1),
            min_strength=max(45, int(window_width * 0.65)),
            min_gap=max(8, img_h // 160),
        )

        y_positions = GlassPanelDetector._largest_regular_line_group(y_positions, img_h)

        if len(x_positions) < 3 or len(y_positions) < 3:
            return []

        column_widths = np.diff(x_positions)
        row_heights = np.diff(y_positions)
        if np.median(column_widths) < img_w * 0.06 or np.median(row_heights) < img_h * 0.045:
            return []

        max_cells = 80
        cell_count = (len(x_positions) - 1) * (len(y_positions) - 1)
        if cell_count < 4 or cell_count > max_cells:
            return []

        boxes: list[tuple[int, int, int, int]] = []
        for row_idx in range(len(y_positions) - 1):
            for col_idx in range(len(x_positions) - 1):
                x1 = int(x_positions[col_idx])
                x2 = int(x_positions[col_idx + 1])
                y1 = int(y_positions[row_idx])
                y2 = int(y_positions[row_idx + 1])
                inset_x = max(3, int((x2 - x1) * 0.04))
                inset_y = max(3, int((y2 - y1) * 0.04))
                boxes.append((x1 + inset_x, y1 + inset_y, x2 - inset_x, y2 - inset_y))

        logger.info(
            "Glass grid fallback detected | vertical_lines=%s horizontal_lines=%s cells=%s",
            x_positions,
            y_positions,
            len(boxes),
        )
        return boxes

    @staticmethod
    def _projection_clusters(
        projection: np.ndarray,
        min_strength: int,
        min_gap: int,
    ) -> list[int]:
        active_indices = np.where(projection >= min_strength)[0]
        if active_indices.size == 0:
            return []

        clusters: list[np.ndarray] = []
        start = 0
        for idx in range(1, active_indices.size):
            if active_indices[idx] - active_indices[idx - 1] > min_gap:
                clusters.append(active_indices[start:idx])
                start = idx
        clusters.append(active_indices[start:])

        centers: list[int] = []
        for cluster in clusters:
            strengths = projection[cluster].astype(float)
            if strengths.sum() <= 0:
                centers.append(int(np.mean(cluster)))
            else:
                centers.append(int(round(float(np.average(cluster, weights=strengths)))))
        return centers

    @staticmethod
    def _largest_regular_line_group(positions: list[int], image_span: int) -> list[int]:
        if len(positions) < 3:
            return positions

        positions = sorted(positions)
        best_group: list[int] = []
        min_spacing = max(20, int(image_span * 0.045))
        max_spacing = max(min_spacing + 1, int(image_span * 0.35))

        for start_idx, start in enumerate(positions):
            for next_idx in range(start_idx + 1, len(positions)):
                spacing = positions[next_idx] - start
                if spacing < min_spacing:
                    continue
                if spacing > max_spacing:
                    break

                tolerance = max(16, int(spacing * 0.28))
                group = [start, positions[next_idx]]
                expected = positions[next_idx] + spacing

                for candidate in positions[next_idx + 1:]:
                    if abs(candidate - expected) <= tolerance:
                        group.append(candidate)
                        expected = candidate + spacing
                    elif candidate > expected + tolerance:
                        while candidate > expected + tolerance:
                            expected += spacing
                        if abs(candidate - expected) <= tolerance:
                            group.append(candidate)
                            expected = candidate + spacing

                if len(group) > len(best_group):
                    best_group = group
                elif len(group) == len(best_group) and group:
                    if (group[-1] - group[0]) > (best_group[-1] - best_group[0]):
                        best_group = group

        return best_group if len(best_group) >= 3 else positions

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
    def _perform_nms_with_exclusions(detections: list[dict], iou_threshold: float) -> tuple[list[dict], list[dict]]:
        """Return kept boxes plus boxes rejected as duplicates by Python NMS."""
        if not detections:
            return [], []

        sorted_dets = sorted(detections, key=lambda det: det["conf"], reverse=True)
        keep: list[dict] = []
        excluded: list[dict] = []

        while sorted_dets:
            best_det = sorted_dets.pop(0)
            keep.append(best_det)

            remaining = []
            for det in sorted_dets:
                iou = GlassPanelDetector._compute_iou(best_det["xyxy"], det["xyxy"])
                if iou < iou_threshold:
                    remaining.append(det)
                else:
                    excluded.append({**det, "duplicate_of": best_det.get("raw_index"), "iou": round(iou, 4)})
            sorted_dets = remaining

        return keep, excluded

    @staticmethod
    def _remove_contained_boxes_with_exclusions(
        detections: list[dict],
        containment_threshold: float,
    ) -> tuple[list[dict], list[dict]]:
        """Return kept boxes plus boxes rejected because another box contains them."""
        if not detections:
            return [], []

        def area(det: dict) -> float:
            x1, y1, x2, y2 = det["xyxy"]
            return max(0.0, float(x2 - x1)) * max(0.0, float(y2 - y1))

        kept: list[dict] = []
        excluded: list[dict] = []
        for candidate in sorted(detections, key=area, reverse=True):
            candidate_area = area(candidate)
            if candidate_area <= 0:
                continue

            containing_raw_index = None
            for existing in kept:
                smaller_area = min(candidate_area, area(existing))
                if smaller_area <= 0:
                    continue

                intersection = GlassPanelDetector._compute_intersection_area(
                    candidate["xyxy"],
                    existing["xyxy"],
                )
                if intersection / smaller_area >= containment_threshold:
                    containing_raw_index = existing.get("raw_index")
                    break

            if containing_raw_index is None:
                kept.append(candidate)
            else:
                excluded.append({**candidate, "contained_by": containing_raw_index})

        return kept, excluded

    @staticmethod
    def _debug_box_payload(det: dict) -> dict:
        x1, y1, x2, y2 = map(float, det["xyxy"])
        return {
            "raw_index": det.get("raw_index"),
            "x1": round(x1, 1),
            "y1": round(y1, 1),
            "x2": round(x2, 1),
            "y2": round(y2, 1),
            "confidence": round(float(det["conf"]), 4),
            "class_label": det.get("class_name", "glass_panel"),
            "reason": det.get("reason"),
        }

    @staticmethod
    def _summarize_excluded_reasons(excluded: list[dict]) -> list[dict]:
        reason_counts: dict[str, int] = {}
        for det in excluded:
            reason = str(det.get("reason") or "unknown")
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
        return [
            {"reason": reason, "count": count}
            for reason, count in sorted(reason_counts.items())
        ]

    @staticmethod
    def _write_debug_images(
        image: Image.Image,
        token: str,
        raw_detections: list[dict],
        filtered_detections: list[dict],
        counted_detections: list[dict],
        excluded_detections: list[dict],
        partial_detections: list[dict],
    ) -> dict:
        """
        Save backend-only debug images.

        YOLO proposes raw boxes. Python filters boxes. Only counted boxes become
        the AI suggested count; debug images show where a missing panel dropped.
        """
        import cv2

        debug_dir = Path(settings.GLASS_COUNTER_DEBUG_DIR)
        if not debug_dir.is_absolute():
            debug_dir = Path(__file__).resolve().parent.parent / debug_dir
        debug_dir.mkdir(parents=True, exist_ok=True)

        raw_img = np.array(image.convert("RGB"))[:, :, ::-1].copy()
        filtered_img = raw_img.copy()
        counted_img = raw_img.copy()

        GlassPanelDetector._draw_debug_boxes(
            raw_img,
            cv2,
            raw_detections,
            lambda det, idx: f"RAW #{det.get('raw_index', idx)} {float(det['conf']):.2f}",
            (255, 0, 255),
        )
        GlassPanelDetector._draw_debug_boxes(
            filtered_img,
            cv2,
            excluded_detections,
            lambda det, _idx: str(det.get("label") or f"EXCLUDED {det.get('reason', 'unknown')}"),
            (0, 165, 255),
        )
        GlassPanelDetector._draw_debug_boxes(
            filtered_img,
            cv2,
            filtered_detections,
            lambda _det, _idx: "FILTERED",
            (255, 0, 0),
        )
        GlassPanelDetector._draw_debug_boxes(
            counted_img,
            cv2,
            partial_detections,
            lambda _det, _idx: "PARTIAL not counted",
            (0, 165, 255),
        )
        GlassPanelDetector._draw_debug_boxes(
            counted_img,
            cv2,
            counted_detections,
            lambda det, idx: str(det.get("label") or f"COUNTED #{idx}"),
            (0, 0, 255),
        )

        paths = {
            "received_input": str(debug_dir / f"{token}_received_input.jpg"),
            "raw_detections": str(debug_dir / f"{token}_raw_detections.jpg"),
            "filtered_detections": str(debug_dir / f"{token}_filtered_detections.jpg"),
            "final_counted": str(debug_dir / f"{token}_final_counted.jpg"),
        }
        image.convert("RGB").save(paths["received_input"], format="JPEG", quality=95)
        cv2.imwrite(paths["raw_detections"], raw_img)
        cv2.imwrite(paths["filtered_detections"], filtered_img)
        cv2.imwrite(paths["final_counted"], counted_img)
        logger.info("Glass debug images saved: %s", paths)
        return paths

    @staticmethod
    def _draw_debug_boxes(cv_img: np.ndarray, cv2, detections: list[dict], label_fn, color: tuple[int, int, int]) -> None:
        for idx, det in enumerate(detections, start=1):
            x_min, y_min, x_max, y_max = map(int, det["xyxy"])
            label = label_fn(det, idx)
            cv2.rectangle(cv_img, (x_min, y_min), (x_max, y_max), color, 2)
            GlassPanelDetector._draw_label(cv_img, cv2, x_min, y_min, label, color)

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

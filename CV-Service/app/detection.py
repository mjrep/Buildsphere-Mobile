"""
BuildSphere CV Service — YOLO Glass Panel Detector.

Wraps the Ultralytics YOLO model with glass-panel-specific
preprocessing, inference, and post-processing logic.

Detection modes (auto-selected at runtime):
  • box detection     — standard YOLOv8: counts panels from result.boxes
  • segmentation      — YOLOv8-seg: counts panels from result.masks.xy polygons
  • Gemini fallback   — emergency only: Gemini Vision boxes when YOLO returns 0
"""

import time
import logging
from pathlib import Path

import numpy as np
from PIL import Image
from ultralytics import YOLO

from app.config import settings
from app.models import Detection, DetectionResponse

# ── False-positive filter thresholds ─────────────────────────────────
# Glass is transparent/reflective → high colour variance across the crop.
# Solid walls / columns are uniform → low variance.
# Relaxed to 30 to catch glass panels that might be uniform in colour (e.g. tinted or clear sky).
_MIN_COLOR_VARIANCE: float = 30.0
# Minimum fraction of the image dimension a panel must cover to be real.
_MIN_REL_SIZE: float = 0.005   # 0.5 % of image width or height

logger = logging.getLogger(__name__)


class GlassPanelDetector:
    """
    Encapsulates the YOLO model for glass panel detection.

    Handles:
    - Model loading (GPU with CPU fallback)
    - Image preprocessing
    - Inference with configurable thresholds
    - Result formatting into the API response schema
    """

    def __init__(self) -> None:
        self.model: YOLO | None = None
        self.device: str = "cpu"
        self.model_path: str = settings.MODEL_PATH
        self._is_loaded: bool = False

    def load_model(self) -> None:
        """
        Load the YOLO model into memory.
        Attempts GPU (CUDA) first, falls back to CPU.
        """
        logger.info(f"Loading YOLO model: {self.model_path}")

        try:
            self.model = YOLO(self.model_path)

            # Attempt GPU inference; silently fall back to CPU
            try:
                import torch

                if torch.cuda.is_available():
                    self.device = "cuda"
                    logger.info(
                        f"CUDA available — using GPU: {torch.cuda.get_device_name(0)}"
                    )
                else:
                    self.device = "cpu"
                    logger.info("CUDA not available — using CPU")
            except ImportError:
                self.device = "cpu"
                logger.info("PyTorch CUDA not installed — using CPU")

            self._is_loaded = True
            logger.info(
                f"✅ Model loaded successfully on {self.device} "
                f"({self.model_path})"
            )

        except Exception as e:
            logger.error(f"❌ Failed to load model: {e}")
            raise RuntimeError(f"Model loading failed: {e}") from e

    @property
    def is_loaded(self) -> bool:
        return self._is_loaded

    def detect(self, image: Image.Image) -> DetectionResponse:
        """
        Run glass panel detection on a PIL Image.

        Supports two YOLO model types:
        - **YOLOv8 detection** (current): counts panels from ``result.boxes``.
        - **YOLOv8-seg segmentation** (future): counts panels from
          ``result.masks.xy`` polygons, with bounding boxes still available.

        If the loaded model does not produce masks, the method automatically
        falls back to bounding-box-only counting.

        Args:
            image: PIL Image in RGB format.

        Returns:
            DetectionResponse with bounding boxes, optional polygons,
            counts, annotated image, and metadata.
        """
        if not self._is_loaded or self.model is None:
            raise RuntimeError("Model not loaded. Call load_model() first.")

        original_width, original_height = image.size

        # ── Run YOLO inference ────────────────────────────────────────
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

        # ── Prepare image arrays for annotation ───────────────────────
        import cv2
        import base64

        cv_img = np.array(image.convert('RGB'))
        cv_img = cv_img[:, :, ::-1].copy()  # RGB → BGR for OpenCV
        # Keep an RGB copy for colour-variance analysis
        rgb_arr = np.array(image.convert('RGB'))

        # ── Parse results ─────────────────────────────────────────────
        detections: list[Detection] = []
        valid_panel_count = 0
        # Track which detection mode was used: "box" or "segmentation"
        detection_mode = "box"

        if results and len(results) > 0:
            result = results[0]  # Single image → single result

            # ─────────────────────────────────────────────────────────
            #  Determine detection mode:
            #    • If result.masks is NOT None → YOLOv8-seg model
            #    • Otherwise                   → standard YOLOv8 box model
            # ─────────────────────────────────────────────────────────
            has_masks = (
                hasattr(result, 'masks')
                and result.masks is not None
                and len(result.masks) > 0
            )

            if has_masks:
                # ═══════════════════════════════════════════════════════
                #  SEGMENTATION PATH  (YOLOv8-seg)
                #  Uses polygon masks for counting and annotation.
                #  Bounding boxes are still extracted alongside masks.
                # ═══════════════════════════════════════════════════════
                detection_mode = "segmentation"
                masks = result.masks
                boxes = result.boxes
                logger.info(
                    f"🔍 YOLOv8-seg: {len(masks)} segmentation masks found"
                )

                # Build raw detections with both box + polygon data
                raw_detections = []
                for i in range(len(masks)):
                    # Polygon vertices from the mask (pixel coordinates)
                    polygon_xy = masks.xy[i]  # ndarray of shape (N, 2)
                    polygon_list = [
                        [round(float(pt[0]), 1), round(float(pt[1]), 1)]
                        for pt in polygon_xy
                    ]

                    # Bounding box (always available alongside masks)
                    xyxy = boxes.xyxy[i].cpu().numpy()
                    confidence = float(boxes.conf[i].cpu().numpy())
                    class_id = int(boxes.cls[i].cpu().numpy())

                    class_name = (
                        result.names[class_id]
                        if result.names and class_id in result.names
                        else "glass_panel"
                    )

                    # Skip person class if using pre-trained COCO model
                    if settings.USE_PRETRAINED_COCO and class_id == 0:
                        continue

                    raw_detections.append({
                        "xyxy": xyxy,
                        "conf": confidence,
                        "class_name": class_name,
                        "polygon": polygon_list,
                        "polygon_np": polygon_xy,
                    })

                # Sort by confidence (highest first)
                raw_detections.sort(key=lambda d: d["conf"], reverse=True)

                # Process, annotate, and build Detection objects
                for det in raw_detections:
                    xyxy = det["xyxy"]
                    confidence = det["conf"]
                    polygon_list = det["polygon"]
                    polygon_np = det["polygon_np"]

                    x_min, y_min, x_max, y_max = map(int, xyxy)

                    class_name = "full_glass_panel"
                    is_class_b = False

                    # Build Detection with polygon data
                    detection = Detection(
                        bounding_box=[
                            round(float(xyxy[0]), 1),
                            round(float(xyxy[1]), 1),
                            round(float(xyxy[2]), 1),
                            round(float(xyxy[3]), 1),
                        ],
                        confidence_score=round(confidence, 4),
                        label=class_name,
                        polygon=polygon_list,
                    )
                    detections.append(detection)

                    if not is_class_b:
                        # Fully visible panel — draw filled polygon overlay
                        valid_panel_count += 1
                        color = (0, 0, 255)  # BGR: PRO-RED

                        # Draw translucent polygon fill
                        pts = polygon_np.astype(np.int32).reshape((-1, 1, 2))
                        overlay = cv_img.copy()
                        cv2.fillPoly(overlay, [pts], color)
                        cv2.addWeighted(overlay, 0.3, cv_img, 0.7, 0, cv_img)
                        # Draw polygon outline
                        cv2.polylines(cv_img, [pts], isClosed=True, color=color, thickness=2)

                        # Label text
                        label_text = f"PANEL #{valid_panel_count}"
                        (tw, th), _ = cv2.getTextSize(
                            label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2
                        )
                        cv2.rectangle(
                            cv_img,
                            (x_min, y_min - th - 10),
                            (x_min + tw + 10, y_min),
                            color, -1,
                        )
                        cv2.putText(
                            cv_img, label_text,
                            (x_min + 5, y_min - 7),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                            (255, 255, 255), 2,
                        )

            else:
                # ═══════════════════════════════════════════════════════
                #  BOX DETECTION PATH  (standard YOLOv8)
                #  Current behaviour — counts panels from bounding boxes.
                #  No polygon data is produced.
                # ═══════════════════════════════════════════════════════
                detection_mode = "box"

                if result.boxes is not None and len(result.boxes) > 0:
                    boxes = result.boxes
                    logger.info(
                        f"🔍 YOLO Raw Detections: {len(boxes)} boxes found"
                    )

                    # Extract all raw detections first to sort them
                    raw_detections = []
                    for i in range(len(boxes)):
                        xyxy = boxes.xyxy[i].cpu().numpy()
                        confidence = float(boxes.conf[i].cpu().numpy())
                        class_id = int(boxes.cls[i].cpu().numpy())

                        logger.info(
                            f"📍 Raw Box {i}: Class={class_id}, "
                            f"Conf={confidence:.3f}, Path={xyxy}"
                        )

                        class_name = (
                            result.names[class_id]
                            if result.names and class_id in result.names
                            else "glass_panel"
                        )

                        if settings.USE_PRETRAINED_COCO and class_id == 0:
                            # Skip 'person' class in COCO model
                            continue

                        # ── Wall / column false-positive filter ───────
                        # (currently disabled — uncomment to re-enable)
                        # x1, y1, x2, y2 = map(int, xyxy)
                        # if self._is_wall_or_column(rgb_arr, x1, y1, x2, y2,
                        #                            original_width, original_height):
                        #     logger.info(
                        #         f"Rejected detection at [{x1},{y1},{x2},{y2}] "
                        #         f"(conf={confidence:.2f}) — low colour variance (wall/column)"
                        #     )
                        #     continue

                        raw_detections.append({
                            "xyxy": xyxy,
                            "conf": confidence,
                            "class_name": class_name,
                        })

                    # Sort by confidence (highest first)
                    raw_detections.sort(
                        key=lambda d: d["conf"], reverse=True
                    )

                    # Process and draw bounding boxes
                    for det in raw_detections:
                        xyxy = det["xyxy"]
                        confidence = det["conf"]
                        class_name = det["class_name"]

                        x_min, y_min, x_max, y_max = map(int, xyxy)

                        # Simplified: Every detection is a glass panel
                        class_name = "full_glass_panel"
                        is_class_b = False

                        # Build Detection (no polygon for box mode)
                        detection = Detection(
                            bounding_box=[
                                round(float(xyxy[0]), 1),
                                round(float(xyxy[1]), 1),
                                round(float(xyxy[2]), 1),
                                round(float(xyxy[3]), 1),
                            ],
                            confidence_score=round(confidence, 4),
                            label=class_name,
                            polygon=None,  # box detection = no polygon
                        )
                        detections.append(detection)

                        if not is_class_b:
                            # Class A: Fully visible (GREEN)
                            valid_panel_count += 1
                            color = (0, 0, 255)  # BGR for PRO-RED

                            overlay = cv_img.copy()
                            cv2.rectangle(
                                overlay,
                                (x_min, y_min), (x_max, y_max),
                                color, -1,
                            )
                            cv2.addWeighted(
                                overlay, 0.3, cv_img, 0.7, 0, cv_img
                            )
                            cv2.rectangle(
                                cv_img,
                                (x_min, y_min), (x_max, y_max),
                                color, 2,
                            )

                            label_text = f"PANEL #{valid_panel_count}"
                            (tw, th), _ = cv2.getTextSize(
                                label_text,
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2,
                            )
                            cv2.rectangle(
                                cv_img,
                                (x_min, y_min - th - 10),
                                (x_min + tw + 10, y_min),
                                color, -1,
                            )
                            cv2.putText(
                                cv_img, label_text,
                                (x_min + 5, y_min - 7),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                                (255, 255, 255), 2,
                            )
                        else:
                            # Class B: Partial/Obscured (ORANGE/YELLOW)
                            color = (0, 165, 255)  # BGR for Orange
                            cv2.rectangle(
                                cv_img,
                                (x_min, y_min), (x_max, y_max),
                                color, 2,
                            )

                            label_text = (
                                "This part of the photo is not fully visible"
                            )
                            (tw, th), _ = cv2.getTextSize(
                                label_text,
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2,
                            )
                            y_text = (
                                y_min
                                if y_min > th + 10
                                else y_min + th + 10
                            )
                            cv2.rectangle(
                                cv_img,
                                (x_min, y_text - th - 10),
                                (x_min + tw + 10, y_text),
                                color, -1,
                            )
                            cv2.putText(
                                cv_img, label_text,
                                (x_min + 5, y_text - 7),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                                (255, 255, 255), 2,
                            )

        # ── Encode annotated image to Base64 ──────────────────────────
        _, buffer = cv2.imencode(
            '.jpg', cv_img, [int(cv2.IMWRITE_JPEG_QUALITY), 85]
        )
        encoded_image = base64.b64encode(buffer).decode('utf-8')
        annotated_image_base64 = f"data:image/jpeg;base64,{encoded_image}"

        logger.info(
            f"Detected {valid_panel_count} valid panels out of "
            f"{len(detections)} total in {inference_ms:.1f}ms "
            f"(image: {original_width}x{original_height}, "
            f"mode: {detection_mode})"
        )

        return DetectionResponse(
            total_valid_panels=valid_panel_count,
            detections=detections,
            annotated_image_base64=annotated_image_base64,
            image_width=original_width,
            image_height=original_height,
            inference_time_ms=round(inference_ms, 1),
            model_version=self.model_path,
            confidence_threshold=settings.CONFIDENCE_THRESHOLD,
            nms_iou_threshold=settings.NMS_IOU_THRESHOLD,
            detection_mode=detection_mode,
        )


    # ── Helper: wall / column false-positive filter ──────────────────
    @staticmethod
    def _is_wall_or_column(
        rgb_arr: np.ndarray,
        x1: int, y1: int, x2: int, y2: int,
        img_w: int, img_h: int,
    ) -> bool:
        """
        Return True if the detected region looks like a wall or column
        rather than a glass panel.

        Heuristics:
        1. Colour variance — glass is transparent/reflective (high variance);
           plain concrete/walls are uniform (low variance).
        2. Minimum relative size — tiny slivers are not real panels.
        """
        # Guard: clamp coordinates
        x1 = max(0, x1); y1 = max(0, y1)
        x2 = min(img_w, x2); y2 = min(img_h, y2)

        if x2 <= x1 or y2 <= y1:
            return True  # degenerate box → reject

        # Minimum size check
        box_w = x2 - x1
        box_h = y2 - y1
        if box_w < img_w * _MIN_REL_SIZE or box_h < img_h * _MIN_REL_SIZE:
            return True

        # Colour variance check on the cropped region
        crop = rgb_arr[y1:y2, x1:x2]  # shape (H, W, 3)
        if crop.size == 0:
            return True

        # Use per-channel std-dev; average across R, G, B
        variance = float(np.mean(np.std(crop.reshape(-1, 3).astype(np.float32), axis=0)))
        logger.debug(f"  Box [{x1},{y1},{x2},{y2}] colour variance = {variance:.1f}")

        return variance < _MIN_COLOR_VARIANCE

    def draw_fallback_boxes(self, image: Image.Image, gemini_boxes: list[list[int]], inference_ms: float) -> DetectionResponse:
        """
        EMERGENCY FALLBACK ONLY — Gemini Vision bounding-box fallback.

        Called only when YOLO returns 0 detections and Gemini Vision
        provides bounding boxes as a last resort. Not a primary detection path.
        """
        import cv2
        import base64
        import numpy as np

        original_width, original_height = image.size
        cv_img = np.array(image.convert('RGB'))
        cv_img = cv_img[:, :, ::-1].copy()

        detections: list[Detection] = []
        valid_panel_count = 0
        raw_detections = []

        for box in gemini_boxes:
            if len(box) != 4:
                continue
            ymin_norm, xmin_norm, ymax_norm, xmax_norm = box
            y_min = int((ymin_norm / 1000.0) * original_height)
            x_min = int((xmin_norm / 1000.0) * original_width)
            y_max = int((ymax_norm / 1000.0) * original_height)
            x_max = int((xmax_norm / 1000.0) * original_width)
            
            raw_detections.append({
                "xyxy": [x_min, y_min, x_max, y_max],
                "conf": 0.99,
                "class_name": "glass_panel"
            })

        for det in raw_detections:
            xyxy = det["xyxy"]
            confidence = det["conf"]
            class_name = det["class_name"]

            x_min, y_min, x_max, y_max = map(int, xyxy)

            is_class_b = False
            margin = 5
            if (x_min <= margin or y_min <= margin or 
                x_max >= original_width - margin or y_max >= original_height - margin):
                is_class_b = True
                class_name = "partial_or_obscured"
            else:
                class_name = "full_glass_panel"

            detection = Detection(
                bounding_box=[float(x_min), float(y_min), float(x_max), float(y_max)],
                confidence_score=confidence,
                label=class_name,
            )
            detections.append(detection)

            if not is_class_b:
                valid_panel_count += 1
                color = (0, 0, 255) # PRO-RED
                overlay = cv_img.copy()
                cv2.rectangle(overlay, (x_min, y_min), (x_max, y_max), color, -1)
                cv2.addWeighted(overlay, 0.3, cv_img, 0.7, 0, cv_img)
                cv2.rectangle(cv_img, (x_min, y_min), (x_max, y_max), color, 2)

                label_text = f"PANEL #{valid_panel_count}"
                (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
                cv2.rectangle(cv_img, (x_min, y_min - th - 10), (x_min + tw + 10, y_min), color, -1)
                cv2.putText(cv_img, label_text, (x_min + 5, y_min - 7), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            else:
                color = (0, 0, 255)
                cv2.rectangle(cv_img, (x_min, y_min), (x_max, y_max), color, 2)

                label_text = "This part of the photo is not fully visible"
                (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
                y_text = y_min if y_min > th + 10 else y_min + th + 10
                cv2.rectangle(cv_img, (x_min, y_text - th - 10), (x_min + tw + 10, y_text), color, -1)
                cv2.putText(cv_img, label_text, (x_min + 5, y_text - 7), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 2)

        _, buffer = cv2.imencode('.jpg', cv_img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        encoded_image = base64.b64encode(buffer).decode('utf-8')
        annotated_image_base64 = f"data:image/jpeg;base64,{encoded_image}"

        return DetectionResponse(
            total_valid_panels=valid_panel_count,
            detections=detections,
            annotated_image_base64=annotated_image_base64,
            image_width=original_width,
            image_height=original_height,
            inference_time_ms=round(inference_ms, 1),
            model_version="gemini-vision-fallback",
            confidence_threshold=0.0,
            nms_iou_threshold=0.0,
            detection_mode="gemini-fallback",  # emergency fallback only
        )

# ── Singleton instance ────────────────────────────────────────────────
detector = GlassPanelDetector()

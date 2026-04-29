"""
BuildSphere CV Service — Pydantic Response Models.

Defines the exact JSON structure returned by the /detect-panels endpoint.
"""

from pydantic import BaseModel, Field


class Detection(BaseModel):
    """A single detected glass panel with its bounding box and confidence."""

    bounding_box: list[float] = Field(
        ...,
        description="Bounding box coordinates [x_min, y_min, x_max, y_max] in pixels",
        examples=[[120.5, 45.0, 340.2, 290.8]],
    )
    confidence_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Model confidence score for this detection",
        examples=[0.92],
    )
    label: str = Field(
        default="glass_panel",
        description="Class label for the detection",
    )
    # ── Segmentation support (YOLOv8-seg) ─────────────────────────────
    # Only populated when a segmentation model returns masks.
    # Format: [[x1, y1], [x2, y2], ...] — polygon vertices in pixel coords.
    polygon: list[list[float]] | None = Field(
        default=None,
        description=(
            "Polygon vertices [[x, y], ...] from YOLOv8-seg mask. "
            "None when using a standard detection model."
        ),
    )


class DetectionResponse(BaseModel):
    """
    Final response payload containing detection results, summary, and annotated image.
    """

    total_valid_panels: int = Field(
        ...,
        ge=0,
        description="Total number of fully visible (Class A) glass panels detected in the image",
        examples=[12],
    )
    summary_text: str | None = Field(
        None,
        description="AI-generated summary of the site audit.",
    )
    annotated_image_base64: str | None = Field(
        None,
        description="Base64 encoded JPEG image with drawn bounding boxes.",
    )
    detections: list[Detection] = Field(
        default_factory=list,
        description="Array of individual panel detections with bounding boxes",
    )
    image_width: int = Field(
        ...,
        description="Original image width in pixels",
    )
    image_height: int = Field(
        ...,
        description="Original image height in pixels",
    )
    inference_time_ms: float = Field(
        ...,
        ge=0.0,
        description="Time taken for model inference in milliseconds",
        examples=[45.2],
    )
    model_version: str = Field(
        ...,
        description="YOLO model identifier used for inference",
        examples=["yolov8m.pt"],
    )
    confidence_threshold: float = Field(
        ...,
        description="Confidence threshold used for filtering detections",
    )
    nms_iou_threshold: float = Field(
        ...,
        description="NMS IoU threshold used for suppressing overlapping boxes",
    )
    # ── Detection mode indicator ──────────────────────────────────────
    # "box" = standard YOLOv8 detection, "segmentation" = YOLOv8-seg,
    # "gemini-fallback" = Gemini Vision emergency fallback.
    detection_mode: str = Field(
        default="box",
        description=(
            "Detection method used: 'box' (YOLOv8), "
            "'segmentation' (YOLOv8-seg), or 'gemini-fallback'."
        ),
    )


class HealthResponse(BaseModel):
    """Response from the /health endpoint."""

    status: str = Field(default="healthy")
    model_loaded: bool = Field(default=False)
    model_path: str = Field(default="")
    version: str = Field(default="1.0.0")
    device: str = Field(
        default="cpu",
        description="Compute device (cpu/cuda)",
    )


class ErrorResponse(BaseModel):
    """Standardized error response."""

    error: str = Field(
        ...,
        description="Human-readable error message",
    )
    detail: str = Field(
        default="",
        description="Technical details for debugging",
    )
    status_code: int = Field(
        ...,
        description="HTTP status code",
    )

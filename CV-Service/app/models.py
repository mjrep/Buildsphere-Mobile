"""
BuildSphere CV Service - Pydantic response models.

The CV service returns YOLOv8 box detections. Python classifies full vs partial
panels, Gemini summarizes only, and the mobile user verifies the final count.
"""

from pydantic import BaseModel, Field


class Detection(BaseModel):
    """A single detected glass panel with box, confidence, and count status."""

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
    status: str = Field(
        default="full",
        description="'full' is counted; 'partial' or 'unclear' is excluded from the AI count",
        examples=["full"],
    )
    counted: bool = Field(
        default=True,
        description="Whether this detection contributed to total_valid_panels",
    )


class DetectionResponse(BaseModel):
    """Final payload containing counts, warnings, detections, and annotated image."""

    total_valid_panels: int = Field(
        ...,
        ge=0,
        description="Number of full glass panels counted by Python from YOLOv8 boxes",
        examples=[8],
    )
    partial_panels: int = Field(
        default=0,
        ge=0,
        description="Detected panels touching or near the image edge and excluded from the AI count",
    )
    unclear_panels: int = Field(
        default=0,
        ge=0,
        description="Detected panels excluded because they are unclear, if supported",
    )
    excluded_panels: int = Field(
        default=0,
        ge=0,
        description="All detections excluded from the final AI count",
    )
    excluded_low_confidence: int = Field(
        default=0,
        ge=0,
        description="Detections excluded below the configured confidence threshold",
    )
    excluded_duplicates: int = Field(
        default=0,
        ge=0,
        description="Detections removed by duplicate/overlap filtering",
    )
    excluded_contained: int = Field(
        default=0,
        ge=0,
        description="Smaller detections removed because they were mostly inside another box",
    )
    excluded_small_boxes: int = Field(
        default=0,
        ge=0,
        description="Detections excluded because they were too small relative to the image",
    )
    excluded_unrealistic_shape: int = Field(
        default=0,
        ge=0,
        description="Detections excluded because their aspect ratio looked unrealistic for a panel",
    )
    avg_confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Average confidence score across returned detections",
    )
    detection_mode: str = Field(
        default="box",
        description="'box' for regular YOLOv8 detection, or 'gemini-fallback' for emergency fallback",
    )
    has_warnings: bool = Field(
        default=False,
        description="True when partial or unclear panels were excluded",
    )
    warning_message: str | None = Field(
        default=None,
        description="Human-readable warning when panels were excluded from the AI count",
    )
    summary: str | None = Field(
        default=None,
        description="Gemini-generated professional summary of the structured CV result.",
    )
    summary_text: str | None = Field(
        default=None,
        description="Backward-compatible alias for the Gemini-generated summary.",
    )
    annotated_image_base64: str | None = Field(
        default=None,
        description="Base64 encoded JPEG image with drawn bounding boxes.",
    )
    detections: list[Detection] = Field(
        default_factory=list,
        description="Array of individual panel detections with bounding boxes",
    )
    image_width: int = Field(..., description="Original image width in pixels")
    image_height: int = Field(..., description="Original image height in pixels")
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


class HealthResponse(BaseModel):
    """Response from the /health endpoint."""

    status: str = Field(default="healthy")
    model_loaded: bool = Field(default=False)
    model_path: str = Field(default="")
    version: str = Field(default="1.0.0")
    device: str = Field(default="cpu", description="Compute device (cpu/cuda)")


class ErrorResponse(BaseModel):
    """Standardized error response."""

    error: str = Field(..., description="Human-readable error message")
    detail: str = Field(default="", description="Technical details for debugging")
    status_code: int = Field(..., description="HTTP status code")

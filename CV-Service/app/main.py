"""
BuildSphere CV Service — FastAPI Application.

Production-grade API for detecting and counting glass panels
on construction site images using YOLOv8.

Endpoints:
    POST /detect-panels   — Upload an image, get panel detections
    GET  /health           — Service health check
    GET  /                 — API info
"""

import io
import time
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError

from app.config import settings
from app.models import DetectionResponse, HealthResponse, ErrorResponse
from app.detection import detector

# ── Logging ───────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s │ %(levelname)-8s │ %(name)s │ %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Lifespan: load model on startup ──────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the YOLO model once at startup, release on shutdown."""
    logger.info("=" * 60)
    logger.info(f"  {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info(f"  Model: {settings.MODEL_PATH}")
    logger.info(f"  Confidence: {settings.CONFIDENCE_THRESHOLD}")
    logger.info(f"  NMS IoU: {settings.NMS_IOU_THRESHOLD}")
    logger.info(f"  Duplicate IoU: {settings.DUPLICATE_IOU_THRESHOLD}")
    logger.info(f"  Min box area ratio: {settings.MIN_BOX_AREA_RATIO}")
    logger.info(f"  Edge margin: {settings.EDGE_MARGIN}px")
    logger.info(f"  Glass counter debug: {settings.GLASS_COUNTER_DEBUG}")
    logger.info("=" * 60)

    try:
        detector.load_model()
    except RuntimeError as e:
        logger.error(f"FATAL: Could not load model — {e}")
        # Allow the server to start but /detect-panels will return 503

    yield  # Application runs here

    logger.info("Shutting down CV service...")


# ── FastAPI app ───────────────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "Computer vision API for detecting and counting glass panels "
        "on construction site images. Powered by YOLOv8 and Ultralytics."
    ),
    lifespan=lifespan,
)

# ── CORS — allow BuildSphere frontend & Node.js server ────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════════════
#  GLOBAL EXCEPTION HANDLER
# ══════════════════════════════════════════════════════════════════════
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all for unhandled exceptions."""
    logger.exception(f"Unhandled error on {request.url.path}: {exc}")
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error="Internal server error",
            detail=str(exc) if settings.DEBUG else "",
            status_code=500,
        ).model_dump(),
    )


# ══════════════════════════════════════════════════════════════════════
#  ROUTES
# ══════════════════════════════════════════════════════════════════════


@app.get("/", tags=["Info"])
async def root():
    """API landing page."""
    return {
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
        "endpoint": "POST /detect-panels",
    }


@app.get("/health", response_model=HealthResponse, tags=["Info"])
async def health_check():
    """
    Service health check.
    Returns model status and compute device information.
    """
    return HealthResponse(
        status="healthy" if detector.is_loaded else "degraded",
        model_loaded=detector.is_loaded,
        model_path=detector.model_path,
        version=settings.APP_VERSION,
        device=detector.device,
    )


@app.post(
    "/detect-panels",
    response_model=DetectionResponse,
    responses={
        400: {"model": ErrorResponse, "description": "Invalid file upload"},
        413: {"model": ErrorResponse, "description": "File too large"},
        415: {"model": ErrorResponse, "description": "Unsupported file type"},
        422: {"model": ErrorResponse, "description": "Unreadable image"},
        500: {"model": ErrorResponse, "description": "Internal error"},
        503: {"model": ErrorResponse, "description": "Model not loaded"},
        504: {"model": ErrorResponse, "description": "Inference timeout"},
    },
    tags=["Detection"],
    summary="Detect glass panels in an uploaded image",
    description=(
        "Upload a JPEG or PNG image from the construction site. "
        "Returns bounding boxes, confidence scores, and the total "
        "count of detected glass panels."
    ),
)
async def detect_panels(
    file: UploadFile = File(
        ...,
        description="Image file (JPEG, PNG, BMP, or WebP)",
    ),
):
    """
    **POST /detect-panels**

    Accepts an image upload and runs YOLOv8 inference to detect
    and count glass panels.

    **Returns:**
    - `total_glass_panels`: integer count
    - `detections`: array of `{ bounding_box, confidence_score, label }`
    - `inference_time_ms`: processing time
    """

    request_start = time.perf_counter()

    # ── 1. Check model availability ───────────────────────────────
    if not detector.is_loaded:
        raise HTTPException(
            status_code=503,
            detail="Model is not loaded. The server is starting up or encountered a loading error.",
        )

    # ── 2. Validate file presence ─────────────────────────────────
    if file is None or file.filename is None:
        raise HTTPException(
            status_code=400,
            detail="No file uploaded. Please attach an image file.",
        )

    # ── 3. Validate file extension ────────────────────────────────
    file_ext = Path(file.filename).suffix.lower()
    logger.info(f"Incoming file: {file.filename} (Ext: {file_ext}, Content-Type: {file.content_type})")
    
    if file_ext and file_ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type: '{file_ext}'. "
                f"Allowed: {', '.join(sorted(settings.ALLOWED_EXTENSIONS))}"
            ),
        )

    if not file_ext:
        # If extension is missing but the MIME type is a known image, allow it.
        if file.content_type and file.content_type.startswith("image/"):
            logger.info(f"Allowing based on mime-type: {file.content_type}")
        else:
            raise HTTPException(
                status_code=415,
                detail=(
                    f"Unsupported file type: '{file_ext}'. "
                    f"Allowed: {', '.join(sorted(settings.ALLOWED_EXTENSIONS))}"
                ),
            )

    # ── 4. Read and validate file size ────────────────────────────
    try:
        contents = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to read uploaded file: {e}",
        )

    if len(contents) == 0:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is empty.",
        )

    if len(contents) > settings.MAX_UPLOAD_SIZE_BYTES:
        size_mb = len(contents) / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=(
                f"File too large: {size_mb:.1f} MB. "
                f"Maximum allowed: {settings.MAX_UPLOAD_SIZE_MB} MB."
            ),
        )

    # ── 5. Decode image ───────────────────────────────────────────
    try:
        image = Image.open(io.BytesIO(contents))
        image = image.convert("RGB")  # Ensure 3-channel RGB
    except UnidentifiedImageError:
        raise HTTPException(
            status_code=422,
            detail="Cannot identify image file. The file may be corrupted or not a valid image.",
        )
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Failed to decode image: {e}",
        )

    # Basic sanity check on dimensions
    width, height = image.size
    if width < 10 or height < 10:
        raise HTTPException(
            status_code=422,
            detail=f"Image too small: {width}x{height}. Minimum: 10x10 pixels.",
        )

    if width > 10000 or height > 10000:
        raise HTTPException(
            status_code=422,
            detail=f"Image too large: {width}x{height}. Maximum: 10000x10000 pixels.",
        )

    logger.info(
        f"Processing: {file.filename} ({len(contents) / 1024:.0f} KB, "
        f"{width}x{height})"
    )

    # 6. Run inference (YOLO PRIMARY MODE).
    # YOLOv8 highlights glass panels with boxes. Python counts/classifies
    # full vs partial panels. Gemini summarizes only, and the user verifies
    # the final count before saving.
    from app.llm import generate_audit_summary, vision_box_fallback

    try:
        # Step 1: Detect using YOLO
        logger.info(f"CORE AUDIT: Running YOLO Primary Detection ({settings.MODEL_PATH})")
        result = detector.detect(image, file_size_bytes=len(contents))
        
        # Step 2: Emergency Fallback to Gemini Vision ONLY if YOLO returns no boxes.
        # If YOLO found partial panels, keep that warning instead of replacing it.
        if len(result.detections) == 0 and not settings.GLASS_COUNTER_DEBUG:
            logger.warning("YOLO returned no boxes. Attempting Gemini Vision emergency fallback...")
            gemini_boxes = vision_box_fallback(contents)
            
            if len(gemini_boxes) > 0:
                result = detector.draw_fallback_boxes(image, gemini_boxes, 0)
                logger.info(f"✅ Gemini Emergency Fallback: {result.total_valid_panels} panels found.")
            else:
                logger.info("Gemini Fallback also returned 0 detections.")
        elif len(result.detections) == 0:
            logger.warning("YOLO returned no boxes. Skipping Gemini fallback because GLASS_COUNTER_DEBUG=true.")

        # Step 3: Generate professional audit summary using structured values.
        avg_conf = result.avg_confidence
        summary = generate_audit_summary(
            total_valid_panels=result.total_valid_panels,
            partial_panels=result.partial_panels,
            unclear_panels=result.unclear_panels,
            avg_confidence=avg_conf,
            detection_mode=result.detection_mode,
            warning_message=result.warning_message,
        )
        result.summary = summary
        result.summary_text = summary
        
    except RuntimeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Inference failed: {e}",
        )
    except Exception as e:
        # Check if it looks like a timeout
        elapsed = time.perf_counter() - request_start
        if elapsed > settings.INFERENCE_TIMEOUT_SECONDS:
            raise HTTPException(
                status_code=504,
                detail=(
                    f"Inference timed out after {elapsed:.1f}s. "
                    f"Maximum: {settings.INFERENCE_TIMEOUT_SECONDS}s. "
                    "Try a smaller image or check server resources."
                ),
            )
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected inference error: {e}",
        )

    total_time = (time.perf_counter() - request_start) * 1000
    logger.info(
        f"✅ Result: {result.total_valid_panels} valid panels, "
        f"inference={result.inference_time_ms:.0f}ms, "
        f"total={total_time:.0f}ms"
    )

    return result


# ══════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info",
    )

"""
BuildSphere CV Service - Gemini AI integration.

Gemini summarizes structured detection results for the user. It does not decide
or override the count; YOLOv8 produces boxes and Python classifies/counts them.
"""

import json
import logging

import google.generativeai as genai

from app.config import settings

logger = logging.getLogger(__name__)

if settings.GEMINI_API_KEY:
    genai.configure(api_key=settings.GEMINI_API_KEY)


def generate_audit_summary(
    total_valid_panels: int,
    partial_panels: int = 0,
    unclear_panels: int = 0,
    avg_confidence: float = 0.0,
    detection_mode: str = "box",
    warning_message: str | None = None,
) -> str:
    """
    Generate a professional site audit summary using Gemini.

    Gemini receives structured values and summarizes only. The authoritative
    AI count remains total_valid_panels from Python post-processing.
    """
    fallback = _fallback_summary(
        total_valid_panels,
        partial_panels,
        unclear_panels,
        warning_message,
    )

    if not settings.GEMINI_API_KEY:
        return fallback

    model = _first_available_text_model()
    if not model:
        return fallback

    payload = {
        "total_valid_panels": total_valid_panels,
        "partial_panels": partial_panels,
        "unclear_panels": unclear_panels,
        "detection_mode": detection_mode,
        "warning_message": warning_message,
    }

    try:
        prompt = (
            "You are a BuildSphere construction audit summarizer.\n"
            "Use only the structured JSON below. Do not change, infer, or override the count.\n"
            "YOLOv8 detected glass panels with boxes. Python counted full panels and excluded partial panels. "
            "The user will verify the final count before saving.\n\n"
            f"Detection result JSON:\n{json.dumps(payload, indent=2)}\n\n"
            "Write one concise professional sentence. Mention excluded partial/unclear panels when present. "
            "Do not mention confidence percentages."
        )
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as exc:
        error_msg = str(exc).lower()
        if "429" in error_msg or "quota" in error_msg:
            logger.warning("Gemini summary hit quota/rate limit. Returning fallback summary.")
        else:
            logger.warning("Gemini summary failed: %s", exc)
        return fallback


def vision_box_fallback(image_bytes: bytes) -> list[list[int]]:
    """
    Emergency fallback only.

    Uses Gemini Vision to propose boxes only if YOLO returns no boxes. Python
    still classifies full vs partial and the user verifies the final count.
    """
    if not settings.GEMINI_API_KEY:
        return []

    try:
        model = _first_available_text_model(probe=True)
        if not model:
            logger.warning("No Gemini models available for fallback.")
            return []

        prompt = (
            "Emergency fallback for BuildSphere glass panel detection.\n"
            "Return ONLY a JSON array of bounding boxes for visible glass panels.\n"
            "Use [ymin, xmin, ymax, xmax] coordinates normalized from 0 to 1000.\n"
            "Do not provide prose."
        )

        response = model.generate_content(
            [
                prompt,
                {"mime_type": "image/jpeg", "data": image_bytes},
            ]
        )

        text = response.text.strip().replace("```json", "").replace("```", "").strip()
        boxes = json.loads(text)
        return boxes if isinstance(boxes, list) else []
    except Exception as exc:
        error_msg = str(exc).lower()
        if "429" in error_msg or "quota" in error_msg or "rate limit" in error_msg:
            logger.warning("Vision box fallback hit rate limit. Returning empty result.")
            return []
        logger.error("Vision box fallback failed: %s", exc)
        return []


def _first_available_text_model(probe: bool = False):
    for model_name in ("gemini-1.5-flash", "gemini-1.5-pro"):
        try:
            model = genai.GenerativeModel(model_name)
            if probe:
                model.generate_content("test")
            return model
        except Exception as exc:
            logger.warning("Gemini model %s unavailable: %s", model_name, exc)
    return None


def _fallback_summary(
    total_valid_panels: int,
    partial_panels: int,
    unclear_panels: int,
    warning_message: str | None,
) -> str:
    excluded = partial_panels + unclear_panels
    if excluded > 0:
        detail = warning_message or (
            f"{excluded} partial or unclear panels were excluded from the AI count."
        )
        return (
            f"{total_valid_panels} complete glass panels were detected. "
            f"{detail} Please retake the photo or verify manually before saving."
        )

    return f"{total_valid_panels} complete glass panels were detected. Please verify the final count before saving."

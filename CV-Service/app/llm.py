"""
BuildSphere CV Service — Gemini AI Integration.

Handles generating natural language summaries from detection statistics.
Supported by a YOLOv8 model trained on 170 site images.
"""

import logging
import google.generativeai as genai

from app.config import settings

logger = logging.getLogger(__name__)

# Configure Gemini if the key is available
if settings.GEMINI_API_KEY:
    genai.configure(api_key=settings.GEMINI_API_KEY)


def generate_audit_summary(total_valid_panels: int, avg_confidence: float) -> str:
    """
    Generate a professional site audit summary using Gemini.
    Gemini acts as the 'Auditor' — explaining the results to the user.
    """
    if not settings.GEMINI_API_KEY:
        return (
            f"Site Audit Complete. BuildSphere YOLO detected {total_valid_panels} "
            f"verified glass panels with an average confidence of {avg_confidence:.1%}."
        )

    models_to_try = [
        'gemini-1.5-flash',
        'gemini-1.5-pro'
    ]
    
    model = None
    last_error = None
    
    for model_name in models_to_try:
        try:
            model = genai.GenerativeModel(model_name)
            # No test generation here to save quota; we'll catch errors in the real call
            break
        except Exception as e:
            last_error = e
            continue

    if not model:
        return f"Site Audit: {total_valid_panels} glass panels verified ({avg_confidence:.1%} confidence)."

    try:
        prompt = (
            f"You are a BuildSphere Senior Construction Auditor.\n"
            f"Context: A Computer Vision scan (YOLO) has just completed.\n"
            f"Result: {total_valid_panels} glass panels were detected with {avg_confidence:.1%} average confidence.\n"
            "\n"
            "Task: Write a concise, 1-sentence professional audit summary for the site manager. "
            "Focus on the verification of the count. If confidence is low (below 60%), mention that "
            "manual verification is recommended."
        )
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        error_msg = str(e).lower()
        if "429" in error_msg or "quota" in error_msg:
            return f"Site Audit: {total_valid_panels} panels verified."
        return f"Site Audit: {total_valid_panels} panels detected."


def vision_box_fallback(image_bytes: bytes) -> list[list[int]]:
    """
    EMERGENCY FALLBACK ONLY.
    Uses Gemini Vision to detect bounding boxes of panels ONLY if YOLO returns 0 detections.
    Returns a list of boxes in [ymin, xmin, ymax, xmax] format (0-1000 scale).
    """
    if not settings.GEMINI_API_KEY:
        return []
        
    try:
        models_to_try = [
            'gemini-1.5-flash', 
            'gemini-1.5-pro'
        ]
        model = None
        for m_name in models_to_try:
            try:
                model = genai.GenerativeModel(m_name)
                # Quick probe to see if model is available/not rate limited
                model.generate_content("test")
                break
            except Exception as probe_err:
                probe_msg = str(probe_err).lower()
                if "429" in probe_msg or "quota" in probe_msg or "rate limit" in probe_msg:
                    logger.warning(f"Gemini model {m_name} rate-limited during fallback probe.")
                    continue
                continue
                
        if not model:
            logger.warning("No Gemini models available for fallback (all rate-limited or unavailable).")
            return []
            
        prompt = (
            "You are a Senior Construction Auditor specialized in High-Precision Glass Panel Detection.\n"
            "\n"
            "CRITICAL MISSION: You must provide an EXACT count of INSTALLED glass panels. Mistakes lead to multi-million dollar errors.\n"
            "\n"
            "DETECTION RULES (BE EXTREMELY CAREFUL):\n"
            "1. ONLY count physical glass panes that are transparent or reflective.\n"
            "2. LOOK FOR the 'glint', 'reflection', or 'transparency' that characterizes glass.\n"
            "3. DO NOT count brown wood panels, plywood slabs, or orange-tinted protective boards.\n"
            "4. DO NOT count grey concrete walls, columns, or textured plaster.\n"
            "5. DO NOT count floors, ceilings, or scaffolding components.\n"
            "6. For glass facades, count the INDIVIDUAL PANES separated by frames (mullions).\n"
            "\n"
            "Return ONLY a JSON array of bounding boxes in this exact format:\n"
            "[\n"
            "  [ymin, xmin, ymax, xmax],\n"
            "  ...\n"
            "]\n"
            "Coordinates must be integers normalized between 0 and 1000."
        )
        
        response = model.generate_content([
            prompt,
            {"mime_type": "image/jpeg", "data": image_bytes}
        ])
        
        text = response.text.strip().replace("```json", "").replace("```", "").strip()
        import json
        boxes = json.loads(text)
        if isinstance(boxes, list):
            return boxes
        return []
    except Exception as e:
        error_msg = str(e).lower()
        if "429" in error_msg or "quota" in error_msg or "rate limit" in error_msg:
            logger.warning("Vision box fallback hit rate limit during inference. Returning empty result.")
            return []
        logger.error(f"Vision box fallback failed: {e}")
        return []

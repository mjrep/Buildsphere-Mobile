"""
BuildSphere CV Service — API Tests.

Tests the /detect-panels endpoint with valid and invalid inputs
to ensure robust error handling and correct response format.

Usage:
    pytest tests/test_api.py -v
    pytest tests/test_api.py -v -k "test_detect"
"""

import io
import pytest
from pathlib import Path

from PIL import Image
from fastapi.testclient import TestClient

from app.main import app

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ══════════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════════

def create_test_image(width: int = 640, height: int = 480, color: str = "RGB") -> bytes:
    """Generate a simple test image as bytes."""
    img = Image.new(color, (width, height), color=(128, 200, 255))
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG")
    buffer.seek(0)
    return buffer.read()


def create_png_image(width: int = 640, height: int = 480) -> bytes:
    """Generate a PNG test image as bytes."""
    img = Image.new("RGB", (width, height), color=(100, 150, 200))
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return buffer.read()


# ══════════════════════════════════════════════════════════════════════
#  INFO & HEALTH ENDPOINTS
# ══════════════════════════════════════════════════════════════════════

class TestInfoEndpoints:
    """Test the informational endpoints."""

    def test_root_returns_service_info(self, client):
        """GET / should return service name and docs link."""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "service" in data
        assert "docs" in data
        assert data["docs"] == "/docs"

    def test_health_check(self, client):
        """GET /health should return model status."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "model_loaded" in data
        assert "device" in data
        assert isinstance(data["model_loaded"], bool)


# ══════════════════════════════════════════════════════════════════════
#  DETECTION ENDPOINT — HAPPY PATH
# ══════════════════════════════════════════════════════════════════════

class TestDetectPanelsValid:
    """Test /detect-panels with valid inputs."""

    def test_detect_jpeg_image(self, client):
        """POST /detect-panels with a valid JPEG should return 200."""
        image_bytes = create_test_image()
        response = client.post(
            "/detect-panels",
            files={"file": ("test_image.jpg", image_bytes, "image/jpeg")},
        )
        assert response.status_code == 200
        data = response.json()

        # Validate response structure
        assert "total_valid_panels" in data
        assert "partial_panels" in data
        assert "excluded_panels" in data
        assert data["detection_mode"] == "box"
        assert "detections" in data
        assert "image_width" in data
        assert "image_height" in data
        assert "inference_time_ms" in data
        assert "model_version" in data
        assert "confidence_threshold" in data
        assert "nms_iou_threshold" in data

        # Validate types
        assert isinstance(data["total_valid_panels"], int)
        assert isinstance(data["detections"], list)
        assert isinstance(data["inference_time_ms"], (int, float))
        assert data["total_valid_panels"] >= 0

    def test_detect_png_image(self, client):
        """POST /detect-panels with a valid PNG should return 200."""
        image_bytes = create_png_image()
        response = client.post(
            "/detect-panels",
            files={"file": ("test_image.png", image_bytes, "image/png")},
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_valid_panels" in data

    def test_detection_response_format(self, client):
        """Each detection should have bounding_box, confidence_score, and label."""
        image_bytes = create_test_image(1280, 720)
        response = client.post(
            "/detect-panels",
            files={"file": ("test.jpg", image_bytes, "image/jpeg")},
        )
        assert response.status_code == 200
        data = response.json()

        for det in data["detections"]:
            assert "bounding_box" in det
            assert "confidence_score" in det
            assert "label" in det
            assert "status" in det
            assert "counted" in det
            assert len(det["bounding_box"]) == 4
            assert 0.0 <= det["confidence_score"] <= 1.0

    def test_image_dimensions_returned(self, client):
        """Response should include original image dimensions."""
        image_bytes = create_test_image(800, 600)
        response = client.post(
            "/detect-panels",
            files={"file": ("test.jpg", image_bytes, "image/jpeg")},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["image_width"] == 800
        assert data["image_height"] == 600


# ══════════════════════════════════════════════════════════════════════
#  DETECTION ENDPOINT — ERROR CASES
# ══════════════════════════════════════════════════════════════════════

class TestDetectPanelsErrors:
    """Test /detect-panels error handling."""

    def test_no_file_uploaded(self, client):
        """POST /detect-panels with no file should return 422."""
        response = client.post("/detect-panels")
        assert response.status_code == 422

    def test_unsupported_file_type(self, client):
        """POST /detect-panels with a .txt file should return 415."""
        response = client.post(
            "/detect-panels",
            files={"file": ("test.txt", b"not an image", "text/plain")},
        )
        assert response.status_code == 415

    def test_unsupported_gif_extension(self, client):
        """POST /detect-panels with a .gif file should return 415."""
        response = client.post(
            "/detect-panels",
            files={"file": ("animation.gif", b"GIF89a", "image/gif")},
        )
        assert response.status_code == 415

    def test_empty_file(self, client):
        """POST /detect-panels with an empty file should return 400."""
        response = client.post(
            "/detect-panels",
            files={"file": ("empty.jpg", b"", "image/jpeg")},
        )
        assert response.status_code == 400

    def test_corrupt_image(self, client):
        """POST /detect-panels with corrupt bytes should return 422."""
        response = client.post(
            "/detect-panels",
            files={"file": ("corrupt.jpg", b"this is not a real image", "image/jpeg")},
        )
        assert response.status_code == 422

    def test_tiny_image_rejected(self, client):
        """POST /detect-panels with a 1x1 image should return 422."""
        image_bytes = create_test_image(1, 1)
        response = client.post(
            "/detect-panels",
            files={"file": ("tiny.jpg", image_bytes, "image/jpeg")},
        )
        assert response.status_code == 422

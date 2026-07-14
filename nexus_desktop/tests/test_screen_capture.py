import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from PIL import Image

from utils import screen_capture


def test_capture_jpeg_bytes_returns_jpeg(monkeypatch):
    monkeypatch.setattr(
        "utils.screen_capture.pyautogui.screenshot",
        lambda: Image.new("RGB", (800, 600), "white"),
    )
    data = screen_capture.capture_jpeg_bytes()
    assert isinstance(data, bytes)
    # JPEG magic bytes.
    assert data[:2] == b"\xff\xd8"


def test_capture_downscales_longest_side(monkeypatch):
    captured = {}

    class FakeImage:
        size = (2000, 1000)

        def resize(self, size):
            captured["resized_to"] = size
            return self

        def convert(self, mode):
            return Image.new("RGB", (10, 10), "white")

    monkeypatch.setattr("utils.screen_capture.pyautogui.screenshot", lambda: FakeImage())
    screen_capture.capture_jpeg_bytes(max_side=1280)
    # Longest side 2000 -> 1280, scale 0.64, so (1280, 640).
    assert captured["resized_to"] == (1280, 640)


def test_data_url_from_jpeg_bytes_wraps_base64():
    url = screen_capture.data_url_from_jpeg_bytes(b"\xff\xd8fake")
    assert url.startswith("data:image/jpeg;base64,")


def test_capture_jpeg_data_url_roundtrip(monkeypatch):
    monkeypatch.setattr(
        "utils.screen_capture.pyautogui.screenshot",
        lambda: Image.new("RGB", (100, 100), "white"),
    )
    url = screen_capture.capture_jpeg_data_url()
    assert url.startswith("data:image/jpeg;base64,")
    assert len(url) > 100

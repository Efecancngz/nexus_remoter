"""Shared screen capture: screenshot -> downscaled JPEG -> base64 data URL.

Used by the SCREENSHOT action and the /ai/locate vision route so both share
one capture pipeline.
"""
import base64
import io

import pyautogui

_MAX_SIDE = 1280
_JPEG_QUALITY = 70


def capture_jpeg_bytes(max_side=_MAX_SIDE, quality=_JPEG_QUALITY):
    """Grab the screen, downscale so the longest side <= max_side, return JPEG bytes."""
    image = pyautogui.screenshot()
    width, height = image.size
    longest = max(width, height)
    if longest > max_side:
        scale = max_side / longest
        image = image.resize((int(width * scale), int(height * scale)))
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def data_url_from_jpeg_bytes(jpeg):
    b64 = base64.b64encode(jpeg).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def capture_jpeg_data_url(max_side=_MAX_SIDE, quality=_JPEG_QUALITY):
    return data_url_from_jpeg_bytes(capture_jpeg_bytes(max_side, quality))

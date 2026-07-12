import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions.base import ActionContext

CTX = ActionContext(bus=None)


class TestScreenshot:
    def test_returns_jpeg_data_url(self, monkeypatch):
        from PIL import Image
        from actions.screenshot import ScreenshotAction

        monkeypatch.setattr(
            "actions.screenshot.pyautogui.screenshot",
            lambda: Image.new("RGB", (2000, 1000), "white"),
        )
        result = ScreenshotAction().execute("", CTX)
        assert isinstance(result, str)
        assert result.startswith("data:image/jpeg;base64,")
        assert len(result) > 100


class TestClipboard:
    def test_set_calls_set_text(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.clipboard.set_text", lambda t: calls.append(t))
        from actions.clipboard import ClipboardSetAction

        assert ClipboardSetAction().execute("hello", CTX) is None
        assert calls == ["hello"]

    def test_get_returns_text_payload(self, monkeypatch):
        monkeypatch.setattr("actions.clipboard.get_text", lambda: "board text")
        from actions.clipboard import ClipboardGetAction

        assert ClipboardGetAction().execute("", CTX) == {"text": "board text"}

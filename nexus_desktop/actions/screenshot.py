import base64
import io

import pyautogui

from .base import Action
from .registry import register_action

_MAX_SIDE = 1280
_JPEG_QUALITY = 70


@register_action("SCREENSHOT")
class ScreenshotAction(Action):
    prompt_examples = [
        '- "Ekran görüntüsü al": {{ "type": "SCREENSHOT", "value": "", "description": "Ekran görüntüsü alınıyor" }}',
    ]
    prompt_hint = "Ekranın fotoğrafını istemek için SCREENSHOT kullan."

    def execute(self, value, context):
        image = pyautogui.screenshot()
        width, height = image.size
        longest = max(width, height)
        if longest > _MAX_SIDE:
            scale = _MAX_SIDE / longest
            image = image.resize((int(width * scale), int(height * scale)))
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="JPEG", quality=_JPEG_QUALITY)
        b64 = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"

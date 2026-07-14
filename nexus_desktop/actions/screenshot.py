from utils.screen_capture import capture_jpeg_data_url

from .base import Action
from .registry import register_action


@register_action("SCREENSHOT")
class ScreenshotAction(Action):
    prompt_examples = [
        '- "Ekran görüntüsü al": {{ "type": "SCREENSHOT", "value": "", "description": "Ekran görüntüsü alınıyor" }}',
    ]
    prompt_hint = "Ekranın fotoğrafını istemek için SCREENSHOT kullan."

    def execute(self, value, context):
        return capture_jpeg_data_url()

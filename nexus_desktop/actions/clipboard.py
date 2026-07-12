from utils.win_clipboard import get_text, set_text

from .base import Action
from .registry import register_action


@register_action("CLIPBOARD_SET")
class ClipboardSetAction(Action):
    prompt_examples = [
        '- "Panoya \'merhaba\' kopyala": {{ "type": "CLIPBOARD_SET", "value": "merhaba", "description": "Panoya kopyalanıyor" }}',
    ]
    prompt_hint = "Panoya metin koymak için CLIPBOARD_SET kullan."

    def execute(self, value, context):
        set_text(value or "")


@register_action("CLIPBOARD_GET")
class ClipboardGetAction(Action):
    prompt_examples = [
        '- "Panodaki metni oku": {{ "type": "CLIPBOARD_GET", "value": "", "description": "Pano okunuyor" }}',
    ]
    prompt_hint = "Panodaki metni okumak için CLIPBOARD_GET kullan."

    def execute(self, value, context):
        return {"text": get_text()}

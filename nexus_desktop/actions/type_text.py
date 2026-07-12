import pyautogui

from .base import Action
from .registry import register_action


@register_action("TYPE_TEXT")
class TypeTextAction(Action):
    prompt_examples = [
        '- "Merhaba dünya yaz": {{ "type": "TYPE_TEXT", "value": "Merhaba dünya", "description": "Metin yazılıyor" }}',
    ]
    prompt_hint = 'Odaklı alana metin yazmak için TYPE_TEXT kullan (uzun metin için; tek tuş için KEYPRESS).'

    def execute(self, value, context):
        if not (value or '').strip():
            raise ValueError("Empty text")
        pyautogui.write(value, interval=0.02)

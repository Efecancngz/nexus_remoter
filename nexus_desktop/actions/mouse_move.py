import pyautogui

from ._coords import parse_coord
from .base import Action
from .registry import register_action


@register_action("MOUSE_MOVE")
class MouseMoveAction(Action):
    prompt_examples = [
        '- "Fareyi ekranın ortasına götür": {{ "type": "MOUSE_MOVE", "value": "50%,50%", "description": "Fare ortaya taşınıyor" }}',
    ]
    prompt_hint = 'Fare imlecini taşımak için MOUSE_MOVE kullan (value: "50%,50%" gibi).'

    def execute(self, value, context):
        parts = [p.strip() for p in (value or '').split(',')]
        if len(parts) != 2:
            raise ValueError(f"Invalid MOUSE_MOVE value: {value!r}")
        width, height = pyautogui.size()
        x = parse_coord(parts[0], width)
        y = parse_coord(parts[1], height)
        pyautogui.moveTo(x, y)


@register_action("MOUSE_SCROLL")
class MouseScrollAction(Action):
    prompt_examples = [
        '- "Aşağı kaydır": {{ "type": "MOUSE_SCROLL", "value": "-500", "description": "Aşağı kaydırılıyor" }}',
    ]
    prompt_hint = 'Sayfayı kaydırmak için MOUSE_SCROLL kullan (pozitif yukarı, negatif aşağı, örn: "-500").'

    def execute(self, value, context):
        try:
            amount = int((value or '').strip())
        except ValueError:
            raise ValueError(f"Invalid MOUSE_SCROLL amount: {value!r}")
        pyautogui.scroll(amount)

import pyautogui

from ._coords import parse_coord
from .base import Action
from .registry import register_action

_BUTTONS = ('left', 'right', 'double')


@register_action("MOUSE_CLICK")
class MouseClickAction(Action):
    prompt_examples = [
        '- "Ekranın ortasına tıkla": {{ "type": "MOUSE_CLICK", "value": "50%,50%", "description": "Ekran ortasına tıklanıyor" }}',
    ]
    prompt_hint = (
        'MOUSE_CLICK koordinatlarını yüzde olarak ver (örn: "50%,50%" ekran '
        'ortası). İsteğe bağlı üçüncü parça buton: left, right veya double.'
    )

    def execute(self, value, context):
        parts = [p.strip() for p in (value or '').split(',')]
        if len(parts) not in (2, 3):
            raise ValueError(f"Invalid MOUSE_CLICK value: {value!r}")
        button = parts[2].lower() if len(parts) == 3 else 'left'
        if button not in _BUTTONS:
            raise ValueError(f"Invalid mouse button: {button!r}")
        width, height = pyautogui.size()
        x = parse_coord(parts[0], width)
        y = parse_coord(parts[1], height)
        if button == 'double':
            pyautogui.doubleClick(x, y)
        else:
            pyautogui.click(x, y, button=button)

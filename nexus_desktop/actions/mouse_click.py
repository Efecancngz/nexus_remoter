import pyautogui

from .base import Action
from .registry import register_action

_BUTTONS = ('left', 'right', 'double')


def _parse_coord(part, span):
    part = part.strip()
    try:
        if part.endswith('%'):
            pixel = int(span * float(part[:-1]) / 100)
        else:
            pixel = int(part)
    except ValueError:
        raise ValueError(f"Invalid coordinate: {part!r}")
    return max(0, min(pixel, span - 1))


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
        x = _parse_coord(parts[0], width)
        y = _parse_coord(parts[1], height)
        if button == 'double':
            pyautogui.doubleClick(x, y)
        else:
            pyautogui.click(x, y, button=button)

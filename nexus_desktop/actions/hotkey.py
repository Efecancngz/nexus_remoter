import pyautogui

from .base import Action
from .registry import register_action

_ALLOWED_KEYS = (
    {chr(c) for c in range(ord('a'), ord('z') + 1)}
    | {str(d) for d in range(10)}
    | {f'f{i}' for i in range(1, 25)}
    | {
        'ctrl', 'alt', 'shift', 'win', 'enter', 'tab', 'esc', 'space',
        'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
        'delete', 'backspace', 'insert', 'capslock', 'printscreen',
        'volumemute', 'volumeup', 'volumedown', 'playpause', 'nexttrack', 'prevtrack',
    }
)


@register_action("HOTKEY")
class HotkeyAction(Action):
    prompt_examples = [
        '- "Kaydet": {{ "type": "HOTKEY", "value": "ctrl+s", "description": "Kaydediliyor" }}',
        '- "Sekmeyi kapat": {{ "type": "HOTKEY", "value": "ctrl+w", "description": "Sekme kapatılıyor" }}',
    ]
    prompt_hint = (
        'Tuş kombinasyonları için HER ZAMAN HOTKEY kullan (value: "ctrl+s" '
        'gibi, tuşlar + ile ayrılır). Tek tuş veya metin yazmak için KEYPRESS kullan.'
    )

    def execute(self, value, context):
        keys = [k.strip().lower() for k in (value or '').split('+')]
        if not keys or any(not k for k in keys):
            raise ValueError(f"Invalid hotkey: {value!r}")
        for key in keys:
            if key not in _ALLOWED_KEYS:
                raise ValueError(f"Key not allowed in hotkey: {key!r}")
        pyautogui.hotkey(*keys)

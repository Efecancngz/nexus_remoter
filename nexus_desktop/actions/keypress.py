import pyautogui

from .base import Action
from .registry import register_action

_SPECIAL_KEYS = [
    'enter', 'tab', 'esc', 'space', 'backspace', 'delete',
    'up', 'down', 'left', 'right', 'win', 'ctrl', 'alt', 'shift', 'capslock'
]


@register_action("KEYPRESS")
class KeypressAction(Action):
    def execute(self, value, context):
        val_lower = value.lower()
        if val_lower in _SPECIAL_KEYS:
            pyautogui.press(val_lower)
        else:
            pyautogui.write(value, interval=0.05)

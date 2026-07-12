from utils.name_match import best_match
from utils.win_windows import get_foreground, list_windows, maximize, minimize, restore

from .base import Action
from .registry import register_action

_OPS = ('minimize', 'maximize', 'restore')


@register_action("WINDOW_MANAGE")
class WindowManageAction(Action):
    prompt_examples = [
        '- "Spotify\'ı küçült": {{ "type": "WINDOW_MANAGE", "value": "minimize spotify", "description": "Spotify küçültülüyor" }}',
        '- "Pencereyi büyüt": {{ "type": "WINDOW_MANAGE", "value": "maximize", "description": "Pencere büyütülüyor" }}',
    ]
    prompt_hint = (
        'Pencere küçültme/büyütme/eski haline getirme için WINDOW_MANAGE kullan '
        '(value: "minimize", "maximize" veya "restore"; isteğe bağlı olarak '
        'ardından pencere adı, örn: "minimize spotify"). Ad verilmezse öndeki '
        'pencereye uygulanır.'
    )

    def execute(self, value, context):
        parts = (value or '').strip().split(None, 1)
        if not parts:
            raise ValueError("Empty WINDOW_MANAGE value")
        op = parts[0].lower()
        if op not in _OPS:
            raise ValueError(f"Unknown window op: {op!r}")
        target = parts[1] if len(parts) == 2 else ''

        if target:
            titles = {title: hwnd for hwnd, title, _pid in list_windows()}
            winner = best_match(target, titles.keys())
            if winner is None:
                raise ValueError(f"No window matches: {target!r}")
            hwnd = titles[winner]
        else:
            hwnd = get_foreground()
            if not hwnd:
                raise ValueError("No foreground window")

        if op == 'minimize':
            minimize(hwnd)
        elif op == 'maximize':
            maximize(hwnd)
        else:
            restore(hwnd)

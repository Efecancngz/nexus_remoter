from utils.name_match import best_match
from utils.win_windows import focus_window_handle, list_windows

from .base import Action
from .registry import register_action


@register_action("FOCUS_WINDOW")
class FocusWindowAction(Action):
    prompt_examples = [
        '- "Spotify penceresine geç": {{ "type": "FOCUS_WINDOW", "value": "spotify", "description": "Spotify öne getiriliyor" }}',
    ]
    prompt_hint = (
        "Açık bir uygulamaya tuş göndermeden önce FOCUS_WINDOW ile pencereyi "
        "öne getir."
    )

    def execute(self, value, context):
        if not (value or '').strip():
            raise ValueError("Empty window name")
        windows = list_windows()
        titles = {title: hwnd for hwnd, title, _pid in windows}
        # Looser than the 0.75 default (kept for CLOSE_APP): window titles
        # embed extra words ("Spotify Premium"), and misfocusing is
        # reversible — unlike killing the wrong process.
        winner = best_match(value, titles.keys(), threshold=0.6)
        if winner is None:
            raise ValueError(f"No window matches: {value!r}")
        focus_window_handle(titles[winner])

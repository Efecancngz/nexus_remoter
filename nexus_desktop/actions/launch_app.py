import logging
import os

from utils.win_search import find_installed_app

from ._targets import APP_TARGETS
from .base import Action
from .registry import register_action


@register_action("LAUNCH_APP")
class LaunchAppAction(Action):
    prompt_examples = [
        '- "Spotify aç": {{ "type": "LAUNCH_APP", "value": "spotify", "description": "Spotify açılıyor" }}',
        '- "Hesap makinesi aç": {{ "type": "LAUNCH_APP", "value": "calculator", "description": "Hesap makinesi açılıyor" }}',
        '- "cs2 aç": {{ "type": "LAUNCH_APP", "value": "counter strike 2", "description": "Counter-Strike 2 açılıyor" }}',
    ]
    prompt_hint = "Uygulama açmak için HER ZAMAN LAUNCH_APP kullan."

    def execute(self, value, context):
        lower_val = value.lower().strip()
        target = APP_TARGETS.get(lower_val)
        if target:
            os.startfile(target)
            return
        # Smart Search: look up an installed app by name and launch its
        # resolved executable path directly (no shell involved).
        try:
            app_path = find_installed_app(lower_val)
            if app_path:
                os.startfile(app_path)
            else:
                raise ValueError(f"App not found and not in allowlist: {value!r}")
        except Exception as e:
            logging.warning(f"[LaunchApp] App launch error: {e}")
            raise

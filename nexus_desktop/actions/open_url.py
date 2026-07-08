import webbrowser

from .base import Action
from .registry import register_action


@register_action("OPEN_URL")
class OpenUrlAction(Action):
    prompt_examples = [
        '- "Youtube\'u aç": {{ "type": "OPEN_URL", "value": "https://youtube.com", "description": "Youtube açılıyor" }}',
    ]

    def execute(self, value, context):
        webbrowser.open(value)

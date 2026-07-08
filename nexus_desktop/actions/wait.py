import time

from .base import Action
from .registry import register_action


@register_action("WAIT")
class WaitAction(Action):
    prompt_hint = "Ardışık işlemlerde araya mutlaka bekleme (WAIT) koy."

    def execute(self, value, context):
        time.sleep(float(value))

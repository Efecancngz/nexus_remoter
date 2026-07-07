"""Base types for action modules."""
from dataclasses import dataclass


@dataclass
class ActionContext:
    """What the host hands every action at execute time."""
    bus: object  # core.event_bus.EventBus


class Action:
    """Base class for actions.

    Subclasses set `prompt_examples` (Turkish example lines shown to
    Gemini) and optionally `prompt_hint` (a rule sentence appended to the
    system prompt), and implement `execute`.
    """
    prompt_examples: list = []
    prompt_hint: str = ""

    def execute(self, value, context):
        raise NotImplementedError

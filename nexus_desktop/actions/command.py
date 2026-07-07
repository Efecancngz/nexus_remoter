import os
import shlex

from ._targets import APP_TARGETS
from .base import Action
from .registry import register_action


@register_action("COMMAND")
class CommandAction(Action):
    """Only names known to APP_TARGETS are allowed; arbitrary shell strings
    are rejected instead of being executed."""
    prompt_hint = (
        'COMMAND tipini sadece agent\'ın izin verdiği kısa uygulama adları '
        'için kullan (örn: "calc", "notepad") — asla ham shell komutları '
        '(örn: "shutdown /s /t 0", "del ...") üretme, bunlar reddedilir.'
    )

    def execute(self, value, context):
        if not value:
            raise ValueError("Empty command")
        # Only the bare action name is honored — any extra shell-style
        # arguments in `value` are rejected rather than passed through.
        first_token = shlex.split(value.lower().strip())[0] if value.strip() else ''
        target = APP_TARGETS.get(first_token)
        if not target:
            raise ValueError(f"Command not in allowlist: {value!r}")
        os.startfile(target)

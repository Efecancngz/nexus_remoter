"""Volume actions: thin bus-event publishers. The pycaw logic lives in
services.media_service, which subscribes to these events."""
from .base import Action
from .registry import register_action


class _Republish(Action):
    def execute(self, value, context):
        context.bus.publish(self.action_type, {"value": value})


@register_action("VOLUME_SET")
class VolumeSetAction(_Republish):
    prompt_examples = [
        '- "Sesi 30 yap": {{ "type": "VOLUME_SET", "value": "30", "description": "Ses %30 yapılıyor" }}',
    ]


@register_action("VOLUME_MUTE")
class VolumeMuteAction(_Republish):
    prompt_examples = [
        '- "Sesi kapat": {{ "type": "VOLUME_MUTE", "value": "true", "description": "Ses kapatılıyor" }}',
    ]

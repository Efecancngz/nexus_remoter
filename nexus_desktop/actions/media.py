"""Media-key actions: thin bus-event publishers handled by MediaService."""
from .registry import register_action
from .volume import _Republish


@register_action("MEDIA_PLAY_PAUSE")
class MediaPlayPauseAction(_Republish):
    pass


@register_action("MEDIA_NEXT")
class MediaNextAction(_Republish):
    pass


@register_action("MEDIA_PREV")
class MediaPrevAction(_Republish):
    pass

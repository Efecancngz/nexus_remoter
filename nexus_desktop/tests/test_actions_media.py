import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions.base import ActionContext
from actions.registry import get_action


class _FakeBus:
    def __init__(self):
        self.published = []

    def publish(self, name, payload):
        self.published.append((name, payload))


@pytest.mark.parametrize("action_type", [
    "VOLUME_SET", "VOLUME_MUTE", "MEDIA_PLAY_PAUSE", "MEDIA_NEXT", "MEDIA_PREV",
])
def test_media_actions_republish_to_media_service(action_type):
    bus = _FakeBus()
    cls = get_action(action_type)
    assert cls is not None, f"{action_type} not registered"
    cls().execute("55", ActionContext(bus=bus))
    assert bus.published == [(action_type, {"value": "55"})]

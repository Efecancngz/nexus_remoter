import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from actions.base import ActionContext
from services.automation_service import AutomationService


class _FakeBus:
    def __init__(self):
        self.published = []

    def publish(self, name, payload):
        self.published.append((name, payload))


def _service():
    svc = AutomationService.__new__(AutomationService)
    svc.bus = _FakeBus()
    svc.context = ActionContext(bus=svc.bus)
    return svc


def test_known_action_dispatches_and_publishes_completed(monkeypatch):
    svc = _service()
    calls = []
    monkeypatch.setattr("actions.open_url.webbrowser.open", lambda url: calls.append(url))
    svc._execute_action({"type": "OPEN_URL", "value": "https://example.com", "id": "1"})
    assert calls == ["https://example.com"]
    assert svc.bus.published == [("ACTION_COMPLETED", {"status": "success", "id": "1", "data": None})]


def test_unknown_action_publishes_failed():
    svc = _service()
    svc._execute_action({"type": "NO_SUCH_ACTION", "value": "", "id": "2"})
    assert svc.bus.published[0][0] == "ACTION_FAILED"
    assert "NO_SUCH_ACTION" in svc.bus.published[0][1]["error"]


def test_action_error_publishes_failed():
    svc = _service()
    # COMMAND with a non-allowlisted value raises inside the action
    svc._execute_action({"type": "COMMAND", "value": "rm -rf /", "id": "3"})
    assert svc.bus.published[0][0] == "ACTION_FAILED"


def test_action_return_value_included_as_data(monkeypatch):
    svc = _service()

    class FakeAction:
        def execute(self, value, context):
            return {"text": "hi"}

    monkeypatch.setattr("services.automation_service.get_action", lambda t: FakeAction)
    svc._execute_action({"type": "X", "value": "", "id": "9"})
    name, payload = svc.bus.published[0]
    assert name == "ACTION_COMPLETED"
    assert payload["data"] == {"text": "hi"}
    assert payload["id"] == "9"


def test_effect_action_data_is_none(monkeypatch):
    svc = _service()

    class FakeAction:
        def execute(self, value, context):
            return None

    monkeypatch.setattr("services.automation_service.get_action", lambda t: FakeAction)
    svc._execute_action({"type": "X", "value": "", "id": "10"})
    assert svc.bus.published[0][1]["data"] is None

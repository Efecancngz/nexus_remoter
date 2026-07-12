import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from core.event_bus import EventBus
from core.security_manager import SecurityManager
from services.api_service import ApiService


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])
    bus = EventBus()
    sec = SecurityManager()
    svc = ApiService("API", bus, sec, start_server=False)
    svc.on_start()
    svc.app.testing = True
    token = sec.issue_token()
    return svc.app.test_client(), bus, svc, token


def _hdr(token):
    return {"X-Nexus-Token": token}


def test_execute_returns_success_when_action_completes(client):
    app_client, bus, svc, token = client
    bus.subscribe(
        "COMMAND_RECEIVED",
        lambda ev: bus.publish("ACTION_COMPLETED", {"status": "success", "id": ev.payload["id"]}),
    )
    res = app_client.post(
        "/execute",
        json={"id": "r1", "type": "LAUNCH_APP", "value": "spotify"},
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json() == {"success": True, "error": None}


def test_execute_returns_failure_with_error(client):
    app_client, bus, svc, token = client
    bus.subscribe(
        "COMMAND_RECEIVED",
        lambda ev: bus.publish("ACTION_FAILED", {"error": "No running app matches", "id": ev.payload["id"]}),
    )
    res = app_client.post(
        "/execute",
        json={"id": "r2", "type": "CLOSE_APP", "value": "spotify"},
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json() == {"success": False, "error": "No running app matches"}


def test_execute_times_out_when_no_result(client):
    app_client, bus, svc, token = client
    svc.EXECUTE_TIMEOUT = 0.1
    res = app_client.post(
        "/execute",
        json={"id": "r3", "type": "LAUNCH_APP", "value": "spotify"},
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json() == {"success": False, "error": "Action timed out"}


def test_schedule_action_returns_queued_without_waiting(client):
    app_client, bus, svc, token = client
    svc.EXECUTE_TIMEOUT = 0.1
    captured = []
    bus.subscribe("SCHEDULE_ACTION", lambda ev: captured.append(ev.payload))
    res = app_client.post(
        "/execute",
        json={"id": "s1", "type": "SCHEDULE_ACTION", "value": "..."},
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json()["status"] == "queued"
    assert len(captured) == 1


def test_missing_id_returns_queued_without_waiting(client):
    app_client, bus, svc, token = client
    svc.EXECUTE_TIMEOUT = 0.1
    res = app_client.post(
        "/execute",
        json={"type": "LAUNCH_APP", "value": "spotify"},
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json()["status"] == "queued"

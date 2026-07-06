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
    return svc.app.test_client(), sec


def test_pair_with_correct_pin_returns_token(client):
    app_client, sec = client
    res = app_client.post('/pair', json={'pin': sec.pin})
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    assert 'token' in body and len(body['token']) > 20


def test_pair_with_wrong_pin_rejected(client):
    app_client, sec = client
    wrong = "0000" if sec.pin != "0000" else "1111"
    res = app_client.post('/pair', json={'pin': wrong})
    assert res.status_code == 401


def test_execute_without_token_rejected(client):
    app_client, _ = client
    res = app_client.post('/execute', json={'type': 'WAIT', 'value': '1'})
    assert res.status_code == 401


def test_execute_with_invalid_token_rejected(client):
    app_client, _ = client
    res = app_client.post(
        '/execute',
        json={'type': 'WAIT', 'value': '1'},
        headers={'X-Nexus-Token': 'bogus-token'},
    )
    assert res.status_code == 401


def test_execute_with_valid_token_accepted(client):
    app_client, sec = client
    pair_res = app_client.post('/pair', json={'pin': sec.pin})
    token = pair_res.get_json()['token']

    res = app_client.post(
        '/execute',
        json={'type': 'WAIT', 'value': '1'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    assert res.get_json()['success'] is True


def test_stats_requires_token(client):
    app_client, _ = client
    res = app_client.get('/stats')
    assert res.status_code == 401


def test_pin_is_never_included_in_pair_response(client):
    app_client, sec = client
    res = app_client.post('/pair', json={'pin': sec.pin})
    assert sec.pin not in res.get_data(as_text=True)


def test_rebinding_host_header_rejected(client):
    app_client, sec = client
    res = app_client.post(
        '/pair',
        json={'pin': sec.pin},
        headers={'Host': 'evil.example.com'},
    )
    assert res.status_code == 403


def test_ip_host_header_allowed(client):
    app_client, sec = client
    res = app_client.post(
        '/pair',
        json={'pin': sec.pin},
        headers={'Host': '192.168.1.50:8080'},
    )
    assert res.status_code == 200

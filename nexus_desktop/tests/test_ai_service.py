import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import json
import pytest
from flask import Flask
from core.security_manager import SecurityManager
from services import ai_service as ai_service_module
from services.ai_service import AiService


class FakeResponse:
    def __init__(self, text):
        self.text = text


class FakeGenerativeModel:
    """Records the call it was made with and returns/raises per test setup."""

    result_text = '[{"type": "WAIT", "value": "1", "description": "ok"}]'
    should_raise = None
    last_instance = None

    def __init__(self, model_name, system_instruction=None, generation_config=None):
        self.model_name = model_name
        self.system_instruction = system_instruction
        self.generation_config = generation_config
        FakeGenerativeModel.last_instance = self

    def generate_content(self, contents):
        self.last_contents = contents
        if FakeGenerativeModel.should_raise:
            raise FakeGenerativeModel.should_raise
        return FakeResponse(FakeGenerativeModel.result_text)


class FakeGenAI:
    GenerativeModel = FakeGenerativeModel

    def __init__(self):
        self.configured_with = None

    def configure(self, api_key):
        self.configured_with = api_key


@pytest.fixture(autouse=True)
def reset_fake_model():
    FakeGenerativeModel.result_text = '[{"type": "WAIT", "value": "1", "description": "ok"}]'
    FakeGenerativeModel.should_raise = None
    FakeGenerativeModel.last_instance = None
    yield


def _build_client(monkeypatch, api_key="test-key", genai=True):
    fake_genai = FakeGenAI() if genai else None
    monkeypatch.setattr(ai_service_module, "genai", fake_genai)
    if api_key is not None:
        monkeypatch.setenv("GEMINI_API_KEY", api_key)
    else:
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    security = SecurityManager()
    svc = AiService(security)
    app = Flask(__name__)
    svc.register(app)
    app.testing = True
    return app.test_client(), security, svc


def _token(security):
    return security.issue_token()


# --- Authorization ---

def test_macro_without_token_rejected(monkeypatch):
    client, _, _ = _build_client(monkeypatch)
    res = client.post('/ai/macro', json={'prompt': 'spotify ac'})
    assert res.status_code == 401
    assert res.get_json()['success'] is False


def test_audio_without_token_rejected(monkeypatch):
    client, _, _ = _build_client(monkeypatch)
    res = client.post('/ai/audio', json={'audio': 'aGVsbG8=', 'mimeType': 'audio/wav'})
    assert res.status_code == 401


def test_schedule_without_token_rejected(monkeypatch):
    client, _, _ = _build_client(monkeypatch)
    res = client.post('/ai/schedule', json={'prompt': '10 dakika sonra kapat'})
    assert res.status_code == 401


def test_invalid_token_rejected(monkeypatch):
    client, _, _ = _build_client(monkeypatch)
    res = client.post(
        '/ai/macro',
        json={'prompt': 'spotify ac'},
        headers={'X-Nexus-Token': 'bogus'},
    )
    assert res.status_code == 401


# --- Disabled proxy (missing key or missing library) ---

def test_disabled_when_api_key_missing(monkeypatch):
    client, security, svc = _build_client(monkeypatch, api_key=None)
    assert svc.enabled is False
    token = _token(security)
    res = client.post(
        '/ai/macro',
        json={'prompt': 'spotify ac'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 503
    assert res.get_json()['success'] is False


def test_disabled_when_genai_library_absent(monkeypatch):
    client, security, svc = _build_client(monkeypatch, genai=False)
    assert svc.enabled is False
    token = _token(security)
    res = client.post(
        '/ai/schedule',
        json={'prompt': '10 dakika sonra kapat'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 503


# --- Validation ---

def test_macro_missing_prompt_rejected(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    res = client.post('/ai/macro', json={}, headers={'X-Nexus-Token': token})
    assert res.status_code == 400


def test_schedule_missing_prompt_rejected(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    res = client.post('/ai/schedule', json={}, headers={'X-Nexus-Token': token})
    assert res.status_code == 400


def test_audio_missing_fields_rejected(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    res = client.post('/ai/audio', json={'audio': 'aGVsbG8='}, headers={'X-Nexus-Token': token})
    assert res.status_code == 400

    res2 = client.post('/ai/audio', json={'mimeType': 'audio/wav'}, headers={'X-Nexus-Token': token})
    assert res2.status_code == 400


def test_audio_invalid_base64_rejected(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    res = client.post(
        '/ai/audio',
        json={'audio': 'not-valid-base64!!', 'mimeType': 'audio/wav'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 400


# --- Success paths ---

def test_macro_success_returns_steps(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps([
        {"type": "LAUNCH_APP", "value": "spotify", "description": "Spotify aciliyor"}
    ])
    res = client.post(
        '/ai/macro',
        json={'prompt': 'spotify ac'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    assert body['steps'] == [{"type": "LAUNCH_APP", "value": "spotify", "description": "Spotify aciliyor"}]
    assert FakeGenerativeModel.last_instance.last_contents == 'spotify ac'


def test_audio_success_decodes_and_returns_steps(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    res = client.post(
        '/ai/audio',
        json={'audio': 'aGVsbG8=', 'mimeType': 'audio/wav'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    contents = FakeGenerativeModel.last_instance.last_contents
    assert contents[0]['mime_type'] == 'audio/wav'
    assert contents[0]['data'] == b'hello'


def test_schedule_success_returns_plan(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps(
        {"seconds": 600, "action": {"type": "SYSTEM_POWER", "value": "shutdown", "description": "Sistem kapatiliyor"}}
    )
    res = client.post(
        '/ai/schedule',
        json={'prompt': '10 dakika sonra kapat'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    assert body['plan']['seconds'] == 600


# --- Upstream failure handling ---

def test_macro_upstream_exception_returns_502(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.should_raise = RuntimeError("upstream boom")
    res = client.post(
        '/ai/macro',
        json={'prompt': 'spotify ac'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 502
    assert res.get_json()['success'] is False


def test_audio_upstream_exception_returns_502(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.should_raise = RuntimeError("upstream boom")
    res = client.post(
        '/ai/audio',
        json={'audio': 'aGVsbG8=', 'mimeType': 'audio/wav'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 502


def test_schedule_upstream_exception_returns_502(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.should_raise = RuntimeError("upstream boom")
    res = client.post(
        '/ai/schedule',
        json={'prompt': '10 dakika sonra kapat'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 502


def test_macro_malformed_json_response_returns_502(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = "not json"
    res = client.post(
        '/ai/macro',
        json={'prompt': 'spotify ac'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 502

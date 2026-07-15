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
    assert 'response_schema' in FakeGenerativeModel.last_instance.generation_config


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
    assert 'response_schema' not in FakeGenerativeModel.last_instance.generation_config


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


# --- /ai/locate (vision) ---

def _patch_capture(monkeypatch):
    """Avoid real screen grabs: locate captures via screen_capture.capture_jpeg_bytes."""
    monkeypatch.setattr(
        "services.ai_service.capture_jpeg_bytes",
        lambda *a, **k: b"\xff\xd8fakejpeg",
    )


def test_locate_without_token_rejected(monkeypatch):
    client, _, _ = _build_client(monkeypatch)
    res = client.post('/ai/locate', json={'description': 'Kaydet butonu'})
    assert res.status_code == 401


def test_locate_disabled_when_api_key_missing(monkeypatch):
    client, security, svc = _build_client(monkeypatch, api_key=None)
    token = _token(security)
    res = client.post(
        '/ai/locate',
        json={'description': 'Kaydet butonu'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 503


def test_locate_missing_description_rejected(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    res = client.post('/ai/locate', json={}, headers={'X-Nexus-Token': token})
    assert res.status_code == 400

    res2 = client.post('/ai/locate', json={'description': '   '}, headers={'X-Nexus-Token': token})
    assert res2.status_code == 400


def test_locate_found_maps_coords_to_percent(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"found": True, "x": 500, "y": 250})
    res = client.post(
        '/ai/locate',
        json={'description': 'Kaydet butonu'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    assert body['found'] is True
    assert body['x_pct'] == 50.0
    assert body['y_pct'] == 25.0
    assert body['image'].startswith('data:image/jpeg;base64,')
    # The screenshot bytes must be sent to Gemini as an image part.
    contents = FakeGenerativeModel.last_instance.last_contents
    assert contents[0]['mime_type'] == 'image/jpeg'
    assert contents[0]['data'] == b"\xff\xd8fakejpeg"
    assert 'response_schema' in FakeGenerativeModel.last_instance.generation_config


def test_locate_clamps_out_of_range_coords(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"found": True, "x": 1200, "y": -30})
    res = client.post(
        '/ai/locate',
        json={'description': 'x'},
        headers={'X-Nexus-Token': token},
    )
    body = res.get_json()
    assert body['x_pct'] == 100.0
    assert body['y_pct'] == 0.0


def test_locate_not_found_returns_found_false(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"found": False, "x": 0, "y": 0})
    res = client.post(
        '/ai/locate',
        json={'description': 'yok'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    assert body['found'] is False
    assert 'image' not in body


def test_locate_upstream_exception_returns_502(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.should_raise = RuntimeError("upstream boom")
    res = client.post(
        '/ai/locate',
        json={'description': 'Kaydet butonu'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 502


# --- /ai/next-action (computer-use loop) ---

def test_next_action_without_token_rejected(monkeypatch):
    client, _, _ = _build_client(monkeypatch)
    res = client.post('/ai/next-action', json={'goal': 'Chrome ac'})
    assert res.status_code == 401


def test_next_action_disabled_when_api_key_missing(monkeypatch):
    client, security, svc = _build_client(monkeypatch, api_key=None)
    token = _token(security)
    res = client.post(
        '/ai/next-action',
        json={'goal': 'Chrome ac'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 503


def test_next_action_missing_goal_rejected(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    res = client.post('/ai/next-action', json={}, headers={'X-Nexus-Token': token})
    assert res.status_code == 400

    res2 = client.post('/ai/next-action', json={'goal': '   '}, headers={'X-Nexus-Token': token})
    assert res2.status_code == 400


def test_next_action_done_passes_summary_through(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"done": True, "summary": "Kedi araması tamamlandı"})
    res = client.post(
        '/ai/next-action',
        json={'goal': 'kedi ara', 'history': []},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    assert body['done'] is True
    assert body['summary'] == "Kedi araması tamamlandı"
    assert 'action' not in body
    # The screenshot must be sent to Gemini as an image part.
    contents = FakeGenerativeModel.last_instance.last_contents
    assert contents[0]['mime_type'] == 'image/jpeg'
    assert 'response_schema' in FakeGenerativeModel.last_instance.generation_config


def test_next_action_non_click_passes_value_through(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps(
        {"done": False, "thought": "Chrome açılıyor", "type": "LAUNCH_APP", "value": "chrome"}
    )
    res = client.post(
        '/ai/next-action',
        json={'goal': 'Chrome ac', 'history': []},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['done'] is False
    assert body['thought'] == "Chrome açılıyor"
    assert body['action'] == {
        "type": "LAUNCH_APP",
        "value": "chrome",
        "description": "Chrome açılıyor",
    }


def test_next_action_click_maps_coords_to_percent(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps(
        {"done": False, "thought": "Adres çubuğuna tıkla", "type": "MOUSE_CLICK", "x": 500, "y": 80}
    )
    res = client.post(
        '/ai/next-action',
        json={'goal': 'x', 'history': []},
        headers={'X-Nexus-Token': token},
    )
    body = res.get_json()
    assert body['action']['type'] == 'MOUSE_CLICK'
    assert body['action']['value'] == '50.0%,8.0%'
    assert body['action']['description'] == 'Adres çubuğuna tıkla'


def test_next_action_click_clamps_out_of_range_coords(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps(
        {"done": False, "thought": "t", "type": "MOUSE_CLICK", "x": 1200, "y": -30}
    )
    res = client.post(
        '/ai/next-action',
        json={'goal': 'x'},
        headers={'X-Nexus-Token': token},
    )
    body = res.get_json()
    assert body['action']['value'] == '100.0%,0.0%'


def test_next_action_serializes_history_into_prompt(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"done": True, "summary": "ok"})
    client.post(
        '/ai/next-action',
        json={'goal': 'kedi ara', 'history': [{'type': 'LAUNCH_APP', 'description': 'Chrome açıldı'}]},
        headers={'X-Nexus-Token': token},
    )
    # The text part must carry the goal and the prior step description.
    text_part = FakeGenerativeModel.last_instance.last_contents[1]
    assert 'kedi ara' in text_part
    assert 'Chrome açıldı' in text_part


def test_next_action_upstream_exception_returns_502(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.should_raise = RuntimeError("upstream boom")
    res = client.post(
        '/ai/next-action',
        json={'goal': 'x'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 502

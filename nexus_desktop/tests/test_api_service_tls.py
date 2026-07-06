import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from flask import Flask
import pytest
from core.event_bus import EventBus
from core.security_manager import SecurityManager
from core.cert_store import CertStore
from services.api_service import ApiService
import services.api_service as api_service_module


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])
    monkeypatch.setattr(api_service_module, "get_local_ip", lambda: "192.168.1.5")
    bus = EventBus()
    sec = SecurityManager()
    svc = ApiService("API", bus, sec, start_server=False)
    svc.on_start()
    svc.app.testing = True
    return svc.app.test_client(), svc, tmp_path


def test_on_start_generates_cert_files_under_data_dir(client):
    _, svc, tmp_path = client

    expected_cert = os.path.join(str(tmp_path), "data", "certs", "agent.crt")
    expected_key = os.path.join(str(tmp_path), "data", "certs", "agent.key")

    assert svc.cert_path == expected_cert
    assert svc.key_path == expected_key
    assert os.path.exists(expected_cert)
    assert os.path.exists(expected_key)


def test_root_route_returns_cert_trusted_landing_page(client):
    app_client, _, _ = client

    res = app_client.get('/')

    assert res.status_code == 200
    assert b"Certificate trusted" in res.data


def test_run_server_passes_ssl_context_to_flask(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])
    bus = EventBus()
    sec = SecurityManager()
    svc = ApiService("API", bus, sec)
    svc.app = Flask(__name__)
    cert_dir = os.path.join(str(tmp_path), "data", "certs")
    svc.cert_path, svc.key_path = CertStore(cert_dir).ensure_cert("192.168.1.5")

    captured = {}

    def fake_run(*args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(svc.app, "run", fake_run)

    svc._run_server()

    assert captured["ssl_context"] == (svc.cert_path, svc.key_path)
    assert captured["host"] == "0.0.0.0"
    assert captured["port"] == 8080

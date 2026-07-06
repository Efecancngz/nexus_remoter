import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from core.event_bus import EventBus
from services.discovery_service import DiscoveryService
import services.discovery_service as discovery_service_module


@pytest.fixture
def service():
    bus = EventBus()
    return DiscoveryService("Discovery", bus)


class FakeSocket:
    def __init__(self):
        self.sent = []
        self.opts = []

    def setsockopt(self, level, opt, value):
        self.opts.append((level, opt, value))

    def sendto(self, message, addr):
        self.sent.append((message, addr))


def test_on_start_launches_daemon_thread_running_broadcast_loop(monkeypatch, service):
    svc = service
    started = {}

    class FakeThread:
        def __init__(self, target, daemon):
            started['target'] = target
            started['daemon'] = daemon

        def start(self):
            started['started'] = True

    monkeypatch.setattr(discovery_service_module.threading, "Thread", FakeThread)

    svc.on_start()

    assert started['target'] == svc._broadcast_loop
    assert started['daemon'] is True
    assert started['started'] is True


def test_broadcast_loop_sends_udp_broadcast_message(monkeypatch, service):
    svc = service
    fake_socket = FakeSocket()
    monkeypatch.setattr(discovery_service_module.socket, "socket", lambda *a, **k: fake_socket)

    sleep_calls = []

    def fake_sleep(seconds):
        sleep_calls.append(seconds)
        svc.running = False  # stop after first iteration

    monkeypatch.setattr(discovery_service_module.time, "sleep", fake_sleep)

    svc.running = True
    svc._broadcast_loop()

    assert len(fake_socket.sent) == 1
    message, addr = fake_socket.sent[0]
    assert message == b"DISCOVER_NEXUS_AGENT_V2"
    assert addr == ('<broadcast>', 5000)
    assert sleep_calls == [2]


def test_broadcast_loop_never_sends_when_not_running(monkeypatch, service):
    svc = service
    fake_socket = FakeSocket()
    monkeypatch.setattr(discovery_service_module.socket, "socket", lambda *a, **k: fake_socket)

    svc.running = False
    svc._broadcast_loop()

    assert fake_socket.sent == []


def test_broadcast_loop_recovers_from_send_error(monkeypatch, service):
    svc = service

    class ExplodingSocket(FakeSocket):
        def sendto(self, message, addr):
            raise OSError("network unreachable")

    monkeypatch.setattr(discovery_service_module.socket, "socket", lambda *a, **k: ExplodingSocket())

    sleep_calls = []

    def fake_sleep(seconds):
        sleep_calls.append(seconds)
        svc.running = False

    monkeypatch.setattr(discovery_service_module.time, "sleep", fake_sleep)

    svc.running = True
    svc._broadcast_loop()  # must not raise

    assert sleep_calls == [5]

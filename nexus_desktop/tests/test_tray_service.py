import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from core.event_bus import EventBus, Event
from services.tray_service import TrayService
import services.tray_service as tray_service_module


@pytest.fixture
def service():
    bus = EventBus()
    return TrayService("Tray", bus), bus


def test_on_start_launches_non_daemon_thread_and_subscribes(monkeypatch, service):
    svc, bus = service
    started = {}

    class FakeThread:
        def __init__(self, target, daemon):
            started['target'] = target
            started['daemon'] = daemon

        def start(self):
            started['started'] = True

    monkeypatch.setattr(tray_service_module.threading, "Thread", FakeThread)

    svc.on_start()

    assert started['target'] == svc._run_tray
    assert started['daemon'] is False
    assert started['started'] is True
    assert "COMMAND_RECEIVED" in bus._subscribers
    assert svc.on_command in bus._subscribers["COMMAND_RECEIVED"]


def test_create_image_returns_64x64_rgb_image(service):
    svc, _ = service
    image = svc.create_image()

    assert image.size == (64, 64)
    assert image.mode == "RGB"


def test_on_command_spawns_notification_thread_with_event_type(monkeypatch, service):
    svc, bus = service
    captured = {}

    class FakeThread:
        def __init__(self, target, args, daemon):
            captured['target'] = target
            captured['args'] = args
            captured['daemon'] = daemon

        def start(self):
            captured['started'] = True

    monkeypatch.setattr(tray_service_module.threading, "Thread", FakeThread)

    svc.on_command(Event("COMMAND_RECEIVED", {"type": "LAUNCH_APP"}))

    assert captured['target'] == svc._show_notif
    assert captured['args'] == ("LAUNCH_APP",)
    assert captured['daemon'] is True
    assert captured['started'] is True


def test_show_notif_calls_icon_notify_when_icon_exists(service):
    svc, _ = service
    notified = []

    class FakeIcon:
        def notify(self, message, title):
            notified.append((message, title))

    svc.icon = FakeIcon()

    svc._show_notif("LAUNCH_APP")

    assert notified == [("Executing: LAUNCH_APP", "Nexus Agent")]


def test_show_notif_noop_when_icon_missing(service):
    svc, _ = service
    svc._show_notif("LAUNCH_APP")  # must not raise


def test_show_notif_swallows_notify_errors(service):
    svc, _ = service

    class FailingIcon:
        def notify(self, message, title):
            raise RuntimeError("tray backend unavailable")

    svc.icon = FailingIcon()

    svc._show_notif("LAUNCH_APP")  # must not raise


def test_show_info_publishes_show_gui_event(service):
    svc, bus = service
    received = []
    bus.subscribe("SHOW_GUI", lambda e: received.append(e))

    svc.show_info()

    assert len(received) == 1


def test_stop_app_stops_icon_and_exits(service):
    svc, _ = service
    stopped = []

    class FakeIcon:
        def stop(self):
            stopped.append(True)

    with pytest.raises(SystemExit) as exc_info:
        svc.stop_app(FakeIcon(), item=None)

    assert stopped == [True]
    assert exc_info.value.code == 0


def test_on_stop_stops_icon_if_present(service):
    svc, _ = service
    stopped = []

    class FakeIcon:
        def stop(self):
            stopped.append(True)

    svc.icon = FakeIcon()
    svc.on_stop()

    assert stopped == [True]


def test_on_stop_noop_when_icon_never_created(service):
    svc, _ = service
    svc.on_stop()  # must not raise

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from core.event_bus import EventBus
from core.security_manager import SecurityManager
from services.gui_service import GuiService
import services.gui_service as gui_service_module


@pytest.fixture
def service():
    bus = EventBus()
    security = SecurityManager()
    return GuiService("Gui", bus, security), bus


def test_on_start_launches_daemon_thread_and_subscribes_to_show_gui(monkeypatch, service):
    svc, bus = service
    started = {}

    class FakeThread:
        def __init__(self, target, daemon):
            started['target'] = target
            started['daemon'] = daemon

        def start(self):
            started['started'] = True

    monkeypatch.setattr(gui_service_module.threading, "Thread", FakeThread)

    svc.on_start()

    assert started['target'] == svc._run_gui_loop
    assert started['daemon'] is True
    assert started['started'] is True
    assert "SHOW_GUI" in bus._subscribers
    assert svc.show_window in bus._subscribers["SHOW_GUI"]


class FakeLabel:
    def __init__(self):
        self.text = None

    def config(self, text):
        self.text = text


class FakeRoot:
    def __init__(self):
        self.after_calls = []
        self.deiconified = False
        self.lifted = False
        self.withdrawn = False
        self.quit_called = False

    def after(self, delay, callback):
        self.after_calls.append((delay, callback))

    def deiconify(self):
        self.deiconified = True

    def lift(self):
        self.lifted = True

    def attributes(self, name, value):
        pass

    def withdraw(self):
        self.withdrawn = True

    def quit(self):
        self.quit_called = True


def test_update_stats_updates_labels_and_reschedules(monkeypatch, service):
    svc, _ = service
    svc.root = FakeRoot()
    svc.lbl_cpu = FakeLabel()
    svc.lbl_ram = FakeLabel()

    monkeypatch.setattr(gui_service_module.psutil, "cpu_percent", lambda interval=None: 33)
    monkeypatch.setattr(
        gui_service_module.psutil, "virtual_memory", lambda: type("Mem", (), {"percent": 44})()
    )

    svc.update_stats()

    assert svc.lbl_cpu.text == "CPU: 33%"
    assert svc.lbl_ram.text == "RAM: 44%"
    assert svc.root.after_calls[-1][0] == 1000
    assert svc.root.after_calls[-1][1] == svc.update_stats


def test_update_stats_noop_before_labels_exist(service):
    svc, _ = service
    svc.update_stats()  # must not raise; lbl_cpu not yet set


def test_update_stats_swallows_psutil_errors(monkeypatch, service):
    svc, _ = service
    svc.root = FakeRoot()
    svc.lbl_cpu = FakeLabel()
    svc.lbl_ram = FakeLabel()

    def boom(interval=None):
        raise RuntimeError("psutil exploded")

    monkeypatch.setattr(gui_service_module.psutil, "cpu_percent", boom)

    svc.update_stats()  # must not raise

    assert svc.lbl_cpu.text is None


def test_show_window_deiconifies_and_lifts_existing_root(service):
    svc, _ = service
    svc.root = FakeRoot()

    svc.show_window()

    assert svc.root.after_calls[0][1] == svc.root.deiconify
    assert svc.root.after_calls[1][1] == svc.root.lift


def test_show_window_logs_error_when_root_missing(service):
    svc, _ = service
    svc.show_window()  # must not raise even though svc.root doesn't exist


def test_hide_window_withdraws_root(service):
    svc, _ = service
    svc.root = FakeRoot()

    svc.hide_window()

    assert svc.root.withdrawn is True


def test_on_stop_quits_root_if_present(service):
    svc, _ = service
    svc.root = FakeRoot()

    svc.on_stop()

    assert svc.root.quit_called is True


def test_on_stop_noop_when_root_never_created(service):
    svc, _ = service
    svc.on_stop()  # must not raise

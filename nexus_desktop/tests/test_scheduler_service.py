import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.event_bus import EventBus
from core.schedule_store import ScheduleStore
from services.scheduler_service import SchedulerService


class FakeTimer:
    """Deterministic stand-in for threading.Timer: captures scheduling
    intent instead of actually running on a background thread."""
    instances = []

    def __init__(self, interval, function, args=None):
        self.interval = interval
        self.function = function
        self.args = args or []
        self.started = False
        self.cancelled = False
        FakeTimer.instances.append(self)

    def start(self):
        self.started = True

    def cancel(self):
        self.cancelled = True

    def fire(self):
        self.function(*self.args)


def make_service(monkeypatch, tmp_path):
    FakeTimer.instances.clear()
    monkeypatch.setattr("threading.Timer", FakeTimer)
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])

    bus = EventBus()
    svc = SchedulerService("Scheduler", bus)
    svc.on_start()
    return svc, bus


def test_handle_schedule_persists_job_to_store(monkeypatch, tmp_path):
    svc, bus = make_service(monkeypatch, tmp_path)

    bus.publish("SCHEDULE_ACTION", {
        "seconds": 600,
        "action": {"type": "SYSTEM_POWER", "value": "shutdown", "description": "test"}
    })

    jobs = svc.store.load()
    assert len(jobs) == 1
    assert jobs[0]["action"]["type"] == "SYSTEM_POWER"
    assert jobs[0]["due_at"] > time.time()


def test_scheduled_job_data_file_is_under_argv_data_dir(monkeypatch, tmp_path):
    svc, bus = make_service(monkeypatch, tmp_path)
    expected_path = os.path.join(str(tmp_path), "data", "schedules.json")
    assert os.path.abspath(svc.store.path) == os.path.abspath(expected_path)

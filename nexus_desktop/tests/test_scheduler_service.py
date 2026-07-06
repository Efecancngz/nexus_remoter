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


def test_cancel_removes_job_from_store(monkeypatch, tmp_path):
    svc, bus = make_service(monkeypatch, tmp_path)

    bus.publish("SCHEDULE_ACTION", {"seconds": 600, "action": {"type": "WAIT", "value": "1", "description": "x"}})
    job_id = svc.store.load()[0]["job_id"]

    bus.publish("CANCEL_SCHEDULE", {"job_id": job_id})

    assert svc.store.load() == []


def test_executed_job_is_removed_from_store(monkeypatch, tmp_path):
    svc, bus = make_service(monkeypatch, tmp_path)

    bus.publish("SCHEDULE_ACTION", {"seconds": 600, "action": {"type": "WAIT", "value": "1", "description": "x"}})
    timer = FakeTimer.instances[-1]

    timer.fire()

    assert svc.store.load() == []


def test_non_json_serializable_action_is_rejected(monkeypatch, tmp_path):
    svc, bus = make_service(monkeypatch, tmp_path)

    created_events = []
    bus.subscribe("SCHEDULE_CREATED", lambda event: created_events.append(event))

    # A set is not JSON-serializable
    bus.publish("SCHEDULE_ACTION", {"seconds": 60, "action": {"type": "WAIT", "value": {1, 2, 3}}})

    assert svc.store.load() == []
    assert svc.active_timers == {}
    assert created_events == []


def test_restart_with_future_job_schedules_timer_with_remaining_delay(monkeypatch, tmp_path):
    FakeTimer.instances.clear()
    monkeypatch.setattr("threading.Timer", FakeTimer)
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])

    # Simulate a job persisted by a previous run, due 500s from now
    store_path = os.path.join(str(tmp_path), "data", "schedules.json")
    pre_store = ScheduleStore(store_path)
    due_at = time.time() + 500
    pre_store.save_job("job-1", due_at, {"type": "WAIT", "value": "1", "description": "x"})

    bus = EventBus()
    svc = SchedulerService("Scheduler", bus)
    svc.on_start()

    assert "job-1" in svc.active_timers
    restored_timer = svc.active_timers["job-1"]
    assert restored_timer.started is True
    assert 490 <= restored_timer.interval <= 500
    assert restored_timer.args == ["job-1", {"type": "WAIT", "value": "1", "description": "x"}]


def test_restart_with_overdue_job_gets_zero_delay_timer_and_fires(monkeypatch, tmp_path):
    FakeTimer.instances.clear()
    monkeypatch.setattr("threading.Timer", FakeTimer)
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])

    store_path = os.path.join(str(tmp_path), "data", "schedules.json")
    pre_store = ScheduleStore(store_path)
    overdue_due_at = time.time() - 3600  # 1 hour in the past
    pre_store.save_job("job-overdue", overdue_due_at, {"type": "SYSTEM_POWER", "value": "lock", "description": "x"})

    executed = []
    bus = EventBus()
    bus.subscribe("COMMAND_RECEIVED", lambda event: executed.append(event.payload))

    svc = SchedulerService("Scheduler", bus)
    svc.on_start()

    restored_timer = svc.active_timers["job-overdue"]
    assert restored_timer.interval == 0.0

    # Simulate the timer firing (as it would almost immediately in real usage)
    restored_timer.fire()

    assert executed == [{"type": "SYSTEM_POWER", "value": "lock", "description": "x"}]
    assert svc.store.load() == []  # removed after execution


def test_restart_with_multiple_overdue_jobs_all_get_timers(monkeypatch, tmp_path):
    FakeTimer.instances.clear()
    monkeypatch.setattr("threading.Timer", FakeTimer)
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])

    store_path = os.path.join(str(tmp_path), "data", "schedules.json")
    pre_store = ScheduleStore(store_path)
    past = time.time() - 100
    pre_store.save_job("job-a", past, {"type": "WAIT", "value": "1", "description": "a"})
    pre_store.save_job("job-b", past, {"type": "WAIT", "value": "2", "description": "b"})
    pre_store.save_job("job-c", past, {"type": "WAIT", "value": "3", "description": "c"})

    executed = []
    bus = EventBus()
    bus.subscribe("COMMAND_RECEIVED", lambda event: executed.append(event.payload["value"]))

    svc = SchedulerService("Scheduler", bus)
    svc.on_start()

    assert set(svc.active_timers.keys()) == {"job-a", "job-b", "job-c"}

    for job_id in ("job-a", "job-b", "job-c"):
        svc.active_timers[job_id].fire()

    assert sorted(executed) == ["1", "2", "3"]
    assert svc.store.load() == []


def test_restart_skips_non_dict_persisted_entry_and_restores_others(monkeypatch, tmp_path):
    FakeTimer.instances.clear()
    monkeypatch.setattr("threading.Timer", FakeTimer)
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])

    store_path = os.path.join(str(tmp_path), "data", "schedules.json")
    pre_store = ScheduleStore(store_path)
    due_at = time.time() + 500
    pre_store.save_job("job-good", due_at, {"type": "WAIT", "value": "1", "description": "x"})

    # Manually corrupt the store with a non-dict entry alongside the valid one
    jobs = pre_store.load()
    jobs.append("garbage")
    pre_store._write(jobs)

    bus = EventBus()
    svc = SchedulerService("Scheduler", bus)
    svc.on_start()  # must not raise

    assert "job-good" in svc.active_timers
    assert len(svc.active_timers) == 1


def test_restart_skips_entry_with_non_numeric_due_at_and_restores_others(monkeypatch, tmp_path):
    FakeTimer.instances.clear()
    monkeypatch.setattr("threading.Timer", FakeTimer)
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])

    store_path = os.path.join(str(tmp_path), "data", "schedules.json")
    pre_store = ScheduleStore(store_path)
    due_at = time.time() + 500
    pre_store.save_job("job-good", due_at, {"type": "WAIT", "value": "1", "description": "x"})
    pre_store.save_job("job-bad-due-at", "soon", {"type": "WAIT", "value": "2", "description": "y"})

    bus = EventBus()
    svc = SchedulerService("Scheduler", bus)
    svc.on_start()  # must not raise

    assert "job-good" in svc.active_timers
    assert "job-bad-due-at" not in svc.active_timers
    assert len(svc.active_timers) == 1


def test_on_stop_does_not_remove_persisted_jobs(monkeypatch, tmp_path):
    svc, bus = make_service(monkeypatch, tmp_path)

    bus.publish("SCHEDULE_ACTION", {"seconds": 600, "action": {"type": "WAIT", "value": "1", "description": "x"}})
    assert len(svc.store.load()) == 1

    svc.on_stop()

    assert len(svc.store.load()) == 1
    assert svc.active_timers == {}


def test_full_stop_restart_cycle_recovers_pending_job(monkeypatch, tmp_path):
    svc, bus = make_service(monkeypatch, tmp_path)

    bus.publish("SCHEDULE_ACTION", {"seconds": 600, "action": {"type": "WAIT", "value": "1", "description": "x"}})
    job_id = svc.store.load()[0]["job_id"]

    svc.on_stop()
    assert svc.active_timers == {}

    # Simulate a fresh agent process starting up again with the same bus/store path
    svc2 = SchedulerService("Scheduler", bus)
    svc2.on_start()

    assert job_id in svc2.active_timers
    assert len(svc2.store.load()) == 1

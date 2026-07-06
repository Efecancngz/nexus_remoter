# Scheduler Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `SchedulerService` survive an agent restart without losing pending scheduled jobs (e.g. "shut down in 1 hour").

**Architecture:** A new `ScheduleStore` class (`nexus_desktop/core/schedule_store.py`) persists jobs as a flat JSON file, written atomically (temp file + `os.replace`). `SchedulerService` calls it on every mutation (schedule/cancel/execute) and, on `on_start`, reloads persisted jobs and re-arms a `threading.Timer` for each — including a zero-delay timer for jobs whose due time already passed, so overdue jobs run via the normal event-driven path instead of a synchronous call during startup.

**Tech Stack:** Python 3, stdlib only (`json`, `os`, `tempfile`, `threading`, `time`, `sys`), pytest + `monkeypatch` for tests (matching the existing style in `nexus_desktop/tests/`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-06-scheduler-persistence-design.md`
- Storage path: `data/schedules.json` under `os.path.dirname(os.path.abspath(sys.argv[0]))` — never `sys._MEIPASS`.
- Job entry shape: `{ "job_id": str, "due_at": float, "action": dict }`, `due_at` is an absolute epoch timestamp.
- `action` must be JSON-serializable; `handle_schedule` validates this and rejects (no job created) if it isn't.
- All `ScheduleStore` calls from `SchedulerService` happen while holding `self.lock` (no new lock).
- Writes are atomic: write to a temp file, then `os.replace()`.
- `on_stop` cancels in-memory timers but must **never** call `store.remove_job(...)`.
- No UI changes, no change to the `/execute` `SCHEDULE_ACTION` API surface.
- Tests go in `nexus_desktop/tests/`, run via `../venv/Scripts/python.exe -m pytest tests/<file>.py -v` from the `nexus_desktop` directory (matches the project's existing venv-based test setup).

---

### Task 1: `ScheduleStore` — basic load/save/remove round-trip

**Files:**
- Create: `nexus_desktop/core/schedule_store.py`
- Test: `nexus_desktop/tests/test_schedule_store.py`

**Interfaces:**
- Produces: `ScheduleStore(path: str)`, `ScheduleStore.load() -> list[dict]`, `ScheduleStore.save_job(job_id: str, due_at: float, action: dict) -> None`, `ScheduleStore.remove_job(job_id: str) -> None`.

- [ ] **Step 1: Write the failing test**

Create `nexus_desktop/tests/test_schedule_store.py`:

```python
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.schedule_store import ScheduleStore


def test_load_on_missing_file_returns_empty_list(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    assert store.load() == []


def test_save_job_then_load_round_trip(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.5, {"type": "SYSTEM_POWER", "value": "shutdown"})

    jobs = store.load()
    assert jobs == [{"job_id": "job-1", "due_at": 1000.5, "action": {"type": "SYSTEM_POWER", "value": "shutdown"}}]


def test_save_job_twice_with_same_id_updates_not_duplicates(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.0, {"type": "WAIT", "value": "1"})
    store.save_job("job-1", 2000.0, {"type": "WAIT", "value": "2"})

    jobs = store.load()
    assert len(jobs) == 1
    assert jobs[0]["due_at"] == 2000.0
    assert jobs[0]["action"]["value"] == "2"


def test_save_two_different_jobs_both_persist(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.0, {"type": "WAIT", "value": "1"})
    store.save_job("job-2", 2000.0, {"type": "WAIT", "value": "2"})

    jobs = store.load()
    assert {j["job_id"] for j in jobs} == {"job-1", "job-2"}


def test_remove_job_deletes_only_that_job(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.0, {"type": "WAIT", "value": "1"})
    store.save_job("job-2", 2000.0, {"type": "WAIT", "value": "2"})

    store.remove_job("job-1")

    jobs = store.load()
    assert len(jobs) == 1
    assert jobs[0]["job_id"] == "job-2"


def test_remove_nonexistent_job_is_a_no_op(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.0, {"type": "WAIT", "value": "1"})

    store.remove_job("does-not-exist")

    jobs = store.load()
    assert len(jobs) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `nexus_desktop/`): `../venv/Scripts/python.exe -m pytest tests/test_schedule_store.py -v`
Expected: FAIL / ERROR with `ModuleNotFoundError: No module named 'core.schedule_store'`

- [ ] **Step 3: Write minimal implementation**

Create `nexus_desktop/core/schedule_store.py`:

```python
import json
import logging
import os


class ScheduleStore:
    """Persists SchedulerService jobs as a flat JSON file.

    Not internally thread-safe: callers must serialize access (SchedulerService
    does this via its existing self.lock).
    """

    def __init__(self, path):
        self.path = path

    def load(self):
        if not os.path.exists(self.path):
            return []
        with open(self.path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def save_job(self, job_id, due_at, action):
        jobs = self.load()
        jobs = [j for j in jobs if j.get('job_id') != job_id]
        jobs.append({"job_id": job_id, "due_at": due_at, "action": action})
        self._write(jobs)

    def remove_job(self, job_id):
        jobs = self.load()
        jobs = [j for j in jobs if j.get('job_id') != job_id]
        self._write(jobs)

    def _write(self, jobs):
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(self.path, 'w', encoding='utf-8') as f:
            json.dump(jobs, f)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../venv/Scripts/python.exe -m pytest tests/test_schedule_store.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/core/schedule_store.py nexus_desktop/tests/test_schedule_store.py
git commit -m "feat: add ScheduleStore for persisting scheduler jobs to JSON"
```

---

### Task 2: `ScheduleStore` — corrupt file recovery

**Files:**
- Modify: `nexus_desktop/core/schedule_store.py`
- Test: `nexus_desktop/tests/test_schedule_store.py`

**Interfaces:**
- Consumes: `ScheduleStore` from Task 1 (same signatures, `load()` behavior extended).
- Produces: `ScheduleStore.load()` now never raises — returns `[]` on any corrupt/unreadable file, logging a warning.

- [ ] **Step 1: Write the failing test**

Append to `nexus_desktop/tests/test_schedule_store.py`:

```python
def test_load_with_corrupt_json_returns_empty_list(tmp_path):
    path = tmp_path / "schedules.json"
    path.write_text("{not valid json!!", encoding="utf-8")

    store = ScheduleStore(str(path))
    assert store.load() == []


def test_load_with_non_list_json_returns_empty_list(tmp_path):
    path = tmp_path / "schedules.json"
    path.write_text('{"unexpected": "object"}', encoding="utf-8")

    store = ScheduleStore(str(path))
    assert store.load() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../venv/Scripts/python.exe -m pytest tests/test_schedule_store.py -v`
Expected: `test_load_with_corrupt_json_returns_empty_list` fails with `json.decoder.JSONDecodeError`; `test_load_with_non_list_json_returns_empty_list` fails because it returns a dict, not `[]`.

- [ ] **Step 3: Write minimal implementation**

In `nexus_desktop/core/schedule_store.py`, replace the `load` method:

```python
    def load(self):
        if not os.path.exists(self.path):
            return []
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logging.warning(f"[ScheduleStore] Failed to load {self.path}: {e}")
            return []
        if not isinstance(data, list):
            logging.warning(f"[ScheduleStore] Expected a list in {self.path}, got {type(data).__name__}")
            return []
        return data
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../venv/Scripts/python.exe -m pytest tests/test_schedule_store.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/core/schedule_store.py nexus_desktop/tests/test_schedule_store.py
git commit -m "fix: ScheduleStore.load never raises on corrupt or malformed JSON"
```

---

### Task 3: `ScheduleStore` — atomic write

**Files:**
- Modify: `nexus_desktop/core/schedule_store.py`
- Test: `nexus_desktop/tests/test_schedule_store.py`

**Interfaces:**
- Consumes: `ScheduleStore` from Tasks 1-2 (same public signatures).
- Produces: `ScheduleStore._write` now writes via temp-file-then-`os.replace()`; a failure during that call leaves the previous file untouched and propagates the exception to the caller.

- [ ] **Step 1: Write the failing test**

Append to `nexus_desktop/tests/test_schedule_store.py`:

```python
import os as _os
import pytest


def test_write_failure_leaves_previous_file_intact(tmp_path, monkeypatch):
    path = tmp_path / "schedules.json"
    store = ScheduleStore(str(path))
    store.save_job("job-1", 100.0, {"type": "WAIT", "value": "1"})

    def boom(src, dst):
        raise OSError("simulated crash before rename")

    monkeypatch.setattr(_os, "replace", boom)

    with pytest.raises(OSError):
        store.save_job("job-2", 200.0, {"type": "WAIT", "value": "2"})

    monkeypatch.undo()
    jobs = store.load()
    assert len(jobs) == 1
    assert jobs[0]["job_id"] == "job-1"


def test_write_failure_does_not_leave_temp_files_behind(tmp_path, monkeypatch):
    path = tmp_path / "schedules.json"
    store = ScheduleStore(str(path))

    def boom(src, dst):
        raise OSError("simulated crash before rename")

    monkeypatch.setattr(_os, "replace", boom)

    with pytest.raises(OSError):
        store.save_job("job-1", 100.0, {"type": "WAIT", "value": "1"})

    monkeypatch.undo()
    leftover = [f for f in _os.listdir(tmp_path) if f != "schedules.json"]
    assert leftover == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../venv/Scripts/python.exe -m pytest tests/test_schedule_store.py -v`
Expected: `test_write_failure_leaves_previous_file_intact` fails because the current plain-`open()`-based `_write` truncates the real file directly (no temp file, no `os.replace` call) — patching `os.replace` has no effect and the write still corrupts `schedules.json`, so `pytest.raises(OSError)` fails to see an exception, OR the file ends up empty/truncated instead of the previous content.

- [ ] **Step 3: Write minimal implementation**

In `nexus_desktop/core/schedule_store.py`, add `import tempfile` at the top and replace `_write`:

```python
    def _write(self, jobs):
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=directory or ".", prefix=".schedules_", suffix=".tmp")
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(jobs, f)
            os.replace(tmp_path, self.path)
        except Exception:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../venv/Scripts/python.exe -m pytest tests/test_schedule_store.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/core/schedule_store.py nexus_desktop/tests/test_schedule_store.py
git commit -m "fix: ScheduleStore writes atomically via temp file + os.replace"
```

---

### Task 4: Wire `ScheduleStore` into `SchedulerService.handle_schedule`

**Files:**
- Modify: `nexus_desktop/services/scheduler_service.py` (whole file currently 66 lines — see below)
- Test: `nexus_desktop/tests/test_scheduler_service.py` (new file)

**Interfaces:**
- Consumes: `ScheduleStore(path: str)`, `ScheduleStore.save_job(job_id, due_at, action)`, `ScheduleStore.remove_job(job_id)`, `ScheduleStore.load() -> list[dict]` from Tasks 1-3.
- Produces: module-level `_default_store_path() -> str` in `scheduler_service.py`; `SchedulerService.on_start` now creates `self.store: ScheduleStore`; `SchedulerService.handle_schedule` now persists jobs before starting the timer.

**Current file content of `nexus_desktop/services/scheduler_service.py` for reference:**

```python
import threading
import time
import logging
import uuid
from core.service_interface import Service

class SchedulerService(Service):
    def on_start(self):
        self.active_timers = {}
        self.lock = threading.Lock()

        self.bus.subscribe("SCHEDULE_ACTION", self.handle_schedule)
        self.bus.subscribe("CANCEL_SCHEDULE", self.handle_cancel)

        logging.info("SchedulerService started")

    def on_stop(self):
        with self.lock:
            for job_id, timer in self.active_timers.items():
                timer.cancel()
            self.active_timers.clear()

    def handle_schedule(self, event):
        data = event.payload
        seconds = data.get('seconds', 0)
        action = data.get('action')

        if not action or seconds <= 0:
            logging.error("Invalid schedule request")
            return

        job_id = str(uuid.uuid4())

        logging.info(f"Scheduling action in {seconds}s: {action}")

        timer = threading.Timer(seconds, self._execute_job, [job_id, action])

        with self.lock:
            self.active_timers[job_id] = timer

        timer.start()

        # Notify that scheduling was successful
        self.bus.publish("SCHEDULE_CREATED", {"job_id": job_id, "seconds": seconds})

    def handle_cancel(self, event):
        job_id = event.payload.get('job_id')
        with self.lock:
            if job_id in self.active_timers:
                self.active_timers[job_id].cancel()
                del self.active_timers[job_id]
                logging.info(f"Cancelled job {job_id}")
                self.bus.publish("SCHEDULE_CANCELLED", {"job_id": job_id})

    def _execute_job(self, job_id, action):
        # Remove from active list
        with self.lock:
            if job_id in self.active_timers:
                del self.active_timers[job_id]

        logging.info(f"Executing scheduled job {job_id}")

        # Inject the action back into the event bus as if it came now
        # We wrap it in COMMAND_RECEIVED so AutomationService picks it up
        self.bus.publish("COMMAND_RECEIVED", action)
```

- [ ] **Step 1: Write the failing test**

Create `nexus_desktop/tests/test_scheduler_service.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: FAIL with `AttributeError: 'SchedulerService' object has no attribute 'store'`

- [ ] **Step 3: Write minimal implementation**

Replace the full content of `nexus_desktop/services/scheduler_service.py`:

```python
import os
import sys
import threading
import time
import logging
import uuid
from core.service_interface import Service
from core.schedule_store import ScheduleStore


def _default_store_path():
    base_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    return os.path.join(base_dir, "data", "schedules.json")


class SchedulerService(Service):
    def on_start(self):
        self.active_timers = {}
        self.lock = threading.Lock()
        self.store = ScheduleStore(_default_store_path())

        self.bus.subscribe("SCHEDULE_ACTION", self.handle_schedule)
        self.bus.subscribe("CANCEL_SCHEDULE", self.handle_cancel)

        logging.info("SchedulerService started")

    def on_stop(self):
        with self.lock:
            for job_id, timer in self.active_timers.items():
                timer.cancel()
            self.active_timers.clear()

    def handle_schedule(self, event):
        data = event.payload
        seconds = data.get('seconds', 0)
        action = data.get('action')

        if not action or seconds <= 0:
            logging.error("Invalid schedule request")
            return

        job_id = str(uuid.uuid4())
        due_at = time.time() + seconds

        logging.info(f"Scheduling action in {seconds}s: {action}")

        timer = threading.Timer(seconds, self._execute_job, [job_id, action])

        with self.lock:
            self.active_timers[job_id] = timer
            self.store.save_job(job_id, due_at, action)

        timer.start()

        # Notify that scheduling was successful
        self.bus.publish("SCHEDULE_CREATED", {"job_id": job_id, "seconds": seconds})

    def handle_cancel(self, event):
        job_id = event.payload.get('job_id')
        with self.lock:
            if job_id in self.active_timers:
                self.active_timers[job_id].cancel()
                del self.active_timers[job_id]
                logging.info(f"Cancelled job {job_id}")
                self.bus.publish("SCHEDULE_CANCELLED", {"job_id": job_id})

    def _execute_job(self, job_id, action):
        # Remove from active list
        with self.lock:
            if job_id in self.active_timers:
                del self.active_timers[job_id]

        logging.info(f"Executing scheduled job {job_id}")

        # Inject the action back into the event bus as if it came now
        # We wrap it in COMMAND_RECEIVED so AutomationService picks it up
        self.bus.publish("COMMAND_RECEIVED", action)
```

(Note: `handle_cancel` and `_execute_job` don't yet call `store.remove_job` — that's Task 5.)

- [ ] **Step 4: Run test to verify it passes**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/services/scheduler_service.py nexus_desktop/tests/test_scheduler_service.py
git commit -m "feat: SchedulerService persists jobs to ScheduleStore on schedule"
```

---

### Task 5: Remove jobs from the store on cancel and on execution

**Files:**
- Modify: `nexus_desktop/services/scheduler_service.py`
- Test: `nexus_desktop/tests/test_scheduler_service.py`

**Interfaces:**
- Consumes: `SchedulerService`, `FakeTimer` from Task 4.
- Produces: `handle_cancel` and `_execute_job` now call `self.store.remove_job(job_id)`.

- [ ] **Step 1: Write the failing test**

Append to `nexus_desktop/tests/test_scheduler_service.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: Both new tests FAIL (`store.load()` still returns the job — `remove_job` is never called).

- [ ] **Step 3: Write minimal implementation**

In `nexus_desktop/services/scheduler_service.py`, update `handle_cancel` and `_execute_job`:

```python
    def handle_cancel(self, event):
        job_id = event.payload.get('job_id')
        with self.lock:
            if job_id in self.active_timers:
                self.active_timers[job_id].cancel()
                del self.active_timers[job_id]
                self.store.remove_job(job_id)
                logging.info(f"Cancelled job {job_id}")
                self.bus.publish("SCHEDULE_CANCELLED", {"job_id": job_id})

    def _execute_job(self, job_id, action):
        # Remove from active list and persisted store
        with self.lock:
            if job_id in self.active_timers:
                del self.active_timers[job_id]
            self.store.remove_job(job_id)

        logging.info(f"Executing scheduled job {job_id}")

        # Inject the action back into the event bus as if it came now
        # We wrap it in COMMAND_RECEIVED so AutomationService picks it up
        self.bus.publish("COMMAND_RECEIVED", action)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/services/scheduler_service.py nexus_desktop/tests/test_scheduler_service.py
git commit -m "fix: SchedulerService removes persisted jobs on cancel and execution"
```

---

### Task 6: Reject non-JSON-serializable actions before persisting

**Files:**
- Modify: `nexus_desktop/services/scheduler_service.py`
- Test: `nexus_desktop/tests/test_scheduler_service.py`

**Interfaces:**
- Consumes: `SchedulerService` from Task 5.
- Produces: `handle_schedule` now validates `action` with a `json.dumps` round-trip before scheduling; on failure, no timer is started, nothing is persisted, and no `SCHEDULE_CREATED` event is published.

- [ ] **Step 1: Write the failing test**

Append to `nexus_desktop/tests/test_scheduler_service.py`:

```python
def test_non_json_serializable_action_is_rejected(monkeypatch, tmp_path):
    svc, bus = make_service(monkeypatch, tmp_path)

    created_events = []
    bus.subscribe("SCHEDULE_CREATED", lambda event: created_events.append(event))

    # A set is not JSON-serializable
    bus.publish("SCHEDULE_ACTION", {"seconds": 60, "action": {"type": "WAIT", "value": {1, 2, 3}}})

    assert svc.store.load() == []
    assert svc.active_timers == {}
    assert created_events == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: FAIL on `assert svc.active_timers == {}`. Trace through why: without validation,
`handle_schedule` first does `self.active_timers[job_id] = timer` and only then calls
`self.store.save_job(job_id, due_at, action)`. `save_job` -> `_write` -> `json.dump` raises
`TypeError` because a `set` isn't JSON-serializable; `ScheduleStore._write`'s `except Exception`
cleans up its temp file and re-raises, so `schedules.json` is never written (`store.load() == []`
correctly holds) — but the exception unwinds past `timer.start()`, so the timer never starts,
while the `active_timers[job_id] = timer` assignment made moments earlier is never rolled back.
The job is left as a permanent, never-firing, unpersisted phantom entry in `active_timers`. This
is the concrete bug the validation-before-scheduling fix in Step 3 prevents.

- [ ] **Step 3: Write minimal implementation**

In `nexus_desktop/services/scheduler_service.py`, add `import json` at the top and update `handle_schedule`:

```python
    def handle_schedule(self, event):
        data = event.payload
        seconds = data.get('seconds', 0)
        action = data.get('action')

        if not action or seconds <= 0:
            logging.error("Invalid schedule request")
            return

        try:
            json.dumps(action)
        except (TypeError, ValueError) as e:
            logging.error(f"Schedule action is not JSON-serializable, rejecting: {e}")
            return

        job_id = str(uuid.uuid4())
        due_at = time.time() + seconds

        logging.info(f"Scheduling action in {seconds}s: {action}")

        timer = threading.Timer(seconds, self._execute_job, [job_id, action])

        with self.lock:
            self.active_timers[job_id] = timer
            self.store.save_job(job_id, due_at, action)

        timer.start()

        # Notify that scheduling was successful
        self.bus.publish("SCHEDULE_CREATED", {"job_id": job_id, "seconds": seconds})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/services/scheduler_service.py nexus_desktop/tests/test_scheduler_service.py
git commit -m "fix: SchedulerService rejects non-JSON-serializable schedule actions"
```

---

### Task 7: Restore a future persisted job on `on_start` with the correct remaining delay

**Files:**
- Modify: `nexus_desktop/services/scheduler_service.py`
- Test: `nexus_desktop/tests/test_scheduler_service.py`

**Interfaces:**
- Consumes: `SchedulerService`, `FakeTimer`, `ScheduleStore` from prior tasks.
- Produces: new private method `SchedulerService._restore_persisted_jobs(self) -> None`, called from `on_start` after subscribing to bus events. For a job with `due_at` in the future, it creates a `threading.Timer(due_at - now, self._execute_job, [job_id, action])`, starts it, and registers it in `active_timers`.

- [ ] **Step 1: Write the failing test**

Append to `nexus_desktop/tests/test_scheduler_service.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: FAIL — `svc.active_timers` is empty after `on_start` because nothing restores persisted jobs yet.

- [ ] **Step 3: Write minimal implementation**

In `nexus_desktop/services/scheduler_service.py`, update `on_start` and add `_restore_persisted_jobs`:

```python
    def on_start(self):
        self.active_timers = {}
        self.lock = threading.Lock()
        self.store = ScheduleStore(_default_store_path())

        self.bus.subscribe("SCHEDULE_ACTION", self.handle_schedule)
        self.bus.subscribe("CANCEL_SCHEDULE", self.handle_cancel)

        self._restore_persisted_jobs()

        logging.info("SchedulerService started")

    def _restore_persisted_jobs(self):
        now = time.time()
        with self.lock:
            for job in self.store.load():
                job_id = job.get('job_id')
                due_at = job.get('due_at', 0)
                action = job.get('action')
                if not job_id or action is None:
                    logging.warning(f"Skipping malformed persisted job: {job!r}")
                    continue

                delay = max(0.0, due_at - now)
                logging.info(f"Restoring persisted job {job_id}, firing in {delay:.1f}s")

                timer = threading.Timer(delay, self._execute_job, [job_id, action])
                self.active_timers[job_id] = timer
                timer.start()
```

Note: the whole method runs under one `with self.lock:` block, including `timer.start()`
(which returns immediately — starting the underlying OS thread — so it's safe to call while
holding the lock). This is simpler and more consistent than re-acquiring the lock per
iteration, and still matches the spec's
invariant that every `ScheduleStore` call goes through the service's existing lock —
even though nothing else can race with it this early in startup, consistency here
avoids a future maintainer copying the unlocked pattern into a context where it matters.

- [ ] **Step 4: Run test to verify it passes**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/services/scheduler_service.py nexus_desktop/tests/test_scheduler_service.py
git commit -m "feat: SchedulerService restores persisted jobs on restart"
```

---

### Task 8: Overdue persisted jobs fire via a zero-delay timer, including multiple at once

**Files:**
- Modify: `nexus_desktop/services/scheduler_service.py` (verify `_restore_persisted_jobs` from Task 7 already handles this — `max(0.0, due_at - now)` naturally yields `0.0` for overdue jobs; this task's job is to add explicit test coverage for that path, including the multi-job case)
- Test: `nexus_desktop/tests/test_scheduler_service.py`

**Interfaces:**
- Consumes: `SchedulerService._restore_persisted_jobs` from Task 7 (unchanged).
- Produces: no new production code expected if Task 7's `max(0.0, ...)` is correct; this task's tests are the verification. If a test fails, fix `_restore_persisted_jobs` to satisfy it before moving on.

- [ ] **Step 1: Write the failing test**

Append to `nexus_desktop/tests/test_scheduler_service.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: PASS immediately if Task 7's implementation is correct (this is expected — Task 7's `max(0.0, due_at - now)` already covers the overdue case). If either test fails, read the failure output and adjust `_restore_persisted_jobs` in `scheduler_service.py` until both pass — the two accepted failure modes to guard against are (a) `.fire()` not calling `_execute_job` correctly, and (b) `active_timers` not being restored for all 3 job IDs.

- [ ] **Step 3: Confirm no implementation change was needed, or fix**

If Step 2 already passed, skip to Step 4. Otherwise, apply the minimal fix to `_restore_persisted_jobs` in `nexus_desktop/services/scheduler_service.py` needed to satisfy both new tests, keeping the method's existing structure and log messages.

- [ ] **Step 4: Run test to verify it passes**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/services/scheduler_service.py nexus_desktop/tests/test_scheduler_service.py
git commit -m "test: verify overdue and multi-job restart recovery for SchedulerService"
```

---

### Task 9: `on_stop` must not remove persisted jobs; full restart cycle

**Files:**
- Modify: `nexus_desktop/services/scheduler_service.py` (verify `on_stop` — currently only cancels in-memory timers and clears `active_timers`, never touches `self.store`; confirm this is still true after Tasks 4-8)
- Test: `nexus_desktop/tests/test_scheduler_service.py`

**Interfaces:**
- Consumes: `SchedulerService.on_start`, `on_stop`, `store` from all prior tasks.
- Produces: no new production code expected (this is a regression-guarding test for an invariant that should already hold); if the test fails, it means an earlier task's edit accidentally called `store.remove_job` from `on_stop` — fix `on_stop` to only cancel timers, never touch the store.

- [ ] **Step 1: Write the failing test**

Append to `nexus_desktop/tests/test_scheduler_service.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: PASS immediately, since no prior task introduced a `store.remove_job` call in `on_stop`. This is expected — the test exists to lock in the invariant so a future change can't silently break it.

- [ ] **Step 3: Confirm `on_stop` is unchanged from the original**

Read `nexus_desktop/services/scheduler_service.py` and verify `on_stop` still reads exactly:

```python
    def on_stop(self):
        with self.lock:
            for job_id, timer in self.active_timers.items():
                timer.cancel()
            self.active_timers.clear()
```

If it matches, no code change is needed for this task.

- [ ] **Step 4: Run test to verify it passes**

Run: `../venv/Scripts/python.exe -m pytest tests/test_scheduler_service.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/tests/test_scheduler_service.py
git commit -m "test: lock in that on_stop never removes persisted scheduler jobs"
```

---

### Task 10: Full test suite regression check and final review

**Files:**
- None modified — verification only.

**Interfaces:**
- Consumes: everything from Tasks 1-9.
- Produces: confirmation that the full `nexus_desktop` test suite (existing security/automation/api tests plus the new scheduler/store tests) passes together.

- [ ] **Step 1: Run the entire test suite**

Run (from `nexus_desktop/`): `../venv/Scripts/python.exe -m pytest tests/ -v`
Expected: all tests pass — the pre-existing 29 tests (`test_security_manager.py`, `test_automation_service.py`, `test_api_service_auth.py`) plus the 10 new `test_scheduler_service.py` tests and 10 new `test_schedule_store.py` tests, for 49 total.

- [ ] **Step 2: Manually verify `main.py` still imports cleanly**

Run (from repo root): `python -m py_compile nexus_desktop/main.py nexus_desktop/services/scheduler_service.py nexus_desktop/core/schedule_store.py`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit (if any cleanup was needed)**

If Steps 1-2 required no code changes, there is nothing to commit — this task is verification-only. If a fix was needed, commit it:

```bash
git add -A
git commit -m "fix: resolve regression found in full scheduler persistence test run"
```

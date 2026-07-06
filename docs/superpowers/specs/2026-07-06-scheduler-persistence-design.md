# Scheduler Persistence Design

Date: 2026-07-06
Branch: TBD (new branch off `main`)

## Problem

`SchedulerService` keeps pending scheduled jobs only in memory
(`threading.Timer` + an in-memory dict). If the desktop agent restarts for any
reason, every pending schedule (e.g. "shut down in 1 hour") is silently lost
with no trace and no way to recover it.

## Decision

Jobs due while the agent was offline fire immediately on restart, rather than
being dropped. This favors "the action eventually happens" over "the action
never happens at a surprising time" — since the alternative (silently
dropping) risks the user believing a schedule is still active when it is not.

## Design

### Storage

A flat JSON file at `data/schedules.json`, rooted at
`os.path.dirname(os.path.abspath(sys.argv[0]))` — the **same** path strategy
`main.py` uses for `logs/` (`main.py:33`), not the `base_path`/`sys._MEIPASS`
strategy used for locating bundled modules (`main.py:8-11`). This distinction
matters: `sys._MEIPASS` is a temporary extraction directory in a frozen
`.exe`, so writing persisted state there would silently vanish on every
restart, defeating the entire feature. Job volume is always small (a handful
of pending timers for a single-user desktop tool), so a JSON file is simpler
and more inspectable than a database.

Each entry: `{ "job_id": str, "due_at": float (epoch seconds), "action": dict }`.
`due_at` is an **absolute** timestamp computed at schedule time
(`time.time() + seconds`) — this is what makes restart recovery possible,
since the original relative `seconds` value is meaningless after time has passed.
`action` must be JSON-serializable — it always is in practice, since it
originates from a parsed JSON HTTP request body and is never constructed
programmatically with non-serializable values (callables, etc). `handle_schedule`
validates this with a `json.dumps` round-trip before persisting, rejecting the
schedule request (and publishing no job) if it fails.

### New component: `core/schedule_store.py`

A small `ScheduleStore` class, decoupled from timer/threading logic:

- `load() -> list[dict]` — read all persisted jobs; returns `[]` and logs a
  warning if the file is missing or corrupt (never raises).
- `save_job(job_id, due_at, action)` — add/update one job and persist.
- `remove_job(job_id)` — remove one job and persist.

It keeps no in-memory cache: `save_job`/`remove_job` each call `load()` to read
the current full job list, apply the change, and rewrite the whole file.
Re-reading on every mutation is simpler than maintaining a cache in sync with
disk, and costs nothing measurable at this scale (a handful of jobs, mutated
rarely — scheduling or cancelling an action, not a hot path).

**Concurrency and crash-safety:** `ScheduleStore` is not internally
thread-safe — callers must serialize access. `SchedulerService` calls every
`ScheduleStore` method while holding its existing `self.lock`, the same lock
that already guards `active_timers`, so no new lock is introduced. Each write
uses a write-to-temp-file-then-`os.replace()` pattern (atomic rename on both
Windows and POSIX) so a crash or power loss mid-write can never leave
`schedules.json` half-written/corrupt — the rename either completes fully or
the old file is untouched.

### `SchedulerService` changes

- `on_start`: after subscribing to bus events, call `self.store.load()`. For
  each persisted job, **always** schedule it through `threading.Timer` rather
  than executing overdue jobs inline:
  - if `due_at <= now`: `threading.Timer(0, self._execute_job, [job_id, action])`.
  - else: `threading.Timer(due_at - now, self._execute_job, [job_id, action])`.

  **Why not execute overdue jobs synchronously in `on_start`:** `EventBus.publish`
  dispatches to whatever is *currently* subscribed with no queueing
  (`event_bus.py:26-41`) — it is not a durable queue. `main.py` starts services
  in a fixed order where `SchedulerService` happens to start after
  `AutomationService`, so a synchronous publish during `on_start` would work
  today, but that ordering is incidental, not guaranteed. Routing every
  restored job through a real (even zero-delay) `threading.Timer` means it
  fires from the main thread's event loop after all services in `main.py` have
  finished starting, removing the implicit ordering dependency entirely rather
  than just documenting it.
- `handle_schedule`: compute `due_at = time.time() + seconds`, call
  `self.store.save_job(...)` before starting the timer.
- `_execute_job`: after removing from `active_timers`, call
  `self.store.remove_job(job_id)`.
- `handle_cancel`: after cancelling and removing from `active_timers`, call
  `self.store.remove_job(job_id)`.
- `on_stop`: cancels in-memory `threading.Timer` objects as it does today, but
  **must not** call `self.store.remove_job(...)` for any of them. The entire
  point of persistence is that a cancelled-in-memory-by-shutdown job is still
  due later — it must still be in `schedules.json` for the next `on_start` to
  pick up. `remove_job` is only ever called on explicit user cancellation
  (`handle_cancel`) or successful execution (`_execute_job`).

### Error handling

A missing or corrupt `schedules.json` is treated as "no pending jobs": log a
warning and start with an empty schedule, rather than crashing the agent.

### Testing

- `ScheduleStore`: save/load/remove round-trip; corrupt-file recovery returns
  `[]` without raising; a crash mid-write (simulated by interrupting before
  `os.replace`) leaves the previous valid file intact.
- `SchedulerService.on_start` restart logic:
  - a persisted job with a past `due_at` executes (via a zero-delay timer);
  - one with a future `due_at` gets a timer with the correct remaining delay;
  - **multiple overdue jobs at once** all execute, none silently dropped;
  - a full `on_start` → `on_stop` → `on_start` cycle leaves the still-pending
    job persisted and recoverable (verifying the `on_stop` invariant above).
  (Timers are mocked/monkeypatched to avoid real waits.)

Both follow the existing test style in `nexus_desktop/tests/` (direct
instantiation + monkeypatching, no real Flask/GUI dependencies).

## Out of scope

- No UI changes — this is purely agent-side durability.
- No change to the scheduling API surface (`/execute` with
  `type: SCHEDULE_ACTION`) or to `parseSchedulerPrompt`.

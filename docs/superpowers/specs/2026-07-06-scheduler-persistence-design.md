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

A flat JSON file at `<agent base dir>/data/schedules.json`, using the same
path-resolution approach as `main.py` (`sys.argv[0]` directory) so it works
identically from source and from the frozen `.exe`. Job volume is always small
(a handful of pending timers for a single-user desktop tool), so a JSON file is
simpler and more inspectable than a database.

Each entry: `{ "job_id": str, "due_at": float (epoch seconds), "action": dict }`.
`due_at` is an **absolute** timestamp computed at schedule time
(`time.time() + seconds`) — this is what makes restart recovery possible,
since the original relative `seconds` value is meaningless after time has passed.

### New component: `core/schedule_store.py`

A small `ScheduleStore` class, decoupled from timer/threading logic:

- `load() -> list[dict]` — read all persisted jobs; returns `[]` and logs a
  warning if the file is missing or corrupt (never raises).
- `save_job(job_id, due_at, action)` — add/update one job and persist.
- `remove_job(job_id)` — remove one job and persist.

Internally it holds the full job list in memory and rewrites the whole file on
each mutation (simplicity over performance — appropriate at this scale).

### `SchedulerService` changes

- `on_start`: after subscribing to bus events, call `self.store.load()`. For
  each persisted job:
  - if `due_at <= now`: execute immediately via the existing
    `_execute_job`-style path.
  - else: start a `threading.Timer(due_at - now, ...)` for the remaining delay
    and re-register it in `active_timers`.
- `handle_schedule`: compute `due_at = time.time() + seconds`, call
  `self.store.save_job(...)` before starting the timer.
- `_execute_job`: after removing from `active_timers`, call
  `self.store.remove_job(job_id)`.
- `handle_cancel`: after cancelling and removing from `active_timers`, call
  `self.store.remove_job(job_id)`.

### Error handling

A missing or corrupt `schedules.json` is treated as "no pending jobs": log a
warning and start with an empty schedule, rather than crashing the agent.

### Testing

- `ScheduleStore`: save/load/remove round-trip; corrupt-file recovery returns
  `[]` without raising.
- `SchedulerService.on_start` restart logic: a persisted job with a past
  `due_at` executes immediately; one with a future `due_at` gets a timer with
  the correct remaining delay (mocking `threading.Timer` to avoid real waits).

Both follow the existing test style in `nexus_desktop/tests/` (direct
instantiation + monkeypatching, no real Flask/GUI dependencies).

## Out of scope

- No UI changes — this is purely agent-side durability.
- No change to the scheduling API surface (`/execute` with
  `type: SCHEDULE_ACTION`) or to `parseSchedulerPrompt`.

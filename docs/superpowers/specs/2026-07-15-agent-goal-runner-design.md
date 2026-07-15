# Server-Side Agent-Loop Runner — Design

**Date:** 2026-07-15
**Roadmap item:** #6 sub-project A (engine for "schedule an agent-loop goal"; sub-project B adds
scheduling + UI)
**Branch:** `feat/agent-goal-runner`

## Goal

A PC-side engine that runs a high-level Turkish goal through the bounded observe→decide→act
loop **autonomously on the PC** — reusing the existing next-action decision and action
execution — records the run, and exposes results via a status endpoint. This is the engine
that scheduled goals (sub-project B) will drive; it is also triggerable directly for testing
and a possible "run now on PC" use.

## Background

The agent loop today lives entirely in the phone (`components/AgentLoopPanel.tsx`): the phone
repeatedly calls `POST /ai/next-action` (screenshot + Gemini → one action) and `POST /execute`
(runs the action). A scheduled goal must run even when the phone is closed, so the loop needs
to run **server-side**.

The pieces already exist on the PC:
- **Decision:** `AiService.next_action` captures a screenshot (`capture_jpeg_bytes()`), asks
  Gemini (`_model(_NEXT_ACTION_INSTRUCTION, _NEXT_ACTION_SCHEMA)`), and parses `{done, summary}`
  or `{done:false, thought, type, value/x,y}` (mapping MOUSE_CLICK `x/y` 0–1000 to `"x%,y%"`).
- **Execution:** `AutomationService._execute_action` runs an action via
  `get_action(type)().execute(value, ActionContext(bus))` and publishes ACTION_COMPLETED/FAILED.
- **Wiring:** `services/api_service.py` (an `ApiService`, which holds `self.bus` and
  `self.security`) constructs `AiService(self.security).register(self.app)` (line 56). This is
  where the runner is wired, since it has the bus (for `ActionContext`), the security manager,
  and creates `AiService`.

## Architecture

One new engine class, one new store, two new endpoints, and one refactor to make the decision
logic reusable. No new dependencies; no frontend changes.

### Refactor — extract the decision from `AiService.next_action`

Add a Flask-free method:

```python
def decide_next_action(self, goal, history):
    """Returns (decision: dict, jpeg: bytes).
    decision is {"done": True, "summary": str}
            or  {"done": False, "thought": str, "action": {"type","value","description"}}.
    """
```

It performs the capture + Gemini call + parsing currently inside `next_action`, returning the
decision dict and the jpeg bytes. `next_action` (the HTTP route) becomes a thin wrapper: it
calls `decide_next_action`, and on the `done:false` branch adds `"image":
data_url_from_jpeg_bytes(jpeg)` to the JSON response (preserving #5a thumbnails). The
runner calls `decide_next_action` and ignores the jpeg. **The `/ai/next-action` HTTP contract
is unchanged.**

### `GoalRunner` — new `services/goal_runner.py`

Dependency-injected so it unit-tests without Gemini or a real desktop:

```python
class GoalRunner:
    def __init__(self, decide, execute, store, max_steps=15): ...
    def start(self, goal) -> str | None:   # returns run_id, or None if a run is already active
    def recent_runs(self) -> list          # store.load()
```

- `decide(goal, history) -> dict` — the AI decision (wired to `AiService.decide_next_action`,
  adapted to drop the jpeg).
- `execute(action: dict) -> Any` — runs the action, raising on failure (wired to
  `get_action(action["type"])().execute(action["value"], ActionContext(bus))`; raises
  `ValueError` for an unknown type).
- `store` — a `RunStore` (below).
- `max_steps` — 15 (same cap as the phone loop).

`start(goal)`: under a lock, if a run is already active return `None` (**single active run** —
concurrent desktop automation is chaotic); otherwise mark busy, generate a `run_id`, spawn a
daemon thread running `_run(goal, run_id)`, and return `run_id`.

`_run` loop (mirrors the phone loop / #5b outcomes):
```
history, steps = [], []
outcome, detail = "failed", None
for step in range(max_steps):
    decision = decide(goal, history)
    if decision["done"]:
        outcome, detail = "completed", decision.get("summary")
        break
    action = decision["action"]
    try:
        execute(action)
    except Exception as e:
        steps.append({...action..., "status": "failed"})
        outcome, detail = "failed", str(e)
        break
    steps.append({...action..., "status": "done"})
    history.append({"type": action["type"], "description": action["description"]})
    if step == max_steps - 1:
        outcome = "capped"
# always: write the record, clear busy
store.save_run({run_id, goal, started_at, finished_at, outcome, detail, steps})
```
`busy` is always cleared in a `finally` so a crash can't wedge the runner.

### `RunStore` — new `core/run_store.py`

Analogous to `core/schedule_store.py`. Persists server-run records to `data/agent_runs.json`,
newest-first, capped at 20. Not internally thread-safe — the `GoalRunner` serializes writes
(only one run is active at a time, and `save_run` is called once per run under the same lock
discipline as the rest of the runner).

- `save_run(record: dict) -> None` — prepend, trim to 20, persist.
- `load() -> list[dict]` — read (missing/corrupt file → `[]`, guarded like `ScheduleStore`).

Record shape: `{ run_id, goal, started_at, finished_at, outcome, detail, steps: [{type, value,
description, status}] }` where `status ∈ {done, failed}` and `outcome ∈
{completed, failed, capped}`.

### Endpoints — `AiService` (token-guarded like all `/ai/*`)

Register two routes and give `AiService` a `goal_runner` reference (wired by `ApiService`):

- `POST /ai/run-goal` `{goal}` → `_guard()`; missing/blank goal → 400; else
  `run_id = goal_runner.start(goal)`; if `None` → 409 `{success:false, error:"busy"}`; else 200
  `{success:true, run_id}`. Returns immediately (the run proceeds on its thread).
- `GET /ai/runs` → `_guard()`; 200 `{success:true, runs: goal_runner.recent_runs()}`.

`ApiService` wiring (line 56 area): build `RunStore(path)`, build the `execute` closure over
`self.bus`, construct `AiService(self.security)`, construct
`GoalRunner(decide=ai.decide_next_action_for_runner, execute=..., store=run_store)`, attach it
to `ai`, then `ai.register(self.app)`. (`decide_next_action_for_runner` is a tiny adapter that
returns just the decision dict from `decide_next_action`.)

### Autonomy note

A server/scheduled run is unattended, so it runs **fully autonomously** — the #5d risky-action
approval gate is phone-side and does not apply here. This is inherent to unattended execution
and is called out explicitly, not hidden.

## Testing (pytest, backend — run from `nexus_desktop/` via `python -m pytest tests -q`)

- **`GoalRunner`** with fake `decide`/`execute`/in-memory `store`:
  - reaches `completed` when `decide` returns `done` (records summary).
  - reaches `failed` when `execute` raises (records the failing step + error).
  - reaches `capped` at `max_steps` (all steps `done`).
  - records steps + builds `history` correctly across multiple steps.
  - `start` returns `None` (busy) when a run is already active; returns a `run_id` otherwise.
- **`RunStore`:** `save_run` prepends + caps at 20; `load` on missing/corrupt file → `[]`;
  round-trips through a temp file.
- **`AiService.decide_next_action`:** with Gemini + capture mocked (as in existing
  `test_ai_service.py`), returns the `done` shape and the `action` shape (incl. MOUSE_CLICK
  coord mapping); `/ai/next-action` HTTP route still returns the `image` on `done:false`
  (regression).
- **Endpoints:** `/ai/run-goal` 401 unauth / 400 missing-goal / 200 with run_id / 409 busy;
  `/ai/runs` 401 unauth / 200 returns records. `GoalRunner.start` is stubbed/mocked so no real
  automation runs during endpoint tests.

## Global Constraints

- No new dependencies; reuse `capture_jpeg_bytes`, `data_url_from_jpeg_bytes`, `_model`,
  `get_action`, `ActionContext`, and the `ScheduleStore` pattern.
- The `/ai/next-action` HTTP contract (fields, 401/503/400/502) is unchanged.
- Token/guard contract identical to other `/ai/*` routes (401 unauthorized, 503 AI disabled).
- Single active server run (409 when busy); `busy` always cleared in `finally`.
- Turkish where user-facing (error strings kept consistent with existing routes).
- No frontend change in this sub-project.
- Backend tests from `nexus_desktop/`; no `Co-Authored-By` trailer.
- Branch: `feat/agent-goal-runner`.

## Out of Scope (→ sub-project B or later)

- Scheduling a goal for a future time, and any scheduler-store changes (sub-project B).
- Any frontend / `SchedulerModal` UI (sub-project B).
- Per-step screenshots in server run records (text only for now; the phone loop keeps its
  own #5e thumbnails).
- Concurrent server runs / a run queue.
- Approval or gating of unattended runs.
- Cancelling an in-progress server run (v1 runs to a terminal state; cap bounds it).

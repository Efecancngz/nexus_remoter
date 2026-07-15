# Server-Side Agent-Loop Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PC-side engine that runs a Turkish goal through the bounded observe→decide→act loop autonomously, records the run, and exposes results via token-guarded endpoints.

**Architecture:** A new `RunStore` (JSON persistence, mirrors `ScheduleStore`) and a dependency-injected `GoalRunner` (bounded loop) are wired in `ApiService`, which builds the runner over the event bus and attaches it to `AiService`. `AiService.next_action`'s decision logic is extracted into a reusable `decide_next_action` so both the HTTP route and the runner share it. Two new routes: `POST /ai/run-goal`, `GET /ai/runs`.

**Tech Stack:** Python 3.12, Flask, pytest. Backend only — no frontend, no new dependencies.

## Global Constraints

- No new dependencies; reuse `capture_jpeg_bytes`, `data_url_from_jpeg_bytes`, `_model`, `get_action`, `ActionContext`, and the `ScheduleStore` pattern.
- The `/ai/next-action` HTTP contract (fields, 401/503/400/502) is UNCHANGED after the refactor.
- Token/guard contract identical to other `/ai/*` routes (401 unauthorized, 503 AI disabled).
- Single active server run: `GoalRunner.start` returns `None` when busy → route responds 409; `busy` is always cleared in a `finally`.
- No frontend change in this sub-project.
- Backend tests run FROM `nexus_desktop/` via `python -m pytest tests -q`.
- No `Co-Authored-By` trailer. Branch: `feat/agent-goal-runner`.

---

## File Structure

- Create: `nexus_desktop/core/run_store.py` — JSON run-record store (mirrors `core/schedule_store.py`).
- Create: `nexus_desktop/tests/test_run_store.py`.
- Create: `nexus_desktop/services/goal_runner.py` — the bounded loop engine.
- Create: `nexus_desktop/tests/test_goal_runner.py`.
- Modify: `nexus_desktop/services/ai_service.py` — extract `decide_next_action`, add `/ai/run-goal` + `/ai/runs`, `goal_runner` attribute.
- Modify: `nexus_desktop/tests/test_ai_service.py` — decision-extraction regression + endpoint tests.
- Modify: `nexus_desktop/services/api_service.py` — build `RunStore` + `GoalRunner`, attach to `AiService`.

---

## Task 1: `RunStore` JSON run-record store

**Files:**
- Create: `nexus_desktop/core/run_store.py`
- Test: `nexus_desktop/tests/test_run_store.py`

**Interfaces:**
- Produces: `RunStore(path)` with `load() -> list` and `save_run(record: dict) -> None`;
  module constant `MAX_RUNS = 20`.

- [ ] **Step 1: Write the failing test**

Create `nexus_desktop/tests/test_run_store.py`:

```python
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.run_store import RunStore, MAX_RUNS


def _rec(run_id, goal="hedef"):
    return {"run_id": run_id, "goal": goal, "started_at": 1, "finished_at": 2,
            "outcome": "completed", "detail": "ok", "steps": []}


def test_load_missing_file_returns_empty(tmp_path):
    store = RunStore(str(tmp_path / "agent_runs.json"))
    assert store.load() == []


def test_load_corrupt_file_returns_empty(tmp_path):
    path = tmp_path / "agent_runs.json"
    path.write_text("{not json", encoding="utf-8")
    assert RunStore(str(path)).load() == []


def test_save_run_prepends_newest_first(tmp_path):
    store = RunStore(str(tmp_path / "agent_runs.json"))
    store.save_run(_rec("a"))
    store.save_run(_rec("b"))
    assert [r["run_id"] for r in store.load()] == ["b", "a"]


def test_save_run_caps_at_max(tmp_path):
    store = RunStore(str(tmp_path / "agent_runs.json"))
    for i in range(MAX_RUNS + 1):
        store.save_run(_rec(str(i)))
    runs = store.load()
    assert len(runs) == MAX_RUNS
    assert runs[0]["run_id"] == str(MAX_RUNS)      # newest kept
    assert all(r["run_id"] != "0" for r in runs)   # oldest dropped
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `nexus_desktop/`): `python -m pytest tests/test_run_store.py -q`
Expected: FAIL — `core.run_store` does not exist.

- [ ] **Step 3: Write the module**

Create `nexus_desktop/core/run_store.py`:

```python
import json
import logging
import os
import tempfile

MAX_RUNS = 20


class RunStore:
    """Persists server-side agent-run records as a flat JSON file, newest-first, capped.

    Not internally thread-safe: the GoalRunner serializes writes (one active run).
    """

    def __init__(self, path):
        self.path = path

    def load(self):
        if not os.path.exists(self.path):
            return []
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logging.warning(f"[RunStore] Failed to load {self.path}: {e}")
            return []
        if not isinstance(data, list):
            logging.warning(f"[RunStore] Expected a list in {self.path}, got {type(data).__name__}")
            return []
        return data

    def save_run(self, record):
        runs = self.load()
        runs = [r for r in runs if r.get('run_id') != record.get('run_id')]
        runs.insert(0, record)
        runs = runs[:MAX_RUNS]
        self._write(runs)

    def _write(self, runs):
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=directory or ".", prefix=".agent_runs_", suffix=".tmp")
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(runs, f)
            os.replace(tmp_path, self.path)
        except Exception:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `nexus_desktop/`): `python -m pytest tests/test_run_store.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/core/run_store.py nexus_desktop/tests/test_run_store.py
git commit -m "feat: add RunStore for server-side agent-run records"
```

---

## Task 2: `GoalRunner` bounded loop engine

**Files:**
- Create: `nexus_desktop/services/goal_runner.py`
- Test: `nexus_desktop/tests/test_goal_runner.py`

**Interfaces:**
- Consumes: injected `decide(goal, history) -> dict`, `execute(action) -> Any` (raises on failure),
  a `store` with `save_run`/`load`.
- Produces: `GoalRunner(decide, execute, store, max_steps=15)` with `start(goal) -> str | None`
  and `recent_runs() -> list`.

**Notes:** `decide` returns `{"done": True, "summary": str}` or `{"done": False, "thought": str,
"action": {"type","value","description"}}`. Outcomes: `completed` / `failed` / `capped`.

- [ ] **Step 1: Write the failing tests**

Create `nexus_desktop/tests/test_goal_runner.py`:

```python
import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.goal_runner import GoalRunner


class FakeStore:
    def __init__(self):
        self.runs = []

    def save_run(self, record):
        self.runs.insert(0, record)

    def load(self):
        return self.runs


ACTION = {"type": "MOUSE_CLICK", "value": "1%,1%", "description": "tıkla"}


def _runner(decide, execute, store=None, max_steps=15):
    return GoalRunner(decide=decide, execute=execute, store=store or FakeStore(), max_steps=max_steps)


def test_run_completed_records_summary():
    store = FakeStore()
    decide = lambda goal, history: {"done": True, "summary": "bitti"}
    r = _runner(decide, execute=lambda a: None, store=store)
    r._run("hedef", "rid")
    rec = store.runs[0]
    assert rec["outcome"] == "completed"
    assert rec["detail"] == "bitti"
    assert rec["steps"] == []


def test_run_failed_when_execute_raises():
    store = FakeStore()
    decide = lambda goal, history: {"done": False, "thought": "t", "action": ACTION}
    def execute(a):
        raise RuntimeError("PC hatası")
    r = _runner(decide, execute, store=store)
    r._run("hedef", "rid")
    rec = store.runs[0]
    assert rec["outcome"] == "failed"
    assert rec["detail"] == "PC hatası"
    assert rec["steps"][-1]["status"] == "failed"


def test_run_capped_at_max_steps():
    store = FakeStore()
    decide = lambda goal, history: {"done": False, "thought": "t", "action": ACTION}
    r = _runner(decide, execute=lambda a: None, store=store, max_steps=3)
    r._run("hedef", "rid")
    rec = store.runs[0]
    assert rec["outcome"] == "capped"
    assert len(rec["steps"]) == 3
    assert all(s["status"] == "done" for s in rec["steps"])


def test_run_builds_history_across_steps():
    seen = []
    def decide(goal, history):
        seen.append(list(history))
        if len(seen) >= 2:
            return {"done": True, "summary": "ok"}
        return {"done": False, "thought": "t", "action": ACTION}
    r = _runner(decide, execute=lambda a: None)
    r._run("hedef", "rid")
    # First decide sees empty history; second sees the executed step.
    assert seen[0] == []
    assert seen[1] == [{"type": "MOUSE_CLICK", "description": "tıkla"}]


def test_start_returns_none_when_busy():
    r = _runner(decide=lambda g, h: {"done": True, "summary": "x"}, execute=lambda a: None)
    r._busy = True
    assert r.start("hedef") is None


def test_start_runs_and_records():
    store = FakeStore()
    r = _runner(decide=lambda g, h: {"done": True, "summary": "ok"}, execute=lambda a: None, store=store)
    run_id = r.start("hedef")
    assert run_id is not None
    deadline = time.time() + 2
    while not store.runs and time.time() < deadline:
        time.sleep(0.01)
    assert store.runs and store.runs[0]["run_id"] == run_id
    assert r._busy is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `nexus_desktop/`): `python -m pytest tests/test_goal_runner.py -q`
Expected: FAIL — `services.goal_runner` does not exist.

- [ ] **Step 3: Write the engine**

Create `nexus_desktop/services/goal_runner.py`:

```python
import threading
import time
import uuid


class GoalRunner:
    """Runs a goal through a bounded observe->decide->act loop on the PC.

    Dependency-injected: `decide(goal, history) -> dict`, `execute(action) -> Any`
    (raises on failure), and a `store` with `save_run`/`load`. One active run at a time.
    """

    def __init__(self, decide, execute, store, max_steps=15):
        self._decide = decide
        self._execute = execute
        self._store = store
        self._max_steps = max_steps
        self._lock = threading.Lock()
        self._busy = False

    def start(self, goal):
        with self._lock:
            if self._busy:
                return None
            self._busy = True
        run_id = str(uuid.uuid4())
        threading.Thread(target=self._run, args=(goal, run_id), daemon=True).start()
        return run_id

    def recent_runs(self):
        return self._store.load()

    def _run(self, goal, run_id):
        started_at = time.time()
        history = []
        steps = []
        outcome = "failed"
        detail = None
        try:
            for step in range(self._max_steps):
                decision = self._decide(goal, history)
                if decision.get("done"):
                    outcome = "completed"
                    detail = decision.get("summary")
                    break
                action = decision["action"]
                record = {
                    "type": action.get("type"),
                    "value": action.get("value"),
                    "description": action.get("description"),
                    "status": "failed",
                }
                try:
                    self._execute(action)
                except Exception as e:
                    steps.append(record)
                    outcome = "failed"
                    detail = str(e)
                    break
                record["status"] = "done"
                steps.append(record)
                history.append({"type": action.get("type"), "description": action.get("description")})
                if step == self._max_steps - 1:
                    outcome = "capped"
            self._store.save_run({
                "run_id": run_id,
                "goal": goal,
                "started_at": started_at,
                "finished_at": time.time(),
                "outcome": outcome,
                "detail": detail,
                "steps": steps,
            })
        finally:
            with self._lock:
                self._busy = False
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `nexus_desktop/`): `python -m pytest tests/test_goal_runner.py -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/services/goal_runner.py nexus_desktop/tests/test_goal_runner.py
git commit -m "feat: add GoalRunner bounded server-side agent loop"
```

---

## Task 3: Decision extraction, endpoints, and `ApiService` wiring

**Files:**
- Modify: `nexus_desktop/services/ai_service.py`
- Test: `nexus_desktop/tests/test_ai_service.py`
- Modify: `nexus_desktop/services/api_service.py`

**Interfaces:**
- Consumes: `GoalRunner`, `RunStore`, `get_action`, `ActionContext`.
- Produces: `AiService.decide_next_action(goal, history) -> (dict, bytes)`,
  `AiService.decide_next_action_for_runner(goal, history) -> dict`, `AiService.goal_runner`
  attribute, and routes `POST /ai/run-goal`, `GET /ai/runs`.

**Notes:** The `/ai/next-action` HTTP response must stay byte-identical in shape. Endpoint tests
attach a stub runner to `svc.goal_runner` so no real automation runs.

- [ ] **Step 1: Write the failing tests**

Append to `nexus_desktop/tests/test_ai_service.py` (it already has `_build_client`, `_token`,
`_patch_capture`, `FakeGenerativeModel`):

```python
class _StubRunner:
    def __init__(self, start_result="rid-1", runs=None):
        self.start_result = start_result
        self._runs = runs or []
        self.started_with = None

    def start(self, goal):
        self.started_with = goal
        return self.start_result

    def recent_runs(self):
        return self._runs


def test_decide_next_action_returns_action_shape(monkeypatch):
    _client, _security, svc = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    FakeGenerativeModel.result_text = json.dumps({
        "done": False, "thought": "tıkla", "type": "MOUSE_CLICK", "x": 500, "y": 500
    })
    decision, jpeg = svc.decide_next_action("hedef", [])
    assert decision["done"] is False
    assert decision["action"]["type"] == "MOUSE_CLICK"
    assert decision["action"]["value"] == "50%,50%"
    assert isinstance(jpeg, (bytes, bytearray))


def test_decide_next_action_returns_done_shape(monkeypatch):
    _client, _security, svc = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    FakeGenerativeModel.result_text = json.dumps({"done": True, "summary": "bitti"})
    decision, _jpeg = svc.decide_next_action("hedef", [])
    assert decision == {"done": True, "summary": "bitti"}


def test_run_goal_requires_auth(monkeypatch):
    client, _security, svc = _build_client(monkeypatch)
    svc.goal_runner = _StubRunner()
    resp = client.post("/ai/run-goal", json={"goal": "hedef"})
    assert resp.status_code == 401


def test_run_goal_missing_goal(monkeypatch):
    client, security, svc = _build_client(monkeypatch)
    svc.goal_runner = _StubRunner()
    resp = client.post("/ai/run-goal", json={"goal": "  "},
                       headers={"X-Nexus-Token": _token(security)})
    assert resp.status_code == 400


def test_run_goal_starts_run(monkeypatch):
    client, security, svc = _build_client(monkeypatch)
    svc.goal_runner = _StubRunner(start_result="rid-1")
    resp = client.post("/ai/run-goal", json={"goal": "hedef"},
                       headers={"X-Nexus-Token": _token(security)})
    assert resp.status_code == 200
    assert resp.get_json()["run_id"] == "rid-1"
    assert svc.goal_runner.started_with == "hedef"


def test_run_goal_busy_returns_409(monkeypatch):
    client, security, svc = _build_client(monkeypatch)
    svc.goal_runner = _StubRunner(start_result=None)
    resp = client.post("/ai/run-goal", json={"goal": "hedef"},
                       headers={"X-Nexus-Token": _token(security)})
    assert resp.status_code == 409


def test_runs_lists_records(monkeypatch):
    client, security, svc = _build_client(monkeypatch)
    svc.goal_runner = _StubRunner(runs=[{"run_id": "a", "outcome": "completed"}])
    resp = client.get("/ai/runs", headers={"X-Nexus-Token": _token(security)})
    assert resp.status_code == 200
    assert resp.get_json()["runs"][0]["run_id"] == "a"


def test_runs_requires_auth(monkeypatch):
    client, _security, svc = _build_client(monkeypatch)
    svc.goal_runner = _StubRunner()
    assert client.get("/ai/runs").status_code == 401
```

> If the existing helpers `_token` / `_patch_capture` differ in name or signature, use the
> forms already present in `test_ai_service.py` — do not redefine them.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `nexus_desktop/`): `python -m pytest tests/test_ai_service.py -q`
Expected: FAIL — `decide_next_action`, `/ai/run-goal`, `/ai/runs` do not exist yet.

- [ ] **Step 3: Extract `decide_next_action` and rewrite `next_action`**

In `nexus_desktop/services/ai_service.py`, replace the whole `next_action` method with the
extracted helper + a thin route. Find the current `def next_action(self):` method and replace
it with:

```python
    def decide_next_action(self, goal, history):
        """Capture + decide one step. Returns (decision: dict, jpeg: bytes).

        decision is {"done": True, "summary": str}
                or  {"done": False, "thought": str, "action": {"type","value","description"}}.
        """
        history_lines = "\n".join(
            f"- {h.get('type', '')}: {h.get('description', '')}" for h in history
        ) or "(henüz yok)"
        prompt = f"Hedef: {goal}\nŞimdiye kadar yapılanlar:\n{history_lines}"
        jpeg = capture_jpeg_bytes()
        model = self._model(_NEXT_ACTION_INSTRUCTION, _NEXT_ACTION_SCHEMA)
        resp = model.generate_content([
            {"mime_type": "image/jpeg", "data": jpeg},
            prompt,
        ])
        result = json.loads(resp.text)
        if result.get("done"):
            return {"done": True, "summary": result.get("summary", "")}, jpeg
        thought = result.get("thought", "")
        action_type = result.get("type", "")
        if action_type in _COORD_TYPES:
            value = f"{_clamp_pct(result.get('x', 0) / 10.0)}%,{_clamp_pct(result.get('y', 0) / 10.0)}%"
        else:
            value = result.get("value", "")
        return {
            "done": False,
            "thought": thought,
            "action": {"type": action_type, "value": value, "description": thought},
        }, jpeg

    def decide_next_action_for_runner(self, goal, history):
        decision, _jpeg = self.decide_next_action(goal, history)
        return decision

    def next_action(self):
        guard = self._guard()
        if guard:
            return guard
        data = request.json or {}
        goal = data.get('goal', '')
        if not goal or not goal.strip():
            return jsonify({"success": False, "error": "Missing goal"}), 400
        history = data.get('history') or []
        try:
            decision, jpeg = self.decide_next_action(goal, history)
            if decision["done"]:
                return jsonify({"success": True, "done": True, "summary": decision["summary"]}), 200
            return jsonify({
                "success": True,
                "done": False,
                "thought": decision["thought"],
                "action": decision["action"],
                "image": data_url_from_jpeg_bytes(jpeg),
            }), 200
        except Exception as e:
            logging.error("[AI] next_action error: %s", e)
            return jsonify({"success": False, "error": str(e)}), 502

    def run_goal(self):
        guard = self._guard()
        if guard:
            return guard
        data = request.json or {}
        goal = data.get('goal', '')
        if not goal or not goal.strip():
            return jsonify({"success": False, "error": "Missing goal"}), 400
        if self.goal_runner is None:
            return jsonify({"success": False, "error": "Runner unavailable"}), 503
        run_id = self.goal_runner.start(goal.strip())
        if run_id is None:
            return jsonify({"success": False, "error": "busy"}), 409
        return jsonify({"success": True, "run_id": run_id}), 200

    def runs(self):
        guard = self._guard()
        if guard:
            return guard
        records = self.goal_runner.recent_runs() if self.goal_runner else []
        return jsonify({"success": True, "runs": records}), 200
```

- [ ] **Step 4: Initialize `goal_runner` and register the routes**

**4a.** In `AiService.__init__`, add at the end of the method body:

```python
        self.goal_runner = None
```

**4b.** In `AiService.register`, add the two routes after the `/ai/next-action` line:

```python
        app.add_url_rule('/ai/run-goal', 'ai_run_goal', self.run_goal, methods=['POST'])
        app.add_url_rule('/ai/runs', 'ai_runs', self.runs, methods=['GET'])
```

- [ ] **Step 5: Run the AiService tests to verify they pass**

Run (from `nexus_desktop/`): `python -m pytest tests/test_ai_service.py -q`
Expected: PASS — new decision/endpoint tests plus all pre-existing tests (incl. the
`/ai/next-action` image regression).

- [ ] **Step 6: Wire the runner in `ApiService`**

In `nexus_desktop/services/api_service.py`, ensure `import os`, `import sys` are present (add
if missing), and add near the other imports:

```python
from services.goal_runner import GoalRunner
from core.run_store import RunStore
from actions import get_action
from actions.base import ActionContext
```

Replace the line `AiService(self.security).register(self.app)` with:

```python
        ai = AiService(self.security)
        run_store_path = os.path.join(
            os.path.dirname(os.path.abspath(sys.argv[0])), "data", "agent_runs.json"
        )
        run_store = RunStore(run_store_path)
        bus = self.bus

        def _execute_action(action):
            cls = get_action(action.get("type"))
            if cls is None:
                raise ValueError(f"Unknown action type: {action.get('type')!r}")
            return cls().execute(action.get("value"), ActionContext(bus=bus))

        ai.goal_runner = GoalRunner(
            decide=ai.decide_next_action_for_runner,
            execute=_execute_action,
            store=run_store,
        )
        ai.register(self.app)
```

- [ ] **Step 7: Full backend suite + commit**

Run (from `nexus_desktop/`): `python -m pytest tests -q`
Expected: PASS (all backend tests).

```bash
git add nexus_desktop/services/ai_service.py nexus_desktop/tests/test_ai_service.py nexus_desktop/services/api_service.py
git commit -m "feat: expose server-side goal runner via /ai/run-goal and /ai/runs"
```

---

## Self-Review Notes

- **Spec coverage:** `RunStore` → Task 1; `GoalRunner` engine + outcomes + single-active-run → Task 2; `decide_next_action` extraction (unchanged `/ai/next-action`) + `/ai/run-goal` + `/ai/runs` + `ApiService` wiring → Task 3. Autonomy is inherent (no gating server-side). All spec sections mapped.
- **Contract preservation:** `next_action` still returns `{success, done, ...}` and `image` on `done:false`; the extraction moves logic, not shape. Endpoint guard order (401 before 400/503/409) matches other `/ai/*` routes.
- **Type consistency:** `decide_next_action` returns `(dict, bytes)`; `decide_next_action_for_runner` returns just the dict — exactly what `GoalRunner.decide` expects. `GoalRunner.start` returns `str | None`; the route maps `None`→409. `RunStore.save_run(record)` / `load()` match the runner's usage.
- **Concurrency:** `GoalRunner` guards `_busy` with a lock and clears it in `finally`; `RunStore` is written only from the single active run. No shared mutable state escapes.

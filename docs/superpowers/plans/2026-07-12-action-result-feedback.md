# Action Result Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `POST /execute` return the real success/failure of an action by correlating the async result back to the blocking HTTP request via the per-step `id`, and surface failures in the phone UI.

**Architecture:** A thread-safe `PendingResults` registry bridges the pool-thread action result to the Flask request thread. `ApiService.execute` registers the `id`, publishes `COMMAND_RECEIVED`, and waits (15s) for `ACTION_COMPLETED`/`ACTION_FAILED` to resolve it. `SCHEDULE_ACTION` and id-less requests keep today's fire-and-forget `queued` response. The frontend reads the JSON body's `success` instead of just HTTP 200.

**Tech Stack:** Python 3.12 / Flask (backend, `threading` stdlib only); React + TypeScript / vitest (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-12-action-result-feedback-design.md`

## Global Constraints

- Branch: `feat/action-result-feedback` (already created; spec committed here).
- No new runtime dependencies (`threading` is stdlib).
- Backend tests run on Windows in CI; Python 3.12. Commit messages have NO Co-Authored-By trailer.
- Normal-action `/execute` responses stay **HTTP 200**; success/failure is carried in the JSON body (`success`, optional `error`). Non-200 stays reserved for auth (401) and transport errors.
- Backward compatibility: `SCHEDULE_ACTION` and any request without an `id` must return `200 {"success": True, "status": "queued"}` without waiting.
- Timeout constant must exceed `CloseAppAction`'s internal `wait_procs(timeout=5)`. Use `15.0` in production; tests override it to stay fast.
- Baseline: 183 backend tests, 49 frontend tests green before Task 1.

---

### Task 1: `PendingResults` correlation registry

**Files:**
- Create: `nexus_desktop/core/pending_results.py`
- Test: `nexus_desktop/tests/test_pending_results.py`

**Interfaces:**
- Produces: `core.pending_results.PendingResults` with `register(request_id: str) -> None`, `resolve(request_id: str, result: dict) -> None`, `wait(request_id: str, timeout: float) -> dict | None`. `wait` returns the resolved dict or `None` on timeout/unknown id, and always removes the entry.

- [ ] **Step 1: Write the failing tests**

```python
# nexus_desktop/tests/test_pending_results.py
import os
import sys
import threading
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.pending_results import PendingResults


def test_resolve_before_wait_returns_result():
    pr = PendingResults()
    pr.register("a")
    pr.resolve("a", {"success": True})
    assert pr.wait("a", timeout=1.0) == {"success": True}


def test_resolve_after_wait_started_wakes_waiter():
    pr = PendingResults()
    pr.register("b")
    results = []

    def waiter():
        results.append(pr.wait("b", timeout=2.0))

    t = threading.Thread(target=waiter)
    t.start()
    time.sleep(0.1)
    pr.resolve("b", {"success": False, "error": "x"})
    t.join(timeout=2.0)
    assert results == [{"success": False, "error": "x"}]


def test_wait_times_out_returns_none():
    pr = PendingResults()
    pr.register("c")
    assert pr.wait("c", timeout=0.1) is None


def test_resolve_unknown_id_is_noop():
    pr = PendingResults()
    pr.resolve("nope", {"success": True})  # must not raise


def test_wait_removes_entry():
    pr = PendingResults()
    pr.register("d")
    pr.resolve("d", {"success": True})
    assert pr.wait("d", timeout=1.0) == {"success": True}
    assert pr.wait("d", timeout=0.1) is None  # entry gone
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `nexus_desktop/`): `../venv/Scripts/python.exe -m pytest tests/test_pending_results.py -q`
Expected: FAIL / `ModuleNotFoundError: No module named 'core.pending_results'`

- [ ] **Step 3: Implement**

```python
# nexus_desktop/core/pending_results.py
"""Correlate an async action result back to the blocking HTTP request that
triggered it, keyed by request id. Thread-safe: register/resolve/wait may be
called from different threads (Flask request thread vs action pool thread)."""
import threading


class PendingResults:
    def __init__(self):
        self._lock = threading.Lock()
        self._entries = {}  # request_id -> [threading.Event, result_dict | None]

    def register(self, request_id):
        """Create a waitable slot for request_id (replaces any existing slot)."""
        with self._lock:
            self._entries[request_id] = [threading.Event(), None]

    def resolve(self, request_id, result):
        """Store result and wake any waiter. No-op if id is unknown."""
        with self._lock:
            entry = self._entries.get(request_id)
            if entry is None:
                return
            entry[1] = result
            entry[0].set()

    def wait(self, request_id, timeout):
        """Block until resolved or timeout. Returns result dict or None.
        Always removes the entry before returning."""
        with self._lock:
            entry = self._entries.get(request_id)
        if entry is None:
            return None
        signaled = entry[0].wait(timeout)
        with self._lock:
            self._entries.pop(request_id, None)
        return entry[1] if signaled else None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `../venv/Scripts/python.exe -m pytest tests/test_pending_results.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/core/pending_results.py nexus_desktop/tests/test_pending_results.py
git commit -m "feat: PendingResults registry for request/result correlation"
```

---

### Task 2: Wire synchronous result into `ApiService`

**Files:**
- Modify: `nexus_desktop/services/api_service.py` (`on_start`, `execute`, `_run_server`; add two handlers and a timeout constant)
- Modify: `nexus_desktop/tests/test_api_service_tls.py` (assert `threaded=True`)
- Test: `nexus_desktop/tests/test_api_service_results.py` (new)

**Interfaces:**
- Consumes: Task 1's `PendingResults`; existing `EventBus` (synchronous `publish`); `ACTION_COMPLETED {"status","id"}` / `ACTION_FAILED {"error","id"}` events already emitted by `AutomationService`.
- Produces: `ApiService.EXECUTE_TIMEOUT` (float class attr, default `15.0`); `/execute` returns `200 {"success": bool, "error": str|None}` for id-bearing normal actions.

- [ ] **Step 1: Write the failing tests**

```python
# nexus_desktop/tests/test_api_service_results.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from core.event_bus import EventBus
from core.security_manager import SecurityManager
from services.api_service import ApiService


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])
    bus = EventBus()
    sec = SecurityManager()
    svc = ApiService("API", bus, sec, start_server=False)
    svc.on_start()
    svc.app.testing = True
    token = sec.issue_token()
    return svc.app.test_client(), bus, svc, token


def _hdr(token):
    return {"X-Nexus-Token": token}


def test_execute_returns_success_when_action_completes(client):
    app_client, bus, svc, token = client
    # Simulate AutomationService: completing the action as soon as it is dispatched.
    bus.subscribe(
        "COMMAND_RECEIVED",
        lambda ev: bus.publish("ACTION_COMPLETED", {"status": "success", "id": ev.payload["id"]}),
    )
    res = app_client.post(
        "/execute",
        json={"id": "r1", "type": "LAUNCH_APP", "value": "spotify"},
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json() == {"success": True, "error": None}


def test_execute_returns_failure_with_error(client):
    app_client, bus, svc, token = client
    bus.subscribe(
        "COMMAND_RECEIVED",
        lambda ev: bus.publish("ACTION_FAILED", {"error": "No running app matches", "id": ev.payload["id"]}),
    )
    res = app_client.post(
        "/execute",
        json={"id": "r2", "type": "CLOSE_APP", "value": "spotify"},
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json() == {"success": False, "error": "No running app matches"}


def test_execute_times_out_when_no_result(client):
    app_client, bus, svc, token = client
    svc.EXECUTE_TIMEOUT = 0.1  # no subscriber resolves it
    res = app_client.post(
        "/execute",
        json={"id": "r3", "type": "LAUNCH_APP", "value": "spotify"},
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json() == {"success": False, "error": "Action timed out"}


def test_schedule_action_returns_queued_without_waiting(client):
    app_client, bus, svc, token = client
    svc.EXECUTE_TIMEOUT = 0.1  # would time out if it (incorrectly) waited
    captured = []
    bus.subscribe("SCHEDULE_ACTION", lambda ev: captured.append(ev.payload))
    res = app_client.post(
        "/execute",
        json={"id": "s1", "type": "SCHEDULE_ACTION", "value": "..."},
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json()["status"] == "queued"
    assert len(captured) == 1


def test_missing_id_returns_queued_without_waiting(client):
    app_client, bus, svc, token = client
    svc.EXECUTE_TIMEOUT = 0.1  # would time out if it (incorrectly) waited
    res = app_client.post(
        "/execute",
        json={"type": "LAUNCH_APP", "value": "spotify"},  # no id
        headers=_hdr(token),
    )
    assert res.status_code == 200
    assert res.get_json()["status"] == "queued"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `../venv/Scripts/python.exe -m pytest tests/test_api_service_results.py -q`
Expected: FAIL — success/failure/timeout tests get today's `{"success": True, "status": "queued"}` instead of the new body (and there is no `EXECUTE_TIMEOUT` attribute).

- [ ] **Step 3: Add the import and timeout constant**

In `nexus_desktop/services/api_service.py`, add to the imports near the top (after `from core.cert_store import CertStore`):

```python
from core.pending_results import PendingResults
```

Add a class attribute at the top of `class ApiService(Service):` (immediately below the class line, before `__init__`):

```python
    EXECUTE_TIMEOUT = 15.0  # seconds; must exceed CloseAppAction's 5s wait_procs
```

- [ ] **Step 4: Create the registry and subscribe in `on_start`**

In `on_start`, immediately after the existing line `self.bus.subscribe("SYSTEM_STATS_UPDATED", self.on_stats_update)`, add:

```python
        # Correlate action results back to the blocking /execute request.
        self.pending = PendingResults()
        self.bus.subscribe("ACTION_COMPLETED", self._on_action_completed)
        self.bus.subscribe("ACTION_FAILED", self._on_action_failed)
```

- [ ] **Step 5: Add the two result handlers**

Add these methods to `ApiService` (e.g. just after `on_stats_update`):

```python
    def _on_action_completed(self, event):
        rid = (event.payload or {}).get('id')
        if rid:
            self.pending.resolve(rid, {"success": True})

    def _on_action_failed(self, event):
        payload = event.payload or {}
        rid = payload.get('id')
        if rid:
            self.pending.resolve(rid, {"success": False, "error": payload.get('error', 'Action failed')})
```

- [ ] **Step 6: Rewrite `execute` to correlate and wait**

Replace the body of `execute` (currently the block from `action_type = data.get('type', '')` through the final `return jsonify({"success": True, "status": "queued"}), 200`) with:

```python
        action_type = data.get('type', '')
        request_id = data.get('id')
        logging.info("[AuthSuccess] Command accepted: type=%s", action_type)

        # SCHEDULE_ACTION is a scheduler meta-command: scheduling it IS the
        # success; no action result will ever come, so never wait.
        if action_type == 'SCHEDULE_ACTION':
            self.bus.publish("SCHEDULE_ACTION", data)
            return jsonify({"success": True, "status": "queued"}), 200

        # No id -> legacy fire-and-forget; nothing to correlate against.
        if not request_id:
            self.bus.publish("COMMAND_RECEIVED", data)
            return jsonify({"success": True, "status": "queued"}), 200

        # Register BEFORE publishing so the result event (fired later from the
        # action pool thread) cannot be missed.
        self.pending.register(request_id)
        self.bus.publish("COMMAND_RECEIVED", data)
        result = self.pending.wait(request_id, self.EXECUTE_TIMEOUT)
        if result is None:
            return jsonify({"success": False, "error": "Action timed out"}), 200
        return jsonify({"success": result["success"], "error": result.get("error")}), 200
```

- [ ] **Step 7: Add `threaded=True` to the server run**

In `_run_server`, change:

```python
        self.app.run(host='0.0.0.0', port=8080, debug=False, use_reloader=False, ssl_context=(self.cert_path, self.key_path))
```

to:

```python
        self.app.run(host='0.0.0.0', port=8080, debug=False, use_reloader=False, threaded=True, ssl_context=(self.cert_path, self.key_path))
```

- [ ] **Step 8: Lock the threaded change in the TLS test**

In `nexus_desktop/tests/test_api_service_tls.py`, inside `test_run_server_passes_ssl_context_to_flask`, after the existing `assert captured["port"] == 8080` line, add:

```python
    assert captured["threaded"] is True
```

- [ ] **Step 9: Run the new tests, the touched tests, then the full suite**

Run:
```
../venv/Scripts/python.exe -m pytest tests/test_api_service_results.py tests/test_api_service_auth.py tests/test_api_service_tls.py -q
../venv/Scripts/python.exe -m pytest tests/ -q
```
Expected: all green. `test_api_service_auth.py` still passes unchanged (its `/execute` test sends no `id`, so it hits the queued bypass and does not block).

- [ ] **Step 10: Commit**

```bash
git add nexus_desktop/services/api_service.py nexus_desktop/tests/test_api_service_results.py nexus_desktop/tests/test_api_service_tls.py
git commit -m "feat: /execute waits for and returns the real action result"
```

---

### Task 3: Frontend reads the real result and reports failures

**Files:**
- Modify: `services/automation.ts` (`run` loop)
- Test: `services/automation.test.ts` (extend)

**Interfaces:**
- Consumes: the new `/execute` body `{success: boolean, error?: string}`.
- Produces: `ActionExecutor.run` returns `{success:false, error}` naming the failed step when the agent reports `success:false`, and stops the macro.

- [ ] **Step 1: Write the failing tests** (append inside the `describe('ActionExecutor.run', ...)` block)

```typescript
  it('stops and names the step when the agent returns success:false', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(200, { success: false, error: 'No running app matches' }));

    const result = await executor.run(
      [
        step({ type: ActionType.CLOSE_APP, value: 'spotify', description: 'Spotify kapatılıyor' }),
        step({ type: ActionType.KEYPRESS, value: 'a' }),
      ],
      '1.2.3.4'
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Spotify kapatılıyor');
    expect(result.error).toContain('No running app matches');
    expect(fetchMock).toHaveBeenCalledTimes(1); // second step never sent
  });

  it('continues to the next step when the agent returns success:true', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));

    const runPromise = executor.run(
      [
        step({ type: ActionType.KEYPRESS, value: 'a' }),
        step({ type: ActionType.KEYPRESS, value: 'b' }),
      ],
      '1.2.3.4'
    );
    await vi.advanceTimersByTimeAsync(200); // cooldown after first step
    const result = await runPromise;

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run the tests to verify the failure test fails**

Run (repo root): `npx vitest run services/automation.test.ts`
Expected: `stops and names the step when the agent returns success:false` FAILS — current code returns `{success:true}` because it only checks `response.ok`.

- [ ] **Step 3: Implement the body check**

In `services/automation.ts`, inside `run`, locate the block right after the `fetch` call:

```typescript
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("AUTH_REQUIRED");
          }
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "PC Agent hatası");
        }
```

Immediately AFTER that `if (!response.ok) { ... }` block (still inside the `try`), add:

```typescript
        const body = await response.json().catch(() => ({} as any));
        if (body && body.success === false) {
          return {
            success: false,
            error: `"${step.description}" adımı başarısız: ${body.error ?? 'bilinmeyen hata'}`,
          };
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run services/automation.test.ts`
Expected: all pass, including the two new tests.

- [ ] **Step 5: Type-check and full frontend suite**

Run (repo root):
```
npx tsc --noEmit
npx vitest run
```
Expected: `tsc` clean; all frontend tests pass (49 prior + 2 new = 51).

- [ ] **Step 6: Commit**

```bash
git add services/automation.ts services/automation.test.ts
git commit -m "feat: report agent action failures per step in the executor"
```

---

## Self-Review

**Spec coverage:**
- `PendingResults` registry (register/resolve/wait, cleanup) → Task 1. ✓
- Subscribe `ACTION_COMPLETED`/`ACTION_FAILED`; resolve by id → Task 2 Steps 4–5. ✓
- `execute` correlation + 15s wait; `SCHEDULE_ACTION` and missing-id bypass → Task 2 Step 6. ✓
- `threaded=True` on `app.run` → Task 2 Step 7, locked by test in Step 8. ✓
- HTTP-200-with-body contract → Task 2 Step 6 (all returns 200). ✓
- Timeout semantics (`{success:false,"Action timed out"}`) → Task 2 Step 6 + test. ✓
- Frontend reads body.success, abort-on-failure names the step → Task 3. ✓
- Backend result tests (success/failure/timeout/schedule/missing-id) → Task 2 Step 1. ✓
- Frontend tests (fail aborts + names step; success continues) → Task 3 Step 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and every run step gives the exact command + expected result. ✓

**Type/name consistency:** `PendingResults.register/resolve/wait`, `EXECUTE_TIMEOUT`, `_on_action_completed`/`_on_action_failed`, event names `ACTION_COMPLETED`/`ACTION_FAILED`/`COMMAND_RECEIVED`/`SCHEDULE_ACTION`, and the response shape `{success, error}` are identical across Tasks 1–3 and the tests. The result dict `{"success": bool, "error"?: str}` produced in Task 2 handlers matches what `execute` reads (`result["success"]`, `result.get("error")`). ✓

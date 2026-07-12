# Action Result Feedback Design

**Date:** 2026-07-12
**Status:** Approved (pending spec review)
**Branch:** `feat/action-result-feedback`

## Goal

Make the phone learn whether each action actually succeeded on the PC. Today `POST /execute` returns `200 {"queued"}` immediately and the frontend treats HTTP 200 as success — so when an action fails on the PC (e.g. "close Spotify" matches nothing), the agent only logs `ACTION_FAILED` to the EventBus and the user sees no error. This closes that loop synchronously, reusing the per-step `id` the frontend already sends and the `ACTION_COMPLETED`/`ACTION_FAILED` events the agent already emits.

## Current Behavior (baseline)

- **Frontend** (`services/automation.ts`): runs steps sequentially, awaiting each `/execute`; sends `{id: step.id, type, value, description}`; treats `response.ok` (HTTP 200) as success; aborts the macro on a transport error or 401. `WAIT` steps are handled locally on the phone and never sent to the agent.
- **Backend** (`services/api_service.py`): `execute()` publishes `COMMAND_RECEIVED` (or `SCHEDULE_ACTION`) and returns `200 {"success": True, "status": "queued"}` immediately.
- **AutomationService**: `handle_command` offloads to a `ThreadPoolExecutor`; `_execute_action` runs the action in a pool thread and publishes `ACTION_COMPLETED {"status":"success","id":...}` or `ACTION_FAILED {"error":...,"id":...}`. Nothing routes these back to the client.
- **EventBus** (`core/event_bus.py`): `publish` is **synchronous** — subscriber callbacks run in the publishing thread.

## Approach

Chosen: **synchronous `/execute` with event correlation** (over a poll endpoint or SSE/WebSocket). The frontend already awaits each step sequentially, so making that await return the real outcome requires no new transport, no new dependency, and no client rearchitecture.

## Architecture

A small thread-safe **pending-results registry** bridges the async pool-thread result back to the blocking HTTP request thread, keyed by `id`.

### Component 1: `PendingResults` (new — `nexus_desktop/core/pending_results.py`)

One responsibility: correlate a request `id` to the result that arrives later on another thread.

Interface:
- `register(request_id: str) -> None` — create a `threading.Event` + empty result slot for this id (idempotent guard: registering an existing id replaces its slot).
- `resolve(request_id: str, result: dict) -> None` — store `result` and set the event. No-op if the id was never registered or already resolved (late/duplicate events are harmless).
- `wait(request_id: str, timeout: float) -> dict | None` — block until resolved or `timeout` seconds elapse; return the stored result dict, or `None` on timeout. Always removes the id's entry before returning (success or timeout) so the registry does not leak.

Internals: a `dict[str, tuple[threading.Event, dict|None]]` guarded by a `threading.Lock`. `wait` releases the lock while blocking on the event.

### Component 2: `ApiService` changes (`nexus_desktop/services/api_service.py`)

- Construct one `PendingResults` instance in `on_start`.
- Subscribe in `on_start`:
  - `ACTION_COMPLETED` → `pending.resolve(payload["id"], {"success": True})`
  - `ACTION_FAILED` → `pending.resolve(payload["id"], {"success": False, "error": payload.get("error", "Action failed")})`
  - Both guard against a missing `id` in the payload (ignore if absent).
- `execute()` new logic:
  1. Authorize (unchanged).
  2. `action_type = data.get('type')`, `request_id = data.get('id')`.
  3. If `action_type == 'SCHEDULE_ACTION'`: publish `SCHEDULE_ACTION`, return `200 {"success": True, "status": "queued"}` (scheduling is the success; no action result will come).
  4. Else if `request_id` is falsy: publish `COMMAND_RECEIVED`, return `200 {"success": True, "status": "queued"}` (backward-compatible fire-and-forget).
  5. Else: `pending.register(request_id)`; publish `COMMAND_RECEIVED`; `result = pending.wait(request_id, timeout=15.0)`.
     - `result is None` → `200 {"success": False, "error": "Action timed out"}`.
     - else → `200 {"success": result["success"], "error": result.get("error")}` (omit/None error on success).
- Register the pending entry **before** publishing so the result event (fired later from the pool thread) cannot be missed.
- Add `threaded=True` to `self.app.run(...)`. Werkzeug serializes requests by default; a `/execute` that blocks up to 15s would otherwise stall the 2-second stats poll and any concurrent request. Required for this design.

HTTP contract: normal-action responses stay **HTTP 200**; success/failure is carried in the JSON body (`success`, optional `error`). Non-200 remains reserved for auth (401) and transport failures, preserving the frontend's existing 401 handling.

### Component 3: Frontend (`services/automation.ts`)

In the per-step loop, after `fetch`:
- Keep the existing `!response.ok` branch (401 → `AUTH_REQUIRED`; other non-200 → connection error).
- On a 200 response, parse the JSON body. If `body.success === false`, stop the macro and return `{ success: false, error: \`"${step.description}" adımı başarısız: ${body.error ?? 'bilinmeyen hata'}\` }`.
- On `body.success === true`, continue to the next step (existing post-step delays unchanged).

This makes the abort-on-first-failure behavior driven by real outcomes; the failure message names the step and includes the agent's error. Surfaced via the existing `ToastContainer`.

## Timeout Semantics

15.0 seconds. Must exceed `CloseAppAction`'s internal `psutil.wait_procs(timeout=5)`; 15s leaves margin for slower machines while still failing definitively rather than hanging the phone. On timeout the action may still complete on the PC, but the phone receives `{success:false, error:"Action timed out"}`.

## Failure Semantics

A failed step aborts the remaining steps in the macro (matching today's abort-on-transport-error behavior), and the returned error names which step failed. Continuing past a failed step is intentionally not done — later steps often depend on earlier ones (e.g. focus-then-hotkey).

## Testing

**Backend — `tests/test_pending_results.py` (new):**
- `resolve` after `wait` started (event-driven wake).
- `resolve` before `wait` (already-set path returns immediately).
- `wait` times out → returns `None`.
- `resolve` for an unregistered id is a no-op (no raise).
- `wait` removes the entry (a second `wait` on the same id times out / returns None).

**Backend — `tests/test_api_service_results.py` (new or extend existing api tests):**
- Successful action → `execute` response body `{"success": True}`. (Drive by publishing `ACTION_COMPLETED` from a fake automation subscriber, or by resolving via the injected registry.)
- Failed action → `{"success": False, "error": ...}`.
- `SCHEDULE_ACTION` → returns `queued` without waiting (no registry entry created).
- Missing `id` → returns `queued` without waiting.
- Timeout → `{"success": False, "error": "Action timed out"}` (use a short injected timeout so the test is fast).

**Frontend — extend `services/automation.test.ts`:**
- `body.success:false` aborts the loop and returns the step-named error; later steps' `/execute` not called.
- `body.success:true` continues to the next step.

## Out of Scope (YAGNI)

Batched/multi-step result payloads, progress streaming, retry/resume, and any per-step UI beyond the existing toast. Deferred to later roadmap items.

## Constraints Carried From the Project

- No new runtime dependencies (`threading` is stdlib).
- Backend tests run on Windows (`windows-latest` in CI); Python 3.12.
- Commit messages have no Co-Authored-By trailer.
- User-visible Turkish strings: the new failure message is Turkish, consistent with the existing UI copy.

# New Actions + Data-Return Support Design

**Date:** 2026-07-13
**Status:** Approved (pending spec review)
**Branch:** `feat/new-actions-data-return`

## Goal

Add a batch of new actions to the registry and the supporting mechanism for actions that return **data** to the phone (not just success/failure). New actions: `SCREENSHOT`, `CLIPBOARD_SET`, `CLIPBOARD_GET`, `WINDOW_MANAGE`, `MOUSE_MOVE`, `MOUSE_SCROLL`, `TYPE_TEXT`. The phone gets a minimal UI to consume the two data-returning ones (screenshot modal, clipboard toast).

## Background

The action registry (`nexus_desktop/actions/`) auto-discovers one-file action modules that register via `@register_action`. The prior "action result feedback" work made `/execute` synchronous: it correlates a per-step `id` to `ACTION_COMPLETED {"status","id"}` / `ACTION_FAILED {"error","id"}` via `core/pending_results.py`, and returns `200 {"success", "error"}`. Today `Action.execute(value, context)` returns nothing and raises on error; `AutomationService._execute_action` runs it and publishes `ACTION_COMPLETED` with no payload beyond status/id. No action can send data back to the phone.

## Design

### Part A — Data-return foundation (additive, backward-compatible)

1. **`Action.execute` contract** (`actions/base.py`): docstring updated to state it MAY return a JSON-serializable value (dict or str) or `None`. No signature change. Existing actions keep returning `None`.

2. **`AutomationService._execute_action`** (`services/automation_service.py`): capture the return value and include it:
   ```python
   result = action_cls().execute(value, self.context)
   self.bus.publish("ACTION_COMPLETED", {"status": "success", "id": data.get('id'), "data": result})
   ```
   `result` is `None` for effect-only actions.

3. **`ApiService`** (`services/api_service.py`):
   - `_on_action_completed` resolves with data:
     ```python
     def _on_action_completed(self, event):
         payload = event.payload or {}
         rid = payload.get('id')
         if rid:
             self.pending.resolve(rid, {"success": True, "data": payload.get("data")})
     ```
   - `execute()` success return includes data:
     ```python
     return jsonify({"success": result["success"], "error": result.get("error"), "data": result.get("data")}), 200
     ```
   Failure and timeout responses are unchanged (no `data` key needed; frontend treats missing as `null`).

This is the ONLY change to existing backend logic files, and it is additive: every current action returns `None`, so `data` is always `null` for them and no behavior changes.

### Part B — Shared coordinate helper (DRY refactor)

`actions/mouse_click.py` currently defines `_parse_coord(part, span)` (percent/pixel parse + clamp to `0..span-1`). Extract it verbatim into a new underscore module so discovery skips it:

- Create `actions/_coords.py` with `parse_coord(part, span)` (the existing logic, renamed public-within-package).
- `mouse_click.py` imports `from ._coords import parse_coord` and drops its local copy.
- `mouse_move.py` reuses the same helper.

### Part C — New action modules

Each is one file in `nexus_desktop/actions/`, registered via `@register_action`, with `prompt_examples`/`prompt_hint` (Turkish) so Gemini learns them automatically, and validation raising `ValueError` on bad input.

1. **`screenshot.py` → `SCREENSHOT`** — `value` ignored. `pyautogui.screenshot()` returns a PIL image (Pillow is already a dependency); downscale so the longest side ≤ 1280 (preserving aspect), encode JPEG quality 70, base64, and **return** `f"data:image/jpeg;base64,{b64}"`. This keeps the payload small enough for the synchronous result body.

2. **`clipboard.py` → `CLIPBOARD_SET`, `CLIPBOARD_GET`** — `CLIPBOARD_SET` writes `value` to the clipboard, returns `None`; `CLIPBOARD_GET` returns `{"text": <clipboard text>}`. Both call a new `utils/win_clipboard.py`.

3. **`window_manage.py` → `WINDOW_MANAGE`** — `value` = `"<op>"` or `"<op> <target>"`. `op ∈ {minimize, maximize, restore}` (allowlist; else `ValueError`). With a target, fuzzy-match it against visible window titles via `utils.name_match.best_match` and act on that window; without a target, act on the foreground window. Returns `None`.

4. **`mouse_move.py` → `MOUSE_MOVE`, `MOUSE_SCROLL`** — `MOUSE_MOVE` value `"X,Y"` (percent like `"50%"` or pixels), clamped to the screen via `parse_coord`, then `pyautogui.moveTo(x, y)`. `MOUSE_SCROLL` value = a signed integer (`"300"` up, `"-300"` down) → `pyautogui.scroll(int(value))`. Bad formats raise `ValueError`. Return `None`.

5. **`type_text.py` → `TYPE_TEXT`** — `value` is the text; `pyautogui.write(value, interval=0.02)`. Empty value raises `ValueError`. Returns `None`.

### Part D — New utilities

1. **`utils/win_clipboard.py`** — Windows clipboard via `ctypes` (no new dependency; matches the existing `ctypes.windll` pattern in `win_windows.py`):
   - `get_text() -> str` — `OpenClipboard`, `GetClipboardData(CF_UNICODETEXT)`, lock/copy the global handle to a Python str, `CloseClipboard`. Returns `""` if empty/non-text.
   - `set_text(text: str) -> None` — `OpenClipboard`, `EmptyClipboard`, allocate a global `CF_UNICODETEXT` buffer, `SetClipboardData`, `CloseClipboard`.
   - Both wrapped so the clipboard is always closed (`try/finally`).

2. **`win_windows.py` additions** — `minimize(hwnd)`, `maximize(hwnd)`, `restore(hwnd)` via `ShowWindow(hwnd, SW_*)` (`SW_MINIMIZE=6`, `SW_MAXIMIZE=3`, `SW_RESTORE=9`), and `get_foreground() -> int | None` via `GetForegroundWindow`. Existing helpers unchanged.

### Part E — Frontend (minimal)

1. **`types.ts`** — add enum members `SCREENSHOT`, `CLIPBOARD_SET`, `CLIPBOARD_GET`, `WINDOW_MANAGE`, `MOUSE_MOVE`, `MOUSE_SCROLL`, `TYPE_TEXT` (the type is already tolerant of unknown strings; these add styling/awareness and autocompletion).

2. **`services/automation.ts`** — the per-step success branch already reads `body`. Extend `run`'s return type to `{ success: boolean; error?: string; data?: unknown }` and carry the `data` of the last data-returning step to the caller:
   - On `body.success === true`, if `body.data != null`, remember it as `lastData`.
   - Return `{ success: true, data: lastData }` at the end (or `{ success: true }` when no data).

3. **`components/ScreenshotModal.tsx`** (new) — a full-screen overlay showing an `<img src={dataUrl}>` with a close button. Rendered by `App.tsx` when a run result's `data` is a string starting with `data:image/`.

4. **`App.tsx`** — after a `run(...)` resolves: if `result.data` is an image data-URL, open `ScreenshotModal`; if `result.data` is `{text}`, show the text via the existing toast. Minimal wiring only.

## Interfaces Summary

- `actions._coords.parse_coord(part: str, span: int) -> int`
- `utils.win_clipboard.get_text() -> str`, `set_text(text: str) -> None`
- `utils.win_windows.minimize(hwnd)`, `maximize(hwnd)`, `restore(hwnd)`, `get_foreground() -> int | None`
- `Action.execute(value, context) -> dict | str | None`
- `/execute` success body: `{"success": true, "error": null, "data": <any|null>}`

## Testing

**Backend (pytest, Windows/3.12):**
- `test_actions_data.py` — `SCREENSHOT` returns a `data:image/jpeg;base64,...` string (monkeypatch `pyautogui.screenshot` to a small fake PIL image); `CLIPBOARD_GET` returns `{"text": ...}` (monkeypatch `win_clipboard.get_text`); `CLIPBOARD_SET` calls `set_text` with the value; `TYPE_TEXT` calls `pyautogui.write`; empty `TYPE_TEXT` raises.
- `test_actions_window_mouse.py` — `WINDOW_MANAGE` op allowlist + fuzzy target selection + foreground fallback (monkeypatch `list_windows`/`get_foreground`/`minimize` etc.); bad op raises. `MOUSE_MOVE` percent+pixel clamped (monkeypatch `pyautogui.size`/`moveTo`); `MOUSE_SCROLL` int parse + bad value raises.
- `test_coords.py` — `parse_coord` percent, pixel, clamp, invalid → `ValueError` (moved from the mouse_click coverage; keep mouse_click tests green).
- Clipboard actions are tested with `win_clipboard` **mocked** (assert `CLIPBOARD_SET` calls `set_text(value)`, `CLIPBOARD_GET` returns `{"text": <get_text()>}`), so they never touch a real clipboard.
- `test_win_clipboard.py` — one real round-trip smoke test: `set_text("nexus-test-123")` then `get_text() == "nexus-test-123"`. This runs on the Windows CI runner (which has an interactive session); it is the only test that exercises the `ctypes` layer directly.
- Data-return path: extend `test_automation_service.py` — a fake action returning a value causes `ACTION_COMPLETED` to carry `data`; extend `test_api_service_results.py` — an action whose `ACTION_COMPLETED` has `data` makes `/execute` return that `data` in the body; effect-only actions return `data: null`.
- Prompt: `test_ai_prompt.py` continues to pass (new modules self-register their examples).

**Frontend (vitest + tsc):**
- `automation.test.ts` — a step whose response body has `data` makes `run` resolve with that `data`; effect-only steps resolve with no `data`.
- `ScreenshotModal.test.tsx` — renders the image and calls `onClose`.

## Out of Scope (YAGNI)

Screenshot zoom/save/share/history; editable clipboard panel; multi-monitor selection for screenshot/window ops; mouse drag; region screenshots. These belong to the later Frontend/UX (#5) and future action increments.

## Constraints Carried From the Project

- No new runtime dependencies (`ctypes`, `base64`, `io` are stdlib; `pyautogui`, `Pillow` already present).
- No shell execution — clipboard and window ops use `ctypes`, screenshot uses `pyautogui`.
- Backend tests run on Windows (CI `windows-latest`), Python 3.12.
- User/AI values are hostile: validate (op allowlists, coord clamping, empty checks) and raise `ValueError`.
- Turkish user-visible strings; new `prompt_examples`/`prompt_hint` in Turkish.
- Commit messages have no Co-Authored-By trailer.

## Suggested Delivery

One spec, but implementation can ship as two PRs to keep review tractable: **PR 1** = Parts A–D (data-return foundation + all actions + utils + backend tests); **PR 2** = Part E (minimal frontend). The plan will order tasks so the backend is independently mergeable before the frontend.

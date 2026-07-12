# New Actions + Data-Return Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let actions return data to the phone and add `SCREENSHOT`, `CLIPBOARD_SET/GET`, `WINDOW_MANAGE`, `MOUSE_MOVE`, `MOUSE_SCROLL`, `TYPE_TEXT`, with a minimal phone UI (screenshot modal, clipboard toast).

**Architecture:** `Action.execute` may return a JSON-serializable value; `AutomationService` puts it in `ACTION_COMPLETED.data`; `ApiService` returns it in the `/execute` body as `data`. New one-file action modules register via `@register_action`. Windows-only helpers use `ctypes`/`pyautogui`; no new dependencies.

**Tech Stack:** Python 3.12 / Flask (backend); React + TypeScript / vitest (frontend). `ctypes`, `base64`, `io` stdlib; `pyautogui`, `Pillow` already present.

**Spec:** `docs/superpowers/specs/2026-07-13-new-actions-data-return-design.md`

## Global Constraints

- Branch: `feat/new-actions-data-return` (already created; spec committed here).
- No new runtime dependencies. No shell execution — `ctypes`/`pyautogui` only.
- Backend tests run on Windows (CI `windows-latest`), Python 3.12; run from `nexus_desktop/` via `../venv/Scripts/python.exe`.
- All AI/user values are hostile: validate (op allowlists, coord clamping, empty checks) and raise `ValueError`.
- New `prompt_examples`/`prompt_hint` are Turkish. Commit messages have NO Co-Authored-By trailer.
- Every new test file starts with the standard path shim and `CTX = ActionContext(bus=None)` where actions need a context.
- Baseline: 193 backend tests, 51 frontend tests green before Task 1.
- Delivery: Tasks 1–6 form the backend (mergeable as PR 1); Tasks 7–9 the frontend (PR 2).

---

### Task 1: Data-return foundation

**Files:**
- Modify: `nexus_desktop/actions/base.py` (docstring)
- Modify: `nexus_desktop/services/automation_service.py`
- Modify: `nexus_desktop/services/api_service.py`
- Modify: `nexus_desktop/tests/test_automation_service.py`
- Modify: `nexus_desktop/tests/test_api_service_results.py`

**Interfaces:**
- Consumes: existing `PendingResults`, `ACTION_COMPLETED`/`ACTION_FAILED` events.
- Produces: `ACTION_COMPLETED` payload gains `"data"`; `/execute` success/failure body gains `"data"` (null for effect-only actions and failures). `Action.execute` may return a JSON-serializable value or `None`.

- [ ] **Step 1: Update the tests to expect `data`**

In `nexus_desktop/tests/test_api_service_results.py`, change the two exact-match assertions:
- In `test_execute_returns_success_when_action_completes`, change the final assert to:
  ```python
      assert res.get_json() == {"success": True, "error": None, "data": None}
  ```
- In `test_execute_returns_failure_with_error`, change the final assert to:
  ```python
      assert res.get_json() == {"success": False, "error": "No running app matches", "data": None}
  ```
Then append two new tests:
```python
def test_execute_returns_data_from_action(client):
    app_client, bus, svc, token = client
    bus.subscribe(
        "COMMAND_RECEIVED",
        lambda ev: bus.publish("ACTION_COMPLETED", {"status": "success", "id": ev.payload["id"], "data": {"text": "clip"}}),
    )
    res = app_client.post("/execute", json={"id": "d1", "type": "CLIPBOARD_GET", "value": ""}, headers=_hdr(token))
    assert res.status_code == 200
    assert res.get_json() == {"success": True, "error": None, "data": {"text": "clip"}}


def test_execute_data_null_for_effect_action(client):
    app_client, bus, svc, token = client
    bus.subscribe(
        "COMMAND_RECEIVED",
        lambda ev: bus.publish("ACTION_COMPLETED", {"status": "success", "id": ev.payload["id"], "data": None}),
    )
    res = app_client.post("/execute", json={"id": "d2", "type": "TYPE_TEXT", "value": "hi"}, headers=_hdr(token))
    assert res.status_code == 200
    assert res.get_json() == {"success": True, "error": None, "data": None}
```

In `nexus_desktop/tests/test_automation_service.py`, append:
```python
def test_action_return_value_included_as_data(monkeypatch):
    svc = _service()

    class FakeAction:
        def execute(self, value, context):
            return {"text": "hi"}

    monkeypatch.setattr("services.automation_service.get_action", lambda t: FakeAction)
    svc._execute_action({"type": "X", "value": "", "id": "9"})
    name, payload = svc.bus.published[0]
    assert name == "ACTION_COMPLETED"
    assert payload["data"] == {"text": "hi"}
    assert payload["id"] == "9"


def test_effect_action_data_is_none(monkeypatch):
    svc = _service()

    class FakeAction:
        def execute(self, value, context):
            return None

    monkeypatch.setattr("services.automation_service.get_action", lambda t: FakeAction)
    svc._execute_action({"type": "X", "value": "", "id": "10"})
    assert svc.bus.published[0][1]["data"] is None
```

- [ ] **Step 2: Run to verify failure**

Run (from `nexus_desktop/`): `../venv/Scripts/python.exe -m pytest tests/test_api_service_results.py tests/test_automation_service.py -q`
Expected: FAIL — success/failure bodies lack `data`; `ACTION_COMPLETED` lacks `data`.

- [ ] **Step 3: Implement the foundation**

In `nexus_desktop/actions/base.py`, update the `execute` docstring:
```python
    def execute(self, value, context):
        """Run the action. May return a JSON-serializable value (dict or str)
        to send back to the client, or None for effect-only actions."""
        raise NotImplementedError
```

In `nexus_desktop/services/automation_service.py`, change the success branch of `_execute_action`:
```python
            result = action_cls().execute(value, self.context)
            self.bus.publish("ACTION_COMPLETED", {"status": "success", "id": data.get('id'), "data": result})
```

In `nexus_desktop/services/api_service.py`:
- Change `_on_action_completed`:
```python
    def _on_action_completed(self, event):
        payload = event.payload or {}
        rid = payload.get('id')
        if rid:
            self.pending.resolve(rid, {"success": True, "data": payload.get("data")})
```
- Change the resolved-result return in `execute` (the line `return jsonify({"success": result["success"], "error": result.get("error")}), 200`) to:
```python
        return jsonify({"success": result["success"], "error": result.get("error"), "data": result.get("data")}), 200
```
(Leave the timeout return `{"success": False, "error": "Action timed out"}` unchanged.)

- [ ] **Step 4: Run tests + full suite**

Run:
```
../venv/Scripts/python.exe -m pytest tests/test_api_service_results.py tests/test_automation_service.py -q
../venv/Scripts/python.exe -m pytest tests/ -q
```
Expected: all green (193 + 4 new = 197).

- [ ] **Step 5: Commit**
```bash
git add nexus_desktop/actions/base.py nexus_desktop/services/automation_service.py nexus_desktop/services/api_service.py nexus_desktop/tests/test_automation_service.py nexus_desktop/tests/test_api_service_results.py
git commit -m "feat: actions can return data through /execute"
```

---

### Task 2: Extract shared coordinate helper (DRY)

**Files:**
- Create: `nexus_desktop/actions/_coords.py`
- Modify: `nexus_desktop/actions/mouse_click.py`
- Test: `nexus_desktop/tests/test_coords.py`

**Interfaces:**
- Produces: `actions._coords.parse_coord(part: str, span: int) -> int` (percent/pixel parse, clamped to `0..span-1`, raises `ValueError` on non-numeric).

- [ ] **Step 1: Write the failing tests**
```python
# nexus_desktop/tests/test_coords.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions._coords import parse_coord


def test_percent():
    assert parse_coord("50%", 1000) == 500


def test_pixel():
    assert parse_coord("300", 1920) == 300


def test_clamps_high():
    assert parse_coord("5000", 1920) == 1919


def test_clamps_low():
    assert parse_coord("-10", 1920) == 0


def test_invalid_raises():
    with pytest.raises(ValueError):
        parse_coord("abc", 1920)
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_coords.py -q`
Expected: `ModuleNotFoundError: No module named 'actions._coords'`

- [ ] **Step 3: Create `_coords.py` and refactor `mouse_click.py`**

Create `nexus_desktop/actions/_coords.py`:
```python
"""Shared coordinate parsing for mouse actions. Underscore-prefixed: not an
action module, skipped by discovery."""


def parse_coord(part, span):
    """Parse a '50%'-style percentage or a pixel int into a clamped pixel."""
    part = part.strip()
    try:
        if part.endswith('%'):
            pixel = int(span * float(part[:-1]) / 100)
        else:
            pixel = int(part)
    except ValueError:
        raise ValueError(f"Invalid coordinate: {part!r}")
    return max(0, min(pixel, span - 1))
```

Rewrite `nexus_desktop/actions/mouse_click.py` to import it and drop the local copy:
```python
import pyautogui

from ._coords import parse_coord
from .base import Action
from .registry import register_action

_BUTTONS = ('left', 'right', 'double')


@register_action("MOUSE_CLICK")
class MouseClickAction(Action):
    prompt_examples = [
        '- "Ekranın ortasına tıkla": {{ "type": "MOUSE_CLICK", "value": "50%,50%", "description": "Ekran ortasına tıklanıyor" }}',
    ]
    prompt_hint = (
        'MOUSE_CLICK koordinatlarını yüzde olarak ver (örn: "50%,50%" ekran '
        'ortası). İsteğe bağlı üçüncü parça buton: left, right veya double.'
    )

    def execute(self, value, context):
        parts = [p.strip() for p in (value or '').split(',')]
        if len(parts) not in (2, 3):
            raise ValueError(f"Invalid MOUSE_CLICK value: {value!r}")
        button = parts[2].lower() if len(parts) == 3 else 'left'
        if button not in _BUTTONS:
            raise ValueError(f"Invalid mouse button: {button!r}")
        width, height = pyautogui.size()
        x = parse_coord(parts[0], width)
        y = parse_coord(parts[1], height)
        if button == 'double':
            pyautogui.doubleClick(x, y)
        else:
            pyautogui.click(x, y, button=button)
```

- [ ] **Step 4: Run coords + existing mouse_click tests + full suite**

Run:
```
../venv/Scripts/python.exe -m pytest tests/test_coords.py tests/test_actions_input.py -q
../venv/Scripts/python.exe -m pytest tests/ -q
```
Expected: all green (the existing `TestMouseClick` tests in `test_actions_input.py` still pass — they call `MouseClickAction().execute`, not the removed `_parse_coord`).

- [ ] **Step 5: Commit**
```bash
git add nexus_desktop/actions/_coords.py nexus_desktop/actions/mouse_click.py nexus_desktop/tests/test_coords.py
git commit -m "refactor: extract parse_coord into shared actions/_coords"
```

---

### Task 3: `SCREENSHOT` action

**Files:**
- Create: `nexus_desktop/actions/screenshot.py`
- Test: `nexus_desktop/tests/test_actions_data.py`

**Interfaces:**
- Produces: `SCREENSHOT` action returning a `data:image/jpeg;base64,...` string.

- [ ] **Step 1: Write the failing test**
```python
# nexus_desktop/tests/test_actions_data.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions.base import ActionContext

CTX = ActionContext(bus=None)


class TestScreenshot:
    def test_returns_jpeg_data_url(self, monkeypatch):
        from PIL import Image
        from actions.screenshot import ScreenshotAction

        monkeypatch.setattr(
            "actions.screenshot.pyautogui.screenshot",
            lambda: Image.new("RGB", (2000, 1000), "white"),
        )
        result = ScreenshotAction().execute("", CTX)
        assert isinstance(result, str)
        assert result.startswith("data:image/jpeg;base64,")
        assert len(result) > 100
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_data.py -q`
Expected: `ModuleNotFoundError: No module named 'actions.screenshot'`

- [ ] **Step 3: Implement**
```python
# nexus_desktop/actions/screenshot.py
import base64
import io

import pyautogui

from .base import Action
from .registry import register_action

_MAX_SIDE = 1280
_JPEG_QUALITY = 70


@register_action("SCREENSHOT")
class ScreenshotAction(Action):
    prompt_examples = [
        '- "Ekran görüntüsü al": {{ "type": "SCREENSHOT", "value": "", "description": "Ekran görüntüsü alınıyor" }}',
    ]
    prompt_hint = "Ekranın fotoğrafını istemek için SCREENSHOT kullan."

    def execute(self, value, context):
        image = pyautogui.screenshot()
        width, height = image.size
        longest = max(width, height)
        if longest > _MAX_SIDE:
            scale = _MAX_SIDE / longest
            image = image.resize((int(width * scale), int(height * scale)))
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="JPEG", quality=_JPEG_QUALITY)
        b64 = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{b64}"
```

- [ ] **Step 4: Run test + full suite**

Run:
```
../venv/Scripts/python.exe -m pytest tests/test_actions_data.py tests/test_ai_prompt.py -q
../venv/Scripts/python.exe -m pytest tests/ -q
```
Expected: all green (`test_ai_prompt.py` still passes — SCREENSHOT self-registers its example).

- [ ] **Step 5: Commit**
```bash
git add nexus_desktop/actions/screenshot.py nexus_desktop/tests/test_actions_data.py
git commit -m "feat: SCREENSHOT action returns a JPEG data URL"
```

---

### Task 4: Clipboard utility + `CLIPBOARD_SET`/`CLIPBOARD_GET`

**Files:**
- Create: `nexus_desktop/utils/win_clipboard.py`
- Create: `nexus_desktop/actions/clipboard.py`
- Test: `nexus_desktop/tests/test_win_clipboard.py`
- Test: extend `nexus_desktop/tests/test_actions_data.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `utils.win_clipboard.get_text() -> str`, `set_text(text: str) -> None`; actions `CLIPBOARD_SET` (returns None) and `CLIPBOARD_GET` (returns `{"text": str}`).

- [ ] **Step 1: Write the failing tests**

Append to `nexus_desktop/tests/test_actions_data.py`:
```python
class TestClipboard:
    def test_set_calls_set_text(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.clipboard.set_text", lambda t: calls.append(t))
        from actions.clipboard import ClipboardSetAction

        assert ClipboardSetAction().execute("hello", CTX) is None
        assert calls == ["hello"]

    def test_get_returns_text_payload(self, monkeypatch):
        monkeypatch.setattr("actions.clipboard.get_text", lambda: "board text")
        from actions.clipboard import ClipboardGetAction

        assert ClipboardGetAction().execute("", CTX) == {"text": "board text"}
```

Create `nexus_desktop/tests/test_win_clipboard.py`:
```python
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils import win_clipboard


def test_clipboard_round_trip():
    win_clipboard.set_text("nexus-test-123")
    assert win_clipboard.get_text() == "nexus-test-123"
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_data.py::TestClipboard tests/test_win_clipboard.py -q`
Expected: import errors (`actions.clipboard` / `utils.win_clipboard` missing).

- [ ] **Step 3: Implement the clipboard utility**
```python
# nexus_desktop/utils/win_clipboard.py
"""Windows clipboard get/set via ctypes (no third-party dependency)."""
import ctypes
from ctypes import wintypes

_CF_UNICODETEXT = 13
_GMEM_MOVEABLE = 0x0002

_user32 = ctypes.windll.user32
_kernel32 = ctypes.windll.kernel32

# Declare pointer-returning functions as pointer-sized so 64-bit handles are
# not truncated to 32 bits (a classic ctypes default-restype bug).
_user32.OpenClipboard.argtypes = [wintypes.HWND]
_user32.OpenClipboard.restype = wintypes.BOOL
_user32.GetClipboardData.argtypes = [wintypes.UINT]
_user32.GetClipboardData.restype = wintypes.HANDLE
_user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
_user32.SetClipboardData.restype = wintypes.HANDLE
_kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
_kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
_kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
_kernel32.GlobalLock.restype = wintypes.LPVOID
_kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]


def get_text():
    """Return clipboard text, or '' if empty/non-text."""
    if not _user32.OpenClipboard(None):
        return ""
    try:
        handle = _user32.GetClipboardData(_CF_UNICODETEXT)
        if not handle:
            return ""
        locked = _kernel32.GlobalLock(handle)
        if not locked:
            return ""
        try:
            return ctypes.c_wchar_p(locked).value or ""
        finally:
            _kernel32.GlobalUnlock(handle)
    finally:
        _user32.CloseClipboard()


def set_text(text):
    """Replace clipboard contents with `text`."""
    text = text or ""
    if not _user32.OpenClipboard(None):
        raise OSError("Could not open clipboard")
    try:
        _user32.EmptyClipboard()
        buffer_size = (len(text) + 1) * ctypes.sizeof(ctypes.c_wchar)
        handle = _kernel32.GlobalAlloc(_GMEM_MOVEABLE, buffer_size)
        locked = _kernel32.GlobalLock(handle)
        ctypes.memmove(locked, ctypes.create_unicode_buffer(text), buffer_size)
        _kernel32.GlobalUnlock(handle)
        _user32.SetClipboardData(_CF_UNICODETEXT, handle)
    finally:
        _user32.CloseClipboard()
```

- [ ] **Step 4: Implement the clipboard actions**
```python
# nexus_desktop/actions/clipboard.py
from utils.win_clipboard import get_text, set_text

from .base import Action
from .registry import register_action


@register_action("CLIPBOARD_SET")
class ClipboardSetAction(Action):
    prompt_examples = [
        '- "Panoya \'merhaba\' kopyala": {{ "type": "CLIPBOARD_SET", "value": "merhaba", "description": "Panoya kopyalanıyor" }}',
    ]
    prompt_hint = "Panoya metin koymak için CLIPBOARD_SET kullan."

    def execute(self, value, context):
        set_text(value or "")


@register_action("CLIPBOARD_GET")
class ClipboardGetAction(Action):
    prompt_examples = [
        '- "Panodaki metni oku": {{ "type": "CLIPBOARD_GET", "value": "", "description": "Pano okunuyor" }}',
    ]
    prompt_hint = "Panodaki metni okumak için CLIPBOARD_GET kullan."

    def execute(self, value, context):
        return {"text": get_text()}
```

- [ ] **Step 5: Run tests + full suite**

Run:
```
../venv/Scripts/python.exe -m pytest tests/test_actions_data.py tests/test_win_clipboard.py -q
../venv/Scripts/python.exe -m pytest tests/ -q
```
Expected: all green. (`test_win_clipboard.py` does a real clipboard round-trip; it passes on the Windows dev machine and the `windows-latest` CI runner.)

- [ ] **Step 6: Commit**
```bash
git add nexus_desktop/utils/win_clipboard.py nexus_desktop/actions/clipboard.py nexus_desktop/tests/test_win_clipboard.py nexus_desktop/tests/test_actions_data.py
git commit -m "feat: CLIPBOARD_SET/GET actions via ctypes clipboard util"
```

---

### Task 5: Window helpers + `WINDOW_MANAGE`

**Files:**
- Modify: `nexus_desktop/utils/win_windows.py`
- Create: `nexus_desktop/actions/window_manage.py`
- Test: `nexus_desktop/tests/test_actions_window_mouse.py`

**Interfaces:**
- Consumes: `utils.name_match.best_match`, `utils.win_windows.list_windows`.
- Produces: `win_windows.minimize(hwnd)`, `maximize(hwnd)`, `restore(hwnd)`, `get_foreground() -> int | None`; `WINDOW_MANAGE` action.

- [ ] **Step 1: Write the failing tests**
```python
# nexus_desktop/tests/test_actions_window_mouse.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions.base import ActionContext

CTX = ActionContext(bus=None)


class TestWindowManage:
    def _action(self):
        from actions.window_manage import WindowManageAction
        return WindowManageAction()

    def test_minimizes_matched_window(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.window_manage.list_windows", lambda: [(111, "Spotify Premium", 100)])
        monkeypatch.setattr("actions.window_manage.minimize", lambda hwnd: calls.append(("min", hwnd)))
        self._action().execute("minimize spotify", CTX)
        assert calls == [("min", 111)]

    def test_maximizes_foreground_when_no_target(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.window_manage.get_foreground", lambda: 222)
        monkeypatch.setattr("actions.window_manage.maximize", lambda hwnd: calls.append(("max", hwnd)))
        self._action().execute("maximize", CTX)
        assert calls == [("max", 222)]

    def test_unknown_op_raises(self):
        with pytest.raises(ValueError):
            self._action().execute("wobble spotify", CTX)

    def test_no_matching_window_raises(self, monkeypatch):
        monkeypatch.setattr("actions.window_manage.list_windows", lambda: [(111, "Notepad", 100)])
        with pytest.raises(ValueError):
            self._action().execute("minimize photoshop", CTX)
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_window_mouse.py -q`
Expected: `ModuleNotFoundError: No module named 'actions.window_manage'`

- [ ] **Step 3: Add window helpers**

In `nexus_desktop/utils/win_windows.py`, add these constants next to `_SW_RESTORE = 9`:
```python
_SW_MAXIMIZE = 3
_SW_MINIMIZE = 6
```
and after the `import` line `from utils.name_match import normalize`, add:
```python
ctypes.windll.user32.GetForegroundWindow.restype = ctypes.wintypes.HWND
```
Then append these functions to the end of the file:
```python
def minimize(hwnd):
    """Minimize a window."""
    ctypes.windll.user32.ShowWindow(hwnd, _SW_MINIMIZE)


def maximize(hwnd):
    """Maximize a window."""
    ctypes.windll.user32.ShowWindow(hwnd, _SW_MAXIMIZE)


def restore(hwnd):
    """Restore a window to its non-minimized/maximized size."""
    ctypes.windll.user32.ShowWindow(hwnd, _SW_RESTORE)


def get_foreground():
    """Return the handle of the current foreground window, or None."""
    hwnd = ctypes.windll.user32.GetForegroundWindow()
    return hwnd or None
```

- [ ] **Step 4: Implement the action**
```python
# nexus_desktop/actions/window_manage.py
from utils.name_match import best_match
from utils.win_windows import get_foreground, list_windows, maximize, minimize, restore

from .base import Action
from .registry import register_action

_OPS = ('minimize', 'maximize', 'restore')


@register_action("WINDOW_MANAGE")
class WindowManageAction(Action):
    prompt_examples = [
        '- "Spotify\'ı küçült": {{ "type": "WINDOW_MANAGE", "value": "minimize spotify", "description": "Spotify küçültülüyor" }}',
        '- "Pencereyi büyüt": {{ "type": "WINDOW_MANAGE", "value": "maximize", "description": "Pencere büyütülüyor" }}',
    ]
    prompt_hint = (
        'Pencere küçültme/büyütme/eski haline getirme için WINDOW_MANAGE kullan '
        '(value: "minimize", "maximize" veya "restore"; isteğe bağlı olarak '
        'ardından pencere adı, örn: "minimize spotify"). Ad verilmezse öndeki '
        'pencereye uygulanır.'
    )

    def execute(self, value, context):
        parts = (value or '').strip().split(None, 1)
        if not parts:
            raise ValueError("Empty WINDOW_MANAGE value")
        op = parts[0].lower()
        if op not in _OPS:
            raise ValueError(f"Unknown window op: {op!r}")
        target = parts[1] if len(parts) == 2 else ''

        if target:
            titles = {title: hwnd for hwnd, title, _pid in list_windows()}
            winner = best_match(target, titles.keys())
            if winner is None:
                raise ValueError(f"No window matches: {target!r}")
            hwnd = titles[winner]
        else:
            hwnd = get_foreground()
            if not hwnd:
                raise ValueError("No foreground window")

        if op == 'minimize':
            minimize(hwnd)
        elif op == 'maximize':
            maximize(hwnd)
        else:
            restore(hwnd)
```

- [ ] **Step 5: Run tests + full suite**

Run:
```
../venv/Scripts/python.exe -m pytest tests/test_actions_window_mouse.py tests/test_win_search.py -q
../venv/Scripts/python.exe -m pytest tests/ -q
```
Expected: all green (existing `win_windows`-dependent tests unaffected — only additions were made).

- [ ] **Step 6: Commit**
```bash
git add nexus_desktop/utils/win_windows.py nexus_desktop/actions/window_manage.py nexus_desktop/tests/test_actions_window_mouse.py
git commit -m "feat: WINDOW_MANAGE action (minimize/maximize/restore)"
```

---

### Task 6: `MOUSE_MOVE`, `MOUSE_SCROLL`, `TYPE_TEXT`

**Files:**
- Create: `nexus_desktop/actions/mouse_move.py`
- Create: `nexus_desktop/actions/type_text.py`
- Test: extend `nexus_desktop/tests/test_actions_window_mouse.py`

**Interfaces:**
- Consumes: `actions._coords.parse_coord`.
- Produces: `MOUSE_MOVE`, `MOUSE_SCROLL`, `TYPE_TEXT` actions (all return `None`).

- [ ] **Step 1: Write the failing tests** (append to `test_actions_window_mouse.py`)
```python
class TestMouseMove:
    def test_percent_moves(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.mouse_move.pyautogui.size", lambda: (1920, 1080))
        monkeypatch.setattr("actions.mouse_move.pyautogui.moveTo", lambda x, y: calls.append((x, y)))
        from actions.mouse_move import MouseMoveAction
        MouseMoveAction().execute("50%,50%", CTX)
        assert calls == [(960, 540)]

    def test_bad_format_raises(self, monkeypatch):
        monkeypatch.setattr("actions.mouse_move.pyautogui.size", lambda: (1920, 1080))
        from actions.mouse_move import MouseMoveAction
        with pytest.raises(ValueError):
            MouseMoveAction().execute("100", CTX)


class TestMouseScroll:
    def test_scrolls_int(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.mouse_move.pyautogui.scroll", lambda a: calls.append(a))
        from actions.mouse_move import MouseScrollAction
        MouseScrollAction().execute("-500", CTX)
        assert calls == [-500]

    def test_bad_amount_raises(self):
        from actions.mouse_move import MouseScrollAction
        with pytest.raises(ValueError):
            MouseScrollAction().execute("abc", CTX)


class TestTypeText:
    def test_writes_text(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.type_text.pyautogui.write", lambda v, interval: calls.append(v))
        from actions.type_text import TypeTextAction
        TypeTextAction().execute("hello", CTX)
        assert calls == ["hello"]

    def test_empty_raises(self):
        from actions.type_text import TypeTextAction
        with pytest.raises(ValueError):
            TypeTextAction().execute("  ", CTX)
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_window_mouse.py -q`
Expected: import errors for `actions.mouse_move` / `actions.type_text`.

- [ ] **Step 3: Implement `mouse_move.py`**
```python
# nexus_desktop/actions/mouse_move.py
import pyautogui

from ._coords import parse_coord
from .base import Action
from .registry import register_action


@register_action("MOUSE_MOVE")
class MouseMoveAction(Action):
    prompt_examples = [
        '- "Fareyi ekranın ortasına götür": {{ "type": "MOUSE_MOVE", "value": "50%,50%", "description": "Fare ortaya taşınıyor" }}',
    ]
    prompt_hint = 'Fare imlecini taşımak için MOUSE_MOVE kullan (value: "50%,50%" gibi).'

    def execute(self, value, context):
        parts = [p.strip() for p in (value or '').split(',')]
        if len(parts) != 2:
            raise ValueError(f"Invalid MOUSE_MOVE value: {value!r}")
        width, height = pyautogui.size()
        x = parse_coord(parts[0], width)
        y = parse_coord(parts[1], height)
        pyautogui.moveTo(x, y)


@register_action("MOUSE_SCROLL")
class MouseScrollAction(Action):
    prompt_examples = [
        '- "Aşağı kaydır": {{ "type": "MOUSE_SCROLL", "value": "-500", "description": "Aşağı kaydırılıyor" }}',
    ]
    prompt_hint = 'Sayfayı kaydırmak için MOUSE_SCROLL kullan (pozitif yukarı, negatif aşağı, örn: "-500").'

    def execute(self, value, context):
        try:
            amount = int((value or '').strip())
        except ValueError:
            raise ValueError(f"Invalid MOUSE_SCROLL amount: {value!r}")
        pyautogui.scroll(amount)
```

- [ ] **Step 4: Implement `type_text.py`**
```python
# nexus_desktop/actions/type_text.py
import pyautogui

from .base import Action
from .registry import register_action


@register_action("TYPE_TEXT")
class TypeTextAction(Action):
    prompt_examples = [
        '- "Merhaba dünya yaz": {{ "type": "TYPE_TEXT", "value": "Merhaba dünya", "description": "Metin yazılıyor" }}',
    ]
    prompt_hint = 'Odaklı alana metin yazmak için TYPE_TEXT kullan (uzun metin için; tek tuş için KEYPRESS).'

    def execute(self, value, context):
        if not (value or '').strip():
            raise ValueError("Empty text")
        pyautogui.write(value, interval=0.02)
```

- [ ] **Step 5: Run tests + full suite**

Run:
```
../venv/Scripts/python.exe -m pytest tests/test_actions_window_mouse.py tests/test_ai_prompt.py -q
../venv/Scripts/python.exe -m pytest tests/ -q
```
Expected: all green.

- [ ] **Step 6: Commit**
```bash
git add nexus_desktop/actions/mouse_move.py nexus_desktop/actions/type_text.py nexus_desktop/tests/test_actions_window_mouse.py
git commit -m "feat: MOUSE_MOVE, MOUSE_SCROLL, TYPE_TEXT actions"
```

---

### Task 7: Frontend enum members

**Files:**
- Modify: `types.ts`

**Interfaces:**
- Produces: `ActionType` members for the new types (rendering/autocompletion; the type already tolerates unknown strings).

- [ ] **Step 1: Add the enum members**

In `types.ts`, inside `export enum ActionType { ... }`, add before the closing `}` (after `SYSTEM_POWER = 'SYSTEM_POWER'` — add a comma to that line):
```typescript
  SYSTEM_POWER = 'SYSTEM_POWER',
  SCREENSHOT = 'SCREENSHOT',
  CLIPBOARD_SET = 'CLIPBOARD_SET',
  CLIPBOARD_GET = 'CLIPBOARD_GET',
  WINDOW_MANAGE = 'WINDOW_MANAGE',
  MOUSE_MOVE = 'MOUSE_MOVE',
  MOUSE_SCROLL = 'MOUSE_SCROLL',
  TYPE_TEXT = 'TYPE_TEXT'
```

- [ ] **Step 2: Verify type-check**

Run (repo root): `npx tsc --noEmit`
Expected: clean (the widened `CommandPreviewModal` switch already defaults unknown types; new members are covered by existing default branches).

- [ ] **Step 3: Commit**
```bash
git add types.ts
git commit -m "feat: add new action types to the frontend enum"
```

---

### Task 8: Frontend carries action data back from `run`

**Files:**
- Modify: `services/automation.ts`
- Test: extend `services/automation.test.ts`

**Interfaces:**
- Consumes: `/execute` body `{success, error?, data?}`.
- Produces: `ActionExecutor.run(...)` resolves to `{ success: boolean; error?: string; data?: unknown }`, where `data` is the payload of the last data-returning step.

- [ ] **Step 1: Write the failing tests** (append inside the `describe('ActionExecutor.run', ...)` block)
```typescript
  it('returns the data payload from a data-returning step', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: 'data:image/jpeg;base64,AAAA' }));

    const runPromise = executor.run(
      [step({ type: ActionType.SCREENSHOT, value: '', description: 'Ekran görüntüsü' })],
      '1.2.3.4'
    );
    const result = await runPromise;

    expect(result.success).toBe(true);
    expect(result.data).toBe('data:image/jpeg;base64,AAAA');
  });

  it('leaves data undefined for effect-only steps', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: null }));

    const result = await executor.run(
      [step({ type: ActionType.KEYPRESS, value: 'a' })],
      '1.2.3.4'
    );

    expect(result).toEqual({ success: true });
  });
```

- [ ] **Step 2: Run to verify the data test fails**

Run (repo root): `npx vitest run services/automation.test.ts`
Expected: `returns the data payload from a data-returning step` FAILS — `run` currently returns `{ success: true }` with no `data`.

- [ ] **Step 3: Implement**

In `services/automation.ts`:
- Change the method signature return type to include `data`:
```typescript
  async run(steps: AutomationStep[], ip: string, token?: string): Promise<{ success: boolean; error?: string; data?: unknown }> {
```
- Declare a `lastData` accumulator at the top of `run`, right after the `if (!ip) ...` guard:
```typescript
    let lastData: unknown = undefined;
```
- In the success branch, right after the existing `body.success === false` check block, add:
```typescript
        if (body && body.data != null) {
          lastData = body.data;
        }
```
- Change the final `return { success: true };` to:
```typescript
    return lastData != null ? { success: true, data: lastData } : { success: true };
```

- [ ] **Step 4: Run tests + tsc + full suite**

Run (repo root):
```
npx vitest run services/automation.test.ts
npx tsc --noEmit
npx vitest run
```
Expected: all pass (51 prior + 2 new = 53); tsc clean.

- [ ] **Step 5: Commit**
```bash
git add services/automation.ts services/automation.test.ts
git commit -m "feat: executor.run returns data from data-returning steps"
```

---

### Task 9: Screenshot modal + clipboard toast wiring

**Files:**
- Create: `components/ScreenshotModal.tsx`
- Modify: `App.tsx`
- Test: `components/ScreenshotModal.test.tsx`

**Interfaces:**
- Consumes: `run(...)` result `data` (Task 8); existing `addToast` (`App.tsx:32`).
- Produces: a screenshot overlay shown when a run returns an image data-URL; clipboard text shown via toast.

- [ ] **Step 1: Write the failing component test**
```tsx
// components/ScreenshotModal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScreenshotModal } from './ScreenshotModal';

describe('ScreenshotModal', () => {
  it('renders the image and calls onClose', () => {
    const onClose = vi.fn();
    render(<ScreenshotModal dataUrl="data:image/jpeg;base64,AAAA" onClose={onClose} />);

    const img = screen.getByAltText('Ekran görüntüsü') as HTMLImageElement;
    expect(img.src).toContain('data:image/jpeg;base64,AAAA');

    fireEvent.click(screen.getByRole('button', { name: /kapat/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (repo root): `npx vitest run components/ScreenshotModal.test.tsx`
Expected: fails to resolve `./ScreenshotModal`.

- [ ] **Step 3: Implement the component**
```tsx
// components/ScreenshotModal.tsx
import React from 'react';

interface ScreenshotModalProps {
  dataUrl: string;
  onClose: () => void;
}

export const ScreenshotModal: React.FC<ScreenshotModalProps> = ({ dataUrl, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4"
      onClick={onClose}
    >
      <img
        src={dataUrl}
        alt="Ekran görüntüsü"
        className="max-w-full max-h-[85vh] object-contain rounded-sm border border-hud-dim"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        aria-label="Kapat"
        className="mt-4 px-6 py-2 bg-hud-cyan/20 text-hud-cyan border border-hud-cyan/40 rounded-sm"
      >
        Kapat
      </button>
    </div>
  );
};
```

- [ ] **Step 4: Wire into `App.tsx`**

Read `App.tsx` first. Then:
- Add the import near the other component imports:
```typescript
import { ScreenshotModal } from './components/ScreenshotModal';
```
- Add state near the other `useState` hooks (e.g. beside the `toasts` usage around line 32):
```typescript
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
```
- Add a helper (place it above the `return` / near the other handlers) that surfaces a run result's data:
```typescript
  const surfaceRunData = (data: unknown) => {
    if (typeof data === 'string' && data.startsWith('data:image/')) {
      setScreenshotUrl(data);
    } else if (data && typeof data === 'object' && 'text' in (data as any)) {
      addToast(`📋 Pano: ${(data as any).text}`, 'info');
    }
  };
```
- At BOTH `executor.run(...)` result sites that check `result.error` (the voice-command handler ~line 209 and the button handler ~line 248), after confirming success (in the branch where `result.success` is true / after the error checks), call:
```typescript
        if (result.success && result.data != null) {
          surfaceRunData(result.data);
        }
```
- Render the modal near the other conditional overlays (e.g. beside the `state.isExecuting` block around line 595):
```tsx
        {screenshotUrl && (
          <ScreenshotModal dataUrl={screenshotUrl} onClose={() => setScreenshotUrl(null)} />
        )}
```

- [ ] **Step 5: Verify**

Run (repo root):
```
npx vitest run components/ScreenshotModal.test.tsx
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: modal test passes; tsc clean; full suite 53 prior + 1 new = 54 pass; build succeeds.

- [ ] **Step 6: Commit**
```bash
git add components/ScreenshotModal.tsx components/ScreenshotModal.test.tsx App.tsx
git commit -m "feat: screenshot modal + clipboard toast for data-returning actions"
```

---

## Self-Review

**Spec coverage:**
- Part A data-return foundation (base/automation/api + tests) → Task 1. ✓
- Part B parse_coord extraction → Task 2. ✓
- Part C actions: SCREENSHOT → Task 3; CLIPBOARD_SET/GET → Task 4; WINDOW_MANAGE → Task 5; MOUSE_MOVE/SCROLL + TYPE_TEXT → Task 6. ✓
- Part D utils: win_clipboard → Task 4; win_windows additions → Task 5. ✓
- Part E frontend: enum → Task 7; automation.ts data carry → Task 8; ScreenshotModal + App wiring → Task 9. ✓
- Testing (per-action, data path, round-trip, frontend) → distributed across tasks; each action has unit tests, data path covered in Tasks 1/8, clipboard round-trip in Task 4, modal in Task 9. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step gives command + expected outcome. Task 9's App.tsx wiring points at exact existing line ranges and instructs reading the file (the surrounding code is not reproduced because it is pre-existing and long). ✓

**Type/name consistency:** `parse_coord` (Tasks 2/3/6), `get_text`/`set_text` (Task 4), `minimize/maximize/restore/get_foreground` (Task 5), `ACTION_COMPLETED.data` / body `data` (Tasks 1/8/9), `ScreenshotModal({dataUrl,onClose})` (Task 9). The `{success, error, data}` body shape from Task 1 matches what Task 8's `run` reads and Task 9 surfaces. Action type strings match between backend `@register_action` and the Task 7 enum. ✓

# Action Registry + New Input Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open/closed action architecture — a contributor adds one file to `nexus_desktop/actions/` and the agent, the Gemini prompt, and the API all pick it up automatically — plus three new actions (HOTKEY, FOCUS_WINDOW, MOUSE_CLICK), fuzzy name matching, and CONTRIBUTING docs in EN/TR/DE.

**Architecture:** A decorator registry (`@register_action`) with pkgutil auto-discovery replaces the `if/elif` chains in `automation_service`, `api_service`, and the hand-maintained `_ACTION_TYPES`/prompt examples in `ai_service`. Volume/media action modules are thin bus-event publishers; pycaw logic stays in `MediaService`. Name resolution (launch/close/focus) funnels through one `best_match` helper (exact → substring → difflib ≥ 0.75).

**Tech Stack:** Python 3 / Flask agent, pytest; pyautogui, psutil, ctypes (all already present — **no new runtime dependencies**); React 19 + TypeScript frontend, vitest.

**Spec:** `docs/superpowers/specs/2026-07-07-action-registry-design.md`

## Global Constraints

- Branch: `feat/action-registry`, created from `feat/close-app` (depends on its `close_app`/`win_windows` code).
- No new runtime dependencies (difflib is stdlib).
- No shell execution anywhere; `os.startfile`/argv-list `subprocess.run` only (existing security posture).
- Existing security tests keep their intent: COMMAND allowlist, `_PROTECTED_PROCESSES`, SYSTEM_POWER argv, token auth.
- All user-visible Turkish strings stay byte-identical unless a task explicitly adds new ones.
- After every task: backend `../venv/Scripts/python.exe -m pytest tests/ -q` green (run from `nexus_desktop/`). Frontend tasks additionally: `npx tsc --noEmit` and `npx vitest run` green (run from repo root).
- Baseline at branch start: 150 backend tests, 49 frontend tests (verify with a full run before Task 1).
- Commit after every task; commit messages have NO Co-Authored-By trailer.

---

### Task 1: Registry, base types, auto-discovery

**Files:**
- Create: `nexus_desktop/actions/__init__.py`
- Create: `nexus_desktop/actions/registry.py`
- Create: `nexus_desktop/actions/base.py`
- Test: `nexus_desktop/tests/test_actions_registry.py`

**Interfaces:**
- Produces: `actions.registry.register_action(action_type: str)` (class decorator), `get_action(action_type: str) -> type | None`, `all_actions() -> dict[str, type]`; `actions.base.Action` (base class with `prompt_examples: list[str]`, `prompt_hint: str`, `execute(self, value, context)`), `actions.base.ActionContext` (dataclass with field `bus`). Importing the `actions` package imports every non-underscore sibling module.

- [ ] **Step 1: Write the failing tests**

```python
# nexus_desktop/tests/test_actions_registry.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest


class TestRegistry:
    def test_register_and_get(self):
        from actions.registry import register_action, get_action, _REGISTRY

        @register_action("TEST_DUMMY")
        class Dummy:
            pass
        try:
            assert get_action("TEST_DUMMY") is Dummy
            assert Dummy.action_type == "TEST_DUMMY"
        finally:
            _REGISTRY.pop("TEST_DUMMY", None)

    def test_duplicate_registration_raises(self):
        from actions.registry import register_action, _REGISTRY

        @register_action("TEST_DUP")
        class First:
            pass
        try:
            with pytest.raises(ValueError):
                @register_action("TEST_DUP")
                class Second:
                    pass
        finally:
            _REGISTRY.pop("TEST_DUP", None)

    def test_unknown_type_returns_none(self):
        from actions.registry import get_action
        assert get_action("NO_SUCH_TYPE") is None

    def test_all_actions_returns_copy(self):
        from actions.registry import all_actions
        snapshot = all_actions()
        snapshot["INJECTED"] = object
        assert "INJECTED" not in all_actions()


class TestBase:
    def test_action_defaults(self):
        from actions.base import Action, ActionContext
        act = Action()
        assert act.prompt_examples == []
        assert act.prompt_hint == ""
        with pytest.raises(NotImplementedError):
            act.execute("x", ActionContext(bus=None))
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `nexus_desktop/`): `../venv/Scripts/python.exe -m pytest tests/test_actions_registry.py -q`
Expected: FAIL / errors with `ModuleNotFoundError: No module named 'actions'`

- [ ] **Step 3: Implement**

```python
# nexus_desktop/actions/registry.py
"""Action registry. Action modules register themselves with
@register_action("TYPE"); the dispatcher and the AI prompt read from here."""

_REGISTRY = {}


def register_action(action_type):
    """Class decorator: register an Action subclass for an action type."""
    def decorator(cls):
        if action_type in _REGISTRY:
            raise ValueError(f"Action type already registered: {action_type!r}")
        cls.action_type = action_type
        _REGISTRY[action_type] = cls
        return cls
    return decorator


def get_action(action_type):
    """Returns the Action class for a type, or None."""
    return _REGISTRY.get(action_type)


def all_actions():
    """Returns a snapshot dict of {action_type: Action class}."""
    return dict(_REGISTRY)
```

```python
# nexus_desktop/actions/base.py
"""Base types for action modules."""
from dataclasses import dataclass


@dataclass
class ActionContext:
    """What the host hands every action at execute time."""
    bus: object  # core.event_bus.EventBus


class Action:
    """Base class for actions.

    Subclasses set `prompt_examples` (Turkish example lines shown to
    Gemini) and optionally `prompt_hint` (a rule sentence appended to the
    system prompt), and implement `execute`.
    """
    prompt_examples: list = []
    prompt_hint: str = ""

    def execute(self, value, context):
        raise NotImplementedError
```

```python
# nexus_desktop/actions/__init__.py
"""Auto-discovering action package.

Importing this package imports every non-underscore sibling module, which
lets each module register itself. Adding a new action == adding a file.
"""
import importlib
import pkgutil

from .registry import register_action, get_action, all_actions  # noqa: F401
from .base import Action, ActionContext  # noqa: F401

_SKIP = {"registry", "base"}

for _mod in pkgutil.iter_modules(__path__):
    if _mod.name in _SKIP or _mod.name.startswith("_"):
        continue
    importlib.import_module(f"{__name__}.{_mod.name}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_registry.py -q`
Expected: 5 passed

- [ ] **Step 5: Run the full backend suite, then commit**

Run: `../venv/Scripts/python.exe -m pytest tests/ -q` — expected: all green (150 + 5 new).

```bash
git add nexus_desktop/actions nexus_desktop/tests/test_actions_registry.py
git commit -m "feat: add action registry with auto-discovery"
```

---

### Task 2: Migrate automation actions into modules; dispatcher swap

**Files:**
- Create: `nexus_desktop/actions/_targets.py` (shared allowlist; underscore = skipped by discovery)
- Create: `nexus_desktop/actions/open_url.py`, `wait.py`, `keypress.py`, `command.py`, `launch_app.py`, `close_app.py`, `system_power.py`
- Modify: `nexus_desktop/services/automation_service.py` (becomes a thin dispatcher)
- Modify: `nexus_desktop/tests/test_automation_service.py` (tests move to action classes; dispatch tests stay)
- Test: `nexus_desktop/tests/test_actions_core.py`

**Interfaces:**
- Consumes: Task 1's `register_action`, `Action`, `ActionContext`.
- Produces: action modules for types `OPEN_URL`, `WAIT`, `KEYPRESS`, `COMMAND`, `LAUNCH_APP`, `CLOSE_APP`, `SYSTEM_POWER`; `actions._targets.APP_TARGETS` (dict), `actions._targets.PROTECTED_PROCESSES` (set), `actions._targets.normalize_name(str) -> str`, `actions._targets.proc_base(str) -> str`. `AutomationService._execute_action` dispatches via `get_action` and publishes `ACTION_FAILED` for unknown types.

- [ ] **Step 1: Create the shared targets module**

Move (cut, don't copy) `_APP_TARGETS`, `_PROTECTED_PROCESSES`, `_normalize_name`, `_proc_base` from `services/automation_service.py` into:

```python
# nexus_desktop/actions/_targets.py
"""Shared allowlists and name normalization for action modules.
Underscore-prefixed: not an action module, skipped by discovery."""
import re

# Named actions the agent will launch, mapped to a target passed to
# os.startfile (never through a shell, so no injection is possible via value).
# Both LAUNCH_APP and COMMAND resolve against this same allowlist.
APP_TARGETS = {
    'whatsapp': 'whatsapp:',
    'spotify': 'spotify:',
    'netflix': 'netflix:',
    'instagram': 'instagram:',
    'calculator': 'calc',
    'calc': 'calc',
    'notepad': 'notepad',
    'paint': 'mspaint',
    'mspaint': 'mspaint',
    'explorer': 'explorer',
    'chrome': 'chrome',
    'edge': 'microsoft-edge:',
    'taskmgr': 'taskmgr',
    'task manager': 'taskmgr',
    'control panel': 'control',
    'control': 'control',
}

# Processes CLOSE_APP must never touch, no matter what name the AI produces.
PROTECTED_PROCESSES = {
    'system', 'registry', 'idle', 'csrss', 'winlogon', 'wininit', 'services',
    'lsass', 'smss', 'svchost', 'dwm', 'explorer', 'fontdrvhost', 'conhost',
    'python', 'pythonw',  # the agent itself
}


def normalize_name(name):
    """Lowercase and strip everything but letters/digits for fuzzy matching."""
    return re.sub(r'[^a-z0-9]', '', name.lower())


def proc_base(name):
    """Normalized process name without its .exe extension."""
    name = name or ''
    if name.lower().endswith('.exe'):
        name = name[:-4]
    return normalize_name(name)
```

- [ ] **Step 2: Create the action modules** (logic moved verbatim from `automation_service`, wrapped in classes)

```python
# nexus_desktop/actions/open_url.py
import webbrowser

from .base import Action
from .registry import register_action


@register_action("OPEN_URL")
class OpenUrlAction(Action):
    prompt_examples = [
        '- "Youtube\'u aç": {{ "type": "OPEN_URL", "value": "https://youtube.com", "description": "Youtube açılıyor" }}',
    ]

    def execute(self, value, context):
        webbrowser.open(value)
```

```python
# nexus_desktop/actions/wait.py
import time

from .base import Action
from .registry import register_action


@register_action("WAIT")
class WaitAction(Action):
    prompt_hint = "Ardışık işlemlerde araya mutlaka bekleme (WAIT) koy."

    def execute(self, value, context):
        time.sleep(float(value))
```

```python
# nexus_desktop/actions/keypress.py
import pyautogui

from .base import Action
from .registry import register_action

_SPECIAL_KEYS = [
    'enter', 'tab', 'esc', 'space', 'backspace', 'delete',
    'up', 'down', 'left', 'right', 'win', 'ctrl', 'alt', 'shift', 'capslock'
]


@register_action("KEYPRESS")
class KeypressAction(Action):
    def execute(self, value, context):
        val_lower = value.lower()
        if val_lower in _SPECIAL_KEYS:
            pyautogui.press(val_lower)
        else:
            pyautogui.write(value, interval=0.05)
```

```python
# nexus_desktop/actions/command.py
import os
import shlex

from ._targets import APP_TARGETS
from .base import Action
from .registry import register_action


@register_action("COMMAND")
class CommandAction(Action):
    """Only names known to APP_TARGETS are allowed; arbitrary shell strings
    are rejected instead of being executed."""
    prompt_hint = (
        'COMMAND tipini sadece agent\'ın izin verdiği kısa uygulama adları '
        'için kullan (örn: "calc", "notepad") — asla ham shell komutları '
        '(örn: "shutdown /s /t 0", "del ...") üretme, bunlar reddedilir.'
    )

    def execute(self, value, context):
        if not value:
            raise ValueError("Empty command")
        # Only the bare action name is honored — any extra shell-style
        # arguments in `value` are rejected rather than passed through.
        first_token = shlex.split(value.lower().strip())[0] if value.strip() else ''
        target = APP_TARGETS.get(first_token)
        if not target:
            raise ValueError(f"Command not in allowlist: {value!r}")
        os.startfile(target)
```

```python
# nexus_desktop/actions/launch_app.py
import logging
import os

from utils.win_search import find_installed_app

from ._targets import APP_TARGETS
from .base import Action
from .registry import register_action


@register_action("LAUNCH_APP")
class LaunchAppAction(Action):
    prompt_examples = [
        '- "Spotify aç": {{ "type": "LAUNCH_APP", "value": "spotify", "description": "Spotify açılıyor" }}',
        '- "Hesap makinesi aç": {{ "type": "LAUNCH_APP", "value": "calculator", "description": "Hesap makinesi açılıyor" }}',
        '- "cs2 aç": {{ "type": "LAUNCH_APP", "value": "counter strike 2", "description": "Counter-Strike 2 açılıyor" }}',
    ]
    prompt_hint = "Uygulama açmak için HER ZAMAN LAUNCH_APP kullan."

    def execute(self, value, context):
        lower_val = value.lower().strip()
        target = APP_TARGETS.get(lower_val)
        if target:
            os.startfile(target)
            return
        # Smart Search: look up an installed app by name and launch its
        # resolved executable path directly (no shell involved).
        try:
            app_path = find_installed_app(lower_val)
            if app_path:
                os.startfile(app_path)
            else:
                raise ValueError(f"App not found and not in allowlist: {value!r}")
        except Exception as e:
            logging.warning(f"[LaunchApp] App launch error: {e}")
            raise
```

```python
# nexus_desktop/actions/close_app.py
import logging
import os

import psutil

from utils.win_windows import find_pids_by_window_title

from ._targets import PROTECTED_PROCESSES, normalize_name, proc_base
from .base import Action
from .registry import register_action


@register_action("CLOSE_APP")
class CloseAppAction(Action):
    """Close an app by name: match process names first (e.g. 'cs2' ->
    cs2.exe), then visible window titles (e.g. 'counter strike 2' ->
    'Counter-Strike 2'). Protected system processes are never killed."""
    prompt_examples = [
        '- "Spotify\'ı kapat": {{ "type": "CLOSE_APP", "value": "spotify", "description": "Spotify kapatılıyor" }}',
        '- "cs2\'yi kapat": {{ "type": "CLOSE_APP", "value": "counter strike 2", "description": "Counter-Strike 2 kapatılıyor" }}',
    ]
    prompt_hint = (
        'Bir uygulamayı/oyunu kapatmak için HER ZAMAN CLOSE_APP kullan. '
        'Kısaltmaları uygulamanın tam adına genişlet (örn: "cs2" -> '
        '"counter strike 2", "lol" -> "league of legends", "ws" -> "whatsapp").'
    )

    def execute(self, value, context):
        search = normalize_name(value or '')
        if not search:
            raise ValueError("Empty app name")

        own_pid = os.getpid()
        targets = {}

        for proc in psutil.process_iter(['pid', 'name']):
            try:
                base = proc_base(proc.info['name'])
                if not base or base in PROTECTED_PROCESSES or proc.info['pid'] == own_pid:
                    continue
                if search == base or (len(search) >= 4 and search in base):
                    targets[proc.info['pid']] = proc
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        if not targets:
            for pid in find_pids_by_window_title(search):
                if pid == own_pid:
                    continue
                try:
                    proc = psutil.Process(pid)
                    if proc_base(proc.name()) not in PROTECTED_PROCESSES:
                        targets[pid] = proc
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

        if not targets:
            raise ValueError(f"No running app matches: {value!r}")

        procs = list(targets.values())
        for proc in procs:
            try:
                proc.terminate()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        gone, alive = psutil.wait_procs(procs, timeout=5)
        for proc in alive:
            try:
                proc.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        logging.info(f"[CloseApp] Closed {len(procs)} process(es) for {value!r}")
```

```python
# nexus_desktop/actions/system_power.py
import logging
import subprocess

from .base import Action
from .registry import register_action


@register_action("SYSTEM_POWER")
class SystemPowerAction(Action):
    prompt_examples = [
        '- "Sesi kapat": {{ "type": "VOLUME_MUTE", "value": "true", "description": "Ses kapatılıyor" }}',
        '- "Bilgisayarı kilitle": {{ "type": "SYSTEM_POWER", "value": "lock", "description": "Bilgisayar kilitleniyor" }}',
        '- "Bilgisayarı kapat": {{ "type": "SYSTEM_POWER", "value": "shutdown", "description": "Bilgisayar kapatılıyor" }}',
    ]
    prompt_hint = (
        "Önemli kısıtlama: Kapatma/yeniden başlatma/uyku/kilitleme için HER "
        "ZAMAN SYSTEM_POWER kullan (value: lock|shutdown|restart|sleep)."
    )

    def execute(self, value, context):
        val_lower = value.lower().strip()
        logging.info(f"[SystemPower] Executing system power action: {val_lower}")
        if val_lower == 'lock':
            import ctypes
            ctypes.windll.user32.LockWorkStation()
        elif val_lower == 'shutdown':
            subprocess.run(["shutdown", "/s", "/t", "0"], shell=False)
        elif val_lower == 'restart':
            subprocess.run(["shutdown", "/r", "/t", "0"], shell=False)
        elif val_lower == 'sleep':
            subprocess.run(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"], shell=False)
        else:
            raise ValueError(f"Unknown power action: {value!r}")
```

(Note: the "Sesi kapat" VOLUME_MUTE example line above is placed on `SystemPowerAction` only temporarily mirroring today's prompt; Task 3 moves it to the volume module.)

- [ ] **Step 3: Slim down `automation_service.py`**

Replace the entire file body (keep the module docstring style) with:

```python
# nexus_desktop/services/automation_service.py
import logging
from concurrent.futures import ThreadPoolExecutor

from actions import get_action
from actions.base import ActionContext
from core.service_interface import Service


class AutomationService(Service):
    def on_start(self):
        self.bus.subscribe("COMMAND_RECEIVED", self.handle_command)
        # Use a thread pool to avoid blocking the EventBus
        self.executor = ThreadPoolExecutor(max_workers=3)
        self.context = ActionContext(bus=self.bus)
        print("[AutomationService] Async Executor Started")

    def on_stop(self):
        self.executor.shutdown(wait=False)

    def handle_command(self, event):
        # Offload execution to thread pool
        self.executor.submit(self._execute_action, event.payload)

    def _execute_action(self, data):
        action_type = data.get('type')
        value = data.get('value')
        try:
            action_cls = get_action(action_type)
            if action_cls is None:
                raise ValueError(f"Unknown action type: {action_type!r}")
            action_cls().execute(value, self.context)
            self.bus.publish("ACTION_COMPLETED", {"status": "success", "id": data.get('id')})
        except Exception as e:
            logging.warning(f"[AutomationService] Error executing {action_type}: {e}")
            self.bus.publish("ACTION_FAILED", {"error": str(e), "id": data.get('id')})
```

`ActionContext` construction must also happen for tests that skip `on_start` — the dispatch tests below build the service via `__new__` and set `context` manually.

- [ ] **Step 4: Rewrite the tests**

Rewrite `nexus_desktop/tests/test_automation_service.py` to keep ONLY dispatch-level tests (new content below), and create `nexus_desktop/tests/test_actions_core.py` carrying every migrated behavior test, pointed at the action classes. Patch targets change from `services.automation_service.*` to the action modules (e.g. `actions.close_app.psutil`, `actions.launch_app.find_installed_app`, `os.startfile` stays global).

```python
# nexus_desktop/tests/test_automation_service.py  (full new content)
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from actions.base import ActionContext
from services.automation_service import AutomationService


class _FakeBus:
    def __init__(self):
        self.published = []

    def publish(self, name, payload):
        self.published.append((name, payload))


def _service():
    svc = AutomationService.__new__(AutomationService)
    svc.bus = _FakeBus()
    svc.context = ActionContext(bus=svc.bus)
    return svc


def test_known_action_dispatches_and_publishes_completed(monkeypatch):
    svc = _service()
    calls = []
    monkeypatch.setattr("actions.open_url.webbrowser.open", lambda url: calls.append(url))
    svc._execute_action({"type": "OPEN_URL", "value": "https://example.com", "id": "1"})
    assert calls == ["https://example.com"]
    assert svc.bus.published == [("ACTION_COMPLETED", {"status": "success", "id": "1"})]


def test_unknown_action_publishes_failed():
    svc = _service()
    svc._execute_action({"type": "NO_SUCH_ACTION", "value": "", "id": "2"})
    assert svc.bus.published[0][0] == "ACTION_FAILED"
    assert "NO_SUCH_ACTION" in svc.bus.published[0][1]["error"]


def test_action_error_publishes_failed():
    svc = _service()
    # COMMAND with a non-allowlisted value raises inside the action
    svc._execute_action({"type": "COMMAND", "value": "rm -rf /", "id": "3"})
    assert svc.bus.published[0][0] == "ACTION_FAILED"
```

`test_actions_core.py` gets the previous test bodies, adapted. Full content:

```python
# nexus_desktop/tests/test_actions_core.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions._targets import APP_TARGETS
from actions.base import ActionContext
from actions.command import CommandAction
from actions.close_app import CloseAppAction
from actions.launch_app import LaunchAppAction
from actions.system_power import SystemPowerAction

CTX = ActionContext(bus=None)


@pytest.fixture
def startfile_calls(monkeypatch):
    calls = []
    monkeypatch.setattr("os.startfile", lambda target: calls.append(target))
    return calls


class TestCommand:
    def test_allowlisted_command_launches_target(self, startfile_calls):
        CommandAction().execute("calc", CTX)
        assert startfile_calls == ["calc"]

    def test_command_with_injection_suffix_only_launches_allowlisted_target(self, startfile_calls):
        # The attacker-controlled suffix must never reach os.startfile/shell.
        CommandAction().execute("calc && del C:/important-data", CTX)
        assert startfile_calls == ["calc"]

    def test_unknown_command_is_rejected(self, startfile_calls):
        with pytest.raises(ValueError):
            CommandAction().execute("shutdown /s /t 0", CTX)
        assert startfile_calls == []

    def test_raw_shell_command_is_rejected(self, startfile_calls):
        with pytest.raises(ValueError):
            CommandAction().execute("rm -rf /", CTX)
        assert startfile_calls == []

    def test_empty_command_is_rejected(self, startfile_calls):
        with pytest.raises(ValueError):
            CommandAction().execute("", CTX)
        assert startfile_calls == []


class TestLaunchApp:
    def test_known_target_uses_allowlist(self, startfile_calls):
        LaunchAppAction().execute("Spotify", CTX)
        assert startfile_calls == [APP_TARGETS["spotify"]]

    def test_unknown_app_falls_back_to_search(self, startfile_calls, monkeypatch):
        monkeypatch.setattr(
            "actions.launch_app.find_installed_app",
            lambda name: r"C:\Program Files\SomeApp\app.exe",
        )
        LaunchAppAction().execute("someapp", CTX)
        assert startfile_calls == [r"C:\Program Files\SomeApp\app.exe"]

    def test_not_found_raises_without_executing_raw_value(self, startfile_calls, monkeypatch):
        monkeypatch.setattr("actions.launch_app.find_installed_app", lambda name: None)
        with pytest.raises(ValueError):
            LaunchAppAction().execute("calc & del C:/", CTX)
        assert startfile_calls == []


class TestSystemPower:
    def test_shutdown_uses_argv_no_shell(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            "subprocess.run", lambda argv, shell: calls.append((argv, shell))
        )
        SystemPowerAction().execute("shutdown", CTX)
        assert calls == [(["shutdown", "/s", "/t", "0"], False)]

    def test_unknown_action_rejected(self):
        with pytest.raises(ValueError):
            SystemPowerAction().execute("format-drive", CTX)


class _FakeProc:
    def __init__(self, pid, name):
        self.pid = pid
        self.info = {"pid": pid, "name": name}
        self.terminated = False
        self.killed = False

    def name(self):
        return self.info["name"]

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True


@pytest.fixture
def psutil_env(monkeypatch):
    def setup(procs, window_pids=frozenset()):
        monkeypatch.setattr(
            "actions.close_app.psutil.process_iter",
            lambda attrs: iter(procs),
        )
        monkeypatch.setattr(
            "actions.close_app.psutil.wait_procs",
            lambda targets, timeout: (targets, []),
        )
        monkeypatch.setattr(
            "actions.close_app.psutil.Process",
            lambda pid: next(p for p in procs if p.pid == pid),
        )
        monkeypatch.setattr(
            "actions.close_app.find_pids_by_window_title",
            lambda term: set(window_pids),
        )
        return procs
    return setup


class TestCloseApp:
    def test_matches_process_name(self, psutil_env):
        procs = psutil_env([_FakeProc(100, "cs2.exe"), _FakeProc(200, "notepad.exe")])
        CloseAppAction().execute("cs2", CTX)
        assert procs[0].terminated and not procs[1].terminated

    def test_falls_back_to_window_title(self, psutil_env):
        # Process is cs2.exe but the AI sends the full game name; only the
        # window title ("Counter-Strike 2") matches.
        procs = psutil_env([_FakeProc(100, "cs2.exe")], window_pids={100})
        CloseAppAction().execute("Counter Strike 2", CTX)
        assert procs[0].terminated

    def test_never_kills_protected_process(self, psutil_env):
        procs = psutil_env([_FakeProc(4, "explorer.exe")], window_pids={4})
        with pytest.raises(ValueError):
            CloseAppAction().execute("explorer", CTX)
        assert not procs[0].terminated

    def test_no_match_raises(self, psutil_env):
        psutil_env([_FakeProc(100, "notepad.exe")])
        with pytest.raises(ValueError):
            CloseAppAction().execute("cs2", CTX)

    def test_empty_value_rejected(self, psutil_env):
        psutil_env([])
        with pytest.raises(ValueError):
            CloseAppAction().execute("  ", CTX)

    def test_short_term_requires_exact_match(self, psutil_env):
        # 'cs2' must not substring-match into unrelated processes.
        procs = psutil_env([_FakeProc(100, "briefcs2sync.exe")])
        with pytest.raises(ValueError):
            CloseAppAction().execute("cs2", CTX)
        assert not procs[0].terminated
```

- [ ] **Step 5: Run the full backend suite**

Run: `../venv/Scripts/python.exe -m pytest tests/ -q`
Expected: all green. Test count stays ≥ 155 (old automation tests replaced 1:1 + 3 dispatch tests).

- [ ] **Step 6: Commit**

```bash
git add nexus_desktop/actions nexus_desktop/services/automation_service.py nexus_desktop/tests/test_automation_service.py nexus_desktop/tests/test_actions_core.py
git commit -m "refactor: migrate automation actions into registry modules"
```

---

### Task 3: Volume/media action modules; collapse api_service router

**Files:**
- Create: `nexus_desktop/actions/volume.py`, `nexus_desktop/actions/media.py`
- Modify: `nexus_desktop/services/api_service.py` (`execute` method, lines ~119-142)
- Modify: `nexus_desktop/actions/system_power.py` (remove the temporary "Sesi kapat" example line — it moves to volume.py)
- Test: `nexus_desktop/tests/test_actions_media.py`

**Interfaces:**
- Consumes: Task 1 registry/base; `ActionContext.bus`.
- Produces: action modules for `VOLUME_SET`, `VOLUME_MUTE`, `MEDIA_PLAY_PAUSE`, `MEDIA_NEXT`, `MEDIA_PREV` that publish the same-named bus events with payload `{"value": value}` (MediaService's `set_volume` reads `event.payload.get('value')` — contract preserved). `api_service.execute` publishes `SCHEDULE_ACTION` for that type and `COMMAND_RECEIVED` for everything else.

- [ ] **Step 1: Write the failing tests**

```python
# nexus_desktop/tests/test_actions_media.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions.base import ActionContext
from actions.registry import get_action


class _FakeBus:
    def __init__(self):
        self.published = []

    def publish(self, name, payload):
        self.published.append((name, payload))


@pytest.mark.parametrize("action_type", [
    "VOLUME_SET", "VOLUME_MUTE", "MEDIA_PLAY_PAUSE", "MEDIA_NEXT", "MEDIA_PREV",
])
def test_media_actions_republish_to_media_service(action_type):
    bus = _FakeBus()
    cls = get_action(action_type)
    assert cls is not None, f"{action_type} not registered"
    cls().execute("55", ActionContext(bus=bus))
    assert bus.published == [(action_type, {"value": "55"})]
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_media.py -q`
Expected: 5 failures (`VOLUME_SET not registered` …)

- [ ] **Step 3: Implement the modules**

```python
# nexus_desktop/actions/volume.py
"""Volume actions: thin bus-event publishers. The pycaw logic lives in
services.media_service, which subscribes to these events."""
from .base import Action
from .registry import register_action


class _Republish(Action):
    def execute(self, value, context):
        context.bus.publish(self.action_type, {"value": value})


@register_action("VOLUME_SET")
class VolumeSetAction(_Republish):
    prompt_examples = [
        '- "Sesi 30 yap": {{ "type": "VOLUME_SET", "value": "30", "description": "Ses %30 yapılıyor" }}',
    ]


@register_action("VOLUME_MUTE")
class VolumeMuteAction(_Republish):
    prompt_examples = [
        '- "Sesi kapat": {{ "type": "VOLUME_MUTE", "value": "true", "description": "Ses kapatılıyor" }}',
    ]
```

```python
# nexus_desktop/actions/media.py
"""Media-key actions: thin bus-event publishers handled by MediaService."""
from .registry import register_action
from .volume import _Republish


@register_action("MEDIA_PLAY_PAUSE")
class MediaPlayPauseAction(_Republish):
    pass


@register_action("MEDIA_NEXT")
class MediaNextAction(_Republish):
    pass


@register_action("MEDIA_PREV")
class MediaPrevAction(_Republish):
    pass
```

In `actions/system_power.py`, delete the line
`'- "Sesi kapat": {{ "type": "VOLUME_MUTE", ... }}',` from `prompt_examples`
(it now lives on `VolumeMuteAction`).

- [ ] **Step 4: Collapse the api_service router**

In `nexus_desktop/services/api_service.py`, replace the routing block inside `execute` (from the `# Route commands...` comment through the final `self.bus.publish("COMMAND_RECEIVED", data)`) with:

```python
        # SCHEDULE_ACTION is a scheduler meta-command, not an action module;
        # every action type goes to AutomationService via the registry.
        if action_type == 'SCHEDULE_ACTION':
            self.bus.publish("SCHEDULE_ACTION", data)
        else:
            self.bus.publish("COMMAND_RECEIVED", data)
```

Check `nexus_desktop/tests/test_api_service_auth.py` for tests asserting the old per-type routing (e.g. a VOLUME_SET publish) and update their expected event name to `COMMAND_RECEIVED` if present.

- [ ] **Step 5: Run the full backend suite**

Run: `../venv/Scripts/python.exe -m pytest tests/ -q`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add nexus_desktop/actions nexus_desktop/services/api_service.py nexus_desktop/tests
git commit -m "refactor: volume/media as registry actions; collapse api router"
```

---

### Task 4: Generate the Gemini prompt from the registry

**Files:**
- Modify: `nexus_desktop/services/ai_service.py` (replace hand-written `_ACTION_TYPES` and `_MACRO_INSTRUCTION` example/hint section)
- Test: `nexus_desktop/tests/test_ai_prompt.py`

**Interfaces:**
- Consumes: `actions.all_actions()`; each class's `prompt_examples` / `prompt_hint`.
- Produces: `ai_service._ACTION_TYPES` (sorted list from registry), `ai_service._MACRO_INSTRUCTION` (built at import), used unchanged by `_model`/`_STEP_SCHEMA`.

- [ ] **Step 1: Write the failing tests**

```python
# nexus_desktop/tests/test_ai_prompt.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from actions import all_actions
from services import ai_service


def test_action_types_come_from_registry():
    assert ai_service._ACTION_TYPES == sorted(all_actions().keys())


def test_prompt_contains_every_example_and_hint():
    for cls in all_actions().values():
        for example in cls.prompt_examples:
            # examples are written with doubled braces for f-string templates
            assert example.replace("{{", "{").replace("}}", "}") in ai_service._MACRO_INSTRUCTION
        if cls.prompt_hint:
            assert cls.prompt_hint in ai_service._MACRO_INSTRUCTION


def test_schema_enum_matches_registry():
    enum = ai_service._STEP_SCHEMA["items"]["properties"]["type"]["enum"]
    assert enum == ai_service._ACTION_TYPES
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_ai_prompt.py -q`
Expected: FAIL (`_ACTION_TYPES` is the hand-written list; examples for new modules missing).

- [ ] **Step 3: Implement**

In `nexus_desktop/services/ai_service.py`, delete the hard-coded `_ACTION_TYPES` list and replace the `_MACRO_INSTRUCTION` literal with generation:

```python
from actions import all_actions

_ACTION_TYPES = sorted(all_actions().keys())


def _build_macro_instruction():
    example_lines = []
    hint_lines = []
    for _type, cls in sorted(all_actions().items()):
        example_lines.extend(
            ex.replace("{{", "{").replace("}}", "}") for ex in cls.prompt_examples
        )
        if cls.prompt_hint:
            hint_lines.append(cls.prompt_hint)
    return (
        "Sen NEXUS AI asistanısın.\n"
        "Görevin: Kullanıcı isteğini bilgisayar otomasyon adımlarına çevirmek.\n"
        "Önemli: Sadece saf JSON dizisi döndür. Başka açıklama yapma.\n\n"
        "Örnekler:\n"
        + "\n".join(example_lines)
        + "\n\n"
        + "\n".join(hint_lines)
        + "\n\nKullanılabilir Tipler: " + ", ".join(_ACTION_TYPES)
    )


_MACRO_INSTRUCTION = _build_macro_instruction()
```

`_SCHEDULE_INSTRUCTION` and everything else stays. `_STEP_SCHEMA` already uses `_ACTION_TYPES` for its enum — verify it references the new list (it's defined after, so it does).

- [ ] **Step 4: Run the full backend suite**

Run: `../venv/Scripts/python.exe -m pytest tests/ -q`
Expected: all green (existing `test_ai_service.py` must still pass — it tests routes/auth, not prompt wording).

- [ ] **Step 5: Print the generated prompt once and eyeball it**

Run: `../venv/Scripts/python.exe -c "import sys; sys.path.insert(0,'.'); from services.ai_service import _MACRO_INSTRUCTION; print(_MACRO_INSTRUCTION)"`
Expected: coherent Turkish prompt containing every example line, hints, and the full type list.

- [ ] **Step 6: Commit**

```bash
git add nexus_desktop/services/ai_service.py nexus_desktop/tests/test_ai_prompt.py
git commit -m "feat: generate Gemini action prompt from registry"
```

---

### Task 5: Fuzzy name matching (`best_match`) wired into search/close

**Files:**
- Create: `nexus_desktop/utils/name_match.py`
- Modify: `nexus_desktop/utils/win_search.py` (use `best_match` over candidates)
- Modify: `nexus_desktop/actions/close_app.py` (fuzzy tier after exact/substring)
- Test: `nexus_desktop/tests/test_name_match.py`; extend `tests/test_win_search.py`, `tests/test_actions_core.py`

**Interfaces:**
- Consumes: `actions._targets.normalize_name`.
- Produces: `name_match.best_match(query: str, candidates: Iterable[str], *, threshold: float = 0.75) -> str | None` — returns the winning ORIGINAL candidate string. Tiers: exact normalized match → substring (shortest candidate wins) → difflib ratio ≥ threshold. Substring and fuzzy tiers require `len(normalized_query) >= 4`.

- [ ] **Step 1: Write the failing tests**

```python
# nexus_desktop/tests/test_name_match.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.name_match import best_match


def test_exact_match_wins_over_substring():
    assert best_match("portal", ["Portal 2", "Portal"]) == "Portal"


def test_substring_prefers_shortest():
    assert best_match("portal2", ["Portal 2 Soundtrack", "Portal 2"]) == "Portal 2"


def test_fuzzy_typo_matches():
    # 'spotfy' has no exact/substring hit; difflib should still find Spotify
    assert best_match("spotfy", ["Spotify", "Discord"]) == "Spotify"


def test_fuzzy_below_threshold_returns_none():
    assert best_match("qqqq", ["Spotify", "Discord"]) is None


def test_short_query_requires_exact():
    # 3-char query must not substring/fuzzy into long names
    assert best_match("cs2", ["briefcs2sync"]) is None
    assert best_match("cs2", ["CS2"]) == "CS2"


def test_empty_inputs():
    assert best_match("", ["Spotify"]) is None
    assert best_match("spotify", []) is None
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_name_match.py -q`
Expected: `ModuleNotFoundError: No module named 'utils.name_match'`

- [ ] **Step 3: Implement**

```python
# nexus_desktop/utils/name_match.py
"""Shared fuzzy name resolution for launch/close/focus actions.

Tier order: exact normalized match -> substring (shortest candidate) ->
difflib similarity >= threshold. Below threshold we return None: failing
loudly beats closing or focusing the wrong app.
"""
import difflib
import re

_MIN_PARTIAL_LEN = 4


def normalize(text):
    """Lowercase and strip everything but letters/digits."""
    return re.sub(r'[^a-z0-9]', '', (text or '').lower())


def best_match(query, candidates, *, threshold=0.75):
    """Returns the best-matching original candidate string, or None."""
    norm_query = normalize(query)
    if not norm_query:
        return None

    normalized = [(candidate, normalize(candidate)) for candidate in candidates]
    normalized = [(c, n) for c, n in normalized if n]
    if not normalized:
        return None

    for candidate, norm in normalized:
        if norm == norm_query:
            return candidate

    if len(norm_query) < _MIN_PARTIAL_LEN:
        return None

    substrings = [(len(norm), candidate) for candidate, norm in normalized if norm_query in norm]
    if substrings:
        substrings.sort()
        return substrings[0][1]

    best_score, best_candidate = 0.0, None
    for candidate, norm in normalized:
        score = difflib.SequenceMatcher(None, norm_query, norm).ratio()
        if score > best_score:
            best_score, best_candidate = score, candidate
    if best_score >= threshold:
        return best_candidate
    return None
```

- [ ] **Step 4: Wire into `win_search.py`**

Refactor `find_installed_app` and `find_steam_app` to COLLECT candidates and pick via `best_match`, replacing the inline exact/substring logic. New full content of the two functions (keep `_steam_library_dirs` unchanged; keep `_normalize` deleted — import from `name_match`):

```python
# nexus_desktop/utils/win_search.py  (revised, full file)
import os
import re

from utils.name_match import best_match


def find_installed_app(search_term):
    """
    Scans Windows Start Menu for .lnk files matching the search term,
    falling back to installed Steam apps (returned as a steam:// URI).
    Returns a launchable target (path or URI) or None.
    """
    paths = [
        os.path.join(os.environ["ProgramData"], r"Microsoft\Windows\Start Menu\Programs"),
        os.path.join(os.environ["APPDATA"], r"Microsoft\Windows\Start Menu\Programs"),
    ]

    candidates = {}  # display name -> full path
    for path in paths:
        if not os.path.exists(path):
            continue
        for root, dirs, files in os.walk(path):
            for file in files:
                if file.endswith(".lnk"):
                    candidates.setdefault(file[:-len(".lnk")], os.path.join(root, file))

    winner = best_match(search_term, candidates.keys())
    if winner:
        return candidates[winner]

    return find_steam_app(search_term)


def _steam_library_dirs():
    """Yields every steamapps directory of every Steam library folder."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            steam_path = winreg.QueryValueEx(key, "SteamPath")[0]
    except OSError:
        return

    main_apps = os.path.join(steam_path, "steamapps")
    if os.path.isdir(main_apps):
        yield main_apps

    vdf = os.path.join(main_apps, "libraryfolders.vdf")
    if not os.path.isfile(vdf):
        return
    try:
        with open(vdf, encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        return
    for raw_path in re.findall(r'"path"\s+"([^"]+)"', content):
        apps = os.path.join(raw_path.replace("\\\\", "\\"), "steamapps")
        if os.path.isdir(apps) and not os.path.samefile(apps, main_apps):
            yield apps


def find_steam_app(search_term):
    """
    Looks up an installed Steam app by name across all Steam libraries.
    Returns a steam://rungameid/<appid> URI or None.
    """
    candidates = {}  # game name -> appid
    for apps_dir in _steam_library_dirs():
        try:
            manifests = os.listdir(apps_dir)
        except OSError:
            continue
        for fname in manifests:
            if not (fname.startswith("appmanifest_") and fname.endswith(".acf")):
                continue
            try:
                with open(os.path.join(apps_dir, fname), encoding="utf-8", errors="replace") as f:
                    content = f.read()
            except OSError:
                continue
            appid = re.search(r'"appid"\s+"(\d+)"', content)
            name = re.search(r'"name"\s+"([^"]+)"', content)
            if appid and name:
                candidates.setdefault(name.group(1), appid.group(1))

    winner = best_match(search_term, candidates.keys())
    if winner:
        return f"steam://rungameid/{candidates[winner]}"
    return None
```

Behavior notes: `find_steam_app` no longer requires a pre-normalized input (it normalizes internally) — existing tests in `test_win_search.py` that pass `"wallpaperengine"` and `"portal2"` still pass because normalization is idempotent. The `steam_library` fixture keeps working. Add one fuzzy test:

```python
# append to nexus_desktop/tests/test_win_search.py inside TestFindSteamApp
    def test_typo_matches_fuzzily(self, steam_library):
        _write_manifest(steam_library, 431960, "Wallpaper Engine")
        assert win_search.find_steam_app("walpaper engine") == "steam://rungameid/431960"
```

- [ ] **Step 5: Wire fuzzy tier into `close_app.py`**

In `actions/close_app.py`, after the window-title fallback and before the final `if not targets: raise`, add a fuzzy pass over process base names:

```python
        if not targets:
            candidates = {}
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    base = proc_base(proc.info['name'])
                    if base and base not in PROTECTED_PROCESSES and proc.info['pid'] != own_pid:
                        candidates.setdefault(base, []).append(proc)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            winner = best_match(search, candidates.keys())
            if winner:
                for proc in candidates[winner]:
                    targets[proc.pid] = proc
```

with import `from utils.name_match import best_match`. Add a test to `TestCloseApp` in `tests/test_actions_core.py` — note the `psutil_env` fixture's `process_iter` must return a fresh iterator per call for this test; change the fixture line to `lambda attrs: iter(list(procs))`:

```python
    def test_typo_matches_process_fuzzily(self, psutil_env):
        procs = psutil_env([_FakeProc(100, "spotify.exe")])
        CloseAppAction().execute("spotfy", CTX)
        assert procs[0].terminated
```

- [ ] **Step 6: Run the full backend suite, commit**

Run: `../venv/Scripts/python.exe -m pytest tests/ -q` — expected: all green.

```bash
git add nexus_desktop/utils nexus_desktop/actions/close_app.py nexus_desktop/tests
git commit -m "feat: shared fuzzy name matching for launch/close"
```

---

### Task 6: HOTKEY action

**Files:**
- Create: `nexus_desktop/actions/hotkey.py`
- Test: `nexus_desktop/tests/test_actions_input.py` (new file, shared by Tasks 6–8)

**Interfaces:**
- Consumes: registry/base from Task 1.
- Produces: `HOTKEY` action; `value` format `"ctrl+shift+s"`. Invalid/unknown keys raise `ValueError`.

- [ ] **Step 1: Write the failing tests**

```python
# nexus_desktop/tests/test_actions_input.py
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions.base import ActionContext

CTX = ActionContext(bus=None)


class TestHotkey:
    def _action(self):
        from actions.hotkey import HotkeyAction
        return HotkeyAction()

    def test_valid_combo_calls_pyautogui(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: calls.append(keys))
        self._action().execute("Ctrl + Shift + S", CTX)
        assert calls == [("ctrl", "shift", "s")]

    def test_single_key_allowed(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: calls.append(keys))
        self._action().execute("f5", CTX)
        assert calls == [("f5",)]

    def test_unknown_key_rejected(self, monkeypatch):
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: pytest.fail("must not run"))
        with pytest.raises(ValueError):
            self._action().execute("ctrl+launchmissiles", CTX)

    def test_empty_value_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("  ", CTX)

    def test_empty_segment_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("ctrl++s", CTX)
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_input.py -q`
Expected: `ModuleNotFoundError: No module named 'actions.hotkey'`

- [ ] **Step 3: Implement**

```python
# nexus_desktop/actions/hotkey.py
import pyautogui

from .base import Action
from .registry import register_action

_ALLOWED_KEYS = (
    {chr(c) for c in range(ord('a'), ord('z') + 1)}
    | {str(d) for d in range(10)}
    | {f'f{i}' for i in range(1, 25)}
    | {
        'ctrl', 'alt', 'shift', 'win', 'enter', 'tab', 'esc', 'space',
        'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
        'delete', 'backspace', 'insert', 'capslock', 'printscreen',
        'volumemute', 'volumeup', 'volumedown', 'playpause', 'nexttrack', 'prevtrack',
    }
)


@register_action("HOTKEY")
class HotkeyAction(Action):
    prompt_examples = [
        '- "Kaydet": {{ "type": "HOTKEY", "value": "ctrl+s", "description": "Kaydediliyor" }}',
        '- "Sekmeyi kapat": {{ "type": "HOTKEY", "value": "ctrl+w", "description": "Sekme kapatılıyor" }}',
    ]
    prompt_hint = (
        'Tuş kombinasyonları için HER ZAMAN HOTKEY kullan (value: "ctrl+s" '
        'gibi, tuşlar + ile ayrılır). Tek tuş veya metin yazmak için KEYPRESS kullan.'
    )

    def execute(self, value, context):
        keys = [k.strip().lower() for k in (value or '').split('+')]
        if not keys or any(not k for k in keys):
            raise ValueError(f"Invalid hotkey: {value!r}")
        for key in keys:
            if key not in _ALLOWED_KEYS:
                raise ValueError(f"Key not allowed in hotkey: {key!r}")
        pyautogui.hotkey(*keys)
```

- [ ] **Step 4: Run tests, full suite, commit**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_input.py tests/test_ai_prompt.py -q` then the full suite.
Expected: all green (prompt tests prove HOTKEY self-documents to Gemini).

```bash
git add nexus_desktop/actions/hotkey.py nexus_desktop/tests/test_actions_input.py
git commit -m "feat: HOTKEY action with key allowlist"
```

---

### Task 7: FOCUS_WINDOW action + window enumeration upgrade

**Files:**
- Modify: `nexus_desktop/utils/win_windows.py` (add `list_windows()` and `focus_window_handle()`; refactor `find_pids_by_window_title` on top)
- Create: `nexus_desktop/actions/focus_window.py`
- Test: extend `nexus_desktop/tests/test_actions_input.py`

**Interfaces:**
- Consumes: `name_match.best_match`.
- Produces: `win_windows.list_windows() -> list[tuple[int, str, int]]` (hwnd, title, pid) for visible titled top-level windows; `win_windows.focus_window_handle(hwnd: int) -> None` (SW_RESTORE + SetForegroundWindow); `FOCUS_WINDOW` action (`value` = app/window name, fuzzy-matched against titles).

- [ ] **Step 1: Write the failing tests** (append to `test_actions_input.py`)

```python
class TestFocusWindow:
    def _action(self):
        from actions.focus_window import FocusWindowAction
        return FocusWindowAction()

    def test_focuses_best_matching_window(self, monkeypatch):
        focused = []
        monkeypatch.setattr(
            "actions.focus_window.list_windows",
            lambda: [(111, "Counter-Strike 2", 100), (222, "Notepad", 200)],
        )
        monkeypatch.setattr(
            "actions.focus_window.focus_window_handle", lambda hwnd: focused.append(hwnd)
        )
        self._action().execute("counter strike 2", CTX)
        assert focused == [111]

    def test_typo_matches_fuzzily(self, monkeypatch):
        focused = []
        monkeypatch.setattr(
            "actions.focus_window.list_windows", lambda: [(111, "Spotify Premium", 100)]
        )
        monkeypatch.setattr(
            "actions.focus_window.focus_window_handle", lambda hwnd: focused.append(hwnd)
        )
        self._action().execute("spotfy", CTX)
        assert focused == [111]

    def test_no_match_raises(self, monkeypatch):
        monkeypatch.setattr("actions.focus_window.list_windows", lambda: [(111, "Notepad", 100)])
        monkeypatch.setattr(
            "actions.focus_window.focus_window_handle",
            lambda hwnd: pytest.fail("must not focus"),
        )
        with pytest.raises(ValueError):
            self._action().execute("photoshop", CTX)

    def test_empty_value_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("", CTX)
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_input.py -q`
Expected: focus tests fail with `ModuleNotFoundError: No module named 'actions.focus_window'`

- [ ] **Step 3: Upgrade `win_windows.py`** (full new content)

```python
# nexus_desktop/utils/win_windows.py
"""Win32 helpers for enumerating and focusing visible top-level windows."""
import ctypes
import ctypes.wintypes

from utils.name_match import normalize

_SW_RESTORE = 9


def list_windows():
    """Returns [(hwnd, title, pid)] for every visible, titled top-level window."""
    user32 = ctypes.windll.user32
    windows = []

    @ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    def _on_window(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        pid = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        windows.append((hwnd, buffer.value, pid.value))
        return True

    user32.EnumWindows(_on_window, 0)
    return windows


def find_pids_by_window_title(search_term):
    """
    Returns the set of PIDs owning a visible top-level window whose title
    matches `search_term` (normalized substring match). `search_term` must
    already be normalized (lowercase alphanumerics only).
    """
    return {
        pid for _hwnd, title, pid in list_windows()
        if search_term in normalize(title) and pid
    }


def focus_window_handle(hwnd):
    """Restore (if minimized) and bring a window to the foreground."""
    user32 = ctypes.windll.user32
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, _SW_RESTORE)
    user32.SetForegroundWindow(hwnd)
```

(The `_normalize` helper is deleted; `name_match.normalize` replaces it. `close_app`'s behavior through `find_pids_by_window_title` is unchanged.)

- [ ] **Step 4: Implement the action**

```python
# nexus_desktop/actions/focus_window.py
from utils.name_match import best_match
from utils.win_windows import focus_window_handle, list_windows

from .base import Action
from .registry import register_action


@register_action("FOCUS_WINDOW")
class FocusWindowAction(Action):
    prompt_examples = [
        '- "Spotify penceresine geç": {{ "type": "FOCUS_WINDOW", "value": "spotify", "description": "Spotify öne getiriliyor" }}',
    ]
    prompt_hint = (
        "Açık bir uygulamaya tuş göndermeden önce FOCUS_WINDOW ile pencereyi "
        "öne getir."
    )

    def execute(self, value, context):
        if not (value or '').strip():
            raise ValueError("Empty window name")
        windows = list_windows()
        titles = {title: hwnd for hwnd, title, _pid in windows}
        winner = best_match(value, titles.keys())
        if winner is None:
            raise ValueError(f"No window matches: {value!r}")
        focus_window_handle(titles[winner])
```

- [ ] **Step 5: Run the full backend suite, commit**

Run: `../venv/Scripts/python.exe -m pytest tests/ -q` — expected: all green.

```bash
git add nexus_desktop/utils/win_windows.py nexus_desktop/actions/focus_window.py nexus_desktop/tests/test_actions_input.py
git commit -m "feat: FOCUS_WINDOW action with fuzzy title matching"
```

---

### Task 8: MOUSE_CLICK action

**Files:**
- Create: `nexus_desktop/actions/mouse_click.py`
- Test: extend `nexus_desktop/tests/test_actions_input.py`

**Interfaces:**
- Consumes: registry/base.
- Produces: `MOUSE_CLICK` action; `value` = `"X,Y[,button]"` where X/Y are `"50%"`-style percentages (recommended to Gemini) or absolute pixels, button ∈ left (default) | right | double. Coordinates clamp to the primary screen.

- [ ] **Step 1: Write the failing tests** (append to `test_actions_input.py`)

```python
class TestMouseClick:
    def _run(self, monkeypatch, value):
        from actions.mouse_click import MouseClickAction
        events = []
        monkeypatch.setattr("actions.mouse_click.pyautogui.size", lambda: (1920, 1080))
        monkeypatch.setattr(
            "actions.mouse_click.pyautogui.click",
            lambda x, y, button="left": events.append(("click", x, y, button)),
        )
        monkeypatch.setattr(
            "actions.mouse_click.pyautogui.doubleClick",
            lambda x, y: events.append(("double", x, y)),
        )
        MouseClickAction().execute(value, CTX)
        return events

    def test_percent_coordinates(self, monkeypatch):
        assert self._run(monkeypatch, "50%,50%") == [("click", 960, 540, "left")]

    def test_pixel_coordinates_and_right_button(self, monkeypatch):
        assert self._run(monkeypatch, "100, 200, right") == [("click", 100, 200, "right")]

    def test_double_click(self, monkeypatch):
        assert self._run(monkeypatch, "10%,10%,double") == [("double", 192, 108)]

    def test_out_of_range_clamped(self, monkeypatch):
        assert self._run(monkeypatch, "5000,5000") == [("click", 1919, 1079, "left")]

    def test_bad_formats_rejected(self, monkeypatch):
        from actions.mouse_click import MouseClickAction
        monkeypatch.setattr("actions.mouse_click.pyautogui.size", lambda: (1920, 1080))
        for bad in ("", "100", "a,b", "50%,50%,middle", "1,2,3,4"):
            with pytest.raises(ValueError):
                MouseClickAction().execute(bad, CTX)
```

- [ ] **Step 2: Run to verify failure**

Run: `../venv/Scripts/python.exe -m pytest tests/test_actions_input.py -q`
Expected: mouse tests fail with `ModuleNotFoundError: No module named 'actions.mouse_click'`

- [ ] **Step 3: Implement**

```python
# nexus_desktop/actions/mouse_click.py
import pyautogui

from .base import Action
from .registry import register_action

_BUTTONS = ('left', 'right', 'double')


def _parse_coord(part, span):
    part = part.strip()
    try:
        if part.endswith('%'):
            pixel = int(span * float(part[:-1]) / 100)
        else:
            pixel = int(part)
    except ValueError:
        raise ValueError(f"Invalid coordinate: {part!r}")
    return max(0, min(pixel, span - 1))


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
        x = _parse_coord(parts[0], width)
        y = _parse_coord(parts[1], height)
        if button == 'double':
            pyautogui.doubleClick(x, y)
        else:
            pyautogui.click(x, y, button=button)
```

- [ ] **Step 4: Run the full backend suite, commit**

Run: `../venv/Scripts/python.exe -m pytest tests/ -q` — expected: all green.

```bash
git add nexus_desktop/actions/mouse_click.py nexus_desktop/tests/test_actions_input.py
git commit -m "feat: MOUSE_CLICK action with percent/pixel coordinates"
```

---

### Task 9: Frontend tolerance + new enum members

**Files:**
- Modify: `types.ts` (enum + step type widening)
- Modify: `components/CommandPreviewModal.tsx` (styling for the new types)
- Test: run `npx tsc --noEmit` and `npx vitest run` (no test file changes expected)

**Interfaces:**
- Consumes: nothing new from backend (string protocol).
- Produces: `AutomationStep.type: ActionType | (string & {})` — unknown backend types type-check and render with default icon/badge.

- [ ] **Step 1: Widen the types**

In `types.ts`:

```typescript
export enum ActionType {
  LAUNCH_APP = 'LAUNCH_APP',
  CLOSE_APP = 'CLOSE_APP',
  FOCUS_WINDOW = 'FOCUS_WINDOW',
  HOTKEY = 'HOTKEY',
  MOUSE_CLICK = 'MOUSE_CLICK',
  OPEN_URL = 'OPEN_URL',
  COMMAND = 'COMMAND',
  MACRO = 'MACRO',
  WAIT = 'WAIT',
  KEYPRESS = 'KEYPRESS',
  VOLUME_SET = 'VOLUME_SET',
  VOLUME_MUTE = 'VOLUME_MUTE',
  MEDIA_PLAY_PAUSE = 'MEDIA_PLAY_PAUSE',
  MEDIA_NEXT = 'MEDIA_NEXT',
  MEDIA_PREV = 'MEDIA_PREV',
  SYSTEM_POWER = 'SYSTEM_POWER'
}

/** Action types arrive from the backend as strings; unknown ones must not
 *  break rendering. `string & {}` keeps ActionType autocompletion. */
export type ActionTypeValue = ActionType | (string & {});

export interface AutomationStep {
  id: string;
  type: ActionTypeValue;
  value: string;
  description: string;
}
```

- [ ] **Step 2: Fix type errors surfaced by tsc**

Run `npx tsc --noEmit`. `getStepIcon`/`getTypeBadgeStyle` in `CommandPreviewModal.tsx` take `ActionType` — change their parameter type to `ActionTypeValue` (import it) and add cases for the new members:

```typescript
      case ActionType.FOCUS_WINDOW:
      case ActionType.HOTKEY:
      case ActionType.MOUSE_CLICK:
        return <PlayCircle className="text-hud-cyan" size={16} />;
```

and in `getTypeBadgeStyle`:

```typescript
      case ActionType.FOCUS_WINDOW:
      case ActionType.HOTKEY:
      case ActionType.MOUSE_CLICK:
        return 'bg-hud-cyan/10 text-hud-cyan border-hud-cyan/20';
```

Fix any other site tsc flags (e.g. `switch` on the widened type in `App.tsx`/`ButtonGrid.tsx` — string comparisons like `step.type === 'SYSTEM_POWER'` keep compiling unchanged).

- [ ] **Step 3: Verify**

Run (repo root): `npx tsc --noEmit` — expected: clean. `npx vitest run` — expected: 49 passed. `npm run build` — expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add types.ts components/CommandPreviewModal.tsx
git commit -m "feat: frontend tolerance for unknown action types + new enum members"
```

---

### Task 10: CONTRIBUTING.md (EN) + README links

**Files:**
- Create: `CONTRIBUTING.md`
- Modify: `README_EN.md`, `README_TR.md`, `README_DE.md` (one link line each)

**Interfaces:** none (documentation).

- [ ] **Step 1: Write `CONTRIBUTING.md`**

Full required content structure (write real prose for each section — this outline is binding, the wording below is the minimum that must appear):

```markdown
# Contributing to Nexus Remote

## Dev setup
- Python agent: `python -m venv venv`, `venv\Scripts\pip install -r requirements.txt`, run with `venv\Scripts\python.exe nexus_desktop\main.py`. Put `GEMINI_API_KEY="..."` in a repo-root `.env` for AI features.
- Web client: `npm install`, `npm run dev` (HTTPS dev server on :5173).
- Tests: backend `venv\Scripts\python.exe -m pytest nexus_desktop\tests -q`; frontend `npx vitest run` and `npx tsc --noEmit`.

## Architecture in 60 seconds
Phone PWA (React) → HTTPS+token → Flask agent (`nexus_desktop/`) → EventBus →
services. AI commands: PWA sends free text to `/ai/*`; the agent asks Gemini
(server-side key) to produce JSON automation steps; steps come back and are
executed one by one via `/execute`.

## Adding a new action (the open/closed rule)
The system is designed so you ADD files, never modify existing ones.
One action = one file in `nexus_desktop/actions/`:

Include `nexus_desktop/actions/hotkey.py` VERBATIM as the annotated example
(it demonstrates all four elements: registry decorator, prompt_examples,
prompt_hint, allowlist validation raising ValueError), followed by the
`TestHotkey` class from `nexus_desktop/tests/test_actions_input.py` verbatim
as the test template.

Checklist:
1. Create `nexus_desktop/actions/<your_action>.py` — auto-discovered, no
   imports to edit anywhere.
2. Create `nexus_desktop/tests/test_<your_action>.py`.
3. `prompt_examples`/`prompt_hint` teach Gemini your action automatically —
   verify with the prompt snapshot test (`tests/test_ai_prompt.py` passes
   without edits).
4. Frontend: nothing to do. Unknown action types render with a default
   icon. Optionally add an enum member + icon case in
   `components/CommandPreviewModal.tsx` for custom styling.

## Security rules (PRs violating these are rejected)
- Never execute through a shell. `os.startfile` with an allowlisted target
  or `subprocess.run([...], shell=False)` with a fixed argv only.
- User/AI-supplied values are hostile input: validate against allowlists
  (see `actions/hotkey.py`, `actions/command.py`) and raise `ValueError`.
- `actions/_targets.py: PROTECTED_PROCESSES` is non-negotiable for anything
  that touches processes.
- Every Flask route must check the session token; AI routes stay
  server-side-key only.

## Using a stronger model / adding vision
- Model swap: `MODEL_NAME` in `nexus_desktop/services/ai_service.py`; any
  Gemini model your key can access works. For another provider, replace the
  `genai` calls inside `AiService._model`/handlers — the routes and schema
  are provider-agnostic.
- Vision ("computer use"): implement as just another action module (e.g.
  SMART_CLICK): capture screen (pyautogui.screenshot), send to a
  vision-capable model with the goal text, parse coordinates, then reuse
  MOUSE_CLICK's clamping. Extension point, not a rewrite: one new file.

## Branch & PR conventions
- One branch per body of work (`feat/...`, `fix/...`), PRs against `main`.
- All suites green (pytest + vitest + tsc) before requesting review.
```

- [ ] **Step 2: Link from the READMEs**

Add to each README's footer section, in its own language:
- `README_EN.md`: `Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).`
- `README_TR.md`: `Katkılar memnuniyetle karşılanır — bkz. [CONTRIBUTING_TR.md](CONTRIBUTING_TR.md).`
- `README_DE.md`: `Beiträge sind willkommen — siehe [CONTRIBUTING_DE.md](CONTRIBUTING_DE.md).`

(TR/DE files are created in Task 11; the links land now so one task owns each file.)

- [ ] **Step 3: Verify + commit**

Proofread the doc against the real file tree (paths must exist). Then:

```bash
git add CONTRIBUTING.md README_EN.md README_TR.md README_DE.md
git commit -m "docs: CONTRIBUTING guide with open/closed action recipe"
```

---

### Task 11: CONTRIBUTING_TR.md + CONTRIBUTING_DE.md

**Files:**
- Create: `CONTRIBUTING_TR.md`, `CONTRIBUTING_DE.md`

**Interfaces:** none.

- [ ] **Step 1: Translate**

Produce full-fidelity Turkish and German translations of the final `CONTRIBUTING.md` (every section, including the code templates' comments; code identifiers stay English). Use proper diacritics in both languages. Each file starts with a note linking the English original as the authoritative version:
- TR: `> İngilizce orijinal: [CONTRIBUTING.md](CONTRIBUTING.md) (uyuşmazlıkta İngilizce metin geçerlidir).`
- DE: `> Englisches Original: [CONTRIBUTING.md](CONTRIBUTING.md) (bei Abweichungen gilt der englische Text).`

- [ ] **Step 2: Cross-link**

Add a language switcher line at the top of all three CONTRIBUTING files:
`[English](CONTRIBUTING.md) | [Türkçe](CONTRIBUTING_TR.md) | [Deutsch](CONTRIBUTING_DE.md)`

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md CONTRIBUTING_TR.md CONTRIBUTING_DE.md
git commit -m "docs: Turkish and German CONTRIBUTING translations"
```

---

### Task 12: Live verification + finish

**Files:** none (verification only).

- [ ] **Step 1: Full suites**

From `nexus_desktop/`: `../venv/Scripts/python.exe -m pytest tests/ -q` — all green.
From repo root: `npx tsc --noEmit`, `npx vitest run`, `npm run build` — all green.

- [ ] **Step 2: Live smoke test on the host** (agent code, without the phone)

```
../venv/Scripts/python.exe - <<'EOF'
import sys; sys.path.insert(0, '.')
import subprocess, time
from actions import get_action
from actions.base import ActionContext
ctx = ActionContext(bus=None)
subprocess.Popen(["notepad.exe"]); time.sleep(2)
get_action("FOCUS_WINDOW")().execute("notepad", ctx)   # window comes forward
time.sleep(1)
get_action("HOTKEY")().execute("ctrl+s", ctx)          # save dialog opens
time.sleep(1)
get_action("KEYPRESS")().execute("esc", ctx)           # dismiss it
get_action("CLOSE_APP")().execute("notepad", ctx)      # notepad closes
print("live smoke OK")
EOF
```

Expected: Notepad opens, comes to foreground, save dialog flashes, closes; prints `live smoke OK`. (MOUSE_CLICK live check: `get_action("MOUSE_CLICK")().execute("50%,50%", ctx)` — cursor visibly clicks screen center; run it while a harmless window is focused.)

- [ ] **Step 3: Verify the generated prompt one last time**

`../venv/Scripts/python.exe -c "import sys; sys.path.insert(0,'.'); from services.ai_service import _ACTION_TYPES; print(_ACTION_TYPES)"`
Expected: includes CLOSE_APP, FOCUS_WINDOW, HOTKEY, MOUSE_CLICK + all originals (MACRO is intentionally absent — it was never executable by the agent; it exists only in the frontend enum).

- [ ] **Step 4: Push and hand off**

```bash
git push -u origin feat/action-registry
```

Then follow `superpowers:finishing-a-development-branch` (PR via compare URL — `gh` is not installed on this machine). PR must note it stacks on `feat/close-app`.

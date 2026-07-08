[English](CONTRIBUTING.md) | [Türkçe](CONTRIBUTING_TR.md) | [Deutsch](CONTRIBUTING_DE.md)

# Contributing to Nexus Remote

Thanks for wanting to improve Nexus Remote! This guide gets you from a fresh clone to a merged PR. The short version: the project is deliberately built so that most contributions are **new files, not edits** — read the "Adding a new action" section before you touch anything.

## Dev setup

The repo holds two apps: the Python agent that runs on the PC (`nexus_desktop/`) and the React PWA the phone loads (repo root).

- **Python agent:** create a virtualenv and install the requirements, then run the agent from source:

  ```bash
  python -m venv venv
  venv\Scripts\pip install -r requirements.txt
  venv\Scripts\python.exe nexus_desktop\main.py
  ```

  For AI features (voice commands, macro generation), put `GEMINI_API_KEY="..."` in a `.env` file at the repo root. The key stays on the PC; it is never shipped to the phone.

- **Web client:** standard Vite workflow:

  ```bash
  npm install
  npm run dev
  ```

  This starts an HTTPS dev server on :5173 (HTTPS is required so the PWA can talk to the agent's TLS endpoint).

- **Tests:** run both suites from the repo root before opening a PR.

  Backend:

  ```bash
  venv\Scripts\python.exe -m pytest nexus_desktop\tests -q
  ```

  Frontend:

  ```bash
  npx vitest run
  npx tsc --noEmit
  ```

## Architecture in 60 seconds

Phone PWA (React) → HTTPS+token → Flask agent (`nexus_desktop/`) → EventBus → services.

The phone never touches your PC directly: every request carries a session token and goes over TLS to the Flask agent, which publishes work onto an EventBus that the services (system, media, automation, scheduler, …) subscribe to.

AI commands take one extra hop: the PWA sends free text to the `/ai/*` routes; the agent asks Gemini (with a **server-side** API key) to produce JSON automation steps; those steps come back to the phone and are executed one by one via `/execute`. The AI never runs anything itself — it only proposes typed steps that the action layer validates.

## Adding a new action (the open/closed rule)

The system is designed so you **ADD files, never modify existing ones**. One action = one file in `nexus_desktop/actions/`. Every module in that package (except underscore-prefixed helpers like `_targets.py`) is auto-discovered at import time, registers itself via the `@register_action` decorator, and from that moment on:

- the `/execute` dispatcher can run it,
- the Gemini system prompt automatically includes its examples and hints,
- the frontend renders it (with a default icon if it has no custom one).

Here is `nexus_desktop/actions/hotkey.py` verbatim — it is the reference implementation because it demonstrates all four elements you need: the registry decorator, `prompt_examples`, `prompt_hint`, and allowlist validation that raises `ValueError` on hostile input:

```python
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

A few notes on what you are looking at:

- `@register_action("HOTKEY")` is the *only* wiring. There is no dispatch table, no import list, no enum to extend on the backend.
- `prompt_examples` lines use doubled `{{ }}` braces on purpose — `services/ai_service.py` unescapes them to `{ }` when it builds the Gemini system prompt. Keep that convention in your own examples. (The examples are in Turkish because the shipped system prompt is Turkish; match it.)
- `execute` treats `value` as hostile: everything is checked against `_ALLOWED_KEYS` and rejected with `ValueError` *before* anything touches the OS. The dispatcher turns `ValueError` into a clean client error.

And here is the matching test template — the `TestHotkey` class from `nexus_desktop/tests/test_actions_input.py`, verbatim (the `CTX` fixture at the top of that file is `ActionContext(bus=None)` from `actions.base`):

```python
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

The pattern: monkeypatch the OS-touching call (`pyautogui.hotkey` here) so nothing real happens, assert the happy path forwards the right arguments, and assert every hostile input raises `ValueError` **without** the OS call ever running.

### Checklist

1. Create `nexus_desktop/actions/<your_action>.py` — auto-discovered, no imports to edit anywhere.
2. Create `nexus_desktop/tests/test_<your_action>.py` following the template above.
3. `prompt_examples`/`prompt_hint` teach Gemini your action automatically — verify with the prompt snapshot test (`tests/test_ai_prompt.py` passes without edits).
4. Frontend: nothing to do. Unknown action types render with a default icon. Optionally add an enum member + icon case in `components/CommandPreviewModal.tsx` for custom styling.

## Security rules (PRs violating these are rejected)

This app accepts natural-language commands from a phone and lets an LLM turn them into actions on someone's PC. The rules below are what keep that from being a remote-code-execution service:

- **Never execute through a shell.** Use `os.startfile` with an allowlisted target, or `subprocess.run([...], shell=False)` with a fixed argv only. String-built commands, `shell=True`, `os.system` — instant rejection.
- **User/AI-supplied values are hostile input.** Validate against allowlists (see `actions/hotkey.py`, `actions/command.py`) and raise `ValueError` on anything unexpected. Gemini output is untrusted input like any other.
- **`actions/_targets.py: PROTECTED_PROCESSES` is non-negotiable** for anything that touches processes. No action may ever terminate `csrss`, `lsass`, the agent's own `python` process, etc., no matter what name the AI produces.
- **Every Flask route must check the session token**; AI routes stay server-side-key only. The Gemini API key never leaves the PC and never appears in the frontend bundle.

## Using a stronger model / adding vision

- **Model swap:** change `MODEL_NAME` in `nexus_desktop/services/ai_service.py` (currently `"gemini-2.5-flash"`); any Gemini model your key can access works. For another provider entirely, replace the `genai` calls inside `AiService._model`/handlers — the routes and the JSON step schema are provider-agnostic, so nothing else changes.
- **Vision ("computer use"):** implement it as just another action module (e.g. `SMART_CLICK`): capture the screen (`pyautogui.screenshot`), send it to a vision-capable model with the goal text, parse the returned coordinates, then reuse MOUSE_CLICK's clamping to keep clicks on-screen. It's an extension point, not a rewrite: one new file.

## Branch & PR conventions

- One branch per body of work (`feat/...`, `fix/...`), PRs against `main`.
- All suites green (pytest + vitest + tsc) before requesting review — the commands from the Dev setup section, exactly as written there.

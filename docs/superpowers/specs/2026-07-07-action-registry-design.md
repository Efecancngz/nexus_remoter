# Extensible Action Registry + New Input Actions — Design

## Problem

Adding a new agent action today requires editing three places in lockstep:
the `if/elif` chain in `automation_service._execute_action`, the
`_ACTION_TYPES` list plus prompt examples in `ai_service`, and the frontend
`ActionType` enum. The user wants the architecture to follow the open/closed
principle — a contributor adds a file, edits nothing — documented in a
CONTRIBUTING guide (EN/TR/DE), and wants the in-app control capabilities
that a plain Gemini API key supports (blind keyboard/window/mouse actions)
implemented now, with vision/"computer use" documented as an extension point
for contributors who bring stronger models.

## Scope

In scope:
1. `nexus_desktop/actions/` package: decorator registry + auto-discovery;
   all 12 existing action types migrate into it.
2. New actions: `HOTKEY`, `FOCUS_WINDOW`, `MOUSE_CLICK`.
3. Fuzzy name resolution (`difflib`, stdlib) shared by launch/close/focus.
4. AI prompt and action-type list generated from the registry.
5. Frontend tolerance for unknown action types.
6. `CONTRIBUTING.md` + `CONTRIBUTING_TR.md` + `CONTRIBUTING_DE.md`.

Out of scope (YAGNI, documented as extension points instead):
- Vision/screenshot-based actions (SMART_CLICK etc.).
- pip-installable plugin system / entry points.
- Any change to pairing, TLS, or transport.

## Design

### 1. Actions package (open/closed core)

```
nexus_desktop/actions/
  __init__.py      # auto-discovery: pkgutil.iter_modules → import all
  registry.py      # @register_action, get_action, all_actions
  base.py          # Action protocol/base class
  launch_app.py    # one file per action type…
  close_app.py
  system_power.py
  keypress.py
  hotkey.py        # new
  focus_window.py  # new
  mouse_click.py   # new
  open_url.py
  command.py
  wait.py
  volume.py        # VOLUME_SET + VOLUME_MUTE (same domain, one module)
  media.py         # MEDIA_PLAY_PAUSE / NEXT / PREV
```

- `registry.py`: `register_action("TYPE")` class decorator stores the class
  in a module-level dict. Duplicate registration raises at import time.
- Each action class defines:
  - `execute(self, value: str, context: ActionContext) -> None` — raises on
    failure (same contract as today; `ACTION_FAILED` is published by the
    dispatcher).
  - `prompt_examples: list[str]` — Turkish example lines for the Gemini
    system prompt (may be empty for internal-only actions).
  - `prompt_hint: str = ""` — optional rule sentence appended to the prompt
    (e.g. "Tuş kombinasyonları için HER ZAMAN HOTKEY kullan").
- `ActionContext` is a small dataclass carrying what actions need from the
  host — today just the event bus. Volume/media action modules are thin:
  they publish the existing `VOLUME_SET`/`MEDIA_*` bus events that
  `MediaService` already subscribes to (pycaw logic stays where it is).
  This also removes the per-type `if/elif` router in
  `api_service.execute_command`: every action type is published as
  `COMMAND_RECEIVED` (only `SCHEDULE_ACTION`, which is not an action
  module, keeps its dedicated route). Result: `api_service` no longer
  enumerates action types either.
- `actions/__init__.py` imports every sibling module on package import, so
  dropping a new `.py` file in the folder is the entire integration step.

### 2. Dispatcher

`AutomationService._execute_action` becomes: look up `get_action(type)`,
instantiate/execute with context, publish `ACTION_COMPLETED`/`ACTION_FAILED`
exactly as today. Unknown type → `ACTION_FAILED` with a clear error (today
it silently succeeds — this is a deliberate behavior fix). The existing
public helper methods (`launch_app`, `close_app`, `run_allowlisted`,
`press_key`, `handle_system_power`) move into their action classes; tests
migrate with them.

### 3. AI prompt generated from the registry

`ai_service` builds at startup:
- `_ACTION_TYPES = sorted(all_actions().keys())` (feeds both the prompt and
  the response schema enum).
- The example block of `_MACRO_INSTRUCTION` = concatenation of every
  action's `prompt_examples`, plus each non-empty `prompt_hint`.
The fixed parts of the prompt (persona, JSON-only rule, WAIT-between-steps
rule, no-raw-shell rule) stay as the static template. Result: a new action
file automatically teaches Gemini about itself.

### 4. New actions

- **HOTKEY** — `value: "ctrl+s"` (keys joined by `+`). Each key must be in
  an allowlist (letters, digits, f1–f24, and the named keys pyautogui
  supports: ctrl, alt, shift, win, enter, tab, esc, space, arrows, home,
  end, pgup, pgdn, delete, backspace, media keys). Reject otherwise.
  Executes `pyautogui.hotkey(*keys)`.
- **FOCUS_WINDOW** — `value: app/window name`. Resolves via window-title
  fuzzy match (extended `utils/win_windows.py`: enumerate visible top-level
  windows with titles → `best_match`). Brings the window forward:
  `ShowWindow(SW_RESTORE)` if minimized + `SetForegroundWindow`. Raises if
  no window matches.
- **MOUSE_CLICK** — `value: "X,Y[,button]"`. `X`/`Y` are either percentages
  (`"50%,50%"` — resolution-independent, the form the prompt recommends to
  Gemini) or absolute pixels (`"960,540"`). `button` ∈ left (default),
  right, double. Coordinates are clamped to the virtual screen. Executes
  via `pyautogui.click` / `doubleClick`.

### 5. Fuzzy name resolution

`utils/name_match.py` — `best_match(query, candidates) -> (candidate, score) | None`:
1. normalize both sides (lowercase, strip non-alphanumerics — the existing
   `_normalize` logic centralizes here),
2. exact normalized match wins (score 1.0),
3. else substring match (shortest candidate wins),
4. else `difflib.SequenceMatcher` ratio; accept the best candidate only if
   ratio ≥ 0.75, otherwise return None (failing loudly beats closing or
   focusing the wrong app).

Consumers: `find_installed_app` (Start Menu + Steam), `CLOSE_APP` process
and window matching, `FOCUS_WINDOW`. The existing guard that short queries
(< 4 chars) require exact match is kept for process names.

### 6. Frontend tolerance

- `types.ts`: `AutomationStep.type` widens to `ActionType | string`; the
  enum itself gains `HOTKEY`, `FOCUS_WINDOW`, `MOUSE_CLICK` (for styling),
  but unknown strings must type-check end-to-end.
- `CommandPreviewModal` already default-cases unknown types; verify the
  other switch sites (`App.tsx`, `ButtonGrid`) tolerate unknown strings.
- Net effect: future backend-only actions need zero frontend edits.

### 7. CONTRIBUTING docs (EN master + TR + DE translations)

Sections:
1. Dev setup (venv, npm, running agent + PWA) and test commands
   (pytest, vitest, tsc).
2. **"Add an action in one file"** — annotated template of an action module
   (registry decorator, `execute`, `prompt_examples`, `prompt_hint`) plus a
   test template; checklist: file + test, nothing else to edit.
3. Security rules that PRs must respect: no shell execution, allowlist
   principle, `_PROTECTED_PROCESSES`, token auth on all routes, no raw hex
   in frontend components (HUD tokens).
4. **Extension points for stronger models**: where `MODEL_NAME` lives, how
   to swap the Gemini model or provider inside `ai_service`, and a sketch
   of how a vision-based action (screenshot → model → coordinates) would
   slot in as just another action module — add, don't modify.
5. Branch/PR conventions (feature branch per body of work, tests green).

`CONTRIBUTING_TR.md` and `CONTRIBUTING_DE.md` are full translations; the
three READMEs each link to the matching CONTRIBUTING file.

## Error handling

- Unknown action type, invalid hotkey key, unparseable coordinates, or a
  fuzzy score below threshold all raise `ValueError` with a message naming
  the offending value → surfaced as `ACTION_FAILED` (and logged), never a
  silent no-op.
- Registry double-registration and a module that fails to import raise at
  agent startup (fail fast, visible in the log).

## Testing

- Registry: discovery finds all modules; duplicate registration raises;
  unknown type dispatch publishes `ACTION_FAILED`.
- Every migrated action keeps its existing tests (moved, not weakened);
  security-sensitive tests (COMMAND allowlist, protected processes,
  SYSTEM_POWER argv) must remain byte-equivalent in intent.
- New: HOTKEY allowlist accept/reject, MOUSE_CLICK parsing (%, px, button,
  clamp), FOCUS_WINDOW match/no-match, `best_match` tier ordering and the
  0.75 threshold, prompt-built-from-registry contains every type.
- `ai_service` prompt snapshot test: every registered type appears in
  `_ACTION_TYPES` and the schema enum.
- Suites: backend pytest (currently 144), frontend vitest (49) + tsc all
  green.
- Live verification on the host: HOTKEY (`ctrl+s` in Notepad opens save
  dialog — then esc), FOCUS_WINDOW brings a background window forward,
  MOUSE_CLICK at `50%,50%`.

## Milestones (implementation order)

1. Registry + base + migrate existing 12 actions, dispatcher swap (tests
   green, pure refactor).
2. Prompt generation from registry.
3. `name_match.py` + wire into search/close.
4. New actions HOTKEY / FOCUS_WINDOW / MOUSE_CLICK (+ frontend enum/types
   widening).
5. CONTRIBUTING EN/TR/DE + README links.

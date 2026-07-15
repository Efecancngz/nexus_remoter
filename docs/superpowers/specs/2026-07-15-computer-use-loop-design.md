# Computer-Use Loop (act→observe) — Design

**Date:** 2026-07-15
**Roadmap item:** #4b (builds on #4a vision smart-click)
**Branch:** `feat/computer-use-loop`

## Goal

Give the AI a high-level goal in Turkish (e.g. "Chrome'u aç ve kedi ara") and let it
pursue that goal over multiple iterations. Each iteration the PC observes the screen,
Gemini decides the single next action, the phone shows it and executes it, and the loop
repeats until the goal is done, a step cap is hit, an error occurs, or the user stops it.

This turns the #4a primitive (screenshot → locate → click, one closed transaction) into a
bounded autonomous loop.

## Architecture

**Phone drives, PC decides one step.** Reuses the #4a pattern — the phone is the brain
and holds the loop; the PC is the hands and vision. No server-side loop, no streaming.

### New PC route: `POST /ai/next-action`

Registered on the Flask app alongside the other `/ai/*` routes in `AiService`.

**Request body:**

```json
{
  "goal": "Chrome'u aç ve kedi ara",
  "history": [
    { "type": "LAUNCH_APP", "description": "Chrome açıldı" },
    { "type": "MOUSE_CLICK", "description": "Adres çubuğuna tıklandı" }
  ]
}
```

- `goal` — required, non-empty (400 on empty/blank).
- `history` — list of already-executed actions (`type` + `description` only). Gives Gemini
  context without re-deriving prior steps. May be empty on the first iteration.

**PC does:**

1. `_guard()` — 401 unauthorized / 503 AI disabled (identical to sibling routes).
2. Validate `goal` non-empty → 400 otherwise.
3. `capture_jpeg_bytes()` — screenshot the current screen (reused from #4a).
4. Gemini vision call: system instruction (Turkish) + screenshot + goal + serialized history.
5. Parse the structured response and return it.

**Response — exactly one of:**

```json
{ "success": true, "done": false,
  "thought": "Adres çubuğuna tıklamam gerek",
  "action": { "type": "MOUSE_CLICK", "value": "50%,8%", "description": "Adres çubuğuna tıkla" } }
```

```json
{ "success": true, "done": true, "summary": "Kedi araması tamamlandı" }
```

- `action.type` is constrained to the existing action-registry enum (`_ACTION_TYPES`, the
  same enum `/ai/macro` uses).
- `action.value` is returned in executor-ready format. For clicks, Gemini returns
  normalized `0–1000` coordinates that the route maps to **clamped percent** using the same
  `_clamp_pct(v / 10.0)` scheme as #4a, then formats as `"x%,y%"`. This reuses
  `parse_coord`, which already handles float percents.
- `thought` — one short Turkish sentence explaining the chosen action (shown in the phone
  loop log).

**Status contract (identical to the other `/ai/*` routes):**

- 401 unauthorized, 503 AI disabled, 400 validation (empty goal), 502 Gemini/parse error.

### Gemini response schema

The route uses a `response_schema` so Gemini returns structured JSON:

```
{
  done:    BOOLEAN   (required)
  thought: STRING
  type:    STRING (enum = _ACTION_TYPES)
  value:   STRING
  x:       INTEGER   (0–1000, only meaningful for click actions)
  y:       INTEGER   (0–1000, only meaningful for click actions)
  summary: STRING
}
```

The handler assembles the public response from these fields:
- `done: true` → return `{ success, done: true, summary }`.
- `done: false` → build `action`. For click types, `value = f"{clamp(x/10)}%,{clamp(y/10)}%"`;
  for non-click types, `value` is used as returned. Return
  `{ success, done: false, thought, action: { type, value, description } }` where
  `description = thought` (the human-readable label).

A flat schema (rather than a nested `action` object) is used because it maps cleanly to
Gemini's `response_schema` shape, matching how `_LOCATE_SCHEMA` is defined in #4a.

### New phone client: `nextAction(ip, token, goal, history)`

Added to `services/gemini.ts`, mirroring `locate()`. Posts `{ goal, history }` to
`/ai/next-action` via the existing `callAgent` helper (which already maps 401 →
`AUTH_REQUIRED`, 503 → config error, and `data.error` otherwise). Returns a typed object:

```ts
{ done: boolean; thought?: string; action?: AutomationStep; summary?: string }
```

### New component: `AgentLoopPanel.tsx`

Rendered in the AI tab, below `SmartClickPanel`. Props `{ ip, token, onToast }`, matching
the SmartClickPanel convention.

**UI:**
- Goal `<input>` + **START** button (one approval to begin the whole loop).
- A live step log: `1/15`, `2/15`, … each row shows the `thought`, the action label, and
  per-step status (running / done / failed).
- An **always-visible STOP** button while the loop runs.

**Loop behavior:**
1. On START, initialize `history = []`, `step = 0`, `running = true`.
2. Call `nextAction(ip, token, goal, history)`.
3. If `done` → toast the `summary`, stop.
4. Else render `thought` + action, then `executor.run([action], ip, token)`.
5. If the executor fails → toast the error, stop.
6. Append `{ type, description }` to `history`, increment `step`.
7. If `step >= 15` → toast "adım sınırına ulaşıldı", stop.
8. If the user pressed STOP → stop between iterations.
9. Otherwise loop back to step 2.

All strings Turkish. Reuses `HudPanel`, `executor`, and lucide icons per SmartClickPanel.

## Safety / Termination

Autonomous but bounded:
- Every proposed step renders on the phone (thought + action label) as the loop runs, so
  the user sees what is happening.
- **STOP** halts the loop immediately between iterations.
- A **hard cap of 15** iterations prevents runaway loops and token burn.
- Any executor error halts the loop and surfaces a toast.
- Same token guard as every other action — the loop grants no privilege a token-holder
  did not already have via `/execute`.

STOP takes effect between iterations (it does not abort an in-flight `/execute`); an
individual action is short, so this is acceptable.

## Testing

**Backend** (`nexus_desktop/tests/test_ai_service.py`, appended):
- 401 unauthorized, 503 AI disabled, 400 empty goal.
- `done: true` → response passes `summary` through, no `action`.
- `done: false` non-click action → `value` passed through, `description = thought`.
- `done: false` click action → `x/y` mapped to clamped percent `"x%,y%"` (e.g. 500→50.0,
  1200→100.0).
- 502 on Gemini/parse error.

**Frontend:**
- `services/gemini.test.ts` — `nextAction` cases (done passthrough, action passthrough,
  401 → `AUTH_REQUIRED`).
- `components/AgentLoopPanel.test.tsx` — loop runs to `done`, STOP halts mid-loop, step cap
  enforced, executor error halts. Uses `vi.spyOn` on `gemini.nextAction` and `executor.run`,
  with `afterEach(cleanup)` (project has no vitest setupFiles).

## Global Constraints

- No new dependencies.
- Reuse `capture_jpeg_bytes`, `_clamp_pct`, `parse_coord`, `executor`, `callAgent`,
  `HudPanel`.
- Turkish user-facing strings and Gemini system instruction.
- Token-guarded: 401 / 503 / 400 / 502 contract identical to sibling `/ai/*` routes.
- Click coordinates use the `0–1000 → clamped percent → "x%,y%"` scheme from #4a.
- No Co-Authored-By trailer.
- Branch: `feat/computer-use-loop`.

## Out of Scope (deferred)

- Confirm-per-step or risk-tiered confirmation (chose autonomous + STOP + cap).
- Server-side loop / streaming progress.
- Aborting an in-flight action mid-execution.
- Persisting or replaying loop transcripts.

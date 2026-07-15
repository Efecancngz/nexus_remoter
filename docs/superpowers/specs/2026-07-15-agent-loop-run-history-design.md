# Agent-Loop Run History + Replay — Design

**Date:** 2026-07-15
**Roadmap item:** #5b (second slice of #5 "Agent-loop UX depth", built on #4b/#5a)
**Branch:** `feat/agent-run-history`

## Goal

Persist each agent-loop run that reaches a terminal state, and let the user revisit a
past run (its goal, outcome, and text step list) and **replay** it — re-running the saved
goal so the agent re-observes the live screen and picks fresh steps.

This is the second slice of "agent-loop UX depth". The loop from #4b is ephemeral: once a
run ends, the log is gone the moment a new run clears it. This slice gives the loop a
memory.

## Background

The app already persists state via `localStorage` + `JSON` (`App.tsx` `STORAGE_KEY`, plus
individual keys like `nexus_voice_feedback`). Runs are stored the same way: text only, no
thumbnails — a single run with 15 screenshots would be ~2 MB against a ~5 MB quota, so
images are deliberately excluded (thumbnails-in-history is a later slice needing IndexedDB).

**Replay semantics = "re-run the goal"** (locked with the user): replay feeds the saved
goal back into `handleStart`; the agent re-observes and re-decides. We therefore only need
to store the goal for replay to work — the step list is for the user to read, not to play
back literally (literal coordinate playback is brittle and out of scope).

## Data model (localStorage, key `nexus_agent_runs`)

```ts
type RunOutcome = 'completed' | 'failed' | 'stopped' | 'capped';

interface AgentRunStep {
  thought: string;
  label: string;                 // "TYPE: value", same as the live log row
  status: 'done' | 'failed';
}

interface AgentRun {
  id: string;                    // crypto.randomUUID() with the existing fallback
  goal: string;
  startedAt: number;             // Date.now() at run start
  outcome: RunOutcome;
  detail?: string;               // summary text (completed) or error text (failed)
  steps: AgentRunStep[];
}
```

Steps are the existing loop log rows minus the `image` field — no new structured
extraction. Newest first; **cap to 20 runs** (oldest dropped on overflow).

## Architecture

No backend change, no new routes, no new dependencies. One localStorage-backed hook, one
new presentational component, and additive recording inside the existing loop.

### Persistence — new hook `hooks/useAgentRuns.ts`

`useAgentRuns()` → `{ runs, addRun(run), clearRuns() }`:

- Initial state reads `localStorage.getItem('nexus_agent_runs')` and `JSON.parse`s it inside
  a try/catch (corrupt/missing → `[]`), mirroring the guarded parse in `App.tsx`.
- `addRun(run)` prepends and trims to 20, then persists.
- `clearRuns()` empties and persists.
- A `useEffect` (or write-through in the setters) keeps localStorage in sync.

### Recording — `components/AgentLoopPanel.tsx` (the loop)

The loop already accumulates its step log. Recording is **purely additive** — the #4b
concurrency machinery (`runIdRef`, `stale()`, `stopRef`, STOP, cap, `history`) stays
byte-for-byte the same. Add inside `handleStart`:

- Local `outcome: RunOutcome` and `detail?: string`, set at each termination branch:
  - `res.done` → `completed`, `detail = res.summary`
  - executor failure → `failed`, `detail = exec.error`
  - cap reached (`step === MAX_STEPS - 1` after a success) → `capped`
  - STOP / stale checkpoint break → `stopped`
  - `catch` → `failed`, `detail = e.message`
- A local step accumulator (`recorded: AgentRunStep[]`) mirroring what is pushed to
  `setLog` — pushed alongside each running row and its status updated the same way
  `markLast` updates the log — so the run can be recorded from the `finally` **without**
  reading stale React state.
- In the `finally`, guarded by the existing `!stale()`: if the run actually started a step
  (`recorded.length > 0`), call `addRun({ id, goal: value, startedAt, outcome, detail, steps: recorded })`.
  A superseded (stale) run never records.

`handleStart` is refactored to accept an optional `goalArg?: string` (`const value =
(goalArg ?? goal).trim()`), so replay is a plain call with the saved goal.

### Replay — wiring

Replay calls a small handler in `AgentLoopPanel`:

```ts
const handleReplay = (savedGoal: string) => {
  if (running) return;
  setGoal(savedGoal);       // reflect it in the input
  handleStart(savedGoal);   // start immediately with the explicit goal
};
```

Passing the goal explicitly avoids the async-state pitfall (relying on `setGoal` before
reading `goal`).

### History UI — new component `components/AgentRunHistory.tsx`

Rendered by `AgentLoopPanel` below the live log. Props `{ runs, onReplay, onClear }`:

- A "Geçmiş" list; each row shows the goal, a relative timestamp, step count, and an
  outcome marker (✓ completed / ✗ failed / ■ stopped / ⏱ capped) with matching color.
- Tapping a row expands its text step list (thought + label + per-step ✓/✗).
- Each row has a **Tekrar Çalıştır** button → `onReplay(run.goal)`, disabled while a loop
  is running (`running` passed down or the button simply calls a guarded handler).
- The section has a **Geçmişi Temizle** action → `onClear()`.
- Empty state: nothing rendered when `runs` is empty.
- Turkish strings; reuses `HudPanel`/existing styling conventions.

## Testing

**Hook** (`hooks/useAgentRuns.test.ts`, new; `afterEach(cleanup)` + clear localStorage):
- Loads `[]` when the key is empty; loads `[]` when the stored value is corrupt JSON.
- `addRun` prepends (newest first) and persists to `localStorage`.
- `addRun` caps at 20 (21st drops the oldest).
- `clearRuns` empties and persists.

**Recording** (`components/AgentLoopPanel.test.tsx`, appended):
- A run that reaches `done` records one run with `outcome:'completed'` and its steps.
- A STOP records `outcome:'stopped'`.
- An executor failure records `outcome:'failed'`.
- A superseded (stale) run does **not** record (`addRun` not called for it).

**History component** (`components/AgentRunHistory.test.tsx`, new; `afterEach(cleanup)`):
- Renders a row per run with goal + outcome marker.
- Tapping a row expands its step list.
- **Tekrar Çalıştır** fires `onReplay` with the run's goal.
- Replay is disabled/no-op while a loop is running.
- **Geçmişi Temizle** fires `onClear`.

## Global Constraints

- No new dependencies; localStorage + JSON like the rest of the app.
- The #4b loop concurrency logic (`runIdRef`/`stale()`/`stopRef`, STOP, cap, `history`)
  stays unchanged except the additive recording.
- Turkish user-facing strings; `alt`/`aria` text Turkish.
- The `/ai/next-action` contract is untouched (no backend change).
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/agent-run-history`.

## Out of Scope (deferred to later #5 slices)

- Per-step thumbnails in history (needs IndexedDB — its own slice).
- Literal step/coordinate playback.
- Pausing/resuming a run; editing a saved run.
- Cross-device sync of history.
- Renaming/pinning/searching runs.

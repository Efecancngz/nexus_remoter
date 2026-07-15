# Agent-Loop Pause / Resume — Design

**Date:** 2026-07-15
**Roadmap item:** #5c (third slice of #5 "Agent-loop UX depth", built on #4b/#5a/#5b)
**Branch:** `feat/agent-loop-pause`

## Goal

Add a **Pause** control that suspends the agent loop between steps, and a **Resume**
control that continues it. Pause is distinct from STOP: STOP ends the run (and records it
to history per #5b); Pause holds the run alive so it can continue later.

## Background

The #4b loop (`components/AgentLoopPanel.tsx` `handleStart`) runs a bounded `for` loop
(`MAX_STEPS = 15`). Each iteration: (1) `nextAction(...)` — screenshot + ask Gemini for one
action; (2) `executor.run([action], ...)` — execute it on the PC. The loop uses a
generation-token concurrency pattern (`runIdRef` + `stale = () => runIdRef.current !==
myRunId` + `stopRef`) so a stopped-then-restarted run cannot resume and corrupt a newer
run. Recording (#5b) happens in the loop's `finally`, guarded by `!stale()`.

A step in flight cannot be frozen mid-execution safely. Pause therefore takes effect at a
step boundary: the current step finishes, then the loop holds before requesting the next
action ("finish current step, then hold").

## Loop states

Three states instead of two: **idle → running → paused → running → …**, with STOP ending
from either active state. `running` stays `true` while paused (the run is alive); a new
`paused` boolean layers on top of it.

- `!running` → **Başlat** (Start)
- `running && !paused` → **Duraklat** (Pause) + **Durdur** (STOP)
- `running && paused` → **Devam** (Resume) + **Durdur** (STOP)

The goal input stays disabled whenever `running` is true (paused or not).

## Architecture

Pause is purely additive to the existing loop. The `runIdRef` / `stale()` / `stopRef`
guards stay byte-for-byte. Two new refs and one new state flag.

### New refs and state (`components/AgentLoopPanel.tsx`)

- `const [paused, setPaused] = useState(false)`
- `const pauseRef = useRef(false)` — read inside the loop (avoids stale-closure reads).
- `const resumeRef = useRef<(() => void) | null>(null)` — holds the resolver of the
  barrier promise while the loop is parked.

### Pause barrier (loop-top only)

After the existing loop-top stop/stale checkpoint, the loop awaits a barrier:

```ts
const waitWhilePaused = async () => {
  while (pauseRef.current && !stopRef.current && !stale()) {
    await new Promise<void>(resolve => { resumeRef.current = resolve; });
  }
  resumeRef.current = null;
};
```

Loop top becomes:

```ts
for (let step = 0; step < MAX_STEPS; step++) {
  if (stopRef.current || stale()) { outcome = 'stopped'; break; }
  await waitWhilePaused();
  if (stopRef.current || stale()) { outcome = 'stopped'; break; }
  const res = await nextAction(ip, token, value, history);
  // ... unchanged ...
}
```

Because the barrier sits at the loop top, any in-flight `nextAction` + `executor.run` from
the current step completes before the hold. After the barrier the loop re-checks
`stopRef`/`stale()`, so a run stopped or superseded while paused exits cleanly and never
resumes.

### Handlers

- `handlePause`: `pauseRef.current = true; setPaused(true);`
- `handleResume`: `pauseRef.current = false; setPaused(false); resumeRef.current?.(); resumeRef.current = null;`
- `handleStop` (extended — existing lines plus): `pauseRef.current = false; resumeRef.current?.(); resumeRef.current = null;` so a paused loop unblocks and hits its stop check.
- `handleStart` (top, additive): `pauseRef.current = false; setPaused(false);` so a fresh
  run never starts paused.

### UI (`components/AgentLoopPanel.tsx` render)

Replace the single running/idle button branch with the tri-state above. Pause and Resume
are new buttons; STOP (Durdur) is shown whenever `running`. Use existing button styling
conventions and a lucide icon each (e.g. `Pause` / `Play` for resume).

## Interactions (verified, no change required)

- **Step cap:** paused time consumes no steps — the `for` counter only advances on
  executed steps, and the barrier does not increment it.
- **#5b recording:** pause is not terminal; nothing records until the run ends
  (resume → `completed`, or STOP-while-paused → `stopped`). The `finally` recording block is
  untouched, still `!stale()`-guarded.
- **Replay (#5b):** `handleReplay` already returns early `if (running)`, so replay stays
  blocked while paused.

## Testing (`components/AgentLoopPanel.test.tsx`, appended)

- **Pause holds the loop:** after Pause is clicked between steps, no further `nextAction`
  call is made until Resume.
- **Resume continues:** after Resume, the loop issues the next `nextAction`.
- **STOP while paused ends the run:** records `outcome:'stopped'` and the control returns to
  Başlat (Start).
- **Pause → STOP → restart does not resume the old run:** the superseded paused run issues
  no further `nextAction` after the new run starts (stale guard).
- **Cap still enforced across a pause/resume cycle:** the loop stops at `MAX_STEPS` and warns.
- **Button transitions render:** running shows Duraklat + Durdur; after Pause shows Devam +
  Durdur; after Resume shows Duraklat + Durdur.

All existing AgentLoopPanel tests must continue to pass unchanged in intent.

## Global Constraints

- No new dependencies.
- The #4b loop concurrency logic (`runIdRef`/`stale()`/`stopRef`, cap, `history`) and the
  #5b recording block stay byte-for-byte except the additive pause barrier and handlers.
- Turkish user-facing strings: "Duraklat" (Pause), "Devam" (Resume); existing "Başlat" /
  "Durdur" unchanged.
- No backend change; `/ai/next-action` contract untouched.
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/agent-loop-pause`.
- Frontend tests from repo root: `npx vitest run`; typecheck `npx tsc --noEmit`; build
  `npm run build`.
- Vitest has no auto-cleanup — RTL tests use explicit `afterEach(cleanup)`.

## Out of Scope (deferred)

- Mid-step interruption (freezing during `executor.run`).
- Auto-pause on a timer or on a specific action type.
- Persisting a paused run across app reloads / navigation.
- A separate "paused" entry in run history (pause is not a terminal outcome).

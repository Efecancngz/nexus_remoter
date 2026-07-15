# Agent-Loop Pause / Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Pause/Resume controls to the agent loop that suspend and continue it between steps, distinct from STOP.

**Architecture:** Purely additive to the existing #4b loop in `components/AgentLoopPanel.tsx`. A `pauseRef` + a resolver-backed `waitWhilePaused()` barrier at the loop top parks the loop between steps; Pause/Resume/Stop handlers drive it. A new `paused` state flag toggles a tri-state button row. The concurrency guards and #5b recording stay byte-for-byte.

**Tech Stack:** React 19 + TypeScript, Vitest 4 + React Testing Library (jsdom), lucide-react.

## Global Constraints

- No new dependencies.
- The #4b loop concurrency logic (`runIdRef`/`stale()`/`stopRef`, `MAX_STEPS` cap, `history`) and the #5b recording block stay byte-for-byte except the additive pause barrier and handlers.
- Turkish strings: "Duraklat" (Pause), "Devam" (Resume); existing "Başlat"/"Durdur" unchanged.
- No backend change; `/ai/next-action` contract untouched.
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/agent-loop-pause`.
- Frontend tests from repo root: `npx vitest run`; typecheck `npx tsc --noEmit`; build `npm run build`.
- Vitest has no auto-cleanup — RTL tests use explicit `afterEach(cleanup)` (already present in the test file).

---

## File Structure

- Modify: `components/AgentLoopPanel.tsx` — add `paused` state + `pauseRef`/`resumeRef`, the `waitWhilePaused` barrier in `handleStart`, `handlePause`/`handleResume`, extend `handleStop`/`handleStart`, tri-state button row.
- Modify: `components/AgentLoopPanel.test.tsx` — append pause/resume tests.

---

## Task 1: Pause / Resume the agent loop

**Files:**
- Modify: `components/AgentLoopPanel.tsx`
- Test: `components/AgentLoopPanel.test.tsx`

**Interfaces:**
- Consumes: existing `handleStart`/`handleStop`/`handleReplay`, `useAgentRuns`, `nextAction`, `executor.run` (all already in the file).
- Produces: no new public interface (self-contained panel change).

**Notes:** The current `handleStart` is the #5b version (loop with `stale()`/`stopRef` guards and `finally` recording). Pause is additive: add the barrier at the loop top after the existing checkpoint, and never touch the guards or recording.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `describe('AgentLoopPanel', ...)` block in `components/AgentLoopPanel.test.tsx` (the file already imports `AGENT_RUNS_KEY`, `AgentRun`, has `startWithGoal`, `clickAction`, `storedRuns()`, and clears localStorage in before/after each):

```ts
  it('holds the loop when Duraklat is pressed and shows Devam', async () => {
    // Each executor call is a fresh pending promise we resolve on demand.
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(executor, 'run').mockImplementation(
      () => new Promise<{ success: boolean }>(r => { resolveExec = r; })
    );
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    // Step 0 reached execution; pause now so the loop parks at the next step top.
    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Duraklat/i }));
    // Devam (Resume) is shown immediately.
    expect(screen.getByRole('button', { name: /Devam/i })).toBeTruthy();
    // Finish step 0; the loop must then park at the barrier, not request step 1.
    resolveExec({ success: true });
    await new Promise(r => setTimeout(r, 0));
    await Promise.resolve();
    expect(gemini.nextAction).toHaveBeenCalledTimes(1);
  });

  it('continues the loop when Devam is pressed', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(executor, 'run').mockImplementation(
      () => new Promise<{ success: boolean }>(r => { resolveExec = r; })
    );
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Duraklat/i }));
    resolveExec({ success: true });
    await new Promise(r => setTimeout(r, 0));
    expect(gemini.nextAction).toHaveBeenCalledTimes(1);

    // Resume -> the loop leaves the barrier and requests the next action.
    fireEvent.click(screen.getByRole('button', { name: /Devam/i }));
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));
    // Back to the running control set.
    expect(screen.getByRole('button', { name: /Duraklat/i })).toBeTruthy();
  });

  it('records a stopped run and returns to Başlat when STOP is pressed while paused', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(executor, 'run').mockImplementation(
      () => new Promise<{ success: boolean }>(r => { resolveExec = r; })
    );
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Duraklat/i }));
    resolveExec({ success: true }); // step 0 completes; loop parks
    await new Promise(r => setTimeout(r, 0));

    // STOP while paused: the parked loop must unblock and end as 'stopped'.
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].outcome).toBe('stopped');
    expect(screen.getByRole('button', { name: /Başlat/i })).toBeTruthy();
  });

  it('cleanly restarts after a run is stopped while paused', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(executor, 'run').mockImplementation(
      () => new Promise<{ success: boolean }>(r => { resolveExec = r; })
    );
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');

    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Duraklat/i }));
    resolveExec({ success: true });
    await new Promise(r => setTimeout(r, 0));
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    await waitFor(() => expect(storedRuns()).toHaveLength(1));

    // A fresh run starts cleanly (not paused) and requests actions again.
    startWithGoal('döngü');
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));
    // The new run shows the running (Duraklat) control, not Devam.
    expect(screen.getByRole('button', { name: /Duraklat/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Devam/i })).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: FAIL — no `Duraklat`/`Devam` buttons exist yet.

- [ ] **Step 3: Add pause state, refs, barrier, and handlers**

In `components/AgentLoopPanel.tsx`:

**3a.** Add `Pause` to the lucide import (keep the rest):

```tsx
import { Bot, Play, Square, Pause, Loader2, CheckCircle2, XCircle } from 'lucide-react';
```

**3b.** Add state + refs after the existing `runIdRef` line (`const runIdRef = useRef(0);`):

```tsx
  const [paused, setPaused] = useState(false);
  const pauseRef = useRef(false);
  const resumeRef = useRef<(() => void) | null>(null);
```

**3c.** In `handleStart`, reset pause at the top. Change the existing block:

```tsx
    stopRef.current = false;
    const myRunId = ++runIdRef.current;
    const stale = () => runIdRef.current !== myRunId;
```

to:

```tsx
    stopRef.current = false;
    pauseRef.current = false;
    setPaused(false);
    const myRunId = ++runIdRef.current;
    const stale = () => runIdRef.current !== myRunId;
    const waitWhilePaused = async () => {
      while (pauseRef.current && !stopRef.current && !stale()) {
        await new Promise<void>(resolve => { resumeRef.current = resolve; });
      }
      resumeRef.current = null;
    };
```

**3d.** In the loop, insert the barrier right after the existing loop-top checkpoint. Change:

```tsx
      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopRef.current || stale()) { outcome = 'stopped'; break; }
        const res = await nextAction(ip, token, value, history);
```

to:

```tsx
      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopRef.current || stale()) { outcome = 'stopped'; break; }
        await waitWhilePaused();
        if (stopRef.current || stale()) { outcome = 'stopped'; break; }
        const res = await nextAction(ip, token, value, history);
```

**3e.** Extend `handleStop` and add `handlePause`/`handleResume`. Replace:

```tsx
  const handleStop = () => {
    stopRef.current = true;
    setRunning(false);
  };
```

with:

```tsx
  const handleStop = () => {
    stopRef.current = true;
    pauseRef.current = false;
    setPaused(false);
    resumeRef.current?.();
    resumeRef.current = null;
    setRunning(false);
  };

  const handlePause = () => {
    pauseRef.current = true;
    setPaused(true);
  };

  const handleResume = () => {
    pauseRef.current = false;
    setPaused(false);
    resumeRef.current?.();
    resumeRef.current = null;
  };
```

- [ ] **Step 4: Update the button row to tri-state**

Replace the whole `{running ? ( ... ) : ( ... )}` block (the STOP/Start button branch inside the `<div className="flex gap-2">`) with:

```tsx
        {!running ? (
          <button
            onClick={() => handleStart()}
            disabled={!goal.trim()}
            className="px-5 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
          >
            <Play size={16} />
            Başlat
          </button>
        ) : (
          <>
            {paused ? (
              <button
                onClick={handleResume}
                className="px-4 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center gap-2 active:scale-95 transition-all"
              >
                <Play size={16} />
                Devam
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="px-4 bg-amber-400 text-slate-950 font-black rounded-sm flex items-center gap-2 active:scale-95 transition-all"
              >
                <Pause size={16} />
                Duraklat
              </button>
            )}
            <button
              onClick={handleStop}
              className="px-4 bg-red-500 text-slate-950 font-black rounded-sm flex items-center gap-2 active:scale-95 transition-all"
            >
              <Square size={16} />
              Durdur
            </button>
          </>
        )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: PASS — all pre-existing tests plus the 4 new pause/resume tests.

- [ ] **Step 6: Full suite, typecheck, build, commit**

Run: `npx vitest run`
Expected: PASS (all tests).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

```bash
git add components/AgentLoopPanel.tsx components/AgentLoopPanel.test.tsx
git commit -m "feat: pause and resume the agent loop between steps"
```

---

## Self-Review Notes

- **Spec coverage:** tri-state buttons → Step 4; pause barrier at loop top ("finish current step, then hold") → Step 3d; `pauseRef`/`resumeRef`/`waitWhilePaused` → Step 3b–3c; `handlePause`/`handleResume`/extended `handleStop`/reset in `handleStart` → Step 3c/3e; step cap unaffected (barrier doesn't advance the counter) → verified by the existing unchanged cap test; #5b recording untouched → the `finally` block is not edited. All spec sections mapped.
- **Concurrency:** the barrier is inserted only AFTER the existing loop-top `if (stopRef.current || stale()) break;` and is followed by a second identical checkpoint, so a run stopped or superseded while paused exits without resuming. No existing guard is moved or removed.
- **Type consistency:** `resumeRef` is `useRef<(() => void) | null>(null)`; `waitWhilePaused` returns `Promise<void>`; `paused` is a boolean. Handler names (`handlePause`, `handleResume`) match their button `onClick`s.

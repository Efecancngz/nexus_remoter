# Agent-Loop Step Approval / Inline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in approval mode that pauses the agent loop before executing each action, letting the user confirm, edit the value, or skip it.

**Architecture:** Additive to the #4b/#5c loop in `components/AgentLoopPanel.tsx`. A `'skipped'` step status is added to the shared model first (Task 1), then a resolver-backed decision barrier + toggle + gate UI is added to the loop (Task 2). The concurrency guards, #5c pause barrier, and #5b recording stay byte-for-byte.

**Tech Stack:** React 19 + TypeScript, Vitest 4 + React Testing Library (jsdom), lucide-react.

## Global Constraints

- No new dependencies.
- The #4b loop concurrency logic (`runIdRef`/`stale()`/`stopRef`, cap, `history`), the #5c pause barrier, and the #5b recording block stay byte-for-byte except the additive gate and the `'skipped'` status.
- Turkish strings: "Onay modu" (approval mode), "Onayla" (Confirm), "Atla" (Skip); existing "Başlat"/"Durdur"/"Duraklat"/"Devam" unchanged.
- No backend change; `/ai/next-action` contract untouched.
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/agent-loop-approval`.
- Frontend tests from repo root: `npx vitest run`; typecheck `npx tsc --noEmit`; build `npm run build`.
- Vitest has no auto-cleanup — RTL tests use explicit `afterEach(cleanup)`.

---

## File Structure

- Modify: `hooks/useAgentRuns.ts` — add `'skipped'` to `AgentRunStep.status`.
- Modify: `components/AgentRunHistory.tsx` — render a skipped-step marker.
- Test: `components/AgentRunHistory.test.tsx` — skipped marker test.
- Modify: `components/AgentLoopPanel.tsx` — `'skipped'` LogRow status + skipped log icon, approval toggle, decision barrier, handlers, gate UI.
- Test: `components/AgentLoopPanel.test.tsx` — approval/edit/skip tests.

---

## Task 1: `'skipped'` step status model + history marker

**Files:**
- Modify: `hooks/useAgentRuns.ts`
- Modify: `components/AgentRunHistory.tsx`
- Test: `components/AgentRunHistory.test.tsx`

**Interfaces:**
- Produces: `AgentRunStep.status` widened to `'done' | 'failed' | 'skipped'` (Task 2 relies on
  this to record skipped steps).

- [ ] **Step 1: Write the failing history test**

Append to `components/AgentRunHistory.test.tsx` (inside the existing `describe`):

```tsx
  it('renders a skipped marker for a skipped step when expanded', () => {
    render(
      <AgentRunHistory
        runs={[run({ steps: [{ thought: 'atla', label: 'MOUSE_CLICK: 10%,10%', status: 'skipped' }] })]}
        running={false}
        onReplay={vi.fn()}
        onClear={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('run-row'));
    expect(screen.getByTestId('step-skipped')).toBeTruthy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/AgentRunHistory.test.tsx`
Expected: FAIL — `status: 'skipped'` is a type error and/or `step-skipped` testid not found.

- [ ] **Step 3: Widen the status union**

In `hooks/useAgentRuns.ts`, change:

```ts
export interface AgentRunStep {
  thought: string;
  label: string;
  status: 'done' | 'failed';
}
```

to:

```ts
export interface AgentRunStep {
  thought: string;
  label: string;
  status: 'done' | 'failed' | 'skipped';
}
```

- [ ] **Step 4: Render the skipped marker in history**

In `components/AgentRunHistory.tsx`:

**4a.** Add `SkipForward` to the lucide import:

```tsx
import { History, RotateCcw, Trash2, CheckCircle2, XCircle, Square, Timer, SkipForward } from 'lucide-react';
```

**4b.** Replace the step-status ternary (currently `s.status === 'done' ? <CheckCircle2 .../> : <XCircle .../>`) with a three-way:

```tsx
                        {s.status === 'done' ? (
                          <CheckCircle2 size={12} className="text-hud-cyan shrink-0 mt-0.5" />
                        ) : s.status === 'skipped' ? (
                          <SkipForward data-testid="step-skipped" size={12} className="text-slate-500 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle size={12} className="text-red-500 shrink-0 mt-0.5" />
                        )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run components/AgentRunHistory.test.tsx`
Expected: PASS (existing tests + the new skipped-marker test).

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors (widening the union does not break `AgentLoopPanel`'s existing `'done'`/`'failed'` pushes).

```bash
git add hooks/useAgentRuns.ts components/AgentRunHistory.tsx components/AgentRunHistory.test.tsx
git commit -m "feat: add skipped step status and history marker"
```

---

## Task 2: Approval mode — decision barrier, toggle, and gate UI

**Files:**
- Modify: `components/AgentLoopPanel.tsx`
- Test: `components/AgentLoopPanel.test.tsx`

**Interfaces:**
- Consumes: `AgentRunStep` (status now includes `'skipped'`), the existing loop/handlers,
  `nextAction`, `executor.run`.
- Produces: no new public interface.

**Notes:** The gate is a second guarded suspension point, inserted **between** the running-row
push and `executor.run`. All existing guards, the #5c pause barrier, and the #5b recording
block stay byte-for-byte. Compare the edited `handleStart` against the anchors below so no
existing line is dropped.

- [ ] **Step 1: Write the failing tests**

Append to `components/AgentLoopPanel.test.tsx` (inside the existing `describe`; the file
already has `startWithGoal`, `clickAction`, `storedRuns()`, and clears localStorage):

```ts
  function enableApproval() {
    fireEvent.click(screen.getByRole('checkbox', { name: /Onay modu/i }));
  }

  it('auto-executes when approval mode is off', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /Onayla/i })).toBeNull();
  });

  it('parks at the gate before executing when approval mode is on', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({ done: false, thought: 'tıkla', action: clickAction });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    await screen.findByRole('button', { name: /Onayla/i });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('executes the original value on Onayla', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    fireEvent.click(await screen.findByRole('button', { name: /Onayla/i }));
    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    expect(runSpy.mock.calls[0][0][0].value).toBe('10%,10%');
  });

  it('executes and records the edited value on Onayla', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    await screen.findByRole('button', { name: /Onayla/i });
    fireEvent.change(screen.getByLabelText('Adım değeri'), { target: { value: '50%,50%' } });
    fireEvent.click(screen.getByRole('button', { name: /Onayla/i }));

    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    expect(runSpy.mock.calls[0][0][0].value).toBe('50%,50%');
    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].steps[0].label).toBe('MOUSE_CLICK: 50%,50%');
  });

  it('skips a step without executing and records it as skipped', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    fireEvent.click(await screen.findByRole('button', { name: /Atla/i }));

    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));
    expect(runSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].steps[0].status).toBe('skipped');
  });

  it('ends the run as stopped when STOP is pressed at the gate', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({ done: false, thought: 'tıkla', action: clickAction });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    enableApproval();
    startWithGoal('kedi ara');

    await screen.findByRole('button', { name: /Onayla/i });
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].outcome).toBe('stopped');
    expect(screen.getByRole('button', { name: /Başlat/i })).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: FAIL — no "Onay modu" checkbox / "Onayla"/"Atla" buttons exist yet.

- [ ] **Step 3: Add imports, status, state, refs, and the Decision type**

In `components/AgentLoopPanel.tsx`:

**3a.** Extend the lucide import with `Check`, `SkipForward`:

```tsx
import { Bot, Play, Square, Pause, Check, SkipForward, Loader2, CheckCircle2, XCircle } from 'lucide-react';
```

**3b.** Widen `StepStatus` and add the `Decision` type (replace the `type StepStatus` line):

```tsx
type StepStatus = 'running' | 'done' | 'failed' | 'skipped';
type Decision = { kind: 'confirm'; value: string } | { kind: 'skip' };
```

**3c.** Add state + refs after `const resumeRef = useRef<(() => void) | null>(null);`:

```tsx
  const [approval, setApproval] = useState(false);
  const approvalRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<{ type: string; value: string; description: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const decisionRef = useRef<((d: Decision) => void) | null>(null);
```

- [ ] **Step 4: Reset gate state in `handleStart` and insert the decision barrier**

**4a.** In `handleStart`, add gate reset alongside the existing pause reset. Change:

```tsx
    stopRef.current = false;
    pauseRef.current = false;
    setPaused(false);
```

to:

```tsx
    stopRef.current = false;
    pauseRef.current = false;
    setPaused(false);
    setPendingAction(null);
    decisionRef.current = null;
```

**4b.** Insert the gate between the running-row push and `executor.run`. Change:

```tsx
        recorded.push({ thought: res.thought || '', label, status: 'failed' });
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running', image: res.image }]);
        const exec = await executor.run([action], ip, token);
```

to:

```tsx
        recorded.push({ thought: res.thought || '', label, status: 'failed' });
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running', image: res.image }]);
        if (approvalRef.current) {
          setPendingAction({ type: action.type, value: action.value, description: action.description });
          setEditValue(action.value);
          const decision = await new Promise<Decision>(resolve => { decisionRef.current = resolve; });
          setPendingAction(null);
          decisionRef.current = null;
          if (stopRef.current || stale()) { outcome = 'stopped'; break; }
          if (decision.kind === 'skip') {
            setLog(prev => markLast(prev, 'skipped'));
            recorded[recorded.length - 1].status = 'skipped';
            history.push({ type: action.type, description: action.description });
            continue;
          }
          action.value = decision.value;
          const editedLabel = `${action.type}: ${action.value}`;
          recorded[recorded.length - 1].label = editedLabel;
          setLog(prev => prev.map((r, i) => (i === prev.length - 1 ? { ...r, label: editedLabel } : r)));
        }
        const exec = await executor.run([action], ip, token);
```

- [ ] **Step 5: Add the gate handlers and extend `handleStop`; add the toggle handler**

**5a.** Extend `handleStop` to release a gated loop. Change:

```tsx
  const handleStop = () => {
    stopRef.current = true;
    pauseRef.current = false;
    setPaused(false);
    resumeRef.current?.();
    resumeRef.current = null;
    setRunning(false);
  };
```

to:

```tsx
  const handleStop = () => {
    stopRef.current = true;
    pauseRef.current = false;
    setPaused(false);
    resumeRef.current?.();
    resumeRef.current = null;
    decisionRef.current?.({ kind: 'skip' });
    decisionRef.current = null;
    setRunning(false);
  };
```

**5b.** Add the gate + toggle handlers after `handleResume`:

```tsx
  const handleConfirm = (value: string) => {
    decisionRef.current?.({ kind: 'confirm', value });
    decisionRef.current = null;
  };

  const handleSkip = () => {
    decisionRef.current?.({ kind: 'skip' });
    decisionRef.current = null;
  };

  const toggleApproval = () => {
    const next = !approvalRef.current;
    approvalRef.current = next;
    setApproval(next);
  };
```

- [ ] **Step 6: Add the toggle and the gate card to the render**

**6a.** Add the approval toggle row directly after the closing `</div>` of the input/buttons
`<div className="flex gap-2">` block (before the `{log.length > 0 && ...}` block):

```tsx
      <label className="flex items-center gap-2 text-[11px] text-slate-400 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={approval}
          onChange={toggleApproval}
          className="accent-hud-cyan"
        />
        Onay modu
      </label>
```

**6b.** Add the skipped icon to the log row status icons. After the `row.status === 'failed'`
line, add:

```tsx
              {row.status === 'skipped' && <SkipForward size={13} className="text-slate-500 shrink-0 mt-0.5" />}
```

**6c.** Add the gate card directly before the `<AgentRunHistory ... />` line:

```tsx
      {pendingAction && (
        <div className="space-y-2 border border-hud-cyan/40 rounded-sm p-3 bg-hud-bg/60">
          <div className="text-[11px] text-slate-400">{pendingAction.description}</div>
          <div className="text-[10px] text-slate-600 font-data">{pendingAction.type}</div>
          <input
            aria-label="Adım değeri"
            className="w-full bg-hud-bg/80 border border-hud-dim rounded-sm font-data p-2 text-sm outline-none focus:border-hud-cyan/60"
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleConfirm(editValue)}
              className="flex-1 px-3 py-2 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <Check size={14} />
              Onayla
            </button>
            <button
              onClick={handleSkip}
              className="flex-1 px-3 py-2 bg-slate-600 text-slate-100 font-bold rounded-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <SkipForward size={14} />
              Atla
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: PASS — all pre-existing tests plus the 6 new approval tests.

- [ ] **Step 8: Full suite, typecheck, build, commit**

Run: `npx vitest run`
Expected: PASS (all tests).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

```bash
git add components/AgentLoopPanel.tsx components/AgentLoopPanel.test.tsx
git commit -m "feat: approval mode to confirm, edit, or skip each agent step"
```

---

## Self-Review Notes

- **Spec coverage:** `'skipped'` status → Task 1; toggle + `approvalRef` → Task 2 3c/5b/6a; decision barrier between push and executor → Task 2 4b; Confirm/Edit/Skip handlers + Stop release → Task 2 5a/5b; gate UI + skipped log icon → Task 2 6b/6c; edited value recorded → Task 2 4b (recorded label + log label update). All spec sections mapped.
- **Concurrency:** the gate barrier is followed immediately by `if (stopRef.current || stale())`, mirroring the #5c discipline, so a run stopped or superseded while gated exits without executing. No existing guard, the pause barrier, or the `finally` recording block is moved or removed. `handleStop` releasing `decisionRef` matches how it releases `resumeRef`.
- **Type consistency:** `Decision` is `{ kind: 'confirm'; value: string } | { kind: 'skip' }`; `decisionRef` is `useRef<((d: Decision) => void) | null>(null)`; `StepStatus` and `AgentRunStep.status` both include `'skipped'`; handler names (`handleConfirm`, `handleSkip`, `toggleApproval`) match their `onClick`/`onChange`s.

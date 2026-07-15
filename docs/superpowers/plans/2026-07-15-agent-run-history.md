# Agent-Loop Run History + Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each terminal agent-loop run (goal, outcome, text steps) to localStorage and let the user revisit and replay it by re-running its goal.

**Architecture:** A localStorage-backed `useAgentRuns` hook owns the run list. A presentational `AgentRunHistory` component renders the list with expandable step detail, Replay, and Clear. `AgentLoopPanel` records a run at each terminal state (additive to the existing loop) and renders the history below its live log; replay calls the existing `handleStart` with a saved goal.

**Tech Stack:** React 19 + TypeScript, Vitest 4 + React Testing Library (jsdom), localStorage + JSON.

## Global Constraints

- No new dependencies; localStorage + JSON only (mirror `App.tsx` `STORAGE_KEY` pattern).
- localStorage key: `nexus_agent_runs`. Cap: **20 runs**, newest first.
- The #4b loop concurrency logic (`runIdRef`/`stale()`/`stopRef`, STOP, cap, `history`) stays unchanged except purely additive recording.
- No backend change; `/ai/next-action` contract untouched.
- Turkish user-facing strings; `alt`/`aria` text Turkish.
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/agent-run-history`.
- Frontend tests run from repo root: `npx vitest run`. Typecheck: `npx tsc --noEmit`.
- Vitest has no auto-cleanup — every RTL test file uses explicit `afterEach(cleanup)`.

---

## File Structure

- Create: `hooks/useAgentRuns.ts` — the run store + shared types (`RunOutcome`, `AgentRunStep`, `AgentRun`).
- Create: `hooks/useAgentRuns.test.ts` — hook tests.
- Create: `components/AgentRunHistory.tsx` — presentational history list.
- Create: `components/AgentRunHistory.test.tsx` — component tests.
- Modify: `components/AgentLoopPanel.tsx` — record runs, `handleStart(goalArg?)` refactor, replay handler, render `AgentRunHistory`.
- Modify: `components/AgentLoopPanel.test.tsx` — recording tests.

---

## Task 1: `useAgentRuns` hook + shared types

**Files:**
- Create: `hooks/useAgentRuns.ts`
- Test: `hooks/useAgentRuns.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RunOutcome = 'completed' | 'failed' | 'stopped' | 'capped'`
  - `interface AgentRunStep { thought: string; label: string; status: 'done' | 'failed' }`
  - `interface AgentRun { id: string; goal: string; startedAt: number; outcome: RunOutcome; detail?: string; steps: AgentRunStep[] }`
  - `useAgentRuns(): { runs: AgentRun[]; addRun: (run: AgentRun) => void; clearRuns: () => void }`
  - `const AGENT_RUNS_KEY = 'nexus_agent_runs'`
  - `const MAX_RUNS = 20`

- [ ] **Step 1: Write the failing tests**

Create `hooks/useAgentRuns.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAgentRuns, AGENT_RUNS_KEY, AgentRun } from './useAgentRuns';

function makeRun(id: string, goal = 'hedef'): AgentRun {
  return {
    id,
    goal,
    startedAt: 1000,
    outcome: 'completed',
    detail: 'ok',
    steps: [{ thought: 'dusun', label: 'MOUSE_CLICK: 10%,10%', status: 'done' }],
  };
}

describe('useAgentRuns', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    cleanup();
  });

  it('starts empty when nothing is stored', () => {
    const { result } = renderHook(() => useAgentRuns());
    expect(result.current.runs).toEqual([]);
  });

  it('starts empty when the stored value is corrupt JSON', () => {
    localStorage.setItem(AGENT_RUNS_KEY, '{not json');
    const { result } = renderHook(() => useAgentRuns());
    expect(result.current.runs).toEqual([]);
  });

  it('loads existing runs from localStorage', () => {
    localStorage.setItem(AGENT_RUNS_KEY, JSON.stringify([makeRun('a')]));
    const { result } = renderHook(() => useAgentRuns());
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.runs[0].id).toBe('a');
  });

  it('addRun prepends (newest first) and persists', () => {
    const { result } = renderHook(() => useAgentRuns());
    act(() => result.current.addRun(makeRun('a')));
    act(() => result.current.addRun(makeRun('b')));
    expect(result.current.runs.map(r => r.id)).toEqual(['b', 'a']);
    const stored = JSON.parse(localStorage.getItem(AGENT_RUNS_KEY)!);
    expect(stored.map((r: AgentRun) => r.id)).toEqual(['b', 'a']);
  });

  it('caps at 20 runs, dropping the oldest', () => {
    const { result } = renderHook(() => useAgentRuns());
    act(() => {
      for (let i = 0; i < 21; i++) result.current.addRun(makeRun(String(i)));
    });
    expect(result.current.runs).toHaveLength(20);
    // Newest is '20'; oldest '0' was dropped.
    expect(result.current.runs[0].id).toBe('20');
    expect(result.current.runs.some(r => r.id === '0')).toBe(false);
  });

  it('clearRuns empties and persists', () => {
    const { result } = renderHook(() => useAgentRuns());
    act(() => result.current.addRun(makeRun('a')));
    act(() => result.current.clearRuns());
    expect(result.current.runs).toEqual([]);
    expect(JSON.parse(localStorage.getItem(AGENT_RUNS_KEY)!)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run hooks/useAgentRuns.test.ts`
Expected: FAIL — cannot resolve `./useAgentRuns`.

- [ ] **Step 3: Write the hook**

Create `hooks/useAgentRuns.ts`:

```ts
import { useCallback, useState } from 'react';

export type RunOutcome = 'completed' | 'failed' | 'stopped' | 'capped';

export interface AgentRunStep {
  thought: string;
  label: string;
  status: 'done' | 'failed';
}

export interface AgentRun {
  id: string;
  goal: string;
  startedAt: number;
  outcome: RunOutcome;
  detail?: string;
  steps: AgentRunStep[];
}

export const AGENT_RUNS_KEY = 'nexus_agent_runs';
export const MAX_RUNS = 20;

function load(): AgentRun[] {
  try {
    const raw = localStorage.getItem(AGENT_RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(runs: AgentRun[]) {
  try {
    localStorage.setItem(AGENT_RUNS_KEY, JSON.stringify(runs));
  } catch {
    // Quota or unavailable storage: keep in-memory state, drop persistence.
  }
}

export function useAgentRuns() {
  const [runs, setRuns] = useState<AgentRun[]>(() => load());

  const addRun = useCallback((run: AgentRun) => {
    setRuns(prev => {
      const next = [run, ...prev].slice(0, MAX_RUNS);
      persist(next);
      return next;
    });
  }, []);

  const clearRuns = useCallback(() => {
    setRuns([]);
    persist([]);
  }, []);

  return { runs, addRun, clearRuns };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run hooks/useAgentRuns.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add hooks/useAgentRuns.ts hooks/useAgentRuns.test.ts
git commit -m "feat: add useAgentRuns localStorage hook for run history"
```

---

## Task 2: `AgentRunHistory` presentational component

**Files:**
- Create: `components/AgentRunHistory.tsx`
- Test: `components/AgentRunHistory.test.tsx`

**Interfaces:**
- Consumes: `AgentRun` from `hooks/useAgentRuns`.
- Produces: `export default function AgentRunHistory(props: AgentRunHistoryProps)` where
  `interface AgentRunHistoryProps { runs: AgentRun[]; running: boolean; onReplay: (goal: string) => void; onClear: () => void }`.

**Notes:** Renders nothing when `runs` is empty. Each run row is a button (`data-testid="run-row"`) that toggles an expanded step list. Replay button per row is disabled when `running` is true. Outcome markers use Turkish labels.

- [ ] **Step 1: Write the failing tests**

Create `components/AgentRunHistory.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import AgentRunHistory from './AgentRunHistory';
import { AgentRun } from '../hooks/useAgentRuns';

afterEach(cleanup);

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'r1',
    goal: 'kedi ara',
    startedAt: Date.now(),
    outcome: 'completed',
    detail: 'bitti',
    steps: [{ thought: 'tarayiciyi ac', label: 'MOUSE_CLICK: 10%,10%', status: 'done' }],
    ...overrides,
  };
}

describe('AgentRunHistory', () => {
  it('renders nothing when there are no runs', () => {
    const { container } = render(
      <AgentRunHistory runs={[]} running={false} onReplay={vi.fn()} onClear={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a row per run with the goal', () => {
    render(
      <AgentRunHistory
        runs={[run({ id: 'a', goal: 'kedi ara' }), run({ id: 'b', goal: 'kopek ara' })]}
        running={false}
        onReplay={vi.fn()}
        onClear={vi.fn()}
      />
    );
    expect(screen.getAllByTestId('run-row')).toHaveLength(2);
    expect(screen.getByText('kedi ara')).toBeTruthy();
    expect(screen.getByText('kopek ara')).toBeTruthy();
  });

  it('expands a run to show its step list when the row is tapped', () => {
    render(
      <AgentRunHistory runs={[run()]} running={false} onReplay={vi.fn()} onClear={vi.fn()} />
    );
    // Step label hidden until expanded.
    expect(screen.queryByText('MOUSE_CLICK: 10%,10%')).toBeNull();
    fireEvent.click(screen.getByTestId('run-row'));
    expect(screen.getByText('MOUSE_CLICK: 10%,10%')).toBeTruthy();
  });

  it('fires onReplay with the run goal when Tekrar Calistir is tapped', () => {
    const onReplay = vi.fn();
    render(
      <AgentRunHistory
        runs={[run({ goal: 'kedi ara' })]}
        running={false}
        onReplay={onReplay}
        onClear={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Tekrar Çalıştır/i }));
    expect(onReplay).toHaveBeenCalledWith('kedi ara');
  });

  it('disables replay while a loop is running', () => {
    const onReplay = vi.fn();
    render(
      <AgentRunHistory runs={[run()]} running={true} onReplay={onReplay} onClear={vi.fn()} />
    );
    const btn = screen.getByRole('button', { name: /Tekrar Çalıştır/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onReplay).not.toHaveBeenCalled();
  });

  it('fires onClear when Gecmisi Temizle is tapped', () => {
    const onClear = vi.fn();
    render(
      <AgentRunHistory runs={[run()]} running={false} onReplay={vi.fn()} onClear={onClear} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Geçmişi Temizle/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/AgentRunHistory.test.tsx`
Expected: FAIL — cannot resolve `./AgentRunHistory`.

- [ ] **Step 3: Write the component**

Create `components/AgentRunHistory.tsx`:

```tsx
import React, { useState } from 'react';
import { History, RotateCcw, Trash2, CheckCircle2, XCircle, Square, Timer } from 'lucide-react';
import { AgentRun, RunOutcome } from '../hooks/useAgentRuns';

interface AgentRunHistoryProps {
  runs: AgentRun[];
  running: boolean;
  onReplay: (goal: string) => void;
  onClear: () => void;
}

const OUTCOME_META: Record<RunOutcome, { label: string; className: string }> = {
  completed: { label: 'Tamamlandı', className: 'text-hud-cyan' },
  failed: { label: 'Başarısız', className: 'text-red-500' },
  stopped: { label: 'Durduruldu', className: 'text-slate-400' },
  capped: { label: 'Sınıra ulaştı', className: 'text-amber-400' },
};

function OutcomeIcon({ outcome }: { outcome: RunOutcome }) {
  const cls = OUTCOME_META[outcome].className + ' shrink-0';
  if (outcome === 'completed') return <CheckCircle2 size={13} className={cls} />;
  if (outcome === 'failed') return <XCircle size={13} className={cls} />;
  if (outcome === 'capped') return <Timer size={13} className={cls} />;
  return <Square size={13} className={cls} />;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'az önce';
  if (min < 60) return `${min} dk önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} sa önce`;
  return `${Math.floor(hr / 24)} gün önce`;
}

export default function AgentRunHistory({ runs, running, onReplay, onClear }: AgentRunHistoryProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (runs.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-hud-dim pt-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-400">
          <History size={14} />
          <h4 className="text-[11px] font-display font-bold uppercase tracking-[0.15em]">Geçmiş</h4>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-red-500 transition-colors"
        >
          <Trash2 size={12} />
          Geçmişi Temizle
        </button>
      </div>

      <ol className="space-y-1.5">
        {runs.map(run => {
          const isOpen = expanded === run.id;
          const meta = OUTCOME_META[run.outcome];
          return (
            <li key={run.id} className="bg-hud-bg/60 border border-hud-dim rounded-sm">
              <button
                type="button"
                data-testid="run-row"
                onClick={() => setExpanded(isOpen ? null : run.id)}
                className="w-full flex items-center gap-2 p-2.5 text-left"
              >
                <OutcomeIcon outcome={run.outcome} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[12px] font-data text-slate-200 truncate">{run.goal}</span>
                  <span className="block text-[10px] text-slate-500">
                    <span className={meta.className}>{meta.label}</span>
                    {' · '}{run.steps.length} adım{' · '}{formatRelative(run.startedAt)}
                  </span>
                </span>
              </button>

              {isOpen && (
                <div className="px-2.5 pb-2.5 space-y-2">
                  <ol className="space-y-1">
                    {run.steps.map((s, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] font-data text-slate-300">
                        {s.status === 'done'
                          ? <CheckCircle2 size={12} className="text-hud-cyan shrink-0 mt-0.5" />
                          : <XCircle size={12} className="text-red-500 shrink-0 mt-0.5" />}
                        <span className="flex-1">
                          <span className="text-slate-400">{s.thought}</span>
                          <span className="block text-slate-600">{s.label}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  <button
                    type="button"
                    onClick={() => onReplay(run.goal)}
                    disabled={running}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-hud-cyan/15 text-hud-cyan border border-hud-cyan/30 rounded-sm text-[11px] font-bold disabled:opacity-40 active:scale-95 transition-all"
                  >
                    <RotateCcw size={13} />
                    Tekrar Çalıştır
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/AgentRunHistory.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add components/AgentRunHistory.tsx components/AgentRunHistory.test.tsx
git commit -m "feat: add AgentRunHistory list with expandable steps and replay"
```

---

## Task 3: Record runs and wire history into `AgentLoopPanel`

**Files:**
- Modify: `components/AgentLoopPanel.tsx`
- Test: `components/AgentLoopPanel.test.tsx`

**Interfaces:**
- Consumes: `useAgentRuns` (`{ runs, addRun, clearRuns }`) and `AgentRun`, `AgentRunStep`, `RunOutcome` from `hooks/useAgentRuns`; `AgentRunHistory` default export.
- Produces: no new public interface (self-contained panel change).

**Notes:** Recording is additive — the existing generation-token guards stay exactly as they are. A local `recorded: AgentRunStep[]` mirrors the log rows so the `finally` reads no stale React state. `handleStart` gains an optional `goalArg` so replay can pass a saved goal explicitly.

- [ ] **Step 1: Write the failing recording tests**

Append to `components/AgentLoopPanel.test.tsx` (inside the existing `describe`), and add `localStorage.clear()` to the existing `beforeEach`/`afterEach`. Add this import near the top of the file:

```ts
import { AGENT_RUNS_KEY, AgentRun } from '../hooks/useAgentRuns';
```

Update the existing hooks to clear storage:

```ts
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    cleanup();
  });
```

Append these tests:

```ts
  function storedRuns(): AgentRun[] {
    const raw = localStorage.getItem(AGENT_RUNS_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  it('records a completed run with its steps', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'Görev bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    const run = storedRuns()[0];
    expect(run.goal).toBe('kedi ara');
    expect(run.outcome).toBe('completed');
    expect(run.detail).toBe('Görev bitti');
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].status).toBe('done');
    expect(run.steps[0].label).toBe('MOUSE_CLICK: 10%,10%');
  });

  it('records a failed run when a step fails', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: false, error: 'PC hatası' });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('hata');

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    const run = storedRuns()[0];
    expect(run.outcome).toBe('failed');
    expect(run.detail).toBe('PC hatası');
    expect(run.steps[0].status).toBe('failed');
  });

  it('records a stopped run when STOP is pressed mid-step', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockReturnValue(new Promise(r => { resolveExec = r; }));

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('sonsuz');

    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    resolveExec({ success: true });

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    expect(storedRuns()[0].outcome).toBe('stopped');
  });

  it('does not record a superseded (stale) run', async () => {
    // Run #1 stays pending; stop+restart supersedes it; resolving it must not record.
    let resolveOldExec: (v: { success: boolean }) => void = () => {};
    let execCall = 0;
    vi.spyOn(executor, 'run').mockImplementation(() => {
      execCall += 1;
      if (execCall === 1) return new Promise<{ success: boolean }>(r => { resolveOldExec = r; });
      return new Promise<{ success: boolean }>(() => {});
    });
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('döngü');
    await screen.findByText(/MOUSE_CLICK/);

    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    // A STOP records the stopped run #1 (1 stored). Restart -> run #2 pending.
    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    startWithGoal('döngü');
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));

    // Resolve the OLD (stale) run's executor: it must NOT add a second record.
    resolveOldExec({ success: true });
    await new Promise(r => setTimeout(r, 0));
    await Promise.resolve();
    expect(storedRuns()).toHaveLength(1);
  });

  it('replays a saved run when Tekrar Calistir is tapped', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' })
      // Replay run:
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'bitti tekrar' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });
    const onToast = vi.fn();

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    startWithGoal('kedi ara');
    await waitFor(() => expect(storedRuns()).toHaveLength(1));

    // Expand the history row, then replay.
    fireEvent.click(screen.getByTestId('run-row'));
    fireEvent.click(screen.getByRole('button', { name: /Tekrar Çalıştır/i }));

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('bitti tekrar', 'success'));
    // A second run was recorded for the same goal.
    await waitFor(() => expect(storedRuns()).toHaveLength(2));
    expect(storedRuns()[0].goal).toBe('kedi ara');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: FAIL — new recording tests fail (`storedRuns()` empty), replay button absent.

- [ ] **Step 3: Modify `AgentLoopPanel.tsx`**

Add imports:

```tsx
import { useAgentRuns, RunOutcome, AgentRunStep } from '../hooks/useAgentRuns';
import AgentRunHistory from './AgentRunHistory';
```

Add the hook inside the component (after the existing state/refs, before `handleStart`):

```tsx
  const { runs, addRun, clearRuns } = useAgentRuns();
```

Replace the whole `handleStart` with the recording version below. The concurrency guards (`stopRef`, `stale()`, `runIdRef`) are byte-for-byte the same; the only additions are `startedAt`, `recorded`, `outcome`/`detail`, the `pushStep`/`markStep` helpers, and the `addRun` call in `finally`:

```tsx
  const handleStart = async (goalArg?: string) => {
    const value = (goalArg ?? goal).trim();
    if (!value || running) return;
    stopRef.current = false;
    const myRunId = ++runIdRef.current;
    const stale = () => runIdRef.current !== myRunId;
    setRunning(true);
    setLog([]);
    setPreview(null);
    const startedAt = Date.now();
    const recorded: AgentRunStep[] = [];
    let outcome: RunOutcome = 'stopped';
    let detail: string | undefined;
    const history: { type: string; description: string }[] = [];
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopRef.current || stale()) { outcome = 'stopped'; break; }
        const res = await nextAction(ip, token, value, history);
        if (res.done) {
          if (!stale()) onToast(res.summary || 'Görev tamamlandı', 'success');
          outcome = 'completed';
          detail = res.summary;
          break;
        }
        if (stopRef.current || stale()) { outcome = 'stopped'; break; }
        const action = res.action!;
        const label = `${action.type}: ${action.value}`;
        recorded.push({ thought: res.thought || '', label, status: 'failed' });
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running', image: res.image }]);
        const exec = await executor.run([action], ip, token);
        if (stale()) break;
        if (!exec.success) {
          setLog(prev => markLast(prev, 'failed'));
          onToast(exec.error || 'Adım başarısız', 'error');
          outcome = 'failed';
          detail = exec.error;
          break;
        }
        setLog(prev => markLast(prev, 'done'));
        recorded[recorded.length - 1].status = 'done';
        history.push({ type: action.type, description: action.description });
        if (step === MAX_STEPS - 1) {
          onToast('Adım sınırına ulaşıldı', 'warning');
          outcome = 'capped';
        }
      }
    } catch (e: any) {
      if (!stale()) onToast(e?.message || 'Döngü hatası oluştu.', 'error');
      outcome = 'failed';
      detail = e?.message;
    } finally {
      if (!stale()) {
        setRunning(false);
        if (recorded.length > 0) {
          addRun({
            id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11),
            goal: value,
            startedAt,
            outcome,
            detail,
            steps: recorded,
          });
        }
      }
    }
  };
```

Add the replay handler right after `handleStop`:

```tsx
  const handleReplay = (savedGoal: string) => {
    if (running) return;
    setGoal(savedGoal);
    handleStart(savedGoal);
  };
```

Render the history below the live log — insert directly before the `{preview && ...}` line:

```tsx
      <AgentRunHistory runs={runs} running={running} onReplay={handleReplay} onClear={clearRuns} />
```

**Note on the step accumulator:** each pushed step starts as `'failed'` and is flipped to `'done'` only after the executor succeeds, so a run that ends mid-step (stopped/failed) records that step's true status. `recorded.length > 0` skips recording a run that never pushed a step (e.g. an immediate `done` with zero actions, or a STOP before the first action).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: PASS — all existing tests plus the 5 new recording/replay tests.

- [ ] **Step 5: Full suite, typecheck, build, commit**

Run: `npx vitest run`
Expected: PASS (all component + hook tests).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

```bash
git add components/AgentLoopPanel.tsx components/AgentLoopPanel.test.tsx
git commit -m "feat: record agent runs to history and replay saved goals"
```

---

## Self-Review Notes

- **Spec coverage:** data model → Task 1; persistence hook (guarded parse, cap 20, clear) → Task 1; history UI (list, expand, replay disabled-while-running, clear) → Task 2; additive recording per outcome + stale-guard + `handleStart(goalArg)` + replay wiring → Task 3. All spec sections mapped.
- **Type consistency:** `AgentRun`/`AgentRunStep`/`RunOutcome` defined in Task 1 and imported unchanged in Tasks 2–3; `steps[].status` is `'done' | 'failed'`; `label` format `"TYPE: value"` matches the live log row.
- **Concurrency:** the `stale()`/`runIdRef`/`stopRef` guards are unchanged; recording sits inside the existing `!stale()` block in `finally`, so superseded runs never record (Task 3 test asserts this).

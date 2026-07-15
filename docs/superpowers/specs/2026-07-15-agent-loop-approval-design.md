# Agent-Loop Step Approval / Inline Editing — Design

**Date:** 2026-07-15
**Roadmap item:** #5d (fourth slice of #5 "Agent-loop UX depth", built on #4b/#5a/#5b/#5c)
**Branch:** `feat/agent-loop-approval`

## Goal

An opt-in **approval mode** where the agent loop pauses before executing each **risky**
proposed action, so the user can run it as-is, tweak its value first, or skip it — plus the
existing Stop. Safe actions (clicks, moves, launches, etc.) auto-run even with the mode on,
keeping runs fast while guarding the consequential steps. When the mode is off, everything
auto-executes exactly as today.

## Risky action types

Approval mode only gates a fixed set of consequential action types; all other types
auto-run. The **risky set** is:

```
TYPE_TEXT, KEYPRESS, HOTKEY, COMMAND, SYSTEM_POWER, CLOSE_APP
```

This covers text entry, key/shortcut presses, raw shell commands, power actions
(shutdown/restart/sleep/lock), and closing apps. All other emitted types — `MOUSE_CLICK`,
`MOUSE_MOVE`, `MOUSE_SCROLL`, `LAUNCH_APP`, `OPEN_URL`, `FOCUS_WINDOW`, `WINDOW_MANAGE`,
`VOLUME_*`, `MEDIA_*`, `CLIPBOARD_*`, `WAIT`, `SCREENSHOT`, `MACRO`, … — are treated as safe
and auto-run. The set is a fixed client-side constant (`RISKY_ACTION_TYPES`), not
user-configurable.

## Background

The #4b loop (`components/AgentLoopPanel.tsx` `handleStart`) runs a bounded `for` loop
(`MAX_STEPS = 15`). Each iteration: (1) `nextAction(...)` returns one action
`{ id, type, value, description }`; (2) `executor.run([action], ...)` executes it. The loop
uses a generation-token concurrency pattern (`runIdRef` + `stale = () => runIdRef.current
!== myRunId` + `stopRef`); #5b records the run in `finally` (guarded by `!stale()`); #5c
added a resolver-backed `waitWhilePaused()` barrier at the loop top with `pauseRef` /
`resumeRef`. This slice reuses that resolver pattern to add a **decision** barrier between
`nextAction` and `executor.run`.

## Toggle and when the gate fires

A new **"Onay modu"** (approval mode) switch sits next to the goal input. Its live value is
mirrored into `approvalRef` (a ref) so the loop reads it fresh each step — toggling mid-run
takes effect from the next step. The switch stays enabled during a run.

When `approvalRef.current` is true **and the proposed action's type is in the risky set**,
the loop — after `nextAction` returns a non-done action and after the action row is pushed to
the log, but **before** `executor.run` — parks and shows a gate. Otherwise (mode off, or a
safe action) the loop executes immediately (unchanged behavior). Approval mode is independent
of #5c pause: both may be on; pause parks at the loop top, approval parks before execution.

## Architecture

Additive to the loop. New state, one new ref, one resolver ref, and a guarded decision
barrier. The `runIdRef` / `stale()` / `stopRef` guards, the #5c pause barrier, and the #5b
recording block stay byte-for-byte.

### New state / refs (`components/AgentLoopPanel.tsx`)

- `const [approval, setApproval] = useState(false)` — the toggle's UI state.
- `const approvalRef = useRef(false)` — kept in sync with `approval` (set in the toggle
  handler) and read inside the loop.
- `const [pendingAction, setPendingAction] = useState<{ type: string; value: string; description: string } | null>(null)` — the action currently at the gate, or null.
- `const decisionRef = useRef<((d: Decision) => void) | null>(null)` — resolver of the
  gate promise while parked.

Where `type Decision = { kind: 'confirm'; value: string } | { kind: 'skip' }`.

A module-level constant defines the gated types:

```ts
const RISKY_ACTION_TYPES = new Set(['TYPE_TEXT', 'KEYPRESS', 'HOTKEY', 'COMMAND', 'SYSTEM_POWER', 'CLOSE_APP']);
```

### Decision barrier (in `handleStart`, before `executor.run`)

The current sequence pushes the running log row, then calls `executor.run`. Insert the gate
between them, firing only for risky actions:

```ts
recorded.push({ thought: res.thought || '', label, status: 'failed' });
setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running', image: res.image }]);

if (approvalRef.current && RISKY_ACTION_TYPES.has(action.type)) {
  setPendingAction({ type: action.type, value: action.value, description: action.description });
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

The post-await `if (stopRef.current || stale())` check makes a run stopped or superseded
while gated exit cleanly and never execute. A skipped step records with the new `'skipped'`
status, pushes to `history` (so Gemini sees it was addressed), and `continue`s — it still
consumes one of `MAX_STEPS` (it is a step attempt). An edited step updates both the recorded
label and the visible log row so history shows what actually ran.

### Handlers

- `handleConfirm(editedValue: string)`: `decisionRef.current?.({ kind: 'confirm', value: editedValue }); decisionRef.current = null;`
- `handleSkip()`: `decisionRef.current?.({ kind: 'skip' }); decisionRef.current = null;`
- `handleStop` (extended — existing lines plus): resolve any pending decision so a gated
  loop unblocks and hits its stop check: `decisionRef.current?.({ kind: 'skip' }); decisionRef.current = null;` (the following `if (stopRef.current) break` catches it before any execution).
- Toggle handler: `const toggleApproval = () => { const next = !approvalRef.current; approvalRef.current = next; setApproval(next); };`
- `handleStart` (top, additive): `setPendingAction(null); decisionRef.current = null;` so a
  fresh run never starts mid-gate. (`approvalRef` is left as the user set it.)

### Step status model

`'skipped'` is added to the step status unions:

- `LogRow.status`: `'running' | 'done' | 'failed' | 'skipped'`.
- `AgentRunStep.status` (in `hooks/useAgentRuns.ts`): `'done' | 'failed' | 'skipped'`.
- `markLast` already spreads `...r`, so it handles the new status without change.

### UI

- The toggle: a small switch/checkbox labelled **"Onay modu"** near the input row, bound to
  `approval` / `toggleApproval`.
- The gate card (rendered when `pendingAction` is non-null, below the log): shows the
  thought text and action type, a text `<input>` pre-filled with `pendingAction.value`
  (local component state for the editable field, seeded when the gate opens), and two
  buttons — **Onayla** (calls `handleConfirm(editedValue)`) and **Atla** (calls
  `handleSkip()`). Stop stays visible in the main control row. No client-side validation of
  the edited value — the executor already handles bad input.
- The skipped log/history marker: a neutral icon (e.g. lucide `SkipForward`, slate-colored)
  distinct from the done (cyan check) and failed (red x) markers, added in both
  `AgentLoopPanel`'s log rows and `AgentRunHistory`'s step detail list.

## Testing

Gating tests use a **risky** action type (e.g. `TYPE_TEXT`) so the gate fires; the
auto-run test uses a **safe** type (`MOUSE_CLICK`).

**`components/AgentLoopPanel.test.tsx` (appended):**
- Approval OFF: a run auto-executes (existing behavior; `executor.run` called without any
  gate interaction).
- Approval ON + **safe** action (`MOUSE_CLICK`): auto-runs, no gate shown.
- Approval ON + **risky** action (`TYPE_TEXT`): the loop parks before `executor.run` — no
  `executor.run` call until Confirm, and the gate is shown.
- Confirm as-is: `executor.run` receives the original value.
- Edit then confirm: `executor.run` receives the edited value, and the recorded step's label
  reflects the edit.
- Skip: `executor.run` is NOT called for that step, the step records with `status:'skipped'`,
  and the loop proceeds to the next `nextAction`.
- Stop while gated: the run ends and records `outcome:'stopped'`; control returns to Başlat.

**`components/AgentRunHistory.test.tsx` (appended):**
- A run whose steps include a `'skipped'` step renders the skipped marker when expanded.

**`hooks/useAgentRuns.test.ts`:** no behavior change (status is an opaque string in the
hook); no new test required beyond the existing round-trip coverage.

## Global Constraints

- No new dependencies.
- The #4b loop concurrency logic (`runIdRef`/`stale()`/`stopRef`, cap, `history`), the #5c
  pause barrier, and the #5b recording block stay byte-for-byte except the additive gate and
  the `'skipped'` status.
- Turkish user-facing strings: "Onay modu" (approval mode), "Onayla" (Confirm), "Atla"
  (Skip); existing "Başlat"/"Durdur"/"Duraklat"/"Devam" unchanged.
- No backend change; `/ai/next-action` contract untouched.
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/agent-loop-approval`.
- Frontend tests from repo root: `npx vitest run`; typecheck `npx tsc --noEmit`; build
  `npm run build`.
- Vitest has no auto-cleanup — RTL tests use explicit `afterEach(cleanup)`.

## Out of Scope (deferred)

- Editing the action *type* (only the value is editable).
- Client-side validation of the edited value.
- Re-asking Gemini after an edit (the edited action is executed directly).
- A user-configurable risky set (the set is a fixed client-side constant).
- Making skipped steps not consume the step cap.

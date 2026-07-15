# Thumbnails in Run History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each run's per-step screenshots in IndexedDB and show them as tap-to-enlarge thumbnails when a run is expanded in history.

**Architecture:** A new `services/runImages.ts` IndexedDB module (with a pure `idsToDelete` helper) stores images keyed by run id. `AgentRunHistory` lazily loads a run's images on expand via an injected `loadImages` prop and renders thumbnails. `AgentLoopPanel` collects images during the loop, saves them on run completion, reconciles IndexedDB to the localStorage run set, and wires the loader. localStorage text history is untouched.

**Tech Stack:** React 19 + TypeScript, Vitest 4 + React Testing Library (jsdom), IndexedDB (browser API; mocked in tests).

## Global Constraints

- No new dependencies. IndexedDB is a browser API; tests mock the `runImages` module or inject a loader — never a real IndexedDB.
- The #4b/#5c/#5d loop concurrency and the #5b recording block stay byte-for-byte except the additive image collection + fire-and-forget `saveRunImages` + the reconcile effect.
- The localStorage text store (`hooks/useAgentRuns.ts`) is untouched.
- Graceful degradation: any IndexedDB failure yields no thumbnails, never an app error.
- Turkish user-facing strings; reuse `ScreenshotModal` and the existing thumbnail styling.
- No backend change. No `Co-Authored-By` trailer.
- Branch: `feat/agent-run-thumbnails`.
- Frontend tests from repo root: `npx vitest run`; typecheck `npx tsc --noEmit`; build `npm run build`.
- Vitest has no auto-cleanup — RTL tests use explicit `afterEach(cleanup)`.

---

## File Structure

- Create: `services/runImages.ts` — IndexedDB image store + pure `idsToDelete`.
- Create: `services/runImages.test.ts` — unit test for `idsToDelete`.
- Modify: `components/AgentRunHistory.tsx` — `loadImages` prop, lazy load on expand, thumbnails, `ScreenshotModal`.
- Modify: `components/AgentRunHistory.test.tsx` — thumbnail tests via injected loader.
- Modify: `components/AgentLoopPanel.tsx` — image collection, shared run id, `saveRunImages`, reconcile effect, wire `loadImages`.
- Modify: `components/AgentLoopPanel.test.tsx` — save/reconcile tests via `vi.mock`.

---

## Task 1: `services/runImages.ts` IndexedDB image store

**Files:**
- Create: `services/runImages.ts`
- Test: `services/runImages.test.ts`

**Interfaces:**
- Produces:
  - `saveRunImages(runId: string, images: (string | null)[]): Promise<void>`
  - `loadRunImages(runId: string): Promise<(string | null)[] | null>`
  - `reconcileRunImages(keepIds: string[]): Promise<void>`
  - `idsToDelete(existingIds: string[], keepIds: string[]): string[]` (pure)

- [ ] **Step 1: Write the failing test**

Create `services/runImages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { idsToDelete } from './runImages';

describe('idsToDelete', () => {
  it('returns all existing ids when keep is empty', () => {
    expect(idsToDelete(['a', 'b'], [])).toEqual(['a', 'b']);
  });
  it('returns only ids not present in keep', () => {
    expect(idsToDelete(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
  });
  it('returns empty when keep is a superset', () => {
    expect(idsToDelete(['a'], ['a', 'b'])).toEqual([]);
  });
  it('returns empty for empty existing', () => {
    expect(idsToDelete([], ['a'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/runImages.test.ts`
Expected: FAIL — cannot resolve `./runImages`.

- [ ] **Step 3: Write the module**

Create `services/runImages.ts`:

```ts
const DB_NAME = 'nexus_agent_images';
const STORE = 'runImages';

export function idsToDelete(existingIds: string[], keepIds: string[]): string[] {
  const keep = new Set(keepIds);
  return existingIds.filter(id => !keep.has(id));
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'runId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRunImages(runId: string, images: (string | null)[]): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ runId, images });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable — degrade to no persistence.
  }
}

export async function loadRunImages(runId: string): Promise<(string | null)[] | null> {
  try {
    const db = await openDB();
    const result = await new Promise<(string | null)[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(runId);
      req.onsuccess = () => resolve(req.result ? req.result.images : null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function reconcileRunImages(keepIds: string[]): Promise<void> {
  try {
    const db = await openDB();
    const existing = await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
      req.onerror = () => reject(req.error);
    });
    const toDelete = idsToDelete(existing, keepIds);
    if (toDelete.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        toDelete.forEach(id => store.delete(id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    db.close();
  } catch {
    // IndexedDB unavailable — no-op.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run services/runImages.test.ts`
Expected: PASS (4 tests). (`idsToDelete` is pure and never touches `indexedDB`, so the test runs without a DOM.)

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add services/runImages.ts services/runImages.test.ts
git commit -m "feat: add IndexedDB run-image store with reconcile helper"
```

---

## Task 2: `AgentRunHistory` thumbnails on expand

**Files:**
- Modify: `components/AgentRunHistory.tsx`
- Test: `components/AgentRunHistory.test.tsx`

**Interfaces:**
- Consumes: `loadImages?: (runId: string) => Promise<(string | null)[] | null>` (new optional prop).
- Produces: no new export.

**Notes:** The prop is optional so the component still renders text-only when no loader is
given. Images cache by run id; the modal reuses `ScreenshotModal`.

- [ ] **Step 1: Write the failing tests**

Append to `components/AgentRunHistory.test.tsx` (inside the existing `describe`; it already
imports `render, screen, fireEvent, cleanup`, has `afterEach(cleanup)`, a `run()` helper, and
`AgentRun`):

```tsx
  it('loads and renders a thumbnail for a step image when expanded', async () => {
    const loadImages = vi.fn().mockResolvedValue(['data:image/jpeg;base64,SHOT', null]);
    render(
      <AgentRunHistory
        runs={[run({
          steps: [
            { thought: 'a', label: 'MOUSE_CLICK: 1%,1%', status: 'done' },
            { thought: 'b', label: 'MOUSE_CLICK: 2%,2%', status: 'done' },
          ],
        })]}
        running={false}
        onReplay={vi.fn()}
        onClear={vi.fn()}
        loadImages={loadImages}
      />
    );
    fireEvent.click(screen.getByTestId('run-row'));
    const thumbs = await screen.findAllByTestId('history-thumbnail');
    expect(thumbs).toHaveLength(1); // only the first step had an image
    expect(loadImages).toHaveBeenCalledTimes(1);
  });

  it('opens ScreenshotModal when a history thumbnail is tapped', async () => {
    const loadImages = vi.fn().mockResolvedValue(['data:image/jpeg;base64,SHOT']);
    render(
      <AgentRunHistory
        runs={[run()]}
        running={false}
        onReplay={vi.fn()}
        onClear={vi.fn()}
        loadImages={loadImages}
      />
    );
    fireEvent.click(screen.getByTestId('run-row'));
    fireEvent.click(await screen.findByTestId('history-thumbnail'));
    expect(await screen.findByRole('button', { name: 'Kapat' })).toBeTruthy();
    expect(screen.getByAltText('Ekran görüntüsü').getAttribute('src')).toBe('data:image/jpeg;base64,SHOT');
  });

  it('renders text steps with no thumbnails when no loader is provided', () => {
    render(<AgentRunHistory runs={[run()]} running={false} onReplay={vi.fn()} onClear={vi.fn()} />);
    fireEvent.click(screen.getByTestId('run-row'));
    expect(screen.queryByTestId('history-thumbnail')).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/AgentRunHistory.test.tsx`
Expected: FAIL — `loadImages` prop / `history-thumbnail` do not exist yet.

- [ ] **Step 3: Add the loader, image cache, and modal**

In `components/AgentRunHistory.tsx`:

**3a.** Import `ScreenshotModal` (add after the existing imports):

```tsx
import { ScreenshotModal } from './ScreenshotModal';
```

**3b.** Extend the props interface:

```tsx
interface AgentRunHistoryProps {
  runs: AgentRun[];
  running: boolean;
  onReplay: (goal: string) => void;
  onClear: () => void;
  loadImages?: (runId: string) => Promise<(string | null)[] | null>;
}
```

**3c.** Update the component signature and add state + a toggle handler. Change:

```tsx
export default function AgentRunHistory({ runs, running, onReplay, onClear }: AgentRunHistoryProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (runs.length === 0) return null;
```

to:

```tsx
export default function AgentRunHistory({ runs, running, onReplay, onClear, loadImages }: AgentRunHistoryProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, (string | null)[] | null>>({});
  const [preview, setPreview] = useState<string | null>(null);

  const handleToggle = (id: string) => {
    const opening = expanded !== id;
    setExpanded(opening ? id : null);
    if (opening && loadImages && images[id] === undefined) {
      loadImages(id)
        .then(imgs => setImages(prev => ({ ...prev, [id]: imgs })))
        .catch(() => setImages(prev => ({ ...prev, [id]: null })));
    }
  };

  if (runs.length === 0) return null;
```

**3d.** Change the run-row `onClick` from `setExpanded(isOpen ? null : run.id)` to
`handleToggle(run.id)`.

**3e.** Render a thumbnail before each step's status icon. In the expanded step list, change:

```tsx
                      <li key={i} className="flex items-start gap-2 text-[11px] font-data text-slate-300">
                        {s.status === 'done' ? (
```

to:

```tsx
                      <li key={i} className="flex items-start gap-2 text-[11px] font-data text-slate-300">
                        {images[run.id]?.[i] && (
                          <button
                            type="button"
                            data-testid="history-thumbnail"
                            onClick={() => setPreview(images[run.id]![i]!)}
                            className="shrink-0 active:scale-95 transition-transform"
                          >
                            <img
                              src={images[run.id]![i]!}
                              alt="Adım görüntüsü"
                              className="w-16 h-10 object-cover rounded-sm border border-hud-dim"
                              loading="lazy"
                              decoding="async"
                            />
                          </button>
                        )}
                        {s.status === 'done' ? (
```

**3f.** Render the modal. Change the component's closing markup from:

```tsx
      </ol>
    </div>
  );
}
```

to:

```tsx
      </ol>
      {preview && <ScreenshotModal dataUrl={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/AgentRunHistory.test.tsx`
Expected: PASS (existing tests + 3 new thumbnail tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add components/AgentRunHistory.tsx components/AgentRunHistory.test.tsx
git commit -m "feat: lazy-load and show run history thumbnails on expand"
```

---

## Task 3: Record images and wire the loader in `AgentLoopPanel`

**Files:**
- Modify: `components/AgentLoopPanel.tsx`
- Test: `components/AgentLoopPanel.test.tsx`

**Interfaces:**
- Consumes: `saveRunImages`, `loadRunImages`, `reconcileRunImages` from `../services/runImages`;
  `AgentRunHistory`'s `loadImages` prop.
- Produces: no new export.

**Notes:** Additive to the loop — the run id is computed once and shared with `addRun`; images
are collected index-aligned with `recorded`; save is fire-and-forget. The reconcile effect
keeps IndexedDB in sync with the localStorage run set.

- [ ] **Step 1: Write the failing tests**

At the TOP of `components/AgentLoopPanel.test.tsx` (after the existing imports), add a module
mock and import the mocked fns:

```ts
vi.mock('../services/runImages', () => ({
  saveRunImages: vi.fn(() => Promise.resolve()),
  loadRunImages: vi.fn(() => Promise.resolve(null)),
  reconcileRunImages: vi.fn(() => Promise.resolve()),
}));
import { saveRunImages, reconcileRunImages } from '../services/runImages';
```

Append these tests inside the existing `describe`:

```ts
  it('saves step screenshots to the image store for a completed run', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction, image: 'data:image/jpeg;base64,SHOT' })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    const runId = storedRuns()[0].id;
    await waitFor(() =>
      expect(saveRunImages).toHaveBeenCalledWith(runId, expect.arrayContaining(['data:image/jpeg;base64,SHOT']))
    );
  });

  it('reconciles the image store with the current run ids', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction, image: 'data:image/jpeg;base64,SHOT' })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(storedRuns()).toHaveLength(1));
    const runId = storedRuns()[0].id;
    await waitFor(() =>
      expect(reconcileRunImages).toHaveBeenCalledWith(expect.arrayContaining([runId]))
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: FAIL — `saveRunImages`/`reconcileRunImages` are never called yet.

- [ ] **Step 3: Import the store and add the reconcile effect**

In `components/AgentLoopPanel.tsx`:

**3a.** Add `useEffect` to the React import and import the store:

```tsx
import React, { useState, useRef, useEffect } from 'react';
```

```tsx
import { saveRunImages, loadRunImages, reconcileRunImages } from '../services/runImages';
```

**3b.** Add the reconcile effect right after the `const { runs, addRun, clearRuns } = useAgentRuns();` line:

```tsx
  useEffect(() => { void reconcileRunImages(runs.map(r => r.id)); }, [runs]);
```

- [ ] **Step 4: Collect images and save on completion**

**4a.** Compute the run id once and start an image accumulator. In `handleStart`, change:

```tsx
    const startedAt = Date.now();
    const recorded: AgentRunStep[] = [];
```

to:

```tsx
    const startedAt = Date.now();
    const runId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11);
    const recorded: AgentRunStep[] = [];
    const images: (string | null)[] = [];
```

**4b.** Push the step image alongside the recorded step. Change:

```tsx
        recorded.push({ thought: res.thought || '', label, status: 'failed' });
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running', image: res.image }]);
```

to:

```tsx
        recorded.push({ thought: res.thought || '', label, status: 'failed' });
        images.push(res.image ?? null);
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running', image: res.image }]);
```

**4c.** Use the shared id in `addRun` and save the images. Change:

```tsx
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
```

to:

```tsx
        if (recorded.length > 0) {
          addRun({
            id: runId,
            goal: value,
            startedAt,
            outcome,
            detail,
            steps: recorded,
          });
          void saveRunImages(runId, images);
        }
```

- [ ] **Step 5: Wire the loader into the history**

Change:

```tsx
      <AgentRunHistory runs={runs} running={running} onReplay={handleReplay} onClear={clearRuns} />
```

to:

```tsx
      <AgentRunHistory runs={runs} running={running} onReplay={handleReplay} onClear={clearRuns} loadImages={loadRunImages} />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: PASS — all pre-existing tests plus the 2 new save/reconcile tests.

- [ ] **Step 7: Full suite, typecheck, build, commit**

Run: `npx vitest run`
Expected: PASS (all tests).

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

```bash
git add components/AgentLoopPanel.tsx components/AgentLoopPanel.test.tsx
git commit -m "feat: persist run screenshots and reconcile the image store"
```

---

## Self-Review Notes

- **Spec coverage:** IndexedDB module + `idsToDelete` → Task 1; lazy-load thumbnails + modal on expand → Task 2; image collection + shared run id + `saveRunImages` + reconcile effect + loader wiring → Task 3. All spec sections mapped.
- **Concurrency:** the loop change is additive only (`runId` computed once, `images.push`, a fire-and-forget `void saveRunImages`); the `runIdRef`/`stale()`/`stopRef` guards, the #5c pause barrier, the #5d approval gate, and the `finally` recording (still `!stale()` + `recorded.length > 0`) are unchanged. The run id now comes from a single source shared by `addRun` and `saveRunImages`.
- **Type consistency:** images are `(string | null)[]`, index-aligned with `recorded`; `loadImages` prop signature matches `loadRunImages`; `saveRunImages`/`reconcileRunImages` signatures match their calls. The image cache is `Record<string, (string | null)[] | null>` (undefined = not yet loaded).
- **Graceful degradation:** every `runImages` function try/catches its IndexedDB work; a failure yields no thumbnails, never an app error. Tests never touch real IndexedDB (module mocked / loader injected / pure helper).

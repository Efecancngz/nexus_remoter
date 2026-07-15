# Thumbnails in Run History — Design

**Date:** 2026-07-15
**Roadmap item:** #5e (fifth/final slice of #5 "Agent-loop UX depth", built on #4b/#5a/#5b/#5c/#5d)
**Branch:** `feat/agent-run-thumbnails`

## Goal

Persist each agent run's per-step screenshots so that expanding a run in history shows the
same thumbnail play-by-play as the live log — tap a thumbnail to enlarge it. This completes
the visual layer that #5a started (live-log thumbnails) and #5b left out of persistence.

## Background

Run *text* history lives in `hooks/useAgentRuns.ts` (localStorage key `nexus_agent_runs`,
cap 20 runs, newest-first; each `AgentRunStep` is `{ thought, label, status }`). The live
loop (`components/AgentLoopPanel.tsx`) already captures a screenshot per step as
`res.image` (a `data:image/jpeg;base64,...` data-URL, ≤1280px q70) and shows it as a
thumbnail in the live log (#5a). #5b deliberately excluded these images from persistence: a
single run's ~15 images ≈ 2 MB against localStorage's ~5 MB quota.

This slice stores the images in **IndexedDB** (large quota, async) instead, keeping the text
run store in localStorage exactly as-is.

## Architecture

Two stores, one source of truth. localStorage (`useAgentRuns`) remains authoritative for
*which* runs exist and their text. IndexedDB holds the images, keyed by run id, and simply
follows the text store via a reconcile effect. Everything is additive — the merged #5b/#5c/
#5d code paths are untouched except the additive image collection.

### Storage module — new `services/runImages.ts`

A thin async IndexedDB wrapper. DB `nexus_agent_images`, object store `runImages` with
`keyPath: 'runId'`; one record per run: `{ runId: string, images: (string | null)[] }`
(image `i` corresponds to text step `i`; `null` where a step had no screenshot).

Public API:

```ts
export function saveRunImages(runId: string, images: (string | null)[]): Promise<void>;
export function loadRunImages(runId: string): Promise<(string | null)[] | null>;
export function reconcileRunImages(keepIds: string[]): Promise<void>;
// Pure, dependency-free — unit-tested directly:
export function idsToDelete(existingIds: string[], keepIds: string[]): string[];
```

`reconcileRunImages` reads the existing record keys and deletes any whose `runId` is not in
`keepIds` (using `idsToDelete` for the set math). Every function wraps its IndexedDB work in
`try/catch` (and open-failure handling) so that if IndexedDB is unavailable or errors, it
**degrades gracefully** — `save`/`reconcile` become no-ops, `load` resolves `null`, and the
app shows no thumbnails without breaking. This mirrors how `useAgentRuns` guards
localStorage.

### Recording — `components/AgentLoopPanel.tsx`

- Compute the run id **once** at the top of `handleStart` (currently it is generated inline
  inside `addRun`); reuse it for both `addRun` and `saveRunImages`.
- Alongside the existing `recorded: AgentRunStep[]`, collect `const images: (string | null)[]
  = []`, pushing `res.image ?? null` at the same point each step is pushed to `recorded`, so
  the arrays stay index-aligned (an edited/skipped step keeps its observation image).
- In the `finally`, inside the existing `if (!stale())` block and guarded by the existing
  `recorded.length > 0`, call `void saveRunImages(runId, images)` right after `addRun(...)`.
  The write is fire-and-forget (its own try/catch); it must not block or throw into the loop.
- The concurrency guards (`runIdRef`/`stale()`/`stopRef`), the #5c pause barrier, the #5d
  approval gate, and the #5b recording all stay byte-for-byte otherwise.

### Keeping the stores in sync — reconcile effect

In `AgentLoopPanel`:

```ts
useEffect(() => { void reconcileRunImages(runs.map(r => r.id)); }, [runs]);
```

Whenever the text runs change — a new run evicts the oldest past the 20-cap, or **Geçmişi
Temizle** empties them, or on mount — IndexedDB is pruned to match. localStorage stays the
single source of truth for which runs exist; images just follow. (A brand-new run's id is
already present in `runs` by the time this runs, so its just-saved images are never pruned.)

### History UI — `components/AgentRunHistory.tsx`

- New **optional** prop `loadImages?: (runId: string) => Promise<(string | null)[] | null>`,
  wired by `AgentLoopPanel` to `loadRunImages`. Optional so the component still renders
  text-only when no loader is supplied.
- On expanding a run, call `loadImages(run.id)` once, cache the result in local state keyed by
  run id, show a brief loading state, then render a small thumbnail next to each step that has
  an image — reusing the live-log thumbnail styling (≈64×40, `object-cover`, `loading="lazy"`
  `decoding="async"`).
- Tapping a thumbnail opens the existing `ScreenshotModal` (AgentRunHistory gains a small
  `preview: string | null` state and renders `<ScreenshotModal>` when set — the same pattern
  the live log uses). No new modal.
- Runs saved before this feature (or whose images were pruned) simply resolve to `null`/no
  images → text-only detail, no error.

## Testing (zero new dependencies)

- **`services/runImages.test.ts`:** unit-test the pure `idsToDelete(existingIds, keepIds)`
  helper with plain arrays (empty keep → delete all; disjoint; overlap; keep superset). No
  IndexedDB touched.
- **`components/AgentRunHistory.test.tsx` (appended):** inject a mock `loadImages` prop
  returning a fixed `['data:image/jpeg;base64,SHOT', null]`; expand the run and assert a
  thumbnail renders for the step that has an image and none for the null step; tapping the
  thumbnail opens `ScreenshotModal` (its "Kapat" button appears). A run with no `loadImages`
  prop still renders its text steps.
- **`components/AgentLoopPanel.test.tsx` (appended):** `vi.mock('../services/runImages')`;
  after a completed run assert `saveRunImages` was called with the run's id and an images
  array containing the step's `res.image`, and that `reconcileRunImages` was called with the
  current run ids. Existing tests stay green (the mock's functions are no-op Promises).

## Global Constraints

- No new dependencies. IndexedDB is a browser API; tests mock the `runImages` module or
  inject a loader — they never touch a real IndexedDB.
- The #4b/#5c/#5d loop concurrency and the #5b recording block stay byte-for-byte except the
  additive image collection + the fire-and-forget `saveRunImages` and the reconcile effect.
- The localStorage text store (`useAgentRuns`) is untouched.
- Graceful degradation: any IndexedDB failure yields no thumbnails, never an app error.
- Turkish user-facing strings; reuse `ScreenshotModal` and the existing thumbnail styling.
- No backend change; `/ai/next-action` contract untouched.
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/agent-run-thumbnails`.
- Frontend tests from repo root: `npx vitest run`; typecheck `npx tsc --noEmit`; build
  `npm run build`.
- Vitest has no auto-cleanup — RTL tests use explicit `afterEach(cleanup)`.

## Out of Scope (deferred)

- Downscaling to smaller thumbnails (the full observation JPEG is stored as-is).
- A migration/backfill for runs created before this feature (they show text-only).
- Cross-device sync of images.
- Recovering from a manual localStorage edit that desyncs the two stores (the reconcile
  effect covers the normal add/evict/clear paths).
- A dedicated "storage used" indicator or manual image-cache purge control.

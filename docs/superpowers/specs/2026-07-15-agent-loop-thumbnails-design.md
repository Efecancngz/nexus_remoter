# Agent-Loop Per-Step Screenshot Thumbnails — Design

**Date:** 2026-07-15
**Roadmap item:** #5a (first slice of #5 "Agent-loop UX depth", built on #4b)
**Branch:** `feat/agent-loop-thumbnails`

## Goal

Show, for each agent-loop step, a thumbnail of the screen the agent observed when it
chose that action. This turns the current text-only step log into a visual play-by-play.
Tapping a thumbnail enlarges it to a full-screen preview.

This is the first slice of "agent-loop UX depth" and the enabler for later slices
(save/replay, run history) — you cannot replay a run whose observations you did not capture.

## Background

`/ai/next-action` (from #4b) already captures a screenshot every iteration via
`capture_jpeg_bytes()` and sends it to Gemini as the observation for that step. The image
is then discarded — the phone receives only `{ done, thought, action }`, so its loop log is
text-only. The `/ai/locate` route already demonstrates returning a screenshot to the phone
as a base64 data-URL via `data_url_from_jpeg_bytes()`, and the `ScreenshotModal` component
already renders such a data-URL full-screen. This slice wires the already-captured image
through to the log.

## Architecture

No new routes, no new dependencies, no new capture path. One field added to an existing
response, threaded through the client into the existing component, displayed with an
existing modal.

### Backend — `nexus_desktop/services/ai_service.py` `next_action()`

On the **`done:false`** branch only, add the screenshot to the JSON response, reusing the
already-imported `data_url_from_jpeg_bytes` helper:

```python
return jsonify({
    "success": True,
    "done": False,
    "thought": thought,
    "action": {"type": action_type, "value": value, "description": thought},
    "image": data_url_from_jpeg_bytes(jpeg),
}), 200
```

`jpeg` is the same bytes already captured and sent to Gemini this iteration — it is the
observation that produced the returned action. The `done:true` branch is unchanged (it has
no action and needs no image). No other backend change.

### Client — `services/gemini.ts` `nextAction()`

Extend the return type to carry the image and pass it through on `done:false`:

```ts
): Promise<{ done: boolean; thought?: string; action?: AutomationStep; summary?: string; image?: string }> => {
  const data = await callAgent('/ai/next-action', ip, token, { goal, history });
  if (data.done) {
    return { done: true, summary: data.summary };
  }
  const a = data.action ?? {};
  return {
    done: false,
    thought: data.thought,
    action: { /* unchanged: id + type + value + description */ },
    image: data.image,
  };
};
```

`done:true` still omits `image`.

### Component — `components/AgentLoopPanel.tsx`

- `LogRow` gains an optional `image?: string`.
- When the running row is pushed each iteration, include `image: res.image`.
- Each log row that has an `image` renders a small thumbnail before the thought/label —
  an `<img>` at roughly 64×40, `object-cover`, rounded, with a `data-testid` for testing.
  A row without an image renders no thumbnail (e.g. rows from a run where the field was
  absent).
- New state `preview: string | null`. Clicking a thumbnail sets `preview` to that row's
  data-URL. When `preview` is non-null, render the existing `ScreenshotModal`
  (`dataUrl={preview} onClose={() => setPreview(null)}`) — reused, not rebuilt.
- The loop control logic (generation token, STOP, cap, history) is untouched.

## Payload / Performance

Reuses the existing ≤1280px, JPEG-q70 data-URL (identical to `/ai/locate`) — no new capture
or encoding path. Up to `MAX_STEPS` (15) images live in the React log state per run; a new
run clears the log (`setLog([])`), so memory is bounded and session-scoped. No persistence.

## Testing

**Backend** (`nexus_desktop/tests/test_ai_service.py`, appended):
- `done:false` response includes an `image` field that starts with `data:image/jpeg;base64,`.
- `done:true` response has no `image` field.

**Client** (`services/gemini.test.ts`, appended):
- `nextAction` surfaces `image` on a `done:false` response.
- `nextAction` omits `image` (undefined) on a `done:true` response.

**Component** (`components/AgentLoopPanel.test.tsx`, appended):
- A step whose `nextAction` result includes an `image` renders a thumbnail (by `data-testid`).
- Clicking the thumbnail opens `ScreenshotModal` showing that data-URL.
- A step result without an `image` renders no thumbnail.

## Global Constraints

- No new dependencies.
- Reuse `data_url_from_jpeg_bytes` (backend) and `ScreenshotModal` (frontend) — do not
  build a new capture path or a new modal.
- Turkish user-facing strings; `alt`/`aria` text Turkish.
- The `/ai/next-action` token/guard contract (401/503/400/502) is unchanged.
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/agent-loop-thumbnails`.

## Out of Scope (deferred to later #5 slices)

- A final-state screenshot on `done:true`.
- Pause/resume of the loop.
- Persisting runs / run history / replay.
- Expandable/inline-editable steps.
- Per-step thumbnails smaller than the ≤1280px capture (a dedicated small thumbnail encode).

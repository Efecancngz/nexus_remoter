# Agent-Loop Per-Step Screenshot Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a thumbnail of the screen the agent observed for each loop step (tap to enlarge), turning the text-only step log into a visual play-by-play.

**Architecture:** `/ai/next-action` already captures the observation screenshot each step and discards it after sending to Gemini. Return it (as a data-URL) on the `done:false` response, thread it through the `nextAction()` client, and render it as a per-row thumbnail in `AgentLoopPanel` that opens the existing `ScreenshotModal` on tap. No new routes, deps, capture path, or modal.

**Tech Stack:** Flask + google-generativeai (backend); React 19 + TypeScript + Vitest/RTL (frontend).

## Global Constraints

- No new dependencies.
- Reuse `data_url_from_jpeg_bytes` (already imported in `ai_service.py`) and the existing `ScreenshotModal` component — do not build a new capture path or a new modal.
- Turkish user-facing strings; image `alt` text Turkish.
- The `/ai/next-action` token/guard contract (401/503/400/502) is unchanged.
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/agent-loop-thumbnails` (already created and checked out; the spec commit is its first commit).
- Backend tests run from `nexus_desktop/`: `python -m pytest tests -q`. Frontend tests run from repo root: `npx vitest run`. Type-check: `npx tsc --noEmit`.

## File Structure

- `nexus_desktop/services/ai_service.py` (modify) — add `image` to the `next_action` `done:false` response.
- `nexus_desktop/tests/test_ai_service.py` (modify) — append 2 tests.
- `services/gemini.ts` (modify) — add `image` to `nextAction`'s return type and pass it through.
- `services/gemini.test.ts` (modify) — append 2 tests.
- `components/AgentLoopPanel.tsx` (modify) — `LogRow.image`, thumbnail render, `ScreenshotModal` on tap.
- `components/AgentLoopPanel.test.tsx` (modify) — append 3 tests.

---

### Task 1: Backend — return the observation screenshot on `done:false`

**Files:**
- Modify: `nexus_desktop/services/ai_service.py`
- Test: `nexus_desktop/tests/test_ai_service.py`

**Interfaces:**
- Consumes: `data_url_from_jpeg_bytes` (already imported at the top of `ai_service.py`) and the `jpeg` bytes already captured in `next_action()`.
- Produces: the `/ai/next-action` `done:false` response gains a top-level `"image"` field containing a `data:image/jpeg;base64,…` data-URL of the observation screenshot. The `done:true` response is unchanged (no `image`).

- [ ] **Step 1: Write the failing tests**

Append to `nexus_desktop/tests/test_ai_service.py` (the `_build_client`, `_token`, `_patch_capture`, `FakeGenerativeModel` helpers already exist; `_patch_capture` makes `capture_jpeg_bytes` return `b"\xff\xd8fakejpeg"`):

```python
def test_next_action_includes_screenshot_on_action(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps(
        {"done": False, "thought": "Chrome açılıyor", "type": "LAUNCH_APP", "value": "chrome"}
    )
    res = client.post(
        '/ai/next-action',
        json={'goal': 'Chrome ac', 'history': []},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['done'] is False
    assert body['image'].startswith('data:image/jpeg;base64,')


def test_next_action_done_omits_image(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"done": True, "summary": "bitti"})
    res = client.post(
        '/ai/next-action',
        json={'goal': 'x', 'history': []},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['done'] is True
    assert 'image' not in body
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `nexus_desktop/`): `python -m pytest tests/test_ai_service.py -q -k "includes_screenshot or done_omits_image"`
Expected: FAIL — `test_next_action_includes_screenshot_on_action` fails with `KeyError: 'image'` (the `done:false` response has no `image` field yet). The `done_omits_image` test passes already (guards against regression).

- [ ] **Step 3: Add the `image` field to the `done:false` response**

In `nexus_desktop/services/ai_service.py`, in `next_action()`, the `done:false` branch currently returns:

```python
            return jsonify({
                "success": True,
                "done": False,
                "thought": thought,
                "action": {
                    "type": action_type,
                    "value": value,
                    "description": thought,
                },
            }), 200
```

Change it to add the screenshot data-URL (the `jpeg` variable is already in scope from the capture earlier in the method):

```python
            return jsonify({
                "success": True,
                "done": False,
                "thought": thought,
                "action": {
                    "type": action_type,
                    "value": value,
                    "description": thought,
                },
                "image": data_url_from_jpeg_bytes(jpeg),
            }), 200
```

Leave the `done:true` branch unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `nexus_desktop/`): `python -m pytest tests/test_ai_service.py -q -k "next_action"`
Expected: PASS (all next_action tests, including the 2 new ones).

Then the full suite: `python -m pytest tests -q`
Expected: PASS, output pristine (the pre-existing `google.generativeai` FutureWarning is the only warning).

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/services/ai_service.py nexus_desktop/tests/test_ai_service.py
git commit -m "feat: return the observation screenshot on /ai/next-action action steps"
```

---

### Task 2: Client — thread `image` through `nextAction()`

**Files:**
- Modify: `services/gemini.ts`
- Test: `services/gemini.test.ts`

**Interfaces:**
- Consumes: the `/ai/next-action` response's new top-level `image` field (Task 1).
- Produces: `nextAction(...)` return type becomes `{ done: boolean; thought?: string; action?: AutomationStep; summary?: string; image?: string }`. On `done:false`, `image` is `data.image`; on `done:true`, `image` is absent (undefined).

- [ ] **Step 1: Write the failing tests**

Append to `services/gemini.test.ts`, inside the existing `describe('nextAction', ...)` block (after its last test):

```ts
    it('surfaces the step screenshot on a not-done response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          success: true,
          done: false,
          thought: 'tıkla',
          action: { type: 'MOUSE_CLICK', value: '50%,8%', description: 'tıkla' },
          image: 'data:image/jpeg;base64,abc',
        })
      );

      const result = await nextAction('1.2.3.4', 'tok', 'x', []);

      expect(result.image).toBe('data:image/jpeg;base64,abc');
    });

    it('has no image on a done response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, { success: true, done: true, summary: 'bitti' })
      );

      const result = await nextAction('1.2.3.4', 'tok', 'x', []);

      expect(result.image).toBeUndefined();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from repo root): `npx vitest run services/gemini.test.ts`
Expected: FAIL — `surfaces the step screenshot on a not-done response` fails because `result.image` is `undefined` (the client does not read `data.image` yet). The `done` test passes already.

- [ ] **Step 3: Add `image` to the return type and the `done:false` return**

In `services/gemini.ts`, the current `nextAction` is:

```ts
export const nextAction = async (
  ip: string,
  token: string,
  goal: string,
  history: { type: string; description: string }[]
): Promise<{ done: boolean; thought?: string; action?: AutomationStep; summary?: string }> => {
  const data = await callAgent('/ai/next-action', ip, token, { goal, history });
  if (data.done) {
    return { done: true, summary: data.summary };
  }
  const a = data.action ?? {};
  return {
    done: false,
    thought: data.thought,
    action: {
      id: (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11)),
      type: a.type,
      value: a.value,
      description: a.description,
    },
  };
};
```

Change the return type annotation to include `image?: string`, and add `image: data.image` to the `done:false` return object:

```ts
export const nextAction = async (
  ip: string,
  token: string,
  goal: string,
  history: { type: string; description: string }[]
): Promise<{ done: boolean; thought?: string; action?: AutomationStep; summary?: string; image?: string }> => {
  const data = await callAgent('/ai/next-action', ip, token, { goal, history });
  if (data.done) {
    return { done: true, summary: data.summary };
  }
  const a = data.action ?? {};
  return {
    done: false,
    thought: data.thought,
    action: {
      id: (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 11)),
      type: a.type,
      value: a.value,
      description: a.description,
    },
    image: data.image,
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from repo root): `npx vitest run services/gemini.test.ts`
Expected: PASS (all gemini tests, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add services/gemini.ts services/gemini.test.ts
git commit -m "feat: thread the step screenshot through the nextAction client"
```

---

### Task 3: Component — render per-step thumbnail with tap-to-enlarge

**Files:**
- Modify: `components/AgentLoopPanel.tsx`
- Test: `components/AgentLoopPanel.test.tsx`

**Interfaces:**
- Consumes: `nextAction(...)`'s `image?: string` (Task 2); the existing `ScreenshotModal` (`{ dataUrl: string; onClose: () => void }`, default-named export `ScreenshotModal` from `./ScreenshotModal`).
- Produces: no new exports. `AgentLoopPanel` renders a thumbnail (`data-testid="step-thumbnail"`) for each log row that has an image; tapping it opens `ScreenshotModal`.

- [ ] **Step 1: Write the failing tests**

Append to `components/AgentLoopPanel.test.tsx` (inside the existing `describe('AgentLoopPanel', ...)`, after the last test). The existing file already imports `render, screen, fireEvent, waitFor, cleanup`, `vi`, spies `gemini.nextAction` / `executor.run`, and has `afterEach(cleanup)` — the tests below need no new imports.

```tsx
  it('renders a thumbnail for a step that has a screenshot', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({
        done: false,
        thought: 'tıkla',
        action: { id: '1', type: 'MOUSE_CLICK', value: '10%,10%', description: 'tıkla' },
        image: 'data:image/jpeg;base64,STEPSHOT',
      })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Hedef/i);
    fireEvent.change(input, { target: { value: 'kedi ara' } });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));

    const thumb = await screen.findByTestId('step-thumbnail');
    const img = thumb.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('data:image/jpeg;base64,STEPSHOT');
  });

  it('opens the full-screen ScreenshotModal when the thumbnail is tapped', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({
        done: false,
        thought: 'tıkla',
        action: { id: '1', type: 'MOUSE_CLICK', value: '10%,10%', description: 'tıkla' },
        image: 'data:image/jpeg;base64,STEPSHOT',
      })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Hedef/i);
    fireEvent.change(input, { target: { value: 'kedi ara' } });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));

    fireEvent.click(await screen.findByTestId('step-thumbnail'));

    // ScreenshotModal renders its own "Kapat" close button and an <img alt="Ekran görüntüsü">.
    expect(await screen.findByRole('button', { name: 'Kapat' })).toBeTruthy();
    expect(screen.getByAltText('Ekran görüntüsü').getAttribute('src')).toBe(
      'data:image/jpeg;base64,STEPSHOT'
    );
  });

  it('renders no thumbnail for a step without a screenshot', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({
        done: false,
        thought: 'tıkla',
        action: { id: '1', type: 'MOUSE_CLICK', value: '10%,10%', description: 'tıkla' },
      })
      .mockResolvedValueOnce({ done: true, summary: 'bitti' });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    const input = screen.getByPlaceholderText(/Hedef/i);
    fireEvent.change(input, { target: { value: 'kedi ara' } });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));

    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('step-thumbnail')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from repo root): `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: FAIL — the two thumbnail tests fail (`findByTestId('step-thumbnail')` times out) because the component renders no thumbnail yet. The "no thumbnail" test passes already.

- [ ] **Step 3: Implement the thumbnail + modal**

In `components/AgentLoopPanel.tsx`, make these edits:

Add the `ScreenshotModal` import after the `HudPanel` import (line 5):

```tsx
import HudPanel from './hud/HudPanel';
import { ScreenshotModal } from './ScreenshotModal';
```

Add `image` to the `LogRow` interface:

```tsx
interface LogRow {
  thought: string;
  label: string;
  status: StepStatus;
  image?: string;
}
```

Add a `preview` state alongside the others (after the `log` state, line 33):

```tsx
  const [log, setLog] = useState<LogRow[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
```

Include the image when pushing the running row. Change (line 57):

```tsx
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running' }]);
```

to:

```tsx
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running', image: res.image }]);
```

(`markLast` spreads `...r`, so the `image` is preserved across the running→done/failed transition — no change needed there.)

In the log row `<li>`, render the thumbnail right after the step-number `<span>` (line 126). Change:

```tsx
            <li key={i} className="flex items-start gap-2 text-[11px] font-data text-slate-300">
              <span className="text-slate-600 w-8 shrink-0">{i + 1}/{MAX_STEPS}</span>
              {row.status === 'running' && <Loader2 size={13} className="animate-spin text-hud-cyan shrink-0 mt-0.5" />}
```

to:

```tsx
            <li key={i} className="flex items-start gap-2 text-[11px] font-data text-slate-300">
              <span className="text-slate-600 w-8 shrink-0">{i + 1}/{MAX_STEPS}</span>
              {row.image && (
                <button
                  type="button"
                  data-testid="step-thumbnail"
                  onClick={() => setPreview(row.image!)}
                  className="shrink-0 active:scale-95 transition-transform"
                >
                  <img
                    src={row.image}
                    alt="Adım görüntüsü"
                    className="w-16 h-10 object-cover rounded-sm border border-hud-dim"
                  />
                </button>
              )}
              {row.status === 'running' && <Loader2 size={13} className="animate-spin text-hud-cyan shrink-0 mt-0.5" />}
```

Render the modal at the end of the component, just before the closing `</HudPanel>` (line 137-138, after the `{log.length > 0 && (...)}` block):

```tsx
      )}

      {preview && <ScreenshotModal dataUrl={preview} onClose={() => setPreview(null)} />}
    </HudPanel>
```

- [ ] **Step 4: Run the tests, type-check, and full suite**

Run (from repo root):
```bash
npx vitest run components/AgentLoopPanel.test.tsx
npx tsc --noEmit
npx vitest run
```
Expected: the AgentLoopPanel file passes (the original tests plus the 3 new ones); `tsc` clean; the full vitest suite passes. Output pristine.

- [ ] **Step 5: Commit**

```bash
git add components/AgentLoopPanel.tsx components/AgentLoopPanel.test.tsx
git commit -m "feat: show a per-step screenshot thumbnail in the agent loop log"
```

---

## Self-Review Notes

- **Spec coverage:** backend returns the observation screenshot on `done:false` (Task 1); client threads `image` through (Task 2); component renders the thumbnail and reuses `ScreenshotModal` on tap (Task 3). The out-of-scope items (final-state screenshot, pause/resume, run history, inline edit) are not touched.
- **Reuse:** `data_url_from_jpeg_bytes` (already imported) and `ScreenshotModal` (existing component) are reused; no new capture path or modal.
- **Type consistency:** `nextAction` return gains `image?: string` (Task 2); `LogRow.image?: string` and `res.image` consumption in Task 3 match it. `ScreenshotModal` prop names (`dataUrl`, `onClose`) match its definition.
- **Test isolation:** the component tests reuse the file's existing `afterEach(cleanup)` and `vi.spyOn` conventions; the "no thumbnail" test asserts absence after the loop completes, avoiding a race.
- **Bounded state:** up to `MAX_STEPS` images in `log` state; `setLog([])` on each new run clears them (unchanged behavior).

# Computer-Use Loop (act→observe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded autonomous "act→observe" loop where the AI pursues a high-level Turkish goal by repeatedly observing the screen, deciding one next action, and executing it.

**Architecture:** Phone drives the loop; the PC decides one step at a time. A new `POST /ai/next-action` route screenshots the screen and asks Gemini vision for the single next action (or `done`). A new phone client `nextAction()` and an `AgentLoopPanel` component run the loop against the existing `executor`, with a STOP button and a hard step cap. Reuses the #4a vision infrastructure end to end.

**Tech Stack:** Flask + google-generativeai (backend), React 19 + TypeScript + Vitest/RTL (frontend).

## Global Constraints

- No new dependencies.
- Reuse `capture_jpeg_bytes` (`utils/screen_capture.py`), `_clamp_pct` and `_ACTION_TYPES` (`services/ai_service.py`), `parse_coord` (`actions/_coords.py`), `callAgent` (`services/gemini.ts`), `executor` (`services/automation.ts`), and `HudPanel`.
- All user-facing strings and the Gemini system instruction are Turkish.
- Token-guarded: 401 unauthorized / 503 AI disabled / 400 validation / 502 Gemini error — identical to the other `/ai/*` routes.
- Click coordinates use the `0–1000 → clamped percent → "x%,y%"` scheme from #4a (only `MOUSE_CLICK` is a coordinate action).
- No `Co-Authored-By` trailer on commits.
- Branch: `feat/computer-use-loop` (already created and checked out; the spec commit is its first commit).
- Backend tests run from `nexus_desktop/`: `python -m pytest tests -q`. Frontend tests run from repo root: `npx vitest run`.

## File Structure

- `nexus_desktop/services/ai_service.py` (modify) — add `_NEXT_ACTION_INSTRUCTION`, `_NEXT_ACTION_SCHEMA`, `_COORD_TYPES`, register `/ai/next-action`, add the `next_action()` handler.
- `nexus_desktop/tests/test_ai_service.py` (modify) — append `/ai/next-action` tests.
- `services/gemini.ts` (modify) — add the `nextAction()` client.
- `services/gemini.test.ts` (modify) — append `nextAction` tests.
- `components/AgentLoopPanel.tsx` (create) — the loop UI + control logic.
- `components/AgentLoopPanel.test.tsx` (create) — component tests.
- `App.tsx` (modify) — render `<AgentLoopPanel>` under `<SmartClickPanel>` in the AI tab.

---

### Task 1: Backend `/ai/next-action` route

**Files:**
- Modify: `nexus_desktop/services/ai_service.py`
- Test: `nexus_desktop/tests/test_ai_service.py`

**Interfaces:**
- Consumes: `capture_jpeg_bytes` and `_clamp_pct` (already imported/defined in `ai_service.py`), `_ACTION_TYPES` (module-level list), the `_guard()` / `_model()` methods.
- Produces: `POST /ai/next-action`. Request `{ goal: str, history: [{type, description}] }`. Response is either `{ "success": true, "done": true, "summary": str }` or `{ "success": true, "done": false, "thought": str, "action": { "type": str, "value": str, "description": str } }`. Errors: 401 / 503 / 400 / 502.

- [ ] **Step 1: Write the failing tests**

Append to `nexus_desktop/tests/test_ai_service.py` (the `_patch_capture`, `_build_client`, `_token`, and `FakeGenerativeModel` helpers already exist at the top of the file):

```python
# --- /ai/next-action (computer-use loop) ---

def test_next_action_without_token_rejected(monkeypatch):
    client, _, _ = _build_client(monkeypatch)
    res = client.post('/ai/next-action', json={'goal': 'Chrome ac'})
    assert res.status_code == 401


def test_next_action_disabled_when_api_key_missing(monkeypatch):
    client, security, svc = _build_client(monkeypatch, api_key=None)
    token = _token(security)
    res = client.post(
        '/ai/next-action',
        json={'goal': 'Chrome ac'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 503


def test_next_action_missing_goal_rejected(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    res = client.post('/ai/next-action', json={}, headers={'X-Nexus-Token': token})
    assert res.status_code == 400

    res2 = client.post('/ai/next-action', json={'goal': '   '}, headers={'X-Nexus-Token': token})
    assert res2.status_code == 400


def test_next_action_done_passes_summary_through(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"done": True, "summary": "Kedi araması tamamlandı"})
    res = client.post(
        '/ai/next-action',
        json={'goal': 'kedi ara', 'history': []},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    assert body['done'] is True
    assert body['summary'] == "Kedi araması tamamlandı"
    assert 'action' not in body
    # The screenshot must be sent to Gemini as an image part.
    contents = FakeGenerativeModel.last_instance.last_contents
    assert contents[0]['mime_type'] == 'image/jpeg'
    assert 'response_schema' in FakeGenerativeModel.last_instance.generation_config


def test_next_action_non_click_passes_value_through(monkeypatch):
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
    assert body['thought'] == "Chrome açılıyor"
    assert body['action'] == {
        "type": "LAUNCH_APP",
        "value": "chrome",
        "description": "Chrome açılıyor",
    }


def test_next_action_click_maps_coords_to_percent(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps(
        {"done": False, "thought": "Adres çubuğuna tıkla", "type": "MOUSE_CLICK", "x": 500, "y": 80}
    )
    res = client.post(
        '/ai/next-action',
        json={'goal': 'x', 'history': []},
        headers={'X-Nexus-Token': token},
    )
    body = res.get_json()
    assert body['action']['type'] == 'MOUSE_CLICK'
    assert body['action']['value'] == '50.0%,8.0%'
    assert body['action']['description'] == 'Adres çubuğuna tıkla'


def test_next_action_click_clamps_out_of_range_coords(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps(
        {"done": False, "thought": "t", "type": "MOUSE_CLICK", "x": 1200, "y": -30}
    )
    res = client.post(
        '/ai/next-action',
        json={'goal': 'x'},
        headers={'X-Nexus-Token': token},
    )
    body = res.get_json()
    assert body['action']['value'] == '100.0%,0.0%'


def test_next_action_serializes_history_into_prompt(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"done": True, "summary": "ok"})
    client.post(
        '/ai/next-action',
        json={'goal': 'kedi ara', 'history': [{'type': 'LAUNCH_APP', 'description': 'Chrome açıldı'}]},
        headers={'X-Nexus-Token': token},
    )
    # The text part must carry the goal and the prior step description.
    text_part = FakeGenerativeModel.last_instance.last_contents[1]
    assert 'kedi ara' in text_part
    assert 'Chrome açıldı' in text_part


def test_next_action_upstream_exception_returns_502(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.should_raise = RuntimeError("upstream boom")
    res = client.post(
        '/ai/next-action',
        json={'goal': 'x'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 502
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `nexus_desktop/`): `python -m pytest tests/test_ai_service.py -q -k next_action`
Expected: FAIL — the route is not registered, so posts to `/ai/next-action` return 404, and the assertions fail.

- [ ] **Step 3: Add the instruction, schema, coord-type set, route registration, and handler**

In `nexus_desktop/services/ai_service.py`, after the `_LOCATE_SCHEMA` / `_clamp_pct` block (before `class AiService`), add:

```python
_COORD_TYPES = {"MOUSE_CLICK"}

_NEXT_ACTION_INSTRUCTION = (
    "Sen bir Windows bilgisayarını kontrol eden bir otomasyon ajanısın.\n"
    "Sana bir hedef, ekranın güncel görüntüsü ve şimdiye kadar yaptığın adımlar verilecek.\n"
    "Görevini tamamlamak için atılacak TEK bir sonraki adımı seç.\n"
    "Hedef zaten tamamlandıysa done=true ve summary (kısa Türkçe özet) döndür.\n"
    "Aksi halde done=false döndür ve şunları ver:\n"
    "- thought: ne yapacağını açıklayan kısa bir Türkçe cümle\n"
    "- type: aşağıdaki listeden bir eylem tipi\n"
    "- MOUSE_CLICK için: x ve y (0-1000 aralığında normalize edilmiş tam sayı; "
    "x soldan sağa, y yukarıdan aşağıya). value boş bırakılabilir.\n"
    "- Diğer tipler için: value (örn. LAUNCH_APP için 'chrome', TYPE_TEXT için yazılacak metin).\n"
    "Her seferinde yalnızca bir adım döndür.\n\n"
    "Kullanılabilir Tipler: " + ", ".join(_ACTION_TYPES)
)

_NEXT_ACTION_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "done": {"type": "BOOLEAN"},
        "thought": {"type": "STRING"},
        "type": {"type": "STRING", "enum": _ACTION_TYPES},
        "value": {"type": "STRING"},
        "x": {"type": "INTEGER"},
        "y": {"type": "INTEGER"},
        "summary": {"type": "STRING"},
    },
    "required": ["done"],
}
```

Register the route inside `register()`, after the `/ai/locate` line:

```python
        app.add_url_rule('/ai/next-action', 'ai_next_action', self.next_action, methods=['POST'])
```

Add the handler method to the `AiService` class (place it after `locate`):

```python
    def next_action(self):
        guard = self._guard()
        if guard:
            return guard
        data = request.json or {}
        goal = data.get('goal', '')
        if not goal or not goal.strip():
            return jsonify({"success": False, "error": "Missing goal"}), 400
        history = data.get('history') or []
        history_lines = "\n".join(
            f"- {h.get('type', '')}: {h.get('description', '')}" for h in history
        ) or "(henüz yok)"
        prompt = f"Hedef: {goal}\nŞimdiye kadar yapılanlar:\n{history_lines}"
        try:
            jpeg = capture_jpeg_bytes()
            model = self._model(_NEXT_ACTION_INSTRUCTION, _NEXT_ACTION_SCHEMA)
            resp = model.generate_content([
                {"mime_type": "image/jpeg", "data": jpeg},
                prompt,
            ])
            result = json.loads(resp.text)
            if result.get("done"):
                return jsonify({
                    "success": True,
                    "done": True,
                    "summary": result.get("summary", ""),
                }), 200
            thought = result.get("thought", "")
            action_type = result.get("type", "")
            if action_type in _COORD_TYPES:
                value = f"{_clamp_pct(result.get('x', 0) / 10.0)}%,{_clamp_pct(result.get('y', 0) / 10.0)}%"
            else:
                value = result.get("value", "")
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
        except Exception as e:
            logging.error("[AI] next_action error: %s", e)
            return jsonify({"success": False, "error": str(e)}), 502
```

- [ ] **Step 4: Run the new tests and the full backend suite**

Run (from `nexus_desktop/`): `python -m pytest tests/test_ai_service.py -q -k next_action`
Expected: PASS (9 next_action tests).

Then the full suite: `python -m pytest tests -q`
Expected: PASS, output pristine (the pre-existing `google.generativeai` FutureWarning is the only warning and is unrelated).

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/services/ai_service.py nexus_desktop/tests/test_ai_service.py
git commit -m "feat: add /ai/next-action route for the computer-use loop"
```

---

### Task 2: Frontend `nextAction()` client

**Files:**
- Modify: `services/gemini.ts`
- Test: `services/gemini.test.ts`

**Interfaces:**
- Consumes: `callAgent(path, ip, token, body)` (already in `gemini.ts`, maps 401→`AUTH_REQUIRED`, 503→config error, `data.error` otherwise); `AutomationStep` from `../types`.
- Produces: `nextAction(ip, token, goal, history) => Promise<{ done: boolean; thought?: string; action?: AutomationStep; summary?: string }>`. On `done:false` the returned `action` is a full `AutomationStep` with a freshly generated `id` so it can be passed straight to `executor.run`.

- [ ] **Step 1: Write the failing tests**

Append to `services/gemini.test.ts` (inside the top-level `describe('gemini service ...')`, after the `locate` describe block; also add `nextAction` to the import on line 2):

Change line 2 from:
```ts
import { generateMacro, generateMacroFromAudio, parseSchedulerPrompt, locate } from './gemini';
```
to:
```ts
import { generateMacro, generateMacroFromAudio, parseSchedulerPrompt, locate, nextAction } from './gemini';
```

Then add:
```ts
  describe('nextAction', () => {
    it('posts goal and history and returns an action with an id when not done', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          success: true,
          done: false,
          thought: 'Adres çubuğuna tıkla',
          action: { type: 'MOUSE_CLICK', value: '50%,8%', description: 'Adres çubuğuna tıkla' },
        })
      );

      const history = [{ type: 'LAUNCH_APP', description: 'Chrome açıldı' }];
      const result = await nextAction('192.168.1.5', 'tok-123', 'kedi ara', history);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://192.168.1.5:8080/ai/next-action');
      expect(options.headers['X-Nexus-Token']).toBe('tok-123');
      expect(JSON.parse(options.body)).toEqual({ goal: 'kedi ara', history });
      expect(result.done).toBe(false);
      expect(result.thought).toBe('Adres çubuğuna tıkla');
      expect(result.action?.type).toBe('MOUSE_CLICK');
      expect(result.action?.value).toBe('50%,8%');
      expect(result.action?.id).toBeTruthy();
    });

    it('returns done with the summary and no action when the goal is complete', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, { success: true, done: true, summary: 'Görev tamamlandı' })
      );

      const result = await nextAction('1.2.3.4', 'tok', 'x', []);

      expect(result.done).toBe(true);
      expect(result.summary).toBe('Görev tamamlandı');
      expect(result.action).toBeUndefined();
    });

    it('throws AUTH_REQUIRED on a 401 response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(401, {}));

      await expect(nextAction('1.2.3.4', 'bad-tok', 'x', [])).rejects.toThrow('AUTH_REQUIRED');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from repo root): `npx vitest run services/gemini.test.ts`
Expected: FAIL — `nextAction` is not exported (import error / undefined).

- [ ] **Step 3: Implement `nextAction`**

Append to `services/gemini.ts` (after the `locate` export):

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

- [ ] **Step 4: Run the tests to verify they pass**

Run (from repo root): `npx vitest run services/gemini.test.ts`
Expected: PASS (all existing gemini tests plus the 3 new `nextAction` tests).

- [ ] **Step 5: Commit**

```bash
git add services/gemini.ts services/gemini.test.ts
git commit -m "feat: add nextAction client for the /ai/next-action route"
```

---

### Task 3: `AgentLoopPanel` component

**Files:**
- Create: `components/AgentLoopPanel.tsx`
- Test: `components/AgentLoopPanel.test.tsx`

**Interfaces:**
- Consumes: `nextAction` from `../services/gemini`; `executor` from `../services/automation` (`executor.run(steps, ip, token) => Promise<{ success, error? }>`); `HudPanel` from `./hud/HudPanel`.
- Produces: default export `AgentLoopPanel({ ip, token, onToast })`. `onToast: (message: string, type?: 'success'|'error'|'warning'|'info') => void`.

- [ ] **Step 1: Write the failing tests**

Create `components/AgentLoopPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AgentLoopPanel from './AgentLoopPanel';
import * as gemini from '../services/gemini';
import { executor } from '../services/automation';

describe('AgentLoopPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  function startWithGoal(goal: string) {
    const input = screen.getByPlaceholderText(/Hedef/i);
    fireEvent.change(input, { target: { value: goal } });
    fireEvent.click(screen.getByRole('button', { name: /Başlat/i }));
  }

  const clickAction = {
    id: '1',
    type: 'MOUSE_CLICK',
    value: '10%,10%',
    description: 'Bir yere tıkla',
  };

  it('runs the loop until done and toasts the summary', async () => {
    vi.spyOn(gemini, 'nextAction')
      .mockResolvedValueOnce({ done: false, thought: 'tıkla', action: clickAction })
      .mockResolvedValueOnce({ done: true, summary: 'Görev bitti' });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });
    const onToast = vi.fn();

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    startWithGoal('kedi ara');

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Görev bitti', 'success'));
    expect(runSpy).toHaveBeenCalledTimes(1);
    const [steps] = runSpy.mock.calls[0];
    expect(steps[0].type).toBe('MOUSE_CLICK');
  });

  it('stops between iterations when STOP is pressed', async () => {
    let resolveExec: (v: { success: boolean }) => void = () => {};
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockReturnValue(
      new Promise(r => {
        resolveExec = r;
      })
    );

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    startWithGoal('sonsuz');

    // First iteration reached execution and is now pending.
    await screen.findByText(/MOUSE_CLICK/);
    fireEvent.click(screen.getByRole('button', { name: /Durdur/i }));
    resolveExec({ success: true });

    // The loop must not request a second action after STOP.
    await waitFor(() => expect(gemini.nextAction).toHaveBeenCalledTimes(1));
  });

  it('enforces the 15-step cap and warns', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: true });
    const onToast = vi.fn();

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    startWithGoal('bitmeyen');

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Adım sınırına ulaşıldı', 'warning'));
    expect(gemini.nextAction).toHaveBeenCalledTimes(15);
  });

  it('halts and toasts when a step fails', async () => {
    vi.spyOn(gemini, 'nextAction').mockResolvedValue({
      done: false,
      thought: 'tıkla',
      action: clickAction,
    });
    vi.spyOn(executor, 'run').mockResolvedValue({ success: false, error: 'PC hatası' });
    const onToast = vi.fn();

    render(<AgentLoopPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    startWithGoal('hata');

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('PC hatası', 'error'));
    expect(gemini.nextAction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from repo root): `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: FAIL — `./AgentLoopPanel` does not exist (module resolution error).

- [ ] **Step 3: Implement the component**

Create `components/AgentLoopPanel.tsx`:

```tsx
import React, { useState, useRef } from 'react';
import { Bot, Play, Square, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { nextAction } from '../services/gemini';
import { executor } from '../services/automation';
import HudPanel from './hud/HudPanel';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface AgentLoopPanelProps {
  ip: string;
  token: string;
  onToast: (message: string, type?: ToastType) => void;
}

type StepStatus = 'running' | 'done' | 'failed';

interface LogRow {
  thought: string;
  label: string;
  status: StepStatus;
}

const MAX_STEPS = 15;

function markLast(rows: LogRow[], status: StepStatus): LogRow[] {
  if (rows.length === 0) return rows;
  return rows.map((r, i) => (i === rows.length - 1 ? { ...r, status } : r));
}

export default function AgentLoopPanel({ ip, token, onToast }: AgentLoopPanelProps) {
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogRow[]>([]);
  const stopRef = useRef(false);

  const handleStart = async () => {
    const value = goal.trim();
    if (!value || running) return;
    stopRef.current = false;
    setRunning(true);
    setLog([]);
    const history: { type: string; description: string }[] = [];
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopRef.current) break;
        const res = await nextAction(ip, token, value, history);
        if (res.done) {
          onToast(res.summary || 'Görev tamamlandı', 'success');
          break;
        }
        if (stopRef.current) break;
        const action = res.action!;
        const label = `${action.type}: ${action.value}`;
        setLog(prev => [...prev, { thought: res.thought || '', label, status: 'running' }]);
        const exec = await executor.run([action], ip, token);
        if (!exec.success) {
          setLog(prev => markLast(prev, 'failed'));
          onToast(exec.error || 'Adım başarısız', 'error');
          break;
        }
        setLog(prev => markLast(prev, 'done'));
        history.push({ type: action.type, description: action.description });
        if (step === MAX_STEPS - 1) {
          onToast('Adım sınırına ulaşıldı', 'warning');
        }
      }
    } catch (e: any) {
      onToast(e?.message || 'Döngü hatası oluştu.', 'error');
    } finally {
      setRunning(false);
    }
  };

  const handleStop = () => {
    stopRef.current = true;
    setRunning(false);
  };

  return (
    <HudPanel className="p-5 space-y-4">
      <div className="flex items-center gap-2 text-hud-cyan">
        <Bot size={18} />
        <h3 className="text-sm font-display font-bold uppercase tracking-[0.15em]">Ajan Döngüsü</h3>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Bir hedef tarif edin; ajan ekranı görüp adım adım kendi kendine ilerlesin. İstediğiniz an durdurun.
      </p>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-hud-bg/80 border border-hud-dim rounded-sm font-data p-3 text-sm outline-none placeholder:text-slate-600 focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20 transition-colors disabled:opacity-50"
          placeholder="Hedef: Chrome'u aç ve kedi ara"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleStart(); }}
          disabled={running}
        />
        {running ? (
          <button
            onClick={handleStop}
            className="px-5 bg-red-500 text-slate-950 font-black rounded-sm flex items-center gap-2 active:scale-95 transition-all"
          >
            <Square size={16} />
            Durdur
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={!goal.trim()}
            className="px-5 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
          >
            <Play size={16} />
            Başlat
          </button>
        )}
      </div>

      {log.length > 0 && (
        <ol className="space-y-1.5">
          {log.map((row, i) => (
            <li key={i} className="flex items-start gap-2 text-[11px] font-data text-slate-300">
              <span className="text-slate-600 w-8 shrink-0">{i + 1}/{MAX_STEPS}</span>
              {row.status === 'running' && <Loader2 size={13} className="animate-spin text-hud-cyan shrink-0 mt-0.5" />}
              {row.status === 'done' && <CheckCircle2 size={13} className="text-hud-cyan shrink-0 mt-0.5" />}
              {row.status === 'failed' && <XCircle size={13} className="text-red-500 shrink-0 mt-0.5" />}
              <span className="flex-1">
                <span className="text-slate-400">{row.thought}</span>
                <span className="block text-slate-600">{row.label}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </HudPanel>
  );
}
```

Note: the danger styling uses `red-500` (the project's `tailwind.config.js` defines no `hud-red`; `red-500`/`red-400` are the danger tokens already used across `components/`). The `hud-cyan`/`hud-gold`/`hud-dim`/`hud-bg` tokens used above are the same ones `SmartClickPanel` uses.

- [ ] **Step 4: Run the tests to verify they pass**

Run (from repo root): `npx vitest run components/AgentLoopPanel.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/AgentLoopPanel.tsx components/AgentLoopPanel.test.tsx
git commit -m "feat: add AgentLoopPanel driving the computer-use loop"
```

---

### Task 4: Wire `AgentLoopPanel` into the AI tab

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `AgentLoopPanel` (default export from Task 3), the existing `connection.pcIpAddress`, `connection.accessToken`, and `addToast` already used by the sibling `SmartClickPanel`.

- [ ] **Step 1: Add the import**

In `App.tsx`, after the existing `SmartClickPanel` import (line 21):

```tsx
import SmartClickPanel from './components/SmartClickPanel';
import AgentLoopPanel from './components/AgentLoopPanel';
```

- [ ] **Step 2: Render the panel under SmartClickPanel**

In `App.tsx`, the AI tab currently renders (around lines 494-498):

```tsx
              <SmartClickPanel
                ip={connection.pcIpAddress}
                token={connection.accessToken}
                onToast={addToast}
              />
            </div>
```

Change it to add `AgentLoopPanel` immediately after the `SmartClickPanel` element:

```tsx
              <SmartClickPanel
                ip={connection.pcIpAddress}
                token={connection.accessToken}
                onToast={addToast}
              />

              <AgentLoopPanel
                ip={connection.pcIpAddress}
                token={connection.accessToken}
                onToast={addToast}
              />
            </div>
```

- [ ] **Step 3: Verify types, build, and the full frontend suite**

Run (from repo root):
```bash
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: `tsc` clean; all vitest tests pass (existing suite + the new gemini and AgentLoopPanel tests); build succeeds.

- [ ] **Step 4: Commit**

```bash
git add App.tsx
git commit -m "feat: surface AgentLoopPanel in the Gemini AI tab"
```

---

## Self-Review Notes

- **Spec coverage:** `/ai/next-action` route + contract (Task 1); `nextAction` client (Task 2); `AgentLoopPanel` with START/STOP/step-cap/log (Task 3); AI-tab wiring (Task 4). Safety (STOP between iterations, hard cap 15, error-halt, token guard) is implemented in Tasks 1 & 3. Coordinate scheme reuses `_clamp_pct` + `parse_coord`. All spec sections map to a task.
- **Coordinate types:** only `MOUSE_CLICK` is treated as a coordinate action (`_COORD_TYPES`), matching the spec's "for clicks" wording; all other action types pass `value` through verbatim.
- **Type consistency:** `nextAction` returns `{ done, thought?, action?, summary? }` (Task 2) and `AgentLoopPanel` consumes exactly those fields (Task 3). The backend response shape (Task 1) matches what `nextAction` reads (`data.done`, `data.summary`, `data.thought`, `data.action.{type,value,description}`).
- **Deferred / consistent-with-siblings:** non-JSON request body is handled as `request.json or {}` exactly like the other `/ai/*` handlers (Flask may raise its own 4xx outside the try/except — same behavior as `macro`/`locate`, not a regression).

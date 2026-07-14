# Vision Smart-Click Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the phone click a PC UI element by describing it in Turkish — Gemini vision locates it in a server-side screenshot, the phone previews a crosshair, and on confirm issues an ordinary `MOUSE_CLICK`.

**Architecture:** A new token-guarded `POST /ai/locate` route on `AiService` screenshots server-side, asks Gemini 2.5 Flash for the target's normalized coordinates via a structured `response_schema`, maps them to percent, and returns them together with the screenshot. The phone renders a crosshair preview and, on confirm, runs the existing `MOUSE_CLICK` action with percent coordinates (reusing `parse_coord`). The screenshot-capture logic is extracted into a shared `utils/screen_capture.py` used by both `SCREENSHOT` and `/ai/locate`.

**Tech Stack:** Python 3.12, Flask, google-generativeai (Gemini 2.5 Flash), pyautogui + Pillow (server); React 19 + TypeScript, Vitest (phone).

## Global Constraints

- No new dependencies — genai, pyautogui, Pillow are already present.
- All user-facing strings and the Gemini instruction in Turkish.
- Every `/ai/*` route is token-guarded via `_guard()` and returns `401` unauthorized / `503` AI disabled.
- Backend imports of shared helpers use absolute form: `from utils.screen_capture import ...`.
- Commits use no `Co-Authored-By` trailer.
- Work on branch `feat/vision-smart-click`.
- Backend tests run from `nexus_desktop/` as `python -m pytest tests -q`. Frontend tests run from the repo root as `npx vitest run`.

---

### Task 1: Extract shared screenshot capture helper

**Files:**
- Create: `nexus_desktop/utils/screen_capture.py`
- Modify: `nexus_desktop/actions/screenshot.py`
- Create: `nexus_desktop/tests/test_screen_capture.py`
- Modify: `nexus_desktop/tests/test_actions_data.py:18-21` (existing SCREENSHOT test monkeypatches `actions.screenshot.pyautogui`, which no longer exists after the refactor)

**Interfaces:**
- Produces:
  - `capture_jpeg_bytes(max_side: int = 1280, quality: int = 70) -> bytes` — screenshot downscaled so its longest side ≤ `max_side`, encoded JPEG.
  - `data_url_from_jpeg_bytes(jpeg: bytes) -> str` — `"data:image/jpeg;base64,..."`.
  - `capture_jpeg_data_url(max_side: int = 1280, quality: int = 70) -> str` — convenience wrapper combining the two.

- [ ] **Step 1: Write the failing tests**

Create `nexus_desktop/tests/test_screen_capture.py`:

```python
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from PIL import Image

from utils import screen_capture


def test_capture_jpeg_bytes_returns_jpeg(monkeypatch):
    monkeypatch.setattr(
        "utils.screen_capture.pyautogui.screenshot",
        lambda: Image.new("RGB", (800, 600), "white"),
    )
    data = screen_capture.capture_jpeg_bytes()
    assert isinstance(data, bytes)
    # JPEG magic bytes.
    assert data[:2] == b"\xff\xd8"


def test_capture_downscales_longest_side(monkeypatch):
    captured = {}

    class FakeImage:
        size = (2000, 1000)

        def resize(self, size):
            captured["resized_to"] = size
            return self

        def convert(self, mode):
            return Image.new("RGB", (10, 10), "white")

    monkeypatch.setattr("utils.screen_capture.pyautogui.screenshot", lambda: FakeImage())
    screen_capture.capture_jpeg_bytes(max_side=1280)
    # Longest side 2000 -> 1280, scale 0.64, so (1280, 640).
    assert captured["resized_to"] == (1280, 640)


def test_data_url_from_jpeg_bytes_wraps_base64():
    url = screen_capture.data_url_from_jpeg_bytes(b"\xff\xd8fake")
    assert url.startswith("data:image/jpeg;base64,")


def test_capture_jpeg_data_url_roundtrip(monkeypatch):
    monkeypatch.setattr(
        "utils.screen_capture.pyautogui.screenshot",
        lambda: Image.new("RGB", (100, 100), "white"),
    )
    url = screen_capture.capture_jpeg_data_url()
    assert url.startswith("data:image/jpeg;base64,")
    assert len(url) > 100
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_screen_capture.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'utils.screen_capture'`

- [ ] **Step 3: Create the helper**

Create `nexus_desktop/utils/screen_capture.py`:

```python
"""Shared screen capture: screenshot -> downscaled JPEG -> base64 data URL.

Used by the SCREENSHOT action and the /ai/locate vision route so both share
one capture pipeline.
"""
import base64
import io

import pyautogui

_MAX_SIDE = 1280
_JPEG_QUALITY = 70


def capture_jpeg_bytes(max_side=_MAX_SIDE, quality=_JPEG_QUALITY):
    """Grab the screen, downscale so the longest side <= max_side, return JPEG bytes."""
    image = pyautogui.screenshot()
    width, height = image.size
    longest = max(width, height)
    if longest > max_side:
        scale = max_side / longest
        image = image.resize((int(width * scale), int(height * scale)))
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def data_url_from_jpeg_bytes(jpeg):
    b64 = base64.b64encode(jpeg).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def capture_jpeg_data_url(max_side=_MAX_SIDE, quality=_JPEG_QUALITY):
    return data_url_from_jpeg_bytes(capture_jpeg_bytes(max_side, quality))
```

- [ ] **Step 4: Refactor the SCREENSHOT action to use the helper**

Replace the entire contents of `nexus_desktop/actions/screenshot.py` with:

```python
from utils.screen_capture import capture_jpeg_data_url

from .base import Action
from .registry import register_action


@register_action("SCREENSHOT")
class ScreenshotAction(Action):
    prompt_examples = [
        '- "Ekran görüntüsü al": {{ "type": "SCREENSHOT", "value": "", "description": "Ekran görüntüsü alınıyor" }}',
    ]
    prompt_hint = "Ekranın fotoğrafını istemek için SCREENSHOT kullan."

    def execute(self, value, context):
        return capture_jpeg_data_url()
```

- [ ] **Step 5: Update the existing SCREENSHOT test to patch the new location**

In `nexus_desktop/tests/test_actions_data.py`, the SCREENSHOT test patches `actions.screenshot.pyautogui.screenshot`, which no longer exists. Change the monkeypatch target to the helper's module. Replace lines 18-21:

```python
        monkeypatch.setattr(
            "actions.screenshot.pyautogui.screenshot",
            lambda: Image.new("RGB", (2000, 1000), "white"),
        )
```

with:

```python
        monkeypatch.setattr(
            "utils.screen_capture.pyautogui.screenshot",
            lambda: Image.new("RGB", (2000, 1000), "white"),
        )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python -m pytest tests/test_screen_capture.py tests/test_actions_data.py -q`
Expected: PASS (all tests in both files)

- [ ] **Step 7: Commit**

```bash
git add nexus_desktop/utils/screen_capture.py nexus_desktop/actions/screenshot.py nexus_desktop/tests/test_screen_capture.py nexus_desktop/tests/test_actions_data.py
git commit -m "refactor: extract shared screen_capture helper for SCREENSHOT and vision"
```

---

### Task 2: Add the `/ai/locate` vision route

**Files:**
- Modify: `nexus_desktop/services/ai_service.py`
- Modify: `nexus_desktop/tests/test_ai_service.py`

**Interfaces:**
- Consumes: `capture_jpeg_bytes()` and `data_url_from_jpeg_bytes()` from Task 1; existing `AiService._guard()`, `AiService._model(instruction, schema)`.
- Produces: `POST /ai/locate` returning JSON:
  - found → `200 {"success": true, "found": true, "x_pct": <float>, "y_pct": <float>, "image": "data:image/jpeg;base64,..."}`
  - not found → `200 {"success": true, "found": false}`
  - missing description → `400`; unauthorized → `401`; AI disabled → `503`; Gemini error → `502`.

- [ ] **Step 1: Write the failing tests**

Add to `nexus_desktop/tests/test_ai_service.py`. First, the `FakeGenerativeModel` in this file returns `result_text` from `generate_content`; the locate tests set it to a JSON object. Append these tests at the end of the file:

```python
# --- /ai/locate (vision) ---

def _patch_capture(monkeypatch):
    """Avoid real screen grabs: locate captures via screen_capture.capture_jpeg_bytes."""
    monkeypatch.setattr(
        "services.ai_service.capture_jpeg_bytes",
        lambda *a, **k: b"\xff\xd8fakejpeg",
    )


def test_locate_without_token_rejected(monkeypatch):
    client, _, _ = _build_client(monkeypatch)
    res = client.post('/ai/locate', json={'description': 'Kaydet butonu'})
    assert res.status_code == 401


def test_locate_disabled_when_api_key_missing(monkeypatch):
    client, security, svc = _build_client(monkeypatch, api_key=None)
    token = _token(security)
    res = client.post(
        '/ai/locate',
        json={'description': 'Kaydet butonu'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 503


def test_locate_missing_description_rejected(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    token = _token(security)
    res = client.post('/ai/locate', json={}, headers={'X-Nexus-Token': token})
    assert res.status_code == 400

    res2 = client.post('/ai/locate', json={'description': '   '}, headers={'X-Nexus-Token': token})
    assert res2.status_code == 400


def test_locate_found_maps_coords_to_percent(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"found": True, "x": 500, "y": 250})
    res = client.post(
        '/ai/locate',
        json={'description': 'Kaydet butonu'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    assert body['found'] is True
    assert body['x_pct'] == 50.0
    assert body['y_pct'] == 25.0
    assert body['image'].startswith('data:image/jpeg;base64,')
    # The screenshot bytes must be sent to Gemini as an image part.
    contents = FakeGenerativeModel.last_instance.last_contents
    assert contents[0]['mime_type'] == 'image/jpeg'
    assert contents[0]['data'] == b"\xff\xd8fakejpeg"
    assert 'response_schema' in FakeGenerativeModel.last_instance.generation_config


def test_locate_clamps_out_of_range_coords(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"found": True, "x": 1200, "y": -30})
    res = client.post(
        '/ai/locate',
        json={'description': 'x'},
        headers={'X-Nexus-Token': token},
    )
    body = res.get_json()
    assert body['x_pct'] == 100.0
    assert body['y_pct'] == 0.0


def test_locate_not_found_returns_found_false(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.result_text = json.dumps({"found": False, "x": 0, "y": 0})
    res = client.post(
        '/ai/locate',
        json={'description': 'yok'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 200
    body = res.get_json()
    assert body['success'] is True
    assert body['found'] is False
    assert 'image' not in body


def test_locate_upstream_exception_returns_502(monkeypatch):
    client, security, _ = _build_client(monkeypatch)
    _patch_capture(monkeypatch)
    token = _token(security)
    FakeGenerativeModel.should_raise = RuntimeError("upstream boom")
    res = client.post(
        '/ai/locate',
        json={'description': 'Kaydet butonu'},
        headers={'X-Nexus-Token': token},
    )
    assert res.status_code == 502
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_ai_service.py -q -k locate`
Expected: FAIL (404 on the route / `AttributeError` on `capture_jpeg_bytes`)

- [ ] **Step 3: Implement the route**

In `nexus_desktop/services/ai_service.py`, add the import near the top (after the `from actions import all_actions` line):

```python
from utils.screen_capture import capture_jpeg_bytes, data_url_from_jpeg_bytes
```

Add the instruction and schema constants after `_STEP_SCHEMA` (near line 70):

```python
_LOCATE_INSTRUCTION = (
    "Sen bir ekran analiz asistanısın. Sana bir ekran görüntüsü ve tıklanacak "
    "öğenin açıklaması verilecek. Öğenin merkez noktasını bul.\n"
    "Koordinatları 0-1000 aralığında normalize edilmiş tam sayı olarak döndür: "
    "x yatay eksen (soldan sağa), y dikey eksen (yukarıdan aşağıya).\n"
    "Öğeyi bulursan found=true ve x, y ver. Bulamazsan found=false döndür."
)

_LOCATE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "found": {"type": "BOOLEAN"},
        "x": {"type": "INTEGER"},
        "y": {"type": "INTEGER"},
    },
    "required": ["found", "x", "y"],
}


def _clamp_pct(value):
    return max(0.0, min(float(value), 100.0))
```

Register the route in `register()` (alongside the other `add_url_rule` calls):

```python
        app.add_url_rule('/ai/locate', 'ai_locate', self.locate, methods=['POST'])
```

Add the handler method to the `AiService` class (after `audio`):

```python
    def locate(self):
        guard = self._guard()
        if guard:
            return guard
        description = (request.json or {}).get('description', '')
        if not description or not description.strip():
            return jsonify({"success": False, "error": "Missing description"}), 400
        try:
            jpeg = capture_jpeg_bytes()
            model = self._model(_LOCATE_INSTRUCTION, _LOCATE_SCHEMA)
            resp = model.generate_content([
                {"mime_type": "image/jpeg", "data": jpeg},
                f"Tıklanacak öğe: {description}",
            ])
            result = json.loads(resp.text)
            if not result.get("found"):
                return jsonify({"success": True, "found": False}), 200
            return jsonify({
                "success": True,
                "found": True,
                "x_pct": _clamp_pct(result["x"] / 10.0),
                "y_pct": _clamp_pct(result["y"] / 10.0),
                "image": data_url_from_jpeg_bytes(jpeg),
            }), 200
        except Exception as e:
            logging.error("[AI] locate error: %s", e)
            return jsonify({"success": False, "error": str(e)}), 502
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_ai_service.py -q`
Expected: PASS (all locate tests plus the pre-existing macro/audio/schedule tests)

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/services/ai_service.py nexus_desktop/tests/test_ai_service.py
git commit -m "feat: add /ai/locate vision route returning percent click coords"
```

---

### Task 3: Add the `locate()` client to the gemini service

**Files:**
- Modify: `services/gemini.ts`
- Modify: `services/gemini.test.ts`

**Interfaces:**
- Consumes: existing `callAgent(path, ip, token, body)` in `services/gemini.ts` (throws `AUTH_REQUIRED` on 401, a config error on 503, and `data.error` otherwise; returns the parsed JSON on success).
- Produces: `locate(ip: string, token: string, description: string) => Promise<{ found: boolean; x_pct?: number; y_pct?: number; image?: string }>`.

- [ ] **Step 1: Write the failing tests**

Add to `services/gemini.test.ts`. Update the import on line 2 to include `locate`:

```typescript
import { generateMacro, generateMacroFromAudio, parseSchedulerPrompt, locate } from './gemini';
```

Add this describe block before the closing `});` of the top-level describe:

```typescript
  describe('locate', () => {
    it('posts the description to /ai/locate and returns the mapped point', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          success: true,
          found: true,
          x_pct: 42.3,
          y_pct: 71,
          image: 'data:image/jpeg;base64,abc',
        })
      );

      const result = await locate('192.168.1.5', 'tok-123', 'Kaydet butonu');

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://192.168.1.5:8080/ai/locate');
      expect(options.headers['X-Nexus-Token']).toBe('tok-123');
      expect(JSON.parse(options.body)).toEqual({ description: 'Kaydet butonu' });
      expect(result).toEqual({
        found: true,
        x_pct: 42.3,
        y_pct: 71,
        image: 'data:image/jpeg;base64,abc',
      });
    });

    it('returns found:false when the element is not located', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(200, { success: true, found: false }));

      const result = await locate('1.2.3.4', 'tok', 'yok');

      expect(result.found).toBe(false);
      expect(result.image).toBeUndefined();
    });

    it('throws AUTH_REQUIRED on a 401 response', async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockResolvedValue(jsonResponse(401, {}));

      await expect(locate('1.2.3.4', 'bad-tok', 'x')).rejects.toThrow('AUTH_REQUIRED');
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run services/gemini.test.ts`
Expected: FAIL — `locate` is not exported.

- [ ] **Step 3: Implement `locate`**

Append to `services/gemini.ts`:

```typescript
export const locate = async (
  ip: string,
  token: string,
  description: string
): Promise<{ found: boolean; x_pct?: number; y_pct?: number; image?: string }> => {
  const data = await callAgent('/ai/locate', ip, token, { description });
  return {
    found: !!data.found,
    x_pct: data.x_pct,
    y_pct: data.y_pct,
    image: data.image,
  };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run services/gemini.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/gemini.ts services/gemini.test.ts
git commit -m "feat: add locate() client for the /ai/locate vision route"
```

---

### Task 4: Build the SmartClickPanel component

**Files:**
- Create: `components/SmartClickPanel.tsx`
- Create: `components/SmartClickPanel.test.tsx`

**Interfaces:**
- Consumes: `locate(ip, token, description)` from Task 3; `executor.run(steps, ip, token)` from `services/automation.ts` (returns `{ success, error?, data? }`); `ActionType.MOUSE_CLICK` from `../types`.
- Produces: `export default function SmartClickPanel(props: { ip: string; token: string; onToast: (message: string, type?: 'success' | 'error' | 'warning' | 'info') => void })`.

Behavior:
- A description input + "Bul" button. Empty input → Bul is a no-op.
- On Bul: call `locate`. If `found` → open a preview modal showing the returned image with a crosshair at `(x_pct%, y_pct%)`. If not found → `onToast('Öğe bulunamadı', 'warning')`. On thrown error → `onToast(err.message, 'error')`.
- Preview modal: "Onayla ve Tıkla" runs `executor.run([{ id, type: MOUSE_CLICK, value: "{x_pct}%,{y_pct}%", description }], ip, token)`, then closes and toasts success/error; "İptal" closes without clicking.

- [ ] **Step 1: Write the failing tests**

Create `components/SmartClickPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SmartClickPanel from './SmartClickPanel';
import * as gemini from '../services/gemini';
import { executor } from '../services/automation';

describe('SmartClickPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function typeAndFind(description: string) {
    const input = screen.getByPlaceholderText(/Kaydet butonu/i);
    fireEvent.change(input, { target: { value: description } });
    fireEvent.click(screen.getByRole('button', { name: 'Bul' }));
  }

  it('shows a crosshair preview when the element is located', async () => {
    vi.spyOn(gemini, 'locate').mockResolvedValue({
      found: true,
      x_pct: 40,
      y_pct: 60,
      image: 'data:image/jpeg;base64,abc',
    });

    render(<SmartClickPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    typeAndFind('Kaydet butonu');

    const crosshair = await screen.findByTestId('smartclick-crosshair');
    expect(crosshair.style.left).toBe('40%');
    expect(crosshair.style.top).toBe('60%');
  });

  it('toasts when the element is not found', async () => {
    vi.spyOn(gemini, 'locate').mockResolvedValue({ found: false });
    const onToast = vi.fn();

    render(<SmartClickPanel ip="1.2.3.4" token="tok" onToast={onToast} />);
    typeAndFind('yok');

    await waitFor(() => expect(onToast).toHaveBeenCalledWith('Öğe bulunamadı', 'warning'));
    expect(screen.queryByTestId('smartclick-crosshair')).toBeNull();
  });

  it('issues a percent MOUSE_CLICK on confirm', async () => {
    vi.spyOn(gemini, 'locate').mockResolvedValue({
      found: true,
      x_pct: 40,
      y_pct: 60,
      image: 'data:image/jpeg;base64,abc',
    });
    const runSpy = vi.spyOn(executor, 'run').mockResolvedValue({ success: true });

    render(<SmartClickPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    typeAndFind('Kaydet butonu');

    fireEvent.click(await screen.findByRole('button', { name: /Onayla ve Tıkla/i }));

    await waitFor(() => expect(runSpy).toHaveBeenCalledTimes(1));
    const [steps, ip, token] = runSpy.mock.calls[0];
    expect(steps[0].type).toBe('MOUSE_CLICK');
    expect(steps[0].value).toBe('40%,60%');
    expect(ip).toBe('1.2.3.4');
    expect(token).toBe('tok');
  });

  it('does not click when the preview is cancelled', async () => {
    vi.spyOn(gemini, 'locate').mockResolvedValue({
      found: true,
      x_pct: 10,
      y_pct: 20,
      image: 'data:image/jpeg;base64,abc',
    });
    const runSpy = vi.spyOn(executor, 'run');

    render(<SmartClickPanel ip="1.2.3.4" token="tok" onToast={vi.fn()} />);
    typeAndFind('Kaydet butonu');

    fireEvent.click(await screen.findByRole('button', { name: 'İptal' }));

    await waitFor(() =>
      expect(screen.queryByTestId('smartclick-crosshair')).toBeNull()
    );
    expect(runSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run components/SmartClickPanel.test.tsx`
Expected: FAIL — the component module does not exist.

- [ ] **Step 3: Implement the component**

Create `components/SmartClickPanel.tsx`:

```tsx
import React, { useState } from 'react';
import { Crosshair, Search, X, MousePointerClick, RefreshCw } from 'lucide-react';
import { ActionType } from '../types';
import { locate } from '../services/gemini';
import { executor } from '../services/automation';
import HudPanel from './hud/HudPanel';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface SmartClickPanelProps {
  ip: string;
  token: string;
  onToast: (message: string, type?: ToastType) => void;
}

interface Target {
  x_pct: number;
  y_pct: number;
  image: string;
}

export default function SmartClickPanel({ ip, token, onToast }: SmartClickPanelProps) {
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isClicking, setIsClicking] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);

  const handleFind = async () => {
    const value = description.trim();
    if (!value || isLoading) return;
    setIsLoading(true);
    try {
      const result = await locate(ip, token, value);
      if (result.found && result.image != null && result.x_pct != null && result.y_pct != null) {
        setTarget({ x_pct: result.x_pct, y_pct: result.y_pct, image: result.image });
      } else {
        onToast('Öğe bulunamadı', 'warning');
      }
    } catch (e: any) {
      onToast(e?.message || 'Öğe aranırken hata oluştu.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!target || isClicking) return;
    setIsClicking(true);
    try {
      const result = await executor.run(
        [{
          id: 'smartclick',
          type: ActionType.MOUSE_CLICK,
          value: `${target.x_pct}%,${target.y_pct}%`,
          description: `Akıllı tıklama: ${description.trim()}`,
        }],
        ip,
        token
      );
      if (result.success) {
        onToast('🎯 Tıklandı', 'success');
      } else {
        onToast(result.error || 'Tıklama başarısız.', 'error');
      }
    } catch {
      onToast('Tıklama gönderilemedi.', 'error');
    } finally {
      setIsClicking(false);
      setTarget(null);
    }
  };

  return (
    <HudPanel className="p-5 space-y-4">
      <div className="flex items-center gap-2 text-hud-cyan">
        <Crosshair size={18} />
        <h3 className="text-sm font-display font-bold uppercase tracking-[0.15em]">Akıllı Tıklama</h3>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Tıklanacak öğeyi tarif edin; Gemini ekranda bulup hedefi göstersin.
      </p>

      <div className="flex gap-2">
        <input
          className="flex-1 bg-hud-bg/80 border border-hud-dim rounded-sm font-data p-3 text-sm outline-none placeholder:text-slate-600 focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20 transition-colors"
          placeholder="Örn: Kaydet butonu"
          value={description}
          onChange={e => setDescription(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleFind(); }}
        />
        <button
          onClick={handleFind}
          disabled={isLoading || !description.trim()}
          className="px-5 bg-hud-cyan text-slate-950 font-black rounded-sm flex items-center gap-2 disabled:opacity-40 active:scale-95 transition-all"
        >
          {isLoading ? <RefreshCw className="animate-spin" size={16} /> : <Search size={16} />}
          Bul
        </button>
      </div>

      {target && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setTarget(null)}
        >
          <div className="relative max-w-full max-h-[75vh]" onClick={e => e.stopPropagation()}>
            <img
              src={target.image}
              alt="Hedef önizleme"
              className="max-w-full max-h-[75vh] object-contain rounded-sm border border-hud-dim"
            />
            <div
              data-testid="smartclick-crosshair"
              className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: `${target.x_pct}%`, top: `${target.y_pct}%` }}
            >
              <Crosshair size={40} className="text-hud-gold drop-shadow-[0_0_6px_rgba(0,0,0,0.9)] animate-pulse" />
            </div>
          </div>

          <div className="flex gap-3 mt-4" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setTarget(null)}
              className="hud-chip py-3 px-5 text-slate-300 font-bold active:scale-95 transition-all text-xs flex items-center gap-1.5"
            >
              <X size={14} />
              İptal
            </button>
            <button
              onClick={handleConfirm}
              disabled={isClicking}
              className="py-3 px-5 bg-gradient-to-r from-hud-cyan to-hud-gold text-slate-950 font-display font-bold rounded-sm active:scale-95 transition-all text-xs flex items-center gap-1.5 disabled:opacity-40"
            >
              <MousePointerClick size={14} />
              Onayla ve Tıkla
            </button>
          </div>
        </div>
      )}
    </HudPanel>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run components/SmartClickPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/SmartClickPanel.tsx components/SmartClickPanel.test.tsx
git commit -m "feat: add SmartClickPanel with locate + crosshair preview + confirm"
```

---

### Task 5: Wire SmartClickPanel into the app

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `SmartClickPanel` (default export) from Task 4; existing `connection.pcIpAddress`, `connection.accessToken`, and `addToast` in `App.tsx`.

This task is pure JSX wiring (no new unit test — App has no test harness); it is verified by `tsc`, the build, and the full frontend suite staying green.

- [ ] **Step 1: Import the component**

In `App.tsx`, add to the component imports block (after the `import CommandPreviewModal ...` line):

```tsx
import SmartClickPanel from './components/SmartClickPanel';
```

- [ ] **Step 2: Render it in the Gemini AI tab**

In `App.tsx`, inside the `activeTab === 'ai'` block, immediately after the closing `</HudPanel>` of the existing macro panel (the one whose button says "Buton Olarak Kaydet") and before the block's closing `</div>`, add:

```tsx
              <SmartClickPanel
                ip={connection.pcIpAddress}
                token={connection.accessToken}
                onToast={addToast}
              />
```

- [ ] **Step 3: Verify types and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Run the full frontend suite**

Run: `npx vitest run`
Expected: PASS (all suites, including the new gemini and SmartClickPanel tests).

- [ ] **Step 5: Commit**

```bash
git add App.tsx
git commit -m "feat: surface SmartClickPanel in the Gemini AI tab"
```

---

## Final verification

- [ ] Backend: from `nexus_desktop/`, run `python -m pytest tests -q` → all pass.
- [ ] Frontend: from repo root, run `npx vitest run` → all pass; `npx tsc --noEmit` clean; `npm run build` succeeds.
- [ ] Manual smoke (optional, needs a paired phone + `GEMINI_API_KEY` set): open the Gemini AI tab, type "Kaydet butonu" (or any on-screen element), press Bul, confirm the crosshair lands on the element, press "Onayla ve Tıkla", verify the PC registers the click.

# Vision Smart-Click (Roadmap #4a) — Design Spec

**Date:** 2026-07-14
**Status:** Approved (brainstorming complete)
**Branch:** `feat/vision-smart-click`

## Goal

Let the phone click a UI element on the PC by *describing* it in Turkish
("Kaydet butonu") rather than by pixel coordinates. Gemini vision locates the
element in a server-side screenshot; the phone shows a crosshair preview over
that screenshot; on confirm, the phone issues an ordinary `MOUSE_CLICK`.

This is the **primitive** for #4b (the act→observe computer-use loop). #4b is
explicitly out of scope here.

## User flow

1. Phone: user types an element description into a dedicated "smart-click"
   input and presses **Bul** ("Find").
2. Phone → `POST /ai/locate` with `{ "description": "..." }` and the token.
3. Agent captures a screenshot, sends image + description to Gemini 2.5 Flash
   with a structured schema, receives normalized coordinates.
4. Agent → phone: `{ found, x_pct, y_pct, image }` (the image is the exact
   screenshot Gemini saw, so the crosshair lines up).
5. Phone: renders the screenshot with a crosshair at `(x_pct%, y_pct%)` in a
   preview modal. **Onayla ve Tıkla** / **İptal**.
6. On confirm: phone runs `MOUSE_CLICK` with value `"{x_pct}%,{y_pct}%"`
   through the existing executor (reuses `parse_coord` percent support).
7. Not found: phone shows an error toast ("Öğe bulunamadı").

## Backend

### `POST /ai/locate` (new route on `AiService`)

- Token-guarded and AI-enabled-guarded via existing `_guard()`.
- Request body: `{ "description": <str> }`. Empty/missing → `400`.
- Captures a screenshot server-side.
- Calls Gemini 2.5 Flash with `response_schema`:
  `{ found: BOOL, x: INTEGER, y: INTEGER }` where `x`/`y` are **normalized
  0–1000** (x horizontal from left, y vertical from top — stated explicitly in
  the instruction to avoid Gemini's `[y,x]` bounding-box convention).
- Maps `0–1000 → 0–100` percent (`x_pct = x / 10`), clamped to `[0, 100]`.
- Responses:
  - found → `200 { "found": true, "x_pct": <float>, "y_pct": <float>, "image": "data:image/jpeg;base64,..." }`
  - not found (`found:false` from model) → `200 { "found": false }`
  - unauthorized → `401`; AI disabled → `503`; missing description → `400`;
    Gemini error → `502` — matching the existing `/ai/*` contract.

### Shared screenshot helper (`utils/screen_capture.py`)

Extract the capture logic currently inlined in `actions/screenshot.py`
(downscale longest side ≤ 1280, JPEG quality 70, base64 data-URL) into
`capture_jpeg_data_url()`. Both `SCREENSHOT` and `/ai/locate` call it. The
`SCREENSHOT` action's external behavior is unchanged.

## Frontend

- `services/gemini.ts`: add `locate(ip, token, description) → { found, x_pct?, y_pct?, image? }`.
- New `SmartClickPanel` component: description input + **Bul** button.
  - found → preview modal showing the returned image with a crosshair at
    `(x_pct%, y_pct%)`; **Onayla ve Tıkla** runs
    `executor.run([MOUSE_CLICK "x_pct%,y_pct%"])`, **İptal** dismisses.
  - not found → error toast.
- Wire the panel into `App` alongside the existing controls.

## Testing

**Backend**
- `/ai/locate`: `401` unauthorized, `503` AI disabled, `400` missing
  description; with genai + pyautogui mocked: found → `200` with correctly
  mapped `x_pct/y_pct` and `image` present; model `found:false` → `200
  {found:false}`; genai raises → `502`.
- Coordinate mapping (1000 → 100, clamp) asserted directly.
- `screen_capture.capture_jpeg_data_url()` round-trip (mock pyautogui) returns
  a `data:image/jpeg;base64,` URL; downscale path exercised.
- `SCREENSHOT` action still green after the refactor.

**Frontend**
- `gemini.locate()` sends the right request and parses found/not-found.
- `SmartClickPanel` renders the crosshair on found, shows the toast on
  not-found, and issues the percent `MOUSE_CLICK` on confirm.

## Constraints

- No new dependencies (genai, pyautogui, Pillow already present).
- All user-facing strings and the Gemini instruction in Turkish.
- Token-guarded; validate/guard hostile input (empty description, non-JSON body).
- Commits without a `Co-Authored-By` trailer; work on `feat/vision-smart-click`.

## Out of scope (deferred)

The act→observe loop, multi-step goals, non-click actions from vision, drag,
multi-monitor target selection, confidence thresholds / retries. These belong
to #4b or later.

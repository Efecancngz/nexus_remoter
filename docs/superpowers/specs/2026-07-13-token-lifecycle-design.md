# Token Lifecycle Design

**Date:** 2026-07-13
**Status:** Approved
**Branch:** `feat/token-lifecycle`

## Goal

Give session tokens a real lifecycle: **persist** them across agent restarts, **expire** them on a sliding 30-day window, and let the user **manage named devices** (view + revoke) from the desktop GUI. This is roadmap item #3.

## Background

Today `core/security_manager.py` mints `secrets.token_urlsafe(32)` tokens into an in-memory `set()` on a successful `/pair` (after PIN validation). Consequences:

- Tokens are **lost on every agent restart** → the phone's next `/verify` returns 401, the client wipes its stored token (`hooks/useConnection.ts`), and the user must re-enter the PIN. This is the main daily annoyance.
- Tokens **never expire** — a leaked token is valid forever.
- Tokens carry **no metadata** (device, issued-at, last-seen) and there is no per-device revocation; only a bulk `revoke_all_tokens()` exists, and it is not wired to any surface.

The client sends the raw token as the `X-Nexus-Token` header on `/execute`, `/stats`, `/verify`. The desktop already has a tkinter GUI (`services/gui_service.py`, shows IP/PIN/CPU/RAM) and a system tray (`services/tray_service.py`), so there is a trusted local surface for device management.

## Design

Three phases, built in dependency order. Phases 1–2 are backend-only and require no client change; phase 3 adds the device-name field end to end.

### Phase 1 — Persistence

**New module `core/token_store.py`** — owns disk persistence, kept separate from auth logic so `SecurityManager` stays focused on policy.

- Record schema (one per paired device):
  ```json
  {
    "id": "<uuid4>",
    "hash": "<sha256 hex of the raw token>",
    "device_name": "Efe's iPhone",
    "issued_at": 1720000000.0,
    "expires_at": 1722592000.0,
    "last_seen": 1720000000.0
  }
  ```
- **Only the SHA-256 hash is stored.** The raw token lives solely in the phone's `localStorage`. If `tokens.json` leaks, no usable credential can be reconstructed.
- File location: `data/tokens.json` (same `data/` dir the cert store uses), resolved from `sys.argv[0]` like `ApiService` resolves `data/certs/`.
- **Atomic writes:** serialize to a temp file in the same directory, then `os.replace()` onto `tokens.json`, so a crash mid-write cannot corrupt the store.
- **On load:** read the file if present (missing/corrupt → start empty), and drop any records whose `expires_at < now`.
- `.gitignore` gains `nexus_desktop/data/tokens.json` (mirrors the gitignored `data/certs/`).

**Interface:**
- `TokenStore(path)` — load on construction.
- `add(record: dict) -> None`
- `get_by_hash(h: str) -> dict | None`
- `remove(id: str) -> bool`
- `clear() -> None`
- `all() -> list[dict]` (copies, no aliasing of internal state)
- `flush() -> None` — atomic write of current state.

`TokenStore` is not thread-safe on its own; `SecurityManager` serializes all access under its existing `self._lock`.

**Result:** after a restart the phone's token still hashes to a stored record → `/verify` returns 200 → the phone stays connected. No client change for this phase.

### Phase 2 — Sliding expiry / renewal

`SecurityManager` is reworked to delegate storage to `TokenStore`:

- `TOKEN_TTL_SECONDS = 30 * 24 * 3600` (30 days).
- `issue_token(device_name)`:
  - `raw = secrets.token_urlsafe(32)`; `h = sha256(raw)`.
  - Build a record with `id = uuid4()`, `issued_at = last_seen = now`, `expires_at = now + TTL`, sanitized `device_name`.
  - `store.add(record)`, flush, return `raw`.
- `validate_token(raw)`:
  - `False` for empty input.
  - `h = sha256(raw)`; `rec = store.get_by_hash(h)`. A full-token hash lookup leaks no prefix information, so the current "compare against every token" constant-time loop is dropped — a dict lookup keyed by the hash of the whole 256-bit secret is the standard, safe approach for session identifiers.
  - No record → `False`.
  - Expired (`expires_at < now`) → `store.remove(rec['id'])`, flush, `False`.
  - Otherwise **slide**: set `last_seen = now`, `expires_at = now + TTL` in memory, mark dirty, return `True`.
- **Disk-write throttling.** `/stats` polls every 1.5s, so writing on every validate is wasteful. `last_seen`/`expires_at` update in memory immediately; the file is flushed at most once per `PERSIST_MIN_INTERVAL = 300` seconds on the slide path (tracked via a `_last_flush` timestamp under the lock), and **always** flushed on issue, revoke, revoke-all, and graceful shutdown. A ≤5-minute-stale `expires_at` on disk is irrelevant to a 30-day window, and `list_devices` reads fresh in-memory state regardless.

All mutations happen under `SecurityManager._lock`; the flush (rare) also holds the lock.

### Phase 3 — Named devices + desktop revoke

**Pairing carries a device name.**
- `/pair` reads an optional `device_name` from the JSON body and passes it to `issue_token`.
- `SecurityManager._sanitize_name(name)`: coerce to str, strip control characters, collapse whitespace, truncate to 40 chars; empty/absent → `"Bilinmeyen Cihaz"`.
- Backward compatible: an old client omitting `device_name` gets the default.

**Device management API on `SecurityManager` (no HTTP route — desktop-trusted only):**
- `list_devices() -> list[dict]` → `[{ "id", "device_name", "last_seen", "expires_at" }]`. **Never** exposes `hash`. Sorted by `last_seen` descending.
- `revoke(device_id) -> bool` → remove one record by id, flush.
- `revoke_all_tokens()` → kept; clears the store and flushes.

**GUI (`services/gui_service.py`).**
- Add a **"Cihazlar (N)"** button to the main window (N = current device count, refreshed on the existing 1s `update_stats` tick).
- Clicking opens a `Toplevel` window listing each device: `device_name` + a relative last-seen string (e.g. "3 dk önce"), each row with a **Kaldır** button calling `security.revoke(id)`; plus a **Tümünü Kaldır** button calling `security.revoke_all_tokens()`. The list refreshes after any revoke and while open.
- The GUI stays dumb glue over `SecurityManager`; all testable logic lives in `SecurityManager`/`TokenStore`. (The tkinter layer is not unit-tested, consistent with the existing untested `GuiService`.)

### Frontend (minimal)

- **`components` pairing screen (ConnectScreen):** add an optional "Cihaz adı" text input, defaulting to a guess derived from `navigator.userAgent` (e.g. "iPhone", "Android", else "Telefon"). A small helper `guessDeviceName()` produces the default.
- **`hooks/useConnection.ts`:** `pairDevice(ip, pin, deviceName?)` includes `device_name` in the `/pair` body.
- **Expiry needs no new client code:** when a token finally ages out (30 days idle), the existing `/verify` 401 handler already clears the token and forces a re-pair.

## Interfaces Summary

- `core.token_store.TokenStore(path)` with `add/get_by_hash/remove/clear/all/flush`.
- `SecurityManager.issue_token(device_name) -> str`
- `SecurityManager.validate_token(raw) -> bool` (slides expiry on success)
- `SecurityManager.list_devices() -> list[dict]` (no secrets)
- `SecurityManager.revoke(device_id) -> bool`
- `SecurityManager.revoke_all_tokens() -> None`
- `/pair` body: `{ "pin": "1234", "device_name": "Efe's iPhone" }` (device_name optional)
- Client: `pairDevice(ip, pin, deviceName?)`

## Testing

**Backend (pytest, Windows/3.12):**
- `test_token_store.py` — save/load round-trip; atomic write leaves valid JSON; corrupt/missing file → empty store; expired records dropped on load; the raw token string never appears in the written file (only its hash).
- `test_security_manager.py` (extended) — `issue_token` stores a sanitized device name and a 30-day `expires_at`; `validate_token` on a good token slides `expires_at`/`last_seen` forward; an expired token is rejected **and** removed; `revoke(id)` removes exactly one; `revoke_all_tokens` empties the store; `list_devices` returns metadata with **no** `hash`/token; the slide path respects `PERSIST_MIN_INTERVAL` (monkeypatch time to assert flush throttling); `_sanitize_name` handles control chars/overlong/empty.
- `test_api_service_auth.py` (extended) — `/pair` with a `device_name` persists it; `/pair` without one uses the default; **a token survives a simulated restart** (construct a fresh `SecurityManager` over the same `tokens.json` and assert the old token still validates via `/execute`).
- Existing auth tests continue to pass (token issuance/validation contract unchanged from the client's view).

**Frontend (vitest + tsc):**
- `useConnection` test — `pairDevice` includes `device_name` in the request body.
- `guessDeviceName()` unit test — maps sample userAgent strings to expected labels.

## Constraints Carried From the Project

- No new runtime dependencies (`hashlib`, `json`, `os`, `uuid`, `secrets`, `time` are stdlib; tkinter already used).
- Backend tests run on Windows (`windows-latest`), Python 3.12.
- User/AI/client values are hostile: sanitize `device_name`, validate tokens, never trust the store file's integrity blindly (corrupt → empty).
- Turkish user-visible strings (GUI labels, default device name).
- Commit messages have no Co-Authored-By trailer; work lands on the `feat/token-lifecycle` branch.

## Migration Note

The first launch after this update loses any live in-memory tokens (they were never persisted before), so each phone re-pairs once. One-time and unavoidable.

## Suggested Delivery

Single PR is fine — the phases are cohesive and the backend surface is small. The plan will order tasks so Phase 1 (store) lands before Phase 2 (expiry) before Phase 3 (naming + GUI + frontend), each independently testable.

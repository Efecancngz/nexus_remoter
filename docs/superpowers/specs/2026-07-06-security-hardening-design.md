# Nexus Remoter — Security Hardening Design

Date: 2026-07-06
Branch: `feat/voice-haptics-settings`

## Problem

The desktop agent (`nexus_desktop`, Flask on `0.0.0.0:8080`) is a remote command
executor protected only by a 4-digit PIN, over plaintext HTTP, with wildcard CORS,
and it logs the valid PIN. The frontend ships the Gemini API key in its browser
bundle. Together these let any LAN device — or a malicious webpage open in the
user's browser — realistically take control of the PC, and let anyone using the
web app steal the API key.

## Decisions

- **TLS:** deferred. LAN stays HTTP; risk documented in `SECURITY.md`.
- **Gemini proxy:** hosted by the desktop agent (Flask), key stays on the PC.
- **Auth model:** 4-digit PIN for pairing only, then a long random session token
  for all subsequent requests.

## Phased plan

Each phase is an independent commit on the current branch.

### Phase 1 — Quick hardening
- `api_service.py`: remove `Expected: '{self.security.pin}'` from auth-fail log;
  log only that auth failed and stop logging full command payloads.
- `main.py`: lower root logging level `DEBUG` → `INFO`.
- `api_service.py`: replace wildcard `CORS(self.app)` with an explicit origin
  allowlist; reject requests whose `Origin`/`Host` is not expected (DNS-rebinding
  mitigation).
- `security_manager.py`: use `hmac.compare_digest` for all secret comparisons.

### Phase 2 — Auth redesign (PIN pairs → token)
- `SecurityManager`: keep PIN for `/pair` only. Add `issue_token()`
  (`secrets.token_urlsafe(32)`), an in-memory token set, `validate_token()`
  (constant-time), and split `validate()` → `validate_pin()`.
- `api_service.py`: `/pair` returns `{ success, token }`. `/execute`, `/stats`,
  scheduler routes require `X-Nexus-Token`, not the PIN. Rate-limit/lockout now
  only guards the pairing surface.
- Client: `useConnection.ts` stores `nexus_access_token` instead of the PIN;
  `automation.ts` and `SchedulerModal.tsx` send `X-Nexus-Token`. On 401 → clear
  token and re-pair. The periodic `/pair` re-check is replaced by a lightweight
  token check.

### Phase 3 — Gemini proxy via the agent
- New `services/ai_service.py`: token-protected `/ai/macro`, `/ai/audio`,
  `/ai/schedule` routes calling Gemini server-side with `GEMINI_API_KEY`
  (non-`VITE_` env name so Vite cannot bundle it). Requires `google-generativeai`
  in `requirements.txt`.
- `gemini.ts`: stop calling Google directly; POST to the agent and return steps.
  Remove all `import.meta.env.VITE_API_KEY` usage.
- User rotates the exposed key and sets `GEMINI_API_KEY` in `.env`.

### Phase 4 — Command allowlisting
- `automation_service.py`: `COMMAND` no longer runs raw `Popen(value, shell=True)`.
  Add an allowlist of named actions → fixed argv executed with `shell=False`.
  `launch_app` fallback stops passing raw user input to a shell.
- `SYSTEM_POWER` destructive actions (shutdown/restart) require `confirmed: true`
  in the payload; the client already gates this via `CommandPreviewModal`.

### Phase 5 — Tests
- pytest for `security_manager` (PIN lockout, token issue/validate, constant-time),
  command routing/allowlist rejection, and `/execute` auth boundary.

## Verification
- `pytest` after Phase 5.
- `npm run build` after Phase 3 to confirm the client compiles without the key.

## Out of scope (documented, not built)
- TLS/HTTPS on the agent. `SECURITY.md` will note LAN traffic is plaintext and
  recommend a trusted network.

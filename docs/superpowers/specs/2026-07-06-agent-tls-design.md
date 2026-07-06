# Agent TLS (self-signed) — Design

## Problem

The desktop agent (`nexus_desktop`) serves its API on `http://<pc-ip>:8080` with
no TLS, documented as a deliberate trade-off in `SECURITY.md`. This creates two
separate problems:

1. **Confidentiality.** Anyone on the same LAN can read PINs, session tokens,
   and command payloads in transit, and could inject or alter commands
   (man-in-the-middle).
2. **Functional breakage for the primary use case.** The web client is a PWA
   (`manifest.json`, `"display": "standalone"`) deployed to GitHub Pages
   (HTTPS-only). A phone that installs the PWA and opens it runs from an HTTPS
   origin, then calls `http://<lan-ip>:8080` — an HTTPS page issuing an active
   `fetch()` to plain HTTP is mixed content, which mobile browsers block by
   default (the only common exemption is `localhost`, which a LAN IP is not).
   This directly blocks "install the app once, control my PC from my phone,"
   which is the stated primary use case for this project.

TLS on the agent fixes both. A VPN overlay (Tailscale/WireGuard, mentioned as
a possible direction in `SECURITY.md`) does **not** fix problem 2 — the
request is still `https://page` → `http://agent` regardless of what tunnel
carries the packets — so it is out of scope for this design. The existing
`SECURITY.md` mention of a VPN as a supplementary recommendation for hostile
networks stays as-is; nothing new is built for it here.

## Scope

In scope:
- Self-signed certificate generation and persistence on the agent.
- Switching the agent's Flask server from HTTP to HTTPS (no dual-protocol
  mode).
- Updating the web client to call `https://` instead of `http://`.
- A one-time, manual "trust this certificate" step surfaced in the UI, since
  there is no code-only way around a browser needing the user to accept (or
  install) a self-signed cert.

Out of scope (YAGNI / not required for this to work):
- A CA-based "install once, trust everywhere" distribution scheme. Would
  still require a manual install step (installing a root CA profile is not
  obviously easier than accepting a per-host warning) for meaningfully more
  implementation and key-management complexity. Not worth it for a
  single-user tool.
- Changing `DiscoveryService`'s broadcast message format (see §3a — the
  client's protocol assumption changes, but the wire format does not).
- Automatic reverse-proxy or `mkcert`-style local tooling.
- Any VPN tooling or scripting.
- Restricting the private key file's OS-level permissions beyond defaults
  (see §1 rationale).

## Design

### 1. Certificate generation and persistence

New module `nexus_desktop/core/cert_store.py`:

- `CertStore(cert_dir)` — analogous role to `ScheduleStore`: owns reading and
  writing cert material on disk, no other component touches the filesystem
  for this.
- Uses the `cryptography` library (added to `requirements.txt`; not
  previously a dependency) to generate a self-signed X.509 certificate and
  matching RSA private key.
- `ensure_cert(current_ip)` — the one entry point `ApiService.on_start()`
  calls before starting the server:
  - If no cert/key files exist on disk: generate and persist a new pair.
  - If a cert exists: parse it and check whether `current_ip` is present in
    its Subject Alternative Names and whether it is still within its
    validity window. If either check fails, regenerate.
  - Otherwise, reuse the existing cert/key as-is.
  - Returns the `(cert_path, key_path)` tuple for the caller to pass to Flask.
- Generated certs always include SANs for: the current LAN IP (from the
  existing `utils.network.get_local_ip()`), `127.0.0.1`, and `localhost`.
- Validity window: 10 years. Self-signed trust is manual regardless of
  expiry length, so a long window avoids ever nagging a user to re-trust
  due to natural expiry — the only realistic re-trust trigger is an IP
  change (DHCP lease change), which is already a rare, one-time-per-device
  action.
- Storage location: `data/certs/agent.crt` and `data/certs/agent.key`,
  under the same base directory `ScheduleStore` uses today (same
  `_default_store_path`-style resolution relative to `sys.argv[0]`), so all
  agent-generated state lives under one `data/` root.
- Private key file permissions are not restricted beyond OS defaults. The
  agent runs as the logged-in user on their own machine; the key material is
  no more sensitive than the session the user already has, and this project
  does not defend against a threat model where another local account on the
  same machine is untrusted. No `os.chmod`/ACL handling is added.
- If an existing cert or key file fails to parse (corrupted, truncated, or
  a partial write from a prior crash), `ensure_cert` treats it the same as
  "missing" — logs a warning and regenerates, mirroring how
  `ScheduleStore.load()` already treats a corrupt `schedules.json` as "no
  pending jobs" rather than crashing.
- IP checks happen only in `ensure_cert`, called once at `on_start()`. If
  the LAN IP changes while the agent is already running (e.g. a DHCP lease
  renewal), the cert is not regenerated until the next restart, and the
  client will fail to connect at the old IP in the meantime. This is an
  accepted gap: DHCP leases on a home network typically outlive a single
  agent session, and a user who loses connectivity would restart the agent
  anyway to diagnose it — that restart is what re-triggers `ensure_cert`.
  No file-watching or periodic IP re-check is added.
- 10-year validity is a self-signed certificate, so it is not subject to
  the CA/Browser Forum maximum-validity rules that apply to CA-issued
  certificates (currently 398 days) — those rules constrain publicly
  trusted CAs, not certs a device is asked to trust individually. Browsers
  do not reject an otherwise-valid self-signed cert for having a long
  expiry.

### 2. Server wiring

`nexus_desktop/services/api_service.py`:

- `on_start()` calls `CertStore(...).ensure_cert(get_local_ip())` before
  starting the Flask thread, and passes the resulting paths into
  `self.app.run(..., ssl_context=(cert_path, key_path))`.
- The entire API — including `/pair`, which currently carries the PIN in
  plaintext — moves to HTTPS. No HTTP fallback or dual-listener mode: one
  protocol, one code path, less surface area to secure and test.
- `_reject_rebinding`'s existing Host-header validation logic is unaffected
  (Host header semantics are unchanged by adding TLS).
- Flask's built-in dev server (`app.run()`) is not intended for production
  use, but this project already runs on it today for the plaintext HTTP
  case, and this design does not change that. A production WSGI server
  (gunicorn, waitress) is not justified for a single-user, single-machine
  LAN tool — this is a conscious continuation of an existing trade-off, not
  a new one introduced by adding TLS.

### 3. Client changes

Four files currently build the agent's base URL, each duplicating the same
`ip.replace(/^https?:\/\//, '').replace(/\/$/, '').trim()` sanitize step (or,
in `SchedulerModal.tsx`'s case, skipping it and relying on the IP already
being sanitized upstream by `useConnection.ts`):

| File | Lines | Used for |
|---|---|---|
| `services/automation.ts` | 37, 90 | `/execute`, `/ping` |
| `services/gemini.ts` | 21 | `/ai/*` proxy |
| `hooks/useConnection.ts` | 38, 81, 108 | `/pair`, `/verify`, `/stats` |
| `components/SchedulerModal.tsx` | 28 | `/execute` |

This migration is the natural point to collapse that duplication: add a
single `buildAgentUrl(ip, path)` helper (new `services/agentUrl.ts`, also
exporting `sanitizeIp` on its own since `useConnection.ts`'s `pairDevice`
needs the cleaned IP by itself, not just a full URL) and have all four call
sites use it instead of hand-rolling `` `https://${cleanIp}:8080${path}` ``
independently. This helper becomes the single place that knows the scheme,
host, and port — all four files switch their hardcoded `http://` prefix to
`https://` by using it.

Behavior note: `sanitizeIp` strips any `http://`/`https://` prefix before
`buildAgentUrl` re-adds `https://`. Mechanically unchanged, but the
effective behavior shifts — a user with an old `http://192.168.1.5` value
already saved in `localStorage` from before this migration gets silently
upgraded to `https://` on next use, since the sanitize step strips whatever
scheme was there regardless. No migration code is needed; this falls out of
the existing strip-and-reprefix logic.

**Trust-first UX flow.** A self-signed cert causes `fetch()` to fail with an
opaque network error until the browser has been told to trust that host, so
the trust step must happen *before* pairing is attempted, not after a
failed `/pair` call:
1. User enters the PC's IP address. No network call happens yet.
2. `ConnectScreen.tsx` shows a "first time on this device?" link pointing at
   `https://<ip>:8080/`, with a short explanation that it must be opened and
   its certificate warning accepted once before pairing will work. The PIN
   field and submit button remain visible/usable (a returning user on an
   already-trusted device skips straight to step 4), but the instruction is
   always shown up front rather than surfaced reactively after a failure.
3. User opens the link in a new tab, accepts the browser's self-signed-cert
   warning, sees the agent's minimal landing page (below), and returns.
4. User enters the PIN and submits; `/pair` now succeeds because the browser
   already trusts the agent's host.

The agent's `/` route (currently unused/undefined) returns a minimal HTML
page ("Certificate trusted — you can close this tab and return to the
app.") so step 3 has something sensible to land on.

iOS Safari has known rough edges trusting self-signed certs inside an
installed (standalone) PWA context specifically. This gets a documentation
note in `SECURITY.md` rather than a code workaround — there isn't a clean
one, and this is a one-person-maintained tool, not a product with iOS QA
resources.

### 3a. DiscoveryService interaction

`DiscoveryService`'s UDP broadcast (`DISCOVER_NEXUS_AGENT_V2`) carries no
protocol information today, and this design does not change that message
format. After this migration, the client unconditionally assumes `https://`
for whatever IP it learns, whether typed manually or received via discovery
— there is no transitional period where an old client (assuming `http://`)
works against a new agent (HTTPS-only) or vice versa. This is acceptable
for a single-user tool where the client and agent are the same person's
install and get updated together, but it is a real implicit coupling worth
naming rather than leaving as an unstated assumption.

### 4. Testing

- `cert_store.py` is pure logic and fully unit-testable without any real
  TLS handshake: generate-when-missing, reuse-when-valid,
  regenerate-when-IP-changed, regenerate-when-expired, and
  regenerate-when-corrupt (see §1) — asserted by using `cryptography`'s own
  parsing against the files `CertStore` wrote.
- `api_service.py`'s actual TLS handshake is not exercised by tests. Existing
  tests already use Flask's test client, which bypasses the network/TLS
  layer entirely (this is unchanged behavior, consistent with how auth is
  tested today).
- Frontend: `services/agentUrl.ts`'s `sanitizeIp`/`buildAgentUrl` get their
  own focused tests (scheme-stripping, trailing-slash-stripping, path
  joining). The existing `automation.test.ts`/`gemini.test.ts` assertions
  that currently expect `http://...` URLs update to `https://...` once
  those two files are switched over to the shared helper.

## Non-goals / explicitly deferred

- No automated way to push trust to a device (covered under Scope above).
- No support for running both HTTP and HTTPS simultaneously.
- No change to how `GEMINI_API_KEY` or session tokens are stored — TLS
  protects them in transit; storage-at-rest is unchanged and out of scope
  here.

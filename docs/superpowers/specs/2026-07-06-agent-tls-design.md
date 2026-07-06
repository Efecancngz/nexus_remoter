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
- Any change to `DiscoveryService` (UDP broadcast; unrelated to HTTP/TLS).
- Automatic reverse-proxy or `mkcert`-style local tooling.
- Any VPN tooling or scripting.

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

### 3. Client changes

- `services/gemini.ts` and `services/automation.ts` (and anywhere else that
  builds the agent base URL) switch their hardcoded `http://` prefix to
  `https://`.
- New one-time trust step: a self-signed cert causes `fetch()` to fail with
  an opaque network error until the browser has been told to trust that
  host. `ConnectScreen.tsx` gets a short instruction with a tappable link:
  "First time on this device? Open this link and accept the security
  warning, then come back." pointing at `https://<ip>:8080/`.
- The agent's `/` route (currently unused/undefined) returns a minimal HTML
  page ("Certificate trusted — you can close this tab and return to the
  app.") so that link has something sensible to land on.
- iOS Safari has known rough edges trusting self-signed certs inside an
  installed (standalone) PWA context specifically. This gets a documentation
  note in `SECURITY.md` rather than a code workaround — there isn't a clean
  one, and this is a one-person-maintained tool, not a product with iOS QA
  resources.

### 4. Testing

- `cert_store.py` is pure logic and fully unit-testable without any real
  TLS handshake: generate-when-missing, reuse-when-valid, regenerate-when-IP
  changed, regenerate-when-expired — asserted by using `cryptography`'s own
  parsing against the files `CertStore` wrote.
- `api_service.py`'s actual TLS handshake is not exercised by tests. Existing
  tests already use Flask's test client, which bypasses the network/TLS
  layer entirely (this is unchanged behavior, consistent with how auth is
  tested today).
- Frontend: no new component tests are required beyond updating the base URL
  the existing `automation.ts`/`gemini.ts` tests assert on (they currently
  assert `http://...` URLs; these become `https://...`).

## Non-goals / explicitly deferred

- No automated way to push trust to a device (covered under Scope above).
- No support for running both HTTP and HTTPS simultaneously.
- No change to how `GEMINI_API_KEY` or session tokens are stored — TLS
  protects them in transit; storage-at-rest is unchanged and out of scope
  here.

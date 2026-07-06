# Security notes

## Transport: self-signed TLS on the LAN

The desktop agent serves its API on `https://<pc-ip>:8080` using a
self-signed certificate the agent generates on first run (`CertStore`,
`nexus_desktop/core/cert_store.py`). The certificate's Subject Alternative
Names cover the agent's current LAN IP, `127.0.0.1`, and `localhost`, with a
10-year validity window.

- **Why self-signed instead of a real cert:** the client connects to a raw
  LAN IP, not a domain name, so a browser-trusted certificate isn't
  obtainable without either a private CA installed on every device or a
  public cert bound to a hostname the agent doesn't have. Both add real
  setup friction for a single-user, single-LAN tool.
- **Trust step:** a device must accept the certificate once before pairing
  will work — open `https://<pc-ip>:8080/` directly (a link for this is
  shown in the app's connect screen), accept the browser's warning, then
  return to the app. This is a one-time step per device. iOS Safari has
  known rough edges trusting a self-signed cert inside an installed
  (standalone) PWA specifically; if pairing fails after accepting the
  warning, try opening the trust link in a normal Safari tab first.
- **Cert regeneration:** the agent regenerates its certificate automatically
  if its LAN IP changes (e.g. a new DHCP lease) or if the existing cert/key
  files are missing, corrupt, or expired. An IP change requires re-accepting
  the certificate once on each device; this is only checked at agent
  startup, so a mid-session IP change requires an agent restart before the
  new cert takes effect.
- **Private key storage:** `data/certs/agent.key` is not given restricted
  OS-level permissions beyond defaults — the agent runs as the logged-in
  user, and the key is no more sensitive than the session that user already
  has.
- **Mitigations already in place, now layered under TLS:** the PIN is only
  used once per pairing (never resent), the session token is only sent to
  the agent's own origin, and `/execute` rejects DNS-rebinding attempts via
  Host-header validation (`api_service.py`).
- **If you need protection on hostile networks** beyond what a single
  device's self-signed trust provides, put the agent behind a VPN (e.g.
  Tailscale/WireGuard) in addition to this — a VPN alone does not replace
  TLS here, since the client's HTTPS-hosted PWA still cannot make a mixed-content
  plaintext request regardless of what network layer carries it.

## Auth model

- Pairing: a 4-digit PIN (shown in the agent's tray GUI, regenerated on every
  agent start) is entered once. It is rate-limited (5 attempts / 30s lockout)
  and compared with `hmac.compare_digest`.
- Session: a successful pair issues a 256-bit random token
  (`secrets.token_urlsafe(32)`). All subsequent requests (`/execute`, `/stats`,
  `/ai/*`) require this token via the `X-Nexus-Token` header. Tokens are held
  in memory only and are invalidated when the agent restarts.

## Command execution

`COMMAND` and `LAUNCH_APP` actions only ever pass a fixed, hardcoded target
string (from an allowlist in `automation_service.py`) to `os.startfile` — the
user-supplied value is used solely as a lookup key, never executed via a
shell. Unrecognized names are rejected rather than run. `SYSTEM_POWER` actions
use `subprocess.run` with a fixed argv list (no shell).

## Secrets

`GEMINI_API_KEY` lives only in the agent's `.env` file and is read server-side
by `ai_service.py`. It is never bundled into the web client — the client calls
the agent's `/ai/*` proxy routes instead of Google's API directly.

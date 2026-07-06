# Security notes

## Transport: plaintext HTTP on the LAN (by design, for now)

The desktop agent (`nexus_desktop`) serves its API on `http://<pc-ip>:8080` with
no TLS. This is a deliberate, documented trade-off, not an oversight:

- The mobile client connects to a raw LAN IP, not a domain name, so a
  browser-trusted certificate isn't obtainable without either a private CA
  installed on every phone or a public cert bound to a hostname the agent
  doesn't have. Both add real setup friction for a single-user, single-LAN tool.
- **Risk this leaves open:** anyone who can observe traffic on the same LAN/WiFi
  (e.g. a compromised AP, another device running a packet sniffer) can read
  session tokens and command payloads in transit, and a man-in-the-middle on
  the network could inject or alter commands sent to the agent.
- **Mitigations already in place:** the PIN is only used once per pairing
  (never resent), the session token is only sent to the agent's own origin
  (not embedded in URLs or logs), and `/execute` rejects DNS-rebinding attempts
  via Host-header validation (`api_service.py`).
- **Recommendation:** only run this on a trusted home/personal network. Avoid
  public or shared WiFi. If you need protection on hostile networks, put the
  agent behind a VPN (e.g. Tailscale/WireGuard) rather than exposing port 8080
  directly — that also sidesteps the certificate problem entirely.

TLS support may be revisited later (e.g. via a VPN overlay providing implicit
mTLS, or a self-signed cert with a documented per-device trust step).

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

# Token Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give session tokens a real lifecycle — persist them across agent restarts, expire them on a sliding 30-day window, and let the user view/revoke named devices from the desktop GUI.

**Architecture:** A new `TokenStore` owns hashed-token persistence to a gitignored `data/tokens.json` (atomic writes, expired-on-load purge). `SecurityManager` delegates all token storage to it, adds SHA-256 hashing, a sliding TTL, throttled disk flushes, and device metadata. Pairing carries an optional device name end-to-end; the tkinter GUI gains a device list with per-device and bulk revoke. Backend phases 1–2 need no client change; phase 3 threads a `device_name` through `/pair`.

**Tech Stack:** Python 3.12 (stdlib `hashlib`/`json`/`os`/`uuid`/`secrets`/`time`/`re`, tkinter), Flask, pytest; React 19 + TypeScript, vitest.

## Global Constraints

- No new runtime dependencies — stdlib + already-present tkinter/Flask/React only.
- Backend tests run on Windows (`windows-latest`), Python 3.12. Run backend tests from `nexus_desktop/` as `python -m pytest tests/... -q`.
- All user/client values are hostile: sanitize `device_name`, validate tokens, treat a corrupt store file as empty.
- **Only the SHA-256 hash of a token is ever written to disk** — never the raw token.
- Turkish user-visible strings (GUI labels, default device name `"Bilinmeyen Cihaz"`).
- Commit messages have **no** Co-Authored-By trailer. Work lands on branch `feat/token-lifecycle`.
- `SecurityManager(store_path=None)` must stay constructible with no arguments (in-memory, flush is a no-op) so existing call sites/tests keep working.

---

### Task 1: TokenStore persistence layer

**Files:**
- Create: `nexus_desktop/core/token_store.py`
- Test: `nexus_desktop/tests/test_token_store.py`
- Modify: `.gitignore` (add `nexus_desktop/data/tokens.json`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `TokenStore(path: str | None = None)` — loads on construction; purges expired records; `path=None` → in-memory only.
  - `add(record: dict) -> None` (record keyed internally by `record['id']`)
  - `get_by_hash(h: str) -> dict | None`
  - `remove(id: str) -> bool`
  - `clear() -> None`
  - `all() -> list[dict]` (returns copies)
  - `flush() -> None` (atomic write; no-op when `path is None`)
  - Record shape: `{"id", "hash", "device_name", "issued_at", "expires_at", "last_seen"}`.

- [ ] **Step 1: Write the failing tests**

Create `nexus_desktop/tests/test_token_store.py`:

```python
import os
import sys
import json
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.token_store import TokenStore


def _rec(id="a", h="hash-a", expires_at=None):
    now = time.time()
    return {
        "id": id, "hash": h, "device_name": "iPhone",
        "issued_at": now, "last_seen": now,
        "expires_at": now + 3600 if expires_at is None else expires_at,
    }


def test_add_and_get_by_hash():
    store = TokenStore()
    store.add(_rec(id="a", h="hash-a"))
    assert store.get_by_hash("hash-a")["id"] == "a"
    assert store.get_by_hash("missing") is None


def test_remove_and_clear():
    store = TokenStore()
    store.add(_rec(id="a", h="hash-a"))
    assert store.remove("a") is True
    assert store.remove("a") is False
    store.add(_rec(id="b", h="hash-b"))
    store.clear()
    assert store.all() == []


def test_all_returns_copies():
    store = TokenStore()
    store.add(_rec(id="a", h="hash-a"))
    store.all()[0]["device_name"] = "mutated"
    assert store.get_by_hash("hash-a")["device_name"] == "iPhone"


def test_flush_and_reload_round_trip(tmp_path):
    p = str(tmp_path / "data" / "tokens.json")
    store = TokenStore(p)
    store.add(_rec(id="a", h="hash-a"))
    store.flush()

    reloaded = TokenStore(p)
    assert reloaded.get_by_hash("hash-a")["id"] == "a"


def test_expired_records_dropped_on_load(tmp_path):
    p = str(tmp_path / "tokens.json")
    store = TokenStore(p)
    store.add(_rec(id="live", h="live", expires_at=time.time() + 3600))
    store.add(_rec(id="dead", h="dead", expires_at=time.time() - 1))
    store.flush()

    reloaded = TokenStore(p)
    assert reloaded.get_by_hash("live") is not None
    assert reloaded.get_by_hash("dead") is None


def test_corrupt_file_yields_empty_store(tmp_path):
    p = tmp_path / "tokens.json"
    p.write_text("{not valid json", encoding="utf-8")
    store = TokenStore(str(p))
    assert store.all() == []


def test_missing_path_is_in_memory_only(tmp_path):
    store = TokenStore(None)
    store.add(_rec(id="a", h="hash-a"))
    store.flush()  # must not raise
    assert store.get_by_hash("hash-a") is not None


def test_raw_token_never_written(tmp_path):
    p = str(tmp_path / "tokens.json")
    store = TokenStore(p)
    rec = _rec(id="a", h="sha256hexhash")
    store.add(rec)
    store.flush()
    written = (tmp_path / "tokens.json").read_text(encoding="utf-8")
    assert "sha256hexhash" in written  # the hash is persisted
    # sanity: the file is valid JSON with a tokens list
    assert isinstance(json.loads(written)["tokens"], list)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_token_store.py -q` (from `nexus_desktop/`)
Expected: FAIL — `ModuleNotFoundError: No module named 'core.token_store'`.

- [ ] **Step 3: Implement `core/token_store.py`**

```python
"""Persistent, hashed session-token store backing SecurityManager."""
import json
import os
import time


class TokenStore:
    """Holds token records keyed by id. Only hashes are stored, never raw
    tokens. `path=None` keeps everything in memory (flush is a no-op)."""

    def __init__(self, path=None):
        self.path = path
        self._records = {}  # id -> record dict
        self._load()

    def _load(self):
        if not self.path or not os.path.exists(self.path):
            return
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            now = time.time()
            for rec in data.get("tokens", []):
                if rec.get("expires_at", 0) > now and "id" in rec:
                    self._records[rec["id"]] = rec
        except (json.JSONDecodeError, OSError, TypeError, ValueError):
            # A corrupt or unreadable store must not crash startup.
            self._records = {}

    def add(self, record):
        self._records[record["id"]] = record

    def get_by_hash(self, h):
        for rec in self._records.values():
            if rec.get("hash") == h:
                return rec
        return None

    def remove(self, id):
        return self._records.pop(id, None) is not None

    def clear(self):
        self._records.clear()

    def all(self):
        return [dict(r) for r in self._records.values()]

    def flush(self):
        if not self.path:
            return
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"tokens": list(self._records.values())}, f)
        os.replace(tmp, self.path)
```

- [ ] **Step 4: Add the gitignore entry**

Append to `.gitignore`:

```
# Persisted session tokens (contains hashes + device metadata)
nexus_desktop/data/tokens.json
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/test_token_store.py -q`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add nexus_desktop/core/token_store.py nexus_desktop/tests/test_token_store.py .gitignore
git commit -m "feat: TokenStore persists hashed session tokens to disk"
```

---

### Task 2: SecurityManager — hashing, persistence, sliding expiry, device names

**Files:**
- Modify: `nexus_desktop/core/security_manager.py`
- Test: `nexus_desktop/tests/test_security_manager.py` (extend)

**Interfaces:**
- Consumes: `TokenStore` from Task 1.
- Produces:
  - `SecurityManager(store_path: str | None = None)`
  - `issue_token(device_name: str = "") -> str` (raw token; stores hash + metadata; flushes)
  - `validate_token(raw) -> bool` (slides `expires_at`/`last_seen` on success; deletes on expiry; throttled flush)
  - `revoke_all_tokens() -> None` (clears store + flushes)
  - Module constants `TOKEN_TTL_SECONDS = 30 * 24 * 3600`, `PERSIST_MIN_INTERVAL = 300`
  - `_sanitize_name(name) -> str` (strips control chars, collapses whitespace, truncates to 40, defaults to `"Bilinmeyen Cihaz"`)

- [ ] **Step 1: Write the failing tests** (append to `nexus_desktop/tests/test_security_manager.py`)

```python
import core.security_manager as sm_mod
from core.security_manager import SecurityManager, _sanitize_name


def test_issue_token_stores_sanitized_device_name():
    sec = SecurityManager()
    tok = sec.issue_token("  Efe's\tiPhone  ")
    devices = sec.list_devices()
    assert len(devices) == 1
    assert devices[0]["device_name"] == "Efe's iPhone"
    assert sec.validate_token(tok) is True


def test_issue_token_default_device_name():
    sec = SecurityManager()
    sec.issue_token("")
    assert sec.list_devices()[0]["device_name"] == "Bilinmeyen Cihaz"


def test_validate_slides_expiry_and_last_seen(monkeypatch):
    sec = SecurityManager()
    t0 = 1_000_000.0
    monkeypatch.setattr(sm_mod.time, "time", lambda: t0)
    tok = sec.issue_token("iPhone")
    first_expiry = sec.list_devices()[0]["expires_at"]

    monkeypatch.setattr(sm_mod.time, "time", lambda: t0 + 10_000)
    assert sec.validate_token(tok) is True
    slid = sec.list_devices()[0]
    assert slid["expires_at"] > first_expiry
    assert slid["last_seen"] == t0 + 10_000


def test_expired_token_rejected_and_removed(monkeypatch):
    sec = SecurityManager()
    t0 = 1_000_000.0
    monkeypatch.setattr(sm_mod.time, "time", lambda: t0)
    tok = sec.issue_token("iPhone")

    monkeypatch.setattr(sm_mod.time, "time", lambda: t0 + sm_mod.TOKEN_TTL_SECONDS + 1)
    assert sec.validate_token(tok) is False
    assert sec.list_devices() == []


def test_token_survives_restart(tmp_path):
    p = str(tmp_path / "tokens.json")
    sec = SecurityManager(store_path=p)
    tok = sec.issue_token("iPhone")

    sec2 = SecurityManager(store_path=p)  # simulate agent restart
    assert sec2.validate_token(tok) is True


def test_list_devices_exposes_no_secrets():
    sec = SecurityManager()
    sec.issue_token("iPhone")
    d = sec.list_devices()[0]
    assert "hash" not in d
    assert set(d.keys()) == {"id", "device_name", "last_seen", "expires_at"}


def test_flush_is_throttled_on_validate(tmp_path, monkeypatch):
    p = str(tmp_path / "tokens.json")
    sec = SecurityManager(store_path=p)
    tok = sec.issue_token("iPhone")  # flush #1

    calls = []
    orig_flush = sec._store.flush
    monkeypatch.setattr(sec._store, "flush", lambda: calls.append(1) or orig_flush())

    t = [2_000_000.0]
    monkeypatch.setattr(sm_mod.time, "time", lambda: t[0])
    sec._last_flush = t[0]
    sec.validate_token(tok)          # within interval -> no flush
    assert calls == []

    t[0] += sm_mod.PERSIST_MIN_INTERVAL + 1
    sec.validate_token(tok)          # interval elapsed -> flush
    assert calls == [1]


def test_sanitize_name_edge_cases():
    assert _sanitize_name("") == "Bilinmeyen Cihaz"
    assert _sanitize_name(None) == "Bilinmeyen Cihaz"
    assert _sanitize_name("a\x00b\x1fc") == "abc"
    assert _sanitize_name("x" * 100) == "x" * 40
```

Also update the two existing tests that assume the old set-based model still hold: `test_issued_token_validates`, `test_unknown_token_rejected`, `test_empty_or_missing_token_rejected`, `test_revoke_all_tokens_invalidates_sessions`, `test_issue_token_returns_unique_values` — these all still pass unchanged (issue returns a raw urlsafe token, validate accepts it, revoke_all clears). Do **not** modify them.

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `python -m pytest tests/test_security_manager.py -q`
Expected: FAIL — `ImportError: cannot import name '_sanitize_name'` / `list_devices` missing.

- [ ] **Step 3: Rewrite `core/security_manager.py`**

Replace the token internals (keep `generate_pin`, `validate_pin`, lockout logic, `is_locked`, `lockout_remaining` exactly as they are). New/changed parts:

```python
import hashlib
import hmac
import random
import re
import secrets
import string
import time
import threading
import uuid
import logging

from core.token_store import TokenStore

TOKEN_TTL_SECONDS = 30 * 24 * 3600     # sliding 30-day window
PERSIST_MIN_INTERVAL = 300             # min seconds between slide-path disk flushes

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _sanitize_name(name):
    if not isinstance(name, str):
        name = str(name) if name is not None else ""
    name = _CONTROL.sub("", name)
    name = " ".join(name.split())
    name = name[:40].strip()
    return name or "Bilinmeyen Cihaz"


class SecurityManager:
    def __init__(self, store_path=None):
        self.pin = self.generate_pin()

        self._store = TokenStore(store_path)
        self._last_flush = 0.0

        self._failed_attempts = 0
        self._lockout_until = 0
        self._lock = threading.Lock()
        self.MAX_ATTEMPTS = 5
        self.LOCKOUT_SECONDS = 30

    # ---- generate_pin / validate_pin / is_locked / lockout_remaining: UNCHANGED ----

    def _hash(self, raw):
        return hashlib.sha256(str(raw).encode("utf-8")).hexdigest()

    def issue_token(self, device_name=""):
        """Mint a session token and persist its hash + device metadata."""
        raw = secrets.token_urlsafe(32)
        now = time.time()
        record = {
            "id": str(uuid.uuid4()),
            "hash": self._hash(raw),
            "device_name": _sanitize_name(device_name),
            "issued_at": now,
            "last_seen": now,
            "expires_at": now + TOKEN_TTL_SECONDS,
        }
        with self._lock:
            self._store.add(record)
            self._store.flush()
            self._last_flush = now
        logging.info("[Security] Session token issued for %s", record["device_name"])
        return raw

    def validate_token(self, incoming_token):
        """Validate a token; slide its expiry on success. Constant-time is
        unnecessary — a SHA-256 lookup of the whole 256-bit secret leaks no
        guessable prefix."""
        if not incoming_token:
            return False
        h = self._hash(incoming_token)
        now = time.time()
        with self._lock:
            rec = self._store.get_by_hash(h)
            if rec is None:
                return False
            if rec["expires_at"] < now:
                self._store.remove(rec["id"])
                self._store.flush()
                self._last_flush = now
                return False
            rec["last_seen"] = now
            rec["expires_at"] = now + TOKEN_TTL_SECONDS
            if now - self._last_flush >= PERSIST_MIN_INTERVAL:
                self._store.flush()
                self._last_flush = now
            return True

    def list_devices(self):
        """Metadata for the GUI — never exposes the hash."""
        with self._lock:
            devices = [
                {
                    "id": r["id"],
                    "device_name": r["device_name"],
                    "last_seen": r["last_seen"],
                    "expires_at": r["expires_at"],
                }
                for r in self._store.all()
            ]
        devices.sort(key=lambda d: d["last_seen"], reverse=True)
        return devices

    def revoke(self, device_id):
        with self._lock:
            ok = self._store.remove(device_id)
            if ok:
                self._store.flush()
                self._last_flush = time.time()
        if ok:
            logging.info("[Security] Device revoked: %s", device_id)
        return ok

    def revoke_all_tokens(self):
        with self._lock:
            self._store.clear()
            self._store.flush()
            self._last_flush = time.time()
        logging.info("[Security] All session tokens revoked")

    def flush(self):
        """Force a final persist (call on graceful shutdown)."""
        with self._lock:
            self._store.flush()
            self._last_flush = time.time()
```

Remove the old `self._tokens = set()`, the set-based `validate_token` loop, and the old `issue_token`/`revoke_all_tokens` bodies. `hmac` stays imported (still used by `validate_pin`).

Note: `revoke` and `list_devices` are also used by Task 3 — they are defined here so Task 2's tests pass; Task 3 only adds their tests/GUI consumption. (Kept together because they share the store and lock.)

- [ ] **Step 4: Run the full SecurityManager suite**

Run: `python -m pytest tests/test_security_manager.py -q`
Expected: PASS (all old + new tests).

- [ ] **Step 5: Commit**

```bash
git add nexus_desktop/core/security_manager.py nexus_desktop/tests/test_security_manager.py
git commit -m "feat: SecurityManager persists tokens with hashing and sliding 30-day expiry"
```

---

### Task 3: Device management API tests (list/revoke)

`list_devices`/`revoke` were implemented in Task 2. This task locks their revocation contract with dedicated tests.

**Files:**
- Test: `nexus_desktop/tests/test_security_manager.py` (extend)

**Interfaces:**
- Consumes: `SecurityManager.list_devices()`, `revoke(id)`, `revoke_all_tokens()` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests** (append)

```python
def test_revoke_single_device_invalidates_only_that_token():
    sec = SecurityManager()
    tok_a = sec.issue_token("iPhone")
    tok_b = sec.issue_token("Android")

    dev_a = next(d for d in sec.list_devices() if d["device_name"] == "iPhone")
    assert sec.revoke(dev_a["id"]) is True

    assert sec.validate_token(tok_a) is False
    assert sec.validate_token(tok_b) is True
    assert [d["device_name"] for d in sec.list_devices()] == ["Android"]


def test_revoke_unknown_id_returns_false():
    sec = SecurityManager()
    sec.issue_token("iPhone")
    assert sec.revoke("no-such-id") is False


def test_list_devices_sorted_by_last_seen_desc(monkeypatch):
    sec = SecurityManager()
    t = [1_000.0]
    monkeypatch.setattr(sm_mod.time, "time", lambda: t[0])
    sec.issue_token("Older")
    t[0] = 2_000.0
    sec.issue_token("Newer")
    assert [d["device_name"] for d in sec.list_devices()] == ["Newer", "Older"]
```

- [ ] **Step 2: Run to verify they pass** (implementation already exists from Task 2)

Run: `python -m pytest tests/test_security_manager.py -k "revoke or list_devices" -q`
Expected: PASS. If any fail, fix the Task 2 implementation of `revoke`/`list_devices` to match.

- [ ] **Step 3: Commit**

```bash
git add nexus_desktop/tests/test_security_manager.py
git commit -m "test: lock per-device revoke and device-list ordering contract"
```

---

### Task 4: Wire /pair device_name and the on-disk store path

**Files:**
- Modify: `nexus_desktop/services/api_service.py:105-114` (the `pair` method)
- Modify: `nexus_desktop/main.py:49-50` (construct `SecurityManager` with a store path)
- Test: `nexus_desktop/tests/test_api_service_auth.py` (extend)

**Interfaces:**
- Consumes: `SecurityManager.issue_token(device_name)`, `SecurityManager(store_path=...)`.
- Produces: `/pair` accepts `{"pin", "device_name"?}`; agent persists tokens under `data/tokens.json`.

- [ ] **Step 1: Write the failing tests** (append to `nexus_desktop/tests/test_api_service_auth.py`)

```python
def test_pair_persists_device_name(client):
    app_client, sec = client
    res = app_client.post('/pair', json={'pin': sec.pin, 'device_name': "Efe's iPhone"})
    assert res.status_code == 200
    devices = sec.list_devices()
    assert devices[0]['device_name'] == "Efe's iPhone"


def test_pair_without_device_name_uses_default(client):
    app_client, sec = client
    res = app_client.post('/pair', json={'pin': sec.pin})
    assert res.status_code == 200
    assert sec.list_devices()[0]['device_name'] == 'Bilinmeyen Cihaz'


def test_token_survives_agent_restart(tmp_path, monkeypatch):
    from core.event_bus import EventBus
    from core.security_manager import SecurityManager
    from services.api_service import ApiService

    monkeypatch.setattr(sys, "argv", [str(tmp_path / "NexusAgent.exe")])
    store = str(tmp_path / "tokens.json")

    sec1 = SecurityManager(store_path=store)
    svc1 = ApiService("API", EventBus(), sec1, start_server=False)
    svc1.on_start()
    svc1.app.testing = True
    c1 = svc1.app.test_client()
    token = c1.post('/pair', json={'pin': sec1.pin}).get_json()['token']

    # Simulate a restart: brand-new manager + service over the same store file.
    sec2 = SecurityManager(store_path=store)
    svc2 = ApiService("API", EventBus(), sec2, start_server=False)
    svc2.on_start()
    svc2.app.testing = True
    c2 = svc2.app.test_client()

    res = c2.get('/verify', headers={'X-Nexus-Token': token})
    assert res.status_code == 200
```

Add `import sys` at the top of the test file if not already present (it is).

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/test_api_service_auth.py -q`
Expected: FAIL — `test_token_survives_agent_restart` fails (tokens not persisted because the fixture's `SecurityManager()` has no store), and the device-name tests fail (`pair` ignores `device_name`).

- [ ] **Step 3: Update `services/api_service.py` `pair`**

```python
    def pair(self):
        """Verify the pairing PIN and issue a session token."""
        data = request.json or {}
        incoming_pin = data.get('pin')

        if self.security.validate_pin(incoming_pin):
            token = self.security.issue_token(data.get('device_name', ''))
            return jsonify({"success": True, "message": "Paired successfully", "token": token}), 200
        else:
            return jsonify({"success": False, "message": "Invalid PIN"}), 401
```

- [ ] **Step 4: Update `main.py` to give the manager a store path**

Replace `sec_manager = SecurityManager()` (around line 50) with:

```python
    from core.security_manager import SecurityManager
    token_store_path = os.path.join(
        os.path.dirname(os.path.abspath(sys.argv[0])), "data", "tokens.json"
    )
    sec_manager = SecurityManager(store_path=token_store_path)
```

- [ ] **Step 5: Run the auth suite to verify it passes**

Run: `python -m pytest tests/test_api_service_auth.py -q`
Expected: PASS (old + 3 new tests).

- [ ] **Step 6: Commit**

```bash
git add nexus_desktop/services/api_service.py nexus_desktop/main.py nexus_desktop/tests/test_api_service_auth.py
git commit -m "feat: /pair accepts device_name and tokens persist across restarts"
```

---

### Task 5: Relative-time helper + GUI device management

**Files:**
- Create: `nexus_desktop/utils/timefmt.py`
- Test: `nexus_desktop/tests/test_timefmt.py`
- Modify: `nexus_desktop/services/gui_service.py`

**Interfaces:**
- Consumes: `SecurityManager.list_devices()`, `revoke(id)`, `revoke_all_tokens()`; `format_relative`.
- Produces: `format_relative(ts: float, now: float | None = None) -> str` (Turkish relative time).

- [ ] **Step 1: Write the failing test** — create `nexus_desktop/tests/test_timefmt.py`:

```python
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.timefmt import format_relative


def test_seconds_ago():
    assert format_relative(1000.0, now=1030.0) == "az önce"


def test_minutes_ago():
    assert format_relative(1000.0, now=1000.0 + 5 * 60) == "5 dk önce"


def test_hours_ago():
    assert format_relative(1000.0, now=1000.0 + 3 * 3600) == "3 saat önce"


def test_days_ago():
    assert format_relative(1000.0, now=1000.0 + 2 * 86400) == "2 gün önce"
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_timefmt.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'utils.timefmt'`.

- [ ] **Step 3: Implement `utils/timefmt.py`**

```python
"""Turkish relative-time formatting for the desktop GUI."""
import time


def format_relative(ts, now=None):
    now = time.time() if now is None else now
    delta = max(0, int(now - ts))
    if delta < 60:
        return "az önce"
    if delta < 3600:
        return f"{delta // 60} dk önce"
    if delta < 86400:
        return f"{delta // 3600} saat önce"
    return f"{delta // 86400} gün önce"
```

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/test_timefmt.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the device window to `services/gui_service.py`**

In `_run_gui_loop`, after the stats frame (`frame_stats.pack(...)`) and before `self.root.protocol(...)`, add a devices button that shows a live count:

```python
            self.btn_devices = tk.Button(
                self.root, text="Cihazlar", font=("Arial", 9, "bold"),
                bg="#ffffff", fg="#333333", relief="solid", bd=1,
                command=self._open_devices_window,
            )
            self.btn_devices.pack(pady=(0, 10))
```

Bump the window height so the button fits: change `self.root.geometry("300x220")` and the centered geometry to use height `270` (both the initial `"300x220"` and the computed `f"300x220+{x}+{y}"` → `270`).

In `update_stats`, refresh the button label with the device count:

```python
            if hasattr(self, 'btn_devices'):
                self.btn_devices.config(text=f"Cihazlar ({len(self.security.list_devices())})")
```

Add these methods to `GuiService`:

```python
    def _open_devices_window(self):
        from utils.timefmt import format_relative
        if getattr(self, "_dev_win", None) and tk.Toplevel.winfo_exists(self._dev_win):
            self._dev_win.lift()
            return
        win = tk.Toplevel(self.root)
        self._dev_win = win
        win.title("Eşleşmiş Cihazlar")
        win.geometry("340x300")
        win.configure(bg="#f0f0f0")

        self._dev_list_frame = tk.Frame(win, bg="#f0f0f0")
        self._dev_list_frame.pack(fill="both", expand=True, padx=10, pady=10)

        tk.Button(
            win, text="Tümünü Kaldır", font=("Arial", 9, "bold"),
            bg="#ff4444", fg="white", relief="flat",
            command=self._revoke_all_devices,
        ).pack(pady=(0, 10))

        self._render_devices()

    def _render_devices(self):
        from utils.timefmt import format_relative
        frame = getattr(self, "_dev_list_frame", None)
        if not frame or not tk.Frame.winfo_exists(frame):
            return
        for child in frame.winfo_children():
            child.destroy()
        devices = self.security.list_devices()
        if not devices:
            tk.Label(frame, text="Eşleşmiş cihaz yok", bg="#f0f0f0",
                     fg="#666666", font=("Arial", 10)).pack(pady=20)
            return
        for dev in devices:
            row = tk.Frame(frame, bg="#ffffff", bd=1, relief="solid")
            row.pack(fill="x", pady=3)
            info = f"{dev['device_name']}\n{format_relative(dev['last_seen'])}"
            tk.Label(row, text=info, bg="#ffffff", fg="#333333",
                     justify="left", anchor="w", font=("Arial", 9)).pack(
                side="left", padx=8, pady=4)
            tk.Button(
                row, text="Kaldır", font=("Arial", 8, "bold"),
                bg="#ff4444", fg="white", relief="flat",
                command=lambda d=dev["id"]: self._revoke_device(d),
            ).pack(side="right", padx=6, pady=4)

    def _revoke_device(self, device_id):
        self.security.revoke(device_id)
        self._render_devices()

    def _revoke_all_devices(self):
        self.security.revoke_all_tokens()
        self._render_devices()
```

- [ ] **Step 6: Verify the helper tests pass and existing tests are green**

Run: `python -m pytest tests/test_timefmt.py tests/test_security_manager.py -q`
Expected: PASS.

The tkinter GUI itself is not unit-tested (consistent with the existing untested `GuiService`); its logic (`list_devices`/`revoke`/`format_relative`) is fully covered. **Manual verification (note in the commit/PR, do not block on it here):** launch the agent, pair a phone, open **Cihazlar** — the device appears with a last-seen; **Kaldır** removes it and the phone re-pairs on its next `/verify`.

- [ ] **Step 7: Commit**

```bash
git add nexus_desktop/utils/timefmt.py nexus_desktop/tests/test_timefmt.py nexus_desktop/services/gui_service.py
git commit -m "feat: desktop GUI lists and revokes paired devices"
```

---

### Task 6: Frontend — device name at pairing

**Files:**
- Create: `services/deviceName.ts`
- Test: `services/deviceName.test.ts`
- Modify: `hooks/useConnection.ts` (`pairDevice` signature + body)
- Modify: `hooks/useConnection.test.ts` (existing body assertion)
- Modify: `components/ConnectScreen.tsx` (device-name input + `onPair` signature)
- Modify: `App.tsx:144-146` (`handlePair` passes the name through)

**Interfaces:**
- Consumes: `/pair` accepting `device_name` (Task 4).
- Produces: `guessDeviceName(ua?: string) -> string`; `pairDevice(ip, pin, deviceName?)`; `onPair(ip, pin, deviceName) => Promise<...>`.

- [ ] **Step 1: Write the failing test** — create `services/deviceName.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { guessDeviceName } from './deviceName';

describe('guessDeviceName', () => {
  it('detects iPhone', () => {
    expect(guessDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iPhone');
  });
  it('detects iPad', () => {
    expect(guessDeviceName('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('iPad');
  });
  it('detects Android', () => {
    expect(guessDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('Android');
  });
  it('falls back to Telefon', () => {
    expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0)')).toBe('Telefon');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run services/deviceName.test.ts`
Expected: FAIL — cannot find module `./deviceName`.

- [ ] **Step 3: Implement `services/deviceName.ts`**

```typescript
/** Best-effort human-friendly device label from the user agent. */
export function guessDeviceName(ua: string = navigator.userAgent): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  return 'Telefon';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run services/deviceName.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Thread `deviceName` through `useConnection.pairDevice`**

In `hooks/useConnection.ts`, import the helper and update the signature + body:

```typescript
import { guessDeviceName } from '../services/deviceName';
```

```typescript
  const pairDevice = async (ip: string, pin: string, deviceName?: string): Promise<{ success: boolean; error?: string }> => {
    const cleanIp = sanitizeIp(ip);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(buildAgentUrl(ip, '/pair'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pin, device_name: (deviceName && deviceName.trim()) || guessDeviceName() }),
        signal: controller.signal
      });
```

(Leave the rest of `pairDevice` unchanged.)

- [ ] **Step 6: Update the existing `useConnection` body assertion**

In `hooks/useConnection.test.ts`, the first pairing test asserts the exact body. Change:

```typescript
      expect(JSON.parse(String(options?.body))).toEqual({ pin: '1234' });
```

to:

```typescript
      const body = JSON.parse(String(options?.body));
      expect(body.pin).toBe('1234');
      expect(typeof body.device_name).toBe('string');
      expect(body.device_name.length).toBeGreaterThan(0);
```

- [ ] **Step 7: Add the device-name input to `ConnectScreen.tsx`**

Update the props and add the field. Change the interface:

```typescript
interface ConnectScreenProps {
  onPair: (ip: string, pin: string, deviceName: string) => Promise<{ success: boolean; error?: string }>;
  initialIp?: string;
  initialPin?: string;
}
```

Add state and a default near the other `useState` calls:

```typescript
  const [deviceName, setDeviceName] = useState(() => guessDeviceName());
```

and import it: `import { guessDeviceName } from '../services/deviceName';`

Pass it in `handleSubmit`:

```typescript
    const result = await onPair(ip, pin, deviceName);
```

Add an input block **after** the PIN input block (before the error message), mirroring the existing input styling:

```tsx
            {/* Device Name Input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-display font-black text-hud-cyan/70 uppercase tracking-wider block px-1">
                CİHAZ ADI
              </label>
              <input
                type="text"
                maxLength={40}
                placeholder="Örn: iPhone"
                className="w-full bg-hud-bg/80 border border-hud-dim rounded-sm py-3 px-4 text-slate-100 font-data text-sm placeholder:text-slate-600 focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20 outline-none transition-all"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                disabled={loading}
              />
            </div>
```

- [ ] **Step 8: Update `App.tsx` `handlePair`**

At `App.tsx:144-146`, update the handler to accept and forward the name:

```typescript
  const handlePair = async (ip: string, pin: string, deviceName: string) => {
    const res = await connection.pairDevice(ip, pin, deviceName);
```

(Keep the rest of the function body unchanged.)

- [ ] **Step 9: Run the full frontend suite + typecheck + build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean, all vitest tests pass, build succeeds.

- [ ] **Step 10: Commit**

```bash
git add services/deviceName.ts services/deviceName.test.ts hooks/useConnection.ts hooks/useConnection.test.ts components/ConnectScreen.tsx App.tsx
git commit -m "feat: phone sends a device name when pairing"
```

---

## Final Verification

- [ ] Backend: `python -m pytest tests -q` from `nexus_desktop/` — all green.
- [ ] Frontend: `npx tsc --noEmit && npx vitest run && npm run build` — all green.
- [ ] `git grep -n "self._tokens"` returns nothing (old set fully removed).
- [ ] `nexus_desktop/data/tokens.json` is gitignored (`git check-ignore nexus_desktop/data/tokens.json`).
- [ ] Whole-branch review via superpowers:requesting-code-review before opening the PR.

## Self-Review Notes (author)

- **Spec coverage:** Phase 1 → Task 1 (+ Task 4 path wiring); Phase 2 → Task 2; Phase 3 device mgmt → Tasks 2/3 (logic) + Task 5 (GUI); `/pair` device_name → Task 4; frontend → Task 6. All spec sections mapped.
- **Type consistency:** `issue_token(device_name='')`, `validate_token`, `list_devices() -> [{id,device_name,last_seen,expires_at}]`, `revoke(id)`, `revoke_all_tokens()`, `SecurityManager(store_path=None)`, `guessDeviceName`, `pairDevice(ip,pin,deviceName?)`, `onPair(ip,pin,deviceName)` are used identically across tasks.
- **Migration:** first post-upgrade launch loses old in-memory tokens (one re-pair) — expected, noted in spec.

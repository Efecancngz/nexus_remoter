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
    name = re.sub(r"[\t\n\r\v\f]", " ", name)
    name = _CONTROL.sub("", name)
    name = " ".join(name.split())
    name = name[:40].strip()
    return name or "Bilinmeyen Cihaz"


class SecurityManager:
    def __init__(self, store_path=None):
        # Generate new PIN on every startup (Dynamic)
        self.pin = self.generate_pin()

        # Session tokens issued after successful pairing
        self._store = TokenStore(store_path)
        self._last_flush = 0.0

        # Brute-force protection (pairing surface only)
        self._failed_attempts = 0
        self._lockout_until = 0
        self._lock = threading.Lock()
        self.MAX_ATTEMPTS = 5
        self.LOCKOUT_SECONDS = 30

    def generate_pin(self):
        return "".join(random.choices(string.digits, k=4))

    def validate_pin(self, incoming_pin):
        """Check the pairing PIN. Rate-limited; only used by /pair."""
        with self._lock:
            now = time.time()

            # Check if currently locked out
            if now < self._lockout_until:
                remaining = int(self._lockout_until - now)
                logging.warning(f"[Security] Locked out. {remaining}s remaining. Rejecting attempt.")
                return False

            if hmac.compare_digest(str(incoming_pin), self.pin):
                # Reset failed attempts on success
                self._failed_attempts = 0
                return True
            else:
                self._failed_attempts += 1
                logging.warning(f"[Security] Failed attempt #{self._failed_attempts} (max: {self.MAX_ATTEMPTS})")

                if self._failed_attempts >= self.MAX_ATTEMPTS:
                    self._lockout_until = now + self.LOCKOUT_SECONDS
                    self._failed_attempts = 0
                    logging.warning(f"[Security] Too many failed attempts! Locked for {self.LOCKOUT_SECONDS}s")

                return False

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

    @property
    def is_locked(self):
        return time.time() < self._lockout_until

    @property
    def lockout_remaining(self):
        remaining = self._lockout_until - time.time()
        return max(0, int(remaining))

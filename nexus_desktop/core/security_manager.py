import hmac
import random
import secrets
import string
import time
import threading
import logging

class SecurityManager:
    def __init__(self):
        # Generate new PIN on every startup (Dynamic)
        self.pin = self.generate_pin()

        # Session tokens issued after successful pairing
        self._tokens = set()

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

    def issue_token(self):
        """Mint a session token after a successful pairing."""
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._tokens.add(token)
        logging.info("[Security] Session token issued")
        return token

    def validate_token(self, incoming_token):
        """Check a session token. Constant-time; used by all protected routes."""
        if not incoming_token:
            return False
        incoming = str(incoming_token)
        with self._lock:
            # Compare against every stored token so timing does not reveal
            # whether a prefix matched.
            valid = False
            for token in self._tokens:
                if hmac.compare_digest(incoming, token):
                    valid = True
            return valid

    def revoke_all_tokens(self):
        with self._lock:
            self._tokens.clear()
        logging.info("[Security] All session tokens revoked")

    @property
    def is_locked(self):
        return time.time() < self._lockout_until

    @property
    def lockout_remaining(self):
        remaining = self._lockout_until - time.time()
        return max(0, int(remaining))

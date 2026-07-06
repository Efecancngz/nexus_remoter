import hmac
import random
import string
import time
import threading
import logging

class SecurityManager:
    def __init__(self):
        # Generate new PIN on every startup (Dynamic)
        self.pin = self.generate_pin()
        
        # Brute-force protection
        self._failed_attempts = 0
        self._lockout_until = 0
        self._lock = threading.Lock()
        self.MAX_ATTEMPTS = 5
        self.LOCKOUT_SECONDS = 30

    def generate_pin(self):
        return "".join(random.choices(string.digits, k=4))

    def validate(self, incoming_pin):
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
    
    @property
    def is_locked(self):
        return time.time() < self._lockout_until
    
    @property
    def lockout_remaining(self):
        remaining = self._lockout_until - time.time()
        return max(0, int(remaining))

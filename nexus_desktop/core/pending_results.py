"""Correlate an async action result back to the blocking HTTP request that
triggered it, keyed by request id. Thread-safe: register/resolve/wait may be
called from different threads (Flask request thread vs action pool thread)."""
import threading


class PendingResults:
    def __init__(self):
        self._lock = threading.Lock()
        self._entries = {}  # request_id -> [threading.Event, result_dict | None]

    def register(self, request_id):
        """Create a waitable slot for request_id (replaces any existing slot)."""
        with self._lock:
            self._entries[request_id] = [threading.Event(), None]

    def resolve(self, request_id, result):
        """Store result and wake any waiter. No-op if id is unknown."""
        with self._lock:
            entry = self._entries.get(request_id)
            if entry is None:
                return
            entry[1] = result
            entry[0].set()

    def wait(self, request_id, timeout):
        """Block until resolved or timeout. Returns result dict or None.
        Always removes the entry before returning."""
        with self._lock:
            entry = self._entries.get(request_id)
        if entry is None:
            return None
        signaled = entry[0].wait(timeout)
        with self._lock:
            self._entries.pop(request_id, None)
        return entry[1] if signaled else None

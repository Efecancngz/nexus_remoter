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
        except (json.JSONDecodeError, OSError, TypeError, ValueError, AttributeError):
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
        dirname = os.path.dirname(self.path)
        if dirname:
            os.makedirs(dirname, exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"tokens": list(self._records.values())}, f)
        os.replace(tmp, self.path)

import json
import logging
import os
import tempfile

MAX_RUNS = 20


class RunStore:
    """Persists server-side agent-run records as a flat JSON file, newest-first, capped.

    Not internally thread-safe: the GoalRunner serializes writes (one active run).
    """

    def __init__(self, path):
        self.path = path

    def load(self):
        if not os.path.exists(self.path):
            return []
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logging.warning(f"[RunStore] Failed to load {self.path}: {e}")
            return []
        if not isinstance(data, list):
            logging.warning(f"[RunStore] Expected a list in {self.path}, got {type(data).__name__}")
            return []
        return data

    def save_run(self, record):
        runs = self.load()
        runs = [r for r in runs if r.get('run_id') != record.get('run_id')]
        runs.insert(0, record)
        runs = runs[:MAX_RUNS]
        self._write(runs)

    def _write(self, runs):
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=directory or ".", prefix=".agent_runs_", suffix=".tmp")
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(runs, f)
            os.replace(tmp_path, self.path)
        except Exception:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise

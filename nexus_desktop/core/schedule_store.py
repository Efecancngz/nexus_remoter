import json
import logging
import os
import tempfile


class ScheduleStore:
    """Persists SchedulerService jobs as a flat JSON file.

    Not internally thread-safe: callers must serialize access (SchedulerService
    does this via its existing self.lock).
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
            logging.warning(f"[ScheduleStore] Failed to load {self.path}: {e}")
            return []
        if not isinstance(data, list):
            logging.warning(f"[ScheduleStore] Expected a list in {self.path}, got {type(data).__name__}")
            return []
        return data

    def save_job(self, job_id, due_at, action):
        jobs = self.load()
        jobs = [j for j in jobs if j.get('job_id') != job_id]
        jobs.append({"job_id": job_id, "due_at": due_at, "action": action})
        self._write(jobs)

    def remove_job(self, job_id):
        jobs = self.load()
        jobs = [j for j in jobs if j.get('job_id') != job_id]
        self._write(jobs)

    def _write(self, jobs):
        directory = os.path.dirname(self.path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=directory or ".", prefix=".schedules_", suffix=".tmp")
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(jobs, f)
            os.replace(tmp_path, self.path)
        except Exception:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise

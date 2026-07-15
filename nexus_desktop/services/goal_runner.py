import threading
import time
import uuid


class GoalRunner:
    """Runs a goal through a bounded observe->decide->act loop on the PC.

    Dependency-injected: `decide(goal, history) -> dict`, `execute(action) -> Any`
    (raises on failure), and a `store` with `save_run`/`load`. One active run at a time.
    """

    def __init__(self, decide, execute, store, max_steps=15):
        self._decide = decide
        self._execute = execute
        self._store = store
        self._max_steps = max_steps
        self._lock = threading.Lock()
        self._busy = False

    def start(self, goal):
        with self._lock:
            if self._busy:
                return None
            self._busy = True
        run_id = str(uuid.uuid4())
        threading.Thread(target=self._run, args=(goal, run_id), daemon=True).start()
        return run_id

    def recent_runs(self):
        return self._store.load()

    def _run(self, goal, run_id):
        started_at = time.time()
        history = []
        steps = []
        outcome = "failed"
        detail = None
        try:
            for step in range(self._max_steps):
                try:
                    decision = self._decide(goal, history)
                    if decision.get("done"):
                        outcome = "completed"
                        detail = decision.get("summary")
                        break
                    action = decision["action"]
                except Exception as e:
                    outcome = "failed"
                    detail = str(e)
                    break
                record = {
                    "type": action.get("type"),
                    "value": action.get("value"),
                    "description": action.get("description"),
                    "status": "failed",
                }
                try:
                    self._execute(action)
                except Exception as e:
                    steps.append(record)
                    outcome = "failed"
                    detail = str(e)
                    break
                record["status"] = "done"
                steps.append(record)
                history.append({"type": action.get("type"), "description": action.get("description")})
                if step == self._max_steps - 1:
                    outcome = "capped"
            self._store.save_run({
                "run_id": run_id,
                "goal": goal,
                "started_at": started_at,
                "finished_at": time.time(),
                "outcome": outcome,
                "detail": detail,
                "steps": steps,
            })
        finally:
            with self._lock:
                self._busy = False

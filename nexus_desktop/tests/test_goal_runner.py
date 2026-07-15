import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.goal_runner import GoalRunner


class FakeStore:
    def __init__(self):
        self.runs = []

    def save_run(self, record):
        self.runs.insert(0, record)

    def load(self):
        return self.runs


ACTION = {"type": "MOUSE_CLICK", "value": "1%,1%", "description": "tıkla"}


def _runner(decide, execute, store=None, max_steps=15):
    return GoalRunner(decide=decide, execute=execute, store=store or FakeStore(), max_steps=max_steps)


def test_run_completed_records_summary():
    store = FakeStore()
    decide = lambda goal, history: {"done": True, "summary": "bitti"}
    r = _runner(decide, execute=lambda a: None, store=store)
    r._run("hedef", "rid")
    rec = store.runs[0]
    assert rec["outcome"] == "completed"
    assert rec["detail"] == "bitti"
    assert rec["steps"] == []


def test_run_failed_when_execute_raises():
    store = FakeStore()
    decide = lambda goal, history: {"done": False, "thought": "t", "action": ACTION}
    def execute(a):
        raise RuntimeError("PC hatası")
    r = _runner(decide, execute, store=store)
    r._run("hedef", "rid")
    rec = store.runs[0]
    assert rec["outcome"] == "failed"
    assert rec["detail"] == "PC hatası"
    assert rec["steps"][-1]["status"] == "failed"


def test_run_capped_at_max_steps():
    store = FakeStore()
    decide = lambda goal, history: {"done": False, "thought": "t", "action": ACTION}
    r = _runner(decide, execute=lambda a: None, store=store, max_steps=3)
    r._run("hedef", "rid")
    rec = store.runs[0]
    assert rec["outcome"] == "capped"
    assert len(rec["steps"]) == 3
    assert all(s["status"] == "done" for s in rec["steps"])


def test_run_builds_history_across_steps():
    seen = []
    def decide(goal, history):
        seen.append(list(history))
        if len(seen) >= 2:
            return {"done": True, "summary": "ok"}
        return {"done": False, "thought": "t", "action": ACTION}
    r = _runner(decide, execute=lambda a: None)
    r._run("hedef", "rid")
    # First decide sees empty history; second sees the executed step.
    assert seen[0] == []
    assert seen[1] == [{"type": "MOUSE_CLICK", "description": "tıkla"}]


def test_start_returns_none_when_busy():
    r = _runner(decide=lambda g, h: {"done": True, "summary": "x"}, execute=lambda a: None)
    r._busy = True
    assert r.start("hedef") is None


def test_start_runs_and_records():
    store = FakeStore()
    r = _runner(decide=lambda g, h: {"done": True, "summary": "ok"}, execute=lambda a: None, store=store)
    run_id = r.start("hedef")
    assert run_id is not None
    deadline = time.time() + 2
    while not store.runs and time.time() < deadline:
        time.sleep(0.01)
    assert store.runs and store.runs[0]["run_id"] == run_id
    assert r._busy is False

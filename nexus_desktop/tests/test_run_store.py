import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.run_store import RunStore, MAX_RUNS


def _rec(run_id, goal="hedef"):
    return {"run_id": run_id, "goal": goal, "started_at": 1, "finished_at": 2,
            "outcome": "completed", "detail": "ok", "steps": []}


def test_load_missing_file_returns_empty(tmp_path):
    store = RunStore(str(tmp_path / "agent_runs.json"))
    assert store.load() == []


def test_load_corrupt_file_returns_empty(tmp_path):
    path = tmp_path / "agent_runs.json"
    path.write_text("{not json", encoding="utf-8")
    assert RunStore(str(path)).load() == []


def test_save_run_prepends_newest_first(tmp_path):
    store = RunStore(str(tmp_path / "agent_runs.json"))
    store.save_run(_rec("a"))
    store.save_run(_rec("b"))
    assert [r["run_id"] for r in store.load()] == ["b", "a"]


def test_save_run_caps_at_max(tmp_path):
    store = RunStore(str(tmp_path / "agent_runs.json"))
    for i in range(MAX_RUNS + 1):
        store.save_run(_rec(str(i)))
    runs = store.load()
    assert len(runs) == MAX_RUNS
    assert runs[0]["run_id"] == str(MAX_RUNS)      # newest kept
    assert all(r["run_id"] != "0" for r in runs)   # oldest dropped

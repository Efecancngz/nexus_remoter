import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.schedule_store import ScheduleStore


def test_load_on_missing_file_returns_empty_list(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    assert store.load() == []


def test_save_job_then_load_round_trip(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.5, {"type": "SYSTEM_POWER", "value": "shutdown"})

    jobs = store.load()
    assert jobs == [{"job_id": "job-1", "due_at": 1000.5, "action": {"type": "SYSTEM_POWER", "value": "shutdown"}}]


def test_save_job_twice_with_same_id_updates_not_duplicates(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.0, {"type": "WAIT", "value": "1"})
    store.save_job("job-1", 2000.0, {"type": "WAIT", "value": "2"})

    jobs = store.load()
    assert len(jobs) == 1
    assert jobs[0]["due_at"] == 2000.0
    assert jobs[0]["action"]["value"] == "2"


def test_save_two_different_jobs_both_persist(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.0, {"type": "WAIT", "value": "1"})
    store.save_job("job-2", 2000.0, {"type": "WAIT", "value": "2"})

    jobs = store.load()
    assert {j["job_id"] for j in jobs} == {"job-1", "job-2"}


def test_remove_job_deletes_only_that_job(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.0, {"type": "WAIT", "value": "1"})
    store.save_job("job-2", 2000.0, {"type": "WAIT", "value": "2"})

    store.remove_job("job-1")

    jobs = store.load()
    assert len(jobs) == 1
    assert jobs[0]["job_id"] == "job-2"


def test_remove_nonexistent_job_is_a_no_op(tmp_path):
    store = ScheduleStore(str(tmp_path / "schedules.json"))
    store.save_job("job-1", 1000.0, {"type": "WAIT", "value": "1"})

    store.remove_job("does-not-exist")

    jobs = store.load()
    assert len(jobs) == 1

import os
import sys
import threading
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.pending_results import PendingResults


def test_resolve_before_wait_returns_result():
    pr = PendingResults()
    pr.register("a")
    pr.resolve("a", {"success": True})
    assert pr.wait("a", timeout=1.0) == {"success": True}


def test_resolve_after_wait_started_wakes_waiter():
    pr = PendingResults()
    pr.register("b")
    results = []

    def waiter():
        results.append(pr.wait("b", timeout=2.0))

    t = threading.Thread(target=waiter)
    t.start()
    time.sleep(0.1)
    pr.resolve("b", {"success": False, "error": "x"})
    t.join(timeout=2.0)
    assert results == [{"success": False, "error": "x"}]


def test_wait_times_out_returns_none():
    pr = PendingResults()
    pr.register("c")
    assert pr.wait("c", timeout=0.1) is None


def test_resolve_unknown_id_is_noop():
    pr = PendingResults()
    pr.resolve("nope", {"success": True})  # must not raise


def test_wait_removes_entry():
    pr = PendingResults()
    pr.register("d")
    pr.resolve("d", {"success": True})
    assert pr.wait("d", timeout=1.0) == {"success": True}
    assert pr.wait("d", timeout=0.1) is None  # entry gone

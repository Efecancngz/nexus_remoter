import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from services.automation_service import AutomationService, _APP_TARGETS


@pytest.fixture
def service(monkeypatch):
    svc = AutomationService.__new__(AutomationService)  # skip Service.__init__
    calls = []
    monkeypatch.setattr("os.startfile", lambda target: calls.append(target))
    svc._startfile_calls = calls
    return svc


def test_allowlisted_command_launches_target(service):
    service.run_allowlisted("calc")
    assert service._startfile_calls == ["calc"]


def test_command_with_injection_suffix_only_launches_allowlisted_target(service):
    # The attacker-controlled suffix must never reach os.startfile/shell.
    service.run_allowlisted("calc && del C:/important-data")
    assert service._startfile_calls == ["calc"]


def test_unknown_command_is_rejected(service):
    with pytest.raises(ValueError):
        service.run_allowlisted("shutdown /s /t 0")
    assert service._startfile_calls == []


def test_raw_shell_command_is_rejected(service):
    with pytest.raises(ValueError):
        service.run_allowlisted("rm -rf /")
    assert service._startfile_calls == []


def test_empty_command_is_rejected(service):
    with pytest.raises(ValueError):
        service.run_allowlisted("")
    assert service._startfile_calls == []


def test_launch_app_known_target_uses_allowlist(service):
    service.launch_app("Spotify")
    assert service._startfile_calls == [_APP_TARGETS["spotify"]]


def test_launch_app_unknown_app_falls_back_to_search(service, monkeypatch):
    monkeypatch.setattr(
        "services.automation_service.find_installed_app",
        lambda name: r"C:\Program Files\SomeApp\app.exe",
    )
    service.launch_app("someapp")
    assert service._startfile_calls == [r"C:\Program Files\SomeApp\app.exe"]


def test_launch_app_not_found_raises_without_executing_raw_value(service, monkeypatch):
    monkeypatch.setattr("services.automation_service.find_installed_app", lambda name: None)
    with pytest.raises(ValueError):
        service.launch_app("calc & del C:/")
    assert service._startfile_calls == []


def test_system_power_shutdown_uses_argv_no_shell(service, monkeypatch):
    calls = []
    monkeypatch.setattr(
        "subprocess.run", lambda argv, shell: calls.append((argv, shell))
    )
    service.handle_system_power("shutdown")
    assert calls == [(["shutdown", "/s", "/t", "0"], False)]


def test_system_power_unknown_action_rejected(service):
    with pytest.raises(ValueError):
        service.handle_system_power("format-drive")


class _FakeProc:
    def __init__(self, pid, name):
        self.pid = pid
        self.info = {"pid": pid, "name": name}
        self.terminated = False
        self.killed = False

    def name(self):
        return self.info["name"]

    def terminate(self):
        self.terminated = True

    def kill(self):
        self.killed = True


@pytest.fixture
def psutil_env(monkeypatch):
    def setup(procs, window_pids=frozenset()):
        monkeypatch.setattr(
            "services.automation_service.psutil.process_iter",
            lambda attrs: iter(procs),
        )
        monkeypatch.setattr(
            "services.automation_service.psutil.wait_procs",
            lambda targets, timeout: (targets, []),
        )
        monkeypatch.setattr(
            "services.automation_service.psutil.Process",
            lambda pid: next(p for p in procs if p.pid == pid),
        )
        monkeypatch.setattr(
            "services.automation_service.find_pids_by_window_title",
            lambda term: set(window_pids),
        )
        return procs
    return setup


def test_close_app_matches_process_name(service, psutil_env):
    procs = psutil_env([_FakeProc(100, "cs2.exe"), _FakeProc(200, "notepad.exe")])
    service.close_app("cs2")
    assert procs[0].terminated and not procs[1].terminated


def test_close_app_falls_back_to_window_title(service, psutil_env):
    # Process is cs2.exe but the AI sends the full game name; only the
    # window title ("Counter-Strike 2") matches.
    procs = psutil_env([_FakeProc(100, "cs2.exe")], window_pids={100})
    service.close_app("Counter Strike 2")
    assert procs[0].terminated


def test_close_app_never_kills_protected_process(service, psutil_env):
    procs = psutil_env([_FakeProc(4, "explorer.exe")], window_pids={4})
    with pytest.raises(ValueError):
        service.close_app("explorer")
    assert not procs[0].terminated


def test_close_app_no_match_raises(service, psutil_env):
    psutil_env([_FakeProc(100, "notepad.exe")])
    with pytest.raises(ValueError):
        service.close_app("cs2")


def test_close_app_empty_value_rejected(service, psutil_env):
    psutil_env([])
    with pytest.raises(ValueError):
        service.close_app("  ")


def test_close_app_short_term_requires_exact_match(service, psutil_env):
    # 'cs2' must not substring-match into unrelated processes like 'briefcs2sync'.
    procs = psutil_env([_FakeProc(100, "briefcs2sync.exe")])
    with pytest.raises(ValueError):
        service.close_app("cs2")
    assert not procs[0].terminated

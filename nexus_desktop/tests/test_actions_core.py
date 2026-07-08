import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions._targets import APP_TARGETS
from actions.base import ActionContext
from actions.command import CommandAction
from actions.close_app import CloseAppAction
from actions.launch_app import LaunchAppAction
from actions.system_power import SystemPowerAction

CTX = ActionContext(bus=None)


@pytest.fixture
def startfile_calls(monkeypatch):
    calls = []
    monkeypatch.setattr("os.startfile", lambda target: calls.append(target))
    return calls


class TestCommand:
    def test_allowlisted_command_launches_target(self, startfile_calls):
        CommandAction().execute("calc", CTX)
        assert startfile_calls == ["calc"]

    def test_command_with_injection_suffix_only_launches_allowlisted_target(self, startfile_calls):
        # The attacker-controlled suffix must never reach os.startfile/shell.
        CommandAction().execute("calc && del C:/important-data", CTX)
        assert startfile_calls == ["calc"]

    def test_unknown_command_is_rejected(self, startfile_calls):
        with pytest.raises(ValueError):
            CommandAction().execute("shutdown /s /t 0", CTX)
        assert startfile_calls == []

    def test_raw_shell_command_is_rejected(self, startfile_calls):
        with pytest.raises(ValueError):
            CommandAction().execute("rm -rf /", CTX)
        assert startfile_calls == []

    def test_empty_command_is_rejected(self, startfile_calls):
        with pytest.raises(ValueError):
            CommandAction().execute("", CTX)
        assert startfile_calls == []


class TestLaunchApp:
    def test_known_target_uses_allowlist(self, startfile_calls):
        LaunchAppAction().execute("Spotify", CTX)
        assert startfile_calls == [APP_TARGETS["spotify"]]

    def test_unknown_app_falls_back_to_search(self, startfile_calls, monkeypatch):
        monkeypatch.setattr(
            "actions.launch_app.find_installed_app",
            lambda name: r"C:\Program Files\SomeApp\app.exe",
        )
        LaunchAppAction().execute("someapp", CTX)
        assert startfile_calls == [r"C:\Program Files\SomeApp\app.exe"]

    def test_not_found_raises_without_executing_raw_value(self, startfile_calls, monkeypatch):
        monkeypatch.setattr("actions.launch_app.find_installed_app", lambda name: None)
        with pytest.raises(ValueError):
            LaunchAppAction().execute("calc & del C:/", CTX)
        assert startfile_calls == []


class TestWait:
    def test_non_numeric_value_raises(self):
        from actions.wait import WaitAction
        with pytest.raises(ValueError):
            WaitAction().execute("abc", CTX)


class TestSystemPower:
    def test_shutdown_uses_argv_no_shell(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            "subprocess.run", lambda argv, shell: calls.append((argv, shell))
        )
        SystemPowerAction().execute("shutdown", CTX)
        assert calls == [(["shutdown", "/s", "/t", "0"], False)]

    def test_unknown_action_rejected(self):
        with pytest.raises(ValueError):
            SystemPowerAction().execute("format-drive", CTX)


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
            "actions.close_app.psutil.process_iter",
            lambda attrs: iter(list(procs)),
        )
        monkeypatch.setattr(
            "actions.close_app.psutil.wait_procs",
            lambda targets, timeout: (targets, []),
        )
        monkeypatch.setattr(
            "actions.close_app.psutil.Process",
            lambda pid: next(p for p in procs if p.pid == pid),
        )
        monkeypatch.setattr(
            "actions.close_app.find_pids_by_window_title",
            lambda term: set(window_pids),
        )
        return procs
    return setup


class TestCloseApp:
    def test_matches_process_name(self, psutil_env):
        procs = psutil_env([_FakeProc(100, "cs2.exe"), _FakeProc(200, "notepad.exe")])
        CloseAppAction().execute("cs2", CTX)
        assert procs[0].terminated and not procs[1].terminated

    def test_falls_back_to_window_title(self, psutil_env):
        # Process is cs2.exe but the AI sends the full game name; only the
        # window title ("Counter-Strike 2") matches.
        procs = psutil_env([_FakeProc(100, "cs2.exe")], window_pids={100})
        CloseAppAction().execute("Counter Strike 2", CTX)
        assert procs[0].terminated

    def test_never_kills_protected_process(self, psutil_env):
        procs = psutil_env([_FakeProc(4, "explorer.exe")], window_pids={4})
        with pytest.raises(ValueError):
            CloseAppAction().execute("explorer", CTX)
        assert not procs[0].terminated

    def test_no_match_raises(self, psutil_env):
        psutil_env([_FakeProc(100, "notepad.exe")])
        with pytest.raises(ValueError):
            CloseAppAction().execute("cs2", CTX)

    def test_empty_value_rejected(self, psutil_env):
        psutil_env([])
        with pytest.raises(ValueError):
            CloseAppAction().execute("  ", CTX)

    def test_short_term_requires_exact_match(self, psutil_env):
        # 'cs2' must not substring-match into unrelated processes.
        procs = psutil_env([_FakeProc(100, "briefcs2sync.exe")])
        with pytest.raises(ValueError):
            CloseAppAction().execute("cs2", CTX)
        assert not procs[0].terminated

    def test_typo_matches_process_fuzzily(self, psutil_env):
        procs = psutil_env([_FakeProc(100, "spotify.exe")])
        CloseAppAction().execute("spotfy", CTX)
        assert procs[0].terminated

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

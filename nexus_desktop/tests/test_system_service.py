import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from core.event_bus import EventBus, Event
from services.system_service import SystemService
import services.system_service as system_service_module


@pytest.fixture
def service():
    bus = EventBus()
    svc = SystemService("System", bus)
    svc.on_start()
    return svc, bus


def test_on_start_subscribes_to_get_system_stats(service):
    svc, bus = service
    assert "GET_SYSTEM_STATS" in bus._subscribers
    assert svc.handle_get_stats in bus._subscribers["GET_SYSTEM_STATS"]


def test_on_start_sets_platform_info(service):
    svc, _ = service
    assert svc.platform_info


def test_handle_get_stats_publishes_system_stats_updated(monkeypatch, service):
    svc, bus = service
    monkeypatch.setattr(system_service_module.psutil, "cpu_percent", lambda interval=None: 42)
    monkeypatch.setattr(
        system_service_module.psutil,
        "virtual_memory",
        lambda: type("Mem", (), {"percent": 55})(),
    )
    monkeypatch.setattr(svc, "_get_battery_status", lambda: "No Battery")

    received = []
    bus.subscribe("SYSTEM_STATS_UPDATED", lambda e: received.append(e.payload))

    svc.handle_get_stats(Event("GET_SYSTEM_STATS"))

    assert len(received) == 1
    stats = received[0]
    assert stats["cpu"] == 42
    assert stats["ram"] == 55
    assert stats["battery"] == "No Battery"
    assert stats["platform"] == svc.platform_info


def test_handle_get_stats_swallows_exceptions(monkeypatch, service):
    svc, bus = service

    def boom(interval=None):
        raise RuntimeError("psutil exploded")

    monkeypatch.setattr(system_service_module.psutil, "cpu_percent", boom)

    received = []
    bus.subscribe("SYSTEM_STATS_UPDATED", lambda e: received.append(e.payload))

    svc.handle_get_stats(Event("GET_SYSTEM_STATS"))

    assert received == []


def test_battery_status_no_sensors_battery_attr(monkeypatch, service):
    svc, _ = service
    monkeypatch.delattr(system_service_module.psutil, "sensors_battery", raising=False)

    assert svc._get_battery_status() == "N/A"


def test_battery_status_no_battery_present(monkeypatch, service):
    svc, _ = service
    monkeypatch.setattr(system_service_module.psutil, "sensors_battery", lambda: None, raising=False)

    assert svc._get_battery_status() == "No Battery"


def test_battery_status_reports_percent_and_plugged_state(monkeypatch, service):
    svc, _ = service
    fake_battery = type("Battery", (), {"percent": 80, "power_plugged": True, "secsleft": 3600})()
    monkeypatch.setattr(system_service_module.psutil, "sensors_battery", lambda: fake_battery, raising=False)

    status = svc._get_battery_status()

    assert status == {"percent": 80, "power_plugged": True, "secsleft": 3600}


def test_battery_status_unlimited_secsleft_reported_as_string(monkeypatch, service):
    svc, _ = service
    fake_battery = type(
        "Battery",
        (),
        {"percent": 100, "power_plugged": True, "secsleft": system_service_module.psutil.POWER_TIME_UNLIMITED},
    )()
    monkeypatch.setattr(system_service_module.psutil, "sensors_battery", lambda: fake_battery, raising=False)

    status = svc._get_battery_status()

    assert status["secsleft"] == "Unlimited"

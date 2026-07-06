import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from core.event_bus import EventBus, Event
from services.media_service import MediaService
import services.media_service as media_service_module


@pytest.fixture
def service():
    bus = EventBus()
    svc = MediaService("Media", bus)
    svc.on_start()
    return svc, bus


def test_on_start_subscribes_to_media_events(service):
    svc, bus = service
    assert "VOLUME_SET" in bus._subscribers
    assert "VOLUME_MUTE" in bus._subscribers
    assert "MEDIA_PLAY_PAUSE" in bus._subscribers
    assert "MEDIA_NEXT" in bus._subscribers
    assert "MEDIA_PREV" in bus._subscribers


def test_media_key_presses_configured_key(monkeypatch, service):
    svc, _ = service
    pressed = []
    monkeypatch.setattr(media_service_module.pyautogui, "press", lambda key: pressed.append(key))

    svc.media_key("playpause")

    assert pressed == ["playpause"]


def test_media_next_event_presses_nexttrack(monkeypatch, service):
    svc, bus = service
    pressed = []
    monkeypatch.setattr(media_service_module.pyautogui, "press", lambda key: pressed.append(key))

    bus.publish("MEDIA_NEXT")

    assert pressed == ["nexttrack"]


def test_set_volume_noop_when_pycaw_unavailable(monkeypatch, service):
    svc, _ = service
    monkeypatch.setattr(media_service_module, "PYCAW_AVAILABLE", False)

    # Should not raise even though no volume interface exists.
    svc.set_volume(Event("VOLUME_SET", {"value": "80"}))


def test_mute_volume_falls_back_to_keypress_when_pycaw_unavailable(monkeypatch, service):
    svc, _ = service
    monkeypatch.setattr(media_service_module, "PYCAW_AVAILABLE", False)
    pressed = []
    monkeypatch.setattr(media_service_module.pyautogui, "press", lambda key: pressed.append(key))

    svc.mute_volume(Event("VOLUME_MUTE"))

    assert pressed == ["volumemute"]


def test_set_volume_clamps_and_sets_scalar(monkeypatch, service):
    svc, _ = service
    monkeypatch.setattr(media_service_module, "PYCAW_AVAILABLE", True)
    monkeypatch.setattr(media_service_module, "comtypes", type(
        "FakeComtypes", (), {"CoInitialize": staticmethod(lambda: None), "CoUninitialize": staticmethod(lambda: None)}
    )())

    calls = []

    class FakeVolumeInterface:
        def SetMasterVolumeLevelScalar(self, scalar, _):
            calls.append(scalar)

    monkeypatch.setattr(svc, "_get_volume_interface", lambda: FakeVolumeInterface())

    svc.set_volume(Event("VOLUME_SET", {"value": "150"}))

    assert calls == [1.0]


def test_set_volume_without_payload_uses_default_50(monkeypatch, service):
    svc, _ = service
    monkeypatch.setattr(media_service_module, "PYCAW_AVAILABLE", True)
    monkeypatch.setattr(media_service_module, "comtypes", type(
        "FakeComtypes", (), {"CoInitialize": staticmethod(lambda: None), "CoUninitialize": staticmethod(lambda: None)}
    )())

    calls = []

    class FakeVolumeInterface:
        def SetMasterVolumeLevelScalar(self, scalar, _):
            calls.append(scalar)

    monkeypatch.setattr(svc, "_get_volume_interface", lambda: FakeVolumeInterface())

    svc.set_volume(Event("VOLUME_SET"))

    assert calls == [0.5]


def test_set_volume_swallows_interface_errors(monkeypatch, service):
    svc, _ = service
    monkeypatch.setattr(media_service_module, "PYCAW_AVAILABLE", True)
    monkeypatch.setattr(media_service_module, "comtypes", type(
        "FakeComtypes", (), {"CoInitialize": staticmethod(lambda: None), "CoUninitialize": staticmethod(lambda: None)}
    )())

    def boom():
        raise RuntimeError("no audio device")

    monkeypatch.setattr(svc, "_get_volume_interface", boom)

    svc.set_volume(Event("VOLUME_SET", {"value": "50"}))


def test_mute_volume_toggles_current_state(monkeypatch, service):
    svc, _ = service
    monkeypatch.setattr(media_service_module, "PYCAW_AVAILABLE", True)
    monkeypatch.setattr(media_service_module, "comtypes", type(
        "FakeComtypes", (), {"CoInitialize": staticmethod(lambda: None), "CoUninitialize": staticmethod(lambda: None)}
    )())

    calls = []

    class FakeVolumeInterface:
        def GetMute(self):
            return False

        def SetMute(self, value, _):
            calls.append(value)

    monkeypatch.setattr(svc, "_get_volume_interface", lambda: FakeVolumeInterface())

    svc.mute_volume(Event("VOLUME_MUTE"))

    assert calls == [True]


def test_get_volume_returns_zero_when_pycaw_unavailable(monkeypatch, service):
    svc, _ = service
    monkeypatch.setattr(media_service_module, "PYCAW_AVAILABLE", False)

    assert svc.get_volume() == 0


def test_get_volume_returns_scalar_as_percent(monkeypatch, service):
    svc, _ = service
    monkeypatch.setattr(media_service_module, "PYCAW_AVAILABLE", True)
    monkeypatch.setattr(media_service_module, "comtypes", type(
        "FakeComtypes", (), {"CoInitialize": staticmethod(lambda: None), "CoUninitialize": staticmethod(lambda: None)}
    )())

    class FakeVolumeInterface:
        def GetMasterVolumeLevelScalar(self):
            return 0.65

    monkeypatch.setattr(svc, "_get_volume_interface", lambda: FakeVolumeInterface())

    assert svc.get_volume() == 65

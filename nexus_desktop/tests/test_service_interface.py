import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from core.service_interface import Service


class RecordingService(Service):
    def __init__(self, name, bus):
        super().__init__(name, bus)
        self.started = False
        self.stopped = False

    def on_start(self):
        self.started = True

    def on_stop(self):
        self.stopped = True


def test_start_sets_running_true_and_calls_on_start():
    svc = RecordingService("Test", bus=None)
    svc.start()

    assert svc.running is True
    assert svc.started is True


def test_stop_sets_running_false_and_calls_on_stop():
    svc = RecordingService("Test", bus=None)
    svc.start()
    svc.stop()

    assert svc.running is False
    assert svc.stopped is True


def test_cannot_instantiate_service_directly():
    with pytest.raises(TypeError):
        Service("Test", bus=None)


def test_service_without_on_stop_cannot_be_instantiated():
    class MissingOnStop(Service):
        def on_start(self):
            pass

    with pytest.raises(TypeError):
        MissingOnStop("Test", bus=None)

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.event_bus import EventBus


def test_subscriber_receives_published_event():
    bus = EventBus()
    received = []
    bus.subscribe("PING", lambda e: received.append(e))

    bus.publish("PING", {"n": 1})

    assert len(received) == 1
    assert received[0].type == "PING"
    assert received[0].payload == {"n": 1}


def test_publish_with_no_subscribers_does_not_raise():
    bus = EventBus()
    bus.publish("NOBODY_LISTENING", {"x": 1})


def test_multiple_subscribers_all_receive_event():
    bus = EventBus()
    calls = []
    bus.subscribe("EVENT", lambda e: calls.append("first"))
    bus.subscribe("EVENT", lambda e: calls.append("second"))

    bus.publish("EVENT")

    assert calls == ["first", "second"]


def test_subscriber_only_receives_its_own_event_type():
    bus = EventBus()
    received = []
    bus.subscribe("A", lambda e: received.append(e.type))
    bus.subscribe("B", lambda e: received.append(e.type))

    bus.publish("A")

    assert received == ["A"]


def test_exception_in_one_subscriber_does_not_block_others():
    bus = EventBus()
    calls = []

    def failing(event):
        raise RuntimeError("boom")

    def working(event):
        calls.append("worked")

    bus.subscribe("EVENT", failing)
    bus.subscribe("EVENT", working)

    bus.publish("EVENT")

    assert calls == ["worked"]


def test_publish_defaults_payload_to_none():
    bus = EventBus()
    received = []
    bus.subscribe("EVENT", lambda e: received.append(e.payload))

    bus.publish("EVENT")

    assert received == [None]


def test_subscribing_during_publish_does_not_affect_current_dispatch():
    bus = EventBus()
    calls = []

    def late_subscriber(event):
        calls.append("late")

    def subscribes_another(event):
        calls.append("first")
        bus.subscribe("EVENT", late_subscriber)

    bus.subscribe("EVENT", subscribes_another)

    bus.publish("EVENT")
    assert calls == ["first"]

    bus.publish("EVENT")
    assert calls == ["first", "first", "late"]

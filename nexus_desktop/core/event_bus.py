import threading
import queue
import logging

class Event:
    def __init__(self, type, payload=None):
        self.type = type
        self.payload = payload

class EventBus:
    def __init__(self):
        self._subscribers = {}
        self._lock = threading.Lock()
        # Thread-safe queue for events if we need async processing later
        # For now, we'll use synchronous dispatch for simplicity in debugging
        self.logger = logging.getLogger("EventBus")

    def subscribe(self, event_type, callback):
        """Register a callback for a specific event type."""
        with self._lock:
            if event_type not in self._subscribers:
                self._subscribers[event_type] = []
            self._subscribers[event_type].append(callback)
        self.logger.debug(f"Subscribed to {event_type}")

    def publish(self, event_type, payload=None):
        """Broadcast an event to all subscribers."""
        event = Event(event_type, payload)
        self.logger.info(f"Event Published: {event_type} -> {payload}")
        
        with self._lock:
            if event_type in self._subscribers:
                for callback in self._subscribers[event_type]:
                    try:
                        # In a more advanced version, we could run these in threads
                        callback(event)
                    except Exception as e:
                        self.logger.error(f"Error in subscriber for {event_type}: {e}")

from abc import ABC, abstractmethod
import threading

class Service(ABC):
    def __init__(self, name, event_bus):
        self.name = name
        self.bus = event_bus
        self.running = False
        self._thread = None

    def start(self):
        """Starts the service, optionally in a separate thread."""
        self.running = True
        self.on_start()
        print(f"[{self.name}] Started.")

    def stop(self):
        """Stops the service."""
        self.running = False
        self.on_stop()
        print(f"[{self.name}] Stopped.")

    @abstractmethod
    def on_start(self):
        """Override to implement startup logic."""
        pass

    @abstractmethod
    def on_stop(self):
        """Override to implement cleanup logic."""
        pass

import logging
from concurrent.futures import ThreadPoolExecutor

from actions import get_action
from actions.base import ActionContext
from core.service_interface import Service


class AutomationService(Service):
    def on_start(self):
        self.bus.subscribe("COMMAND_RECEIVED", self.handle_command)
        # Use a thread pool to avoid blocking the EventBus
        self.executor = ThreadPoolExecutor(max_workers=3)
        self.context = ActionContext(bus=self.bus)
        print("[AutomationService] Async Executor Started")

    def on_stop(self):
        self.executor.shutdown(wait=False)

    def handle_command(self, event):
        # Offload execution to thread pool
        self.executor.submit(self._execute_action, event.payload)

    def _execute_action(self, data):
        action_type = data.get('type')
        value = data.get('value')
        try:
            action_cls = get_action(action_type)
            if action_cls is None:
                raise ValueError(f"Unknown action type: {action_type!r}")
            action_cls().execute(value, self.context)
            self.bus.publish("ACTION_COMPLETED", {"status": "success", "id": data.get('id')})
        except Exception as e:
            logging.warning(f"[AutomationService] Error executing {action_type}: {e}")
            self.bus.publish("ACTION_FAILED", {"error": str(e), "id": data.get('id')})

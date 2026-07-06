import os
import sys
import threading
import time
import logging
import uuid
import json
from core.service_interface import Service
from core.schedule_store import ScheduleStore


def _default_store_path():
    base_dir = os.path.dirname(os.path.abspath(sys.argv[0]))
    return os.path.join(base_dir, "data", "schedules.json")


class SchedulerService(Service):
    def on_start(self):
        self.active_timers = {}
        self.lock = threading.Lock()
        self.store = ScheduleStore(_default_store_path())

        self.bus.subscribe("SCHEDULE_ACTION", self.handle_schedule)
        self.bus.subscribe("CANCEL_SCHEDULE", self.handle_cancel)

        logging.info("SchedulerService started")

    def on_stop(self):
        with self.lock:
            for job_id, timer in self.active_timers.items():
                timer.cancel()
            self.active_timers.clear()

    def handle_schedule(self, event):
        data = event.payload
        seconds = data.get('seconds', 0)
        action = data.get('action')

        if not action or seconds <= 0:
            logging.error("Invalid schedule request")
            return

        try:
            json.dumps(action)
        except (TypeError, ValueError) as e:
            logging.error(f"Schedule action is not JSON-serializable, rejecting: {e}")
            return

        job_id = str(uuid.uuid4())
        due_at = time.time() + seconds

        logging.info(f"Scheduling action in {seconds}s: {action}")

        timer = threading.Timer(seconds, self._execute_job, [job_id, action])

        with self.lock:
            self.active_timers[job_id] = timer
            self.store.save_job(job_id, due_at, action)

        timer.start()

        # Notify that scheduling was successful
        self.bus.publish("SCHEDULE_CREATED", {"job_id": job_id, "seconds": seconds})

    def handle_cancel(self, event):
        job_id = event.payload.get('job_id')
        with self.lock:
            if job_id in self.active_timers:
                self.active_timers[job_id].cancel()
                del self.active_timers[job_id]
                self.store.remove_job(job_id)
                logging.info(f"Cancelled job {job_id}")
                self.bus.publish("SCHEDULE_CANCELLED", {"job_id": job_id})

    def _execute_job(self, job_id, action):
        # Remove from active list and persisted store
        with self.lock:
            if job_id in self.active_timers:
                del self.active_timers[job_id]
            self.store.remove_job(job_id)

        logging.info(f"Executing scheduled job {job_id}")

        # Inject the action back into the event bus as if it came now
        # We wrap it in COMMAND_RECEIVED so AutomationService picks it up
        self.bus.publish("COMMAND_RECEIVED", action)

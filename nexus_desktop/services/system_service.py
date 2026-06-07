import psutil
import platform
import logging
from core.service_interface import Service

class SystemService(Service):
    def on_start(self):
        self.bus.subscribe("GET_SYSTEM_STATS", self.handle_get_stats)
        try:
            self.platform_info = platform.platform()
        except:
            self.platform_info = "Unknown"
        logging.info("SystemService started")

    def on_stop(self):
        pass

    def handle_get_stats(self, event):
        try:
            stats = {
                "cpu": psutil.cpu_percent(interval=None),
                "ram": psutil.virtual_memory().percent,
                "platform": self.platform_info,
                "battery": self._get_battery_status()
            }
            
            self.bus.publish("SYSTEM_STATS_UPDATED", stats)
            
        except Exception as e:
            logging.error(f"Error fetching stats: {e}")

    def _get_battery_status(self):
        if not hasattr(psutil, "sensors_battery"):
            return "N/A"
            
        battery = psutil.sensors_battery()
        if battery:
            return {
                "percent": battery.percent,
                "power_plugged": battery.power_plugged,
                "secsleft": battery.secsleft if battery.secsleft != psutil.POWER_TIME_UNLIMITED else "Unlimited"
            }
        return "No Battery"

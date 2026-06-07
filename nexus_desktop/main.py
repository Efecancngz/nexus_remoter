import time
import sys
from core.event_bus import EventBus
from services.api_service import ApiService
from services.automation_service import AutomationService
from services.tray_service import TrayService
from services.discovery_service import DiscoveryService
from services.gui_service import GuiService
from services.scheduler_service import SchedulerService
from services.system_service import SystemService
from services.media_service import MediaService

import logging
import os

# Configure logging
if getattr(sys, 'frozen', False):
    base_path = sys._MEIPASS
else:
    base_path = os.path.dirname(os.path.abspath(__file__))

sys.path.append(base_path)

log_dir = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "nexus_debug.log")
logging.basicConfig(
    filename=log_file,
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logging.info("Nexus Agent Starting...")

def main():
    print(">>> Starting Nexus Desktop Agent <<<")
    logging.info("Core initialized")
    
    # 1. Initialize Core
    bus = EventBus()
    from core.security_manager import SecurityManager
    sec_manager = SecurityManager()
    
    # 2. Initialize Services
    media_service = MediaService("Media", bus)
    services = [
        AutomationService("Automation", bus),
        TrayService("Tray", bus),
        DiscoveryService("Discovery", bus),
        GuiService("GUI", bus, sec_manager),
        SchedulerService("Scheduler", bus),
        SystemService("System", bus),
        media_service, # Media
        ApiService("API", bus, sec_manager, media_service) # API depends on Media
    ]
    
    # 3. Start Services
    for service in services:
        service.start()
        
    print(">>> Nexus Agent is Online. Press Ctrl+C to exit. <<<")
    
    try:
        # Keep main thread alive
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping services...")
        for service in services:
            service.stop()
        print("Goodbye!")

if __name__ == "__main__":
    main()

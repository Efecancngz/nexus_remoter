import pystray
from PIL import Image, ImageDraw
from core.service_interface import Service
import threading
import sys

class TrayService(Service):
    def on_start(self):
        self._thread = threading.Thread(target=self._run_tray, daemon=False) # Daemon=False to keep app alive
        self._thread.start()
        
        # Subscribe to events to show notifications
        self.bus.subscribe("COMMAND_RECEIVED", self.on_command)

    def on_stop(self):
        if hasattr(self, 'icon'):
            self.icon.stop()

    def create_image(self):
        # Generate a simple icon programmatically (Cyan Circle)
        width = 64
        height = 64
        image = Image.new('RGB', (width, height), (30, 30, 30))
        dc = ImageDraw.Draw(image)
        dc.ellipse((8, 8, 56, 56), fill=(0, 255, 255)) # Cyan
        dc.rectangle((24, 24, 40, 40), fill=(30, 30, 30)) # Hollow center
        return image

    def on_command(self, event):
        # Run notification in separate thread to prevent blocking
        threading.Thread(target=self._show_notif, args=(event.payload.get('type'),), daemon=True).start()

    def _show_notif(self, text):
        if hasattr(self, 'icon'):
            try:
                self.icon.notify(f"Executing: {text}", "Nexus Agent")
            except Exception as e:
                print(f"Tray notification error: {e}")

    def stop_app(self, icon, item):
        print("Tray exit requested.")
        icon.stop()
        # We should also trigger the main event bus to stop other services
        # But for now, since this thread is non-daemon, stopping it will help exit
        # A proper shutdown event would be better
        sys.exit(0)

    def _run_tray(self):
        image = self.create_image()
        menu = pystray.Menu(
            pystray.MenuItem("Show Info", self.show_info, default=True),
            pystray.MenuItem("Nexus Agent", lambda i, item: None, enabled=False),
            pystray.MenuItem("Quit", self.stop_app)
        )
        
        self.icon = pystray.Icon("NexusAgent", image, "Nexus Remote Agent", menu)
        
        # Show info window on startup after a slight delay
        threading.Timer(1.0, self.show_info).start()
        
        self.icon.run()

    def show_info(self, icon=None, item=None):
        # Decoupled: Just ask the event bus to show the GUI
        print("Tray: Requesting GUI Show")
        self.bus.publish("SHOW_GUI")

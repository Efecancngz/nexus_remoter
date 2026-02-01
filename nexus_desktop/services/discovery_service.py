import socket
import time
import threading
from core.service_interface import Service

class DiscoveryService(Service):
    def on_start(self):
        self._thread = threading.Thread(target=self._broadcast_loop, daemon=True)
        self._thread.start()

    def on_stop(self):
        pass

    def _broadcast_loop(self):
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        
        message = b"DISCOVER_NEXUS_AGENT_V2"
        port = 5000
        
        while self.running:
            try:
                # Broadcast to local network
                udp.sendto(message, ('<broadcast>', port))
                time.sleep(2)
            except Exception as e:
                print(f"[Discovery] Error: {e}")
                time.sleep(5)

import os
import subprocess
import time
import pyautogui
import webbrowser
from core.service_interface import Service
from utils.win_search import find_installed_app

# Optional dependencies
try:
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    from comtypes import CLSCTX_ALL
    from ctypes import cast, POINTER
except ImportError:
    print("Warning: Audio dependencies missing.")

import threading
from concurrent.futures import ThreadPoolExecutor

class AutomationService(Service):
    def on_start(self):
        # Subscribe to command events
        self.bus.subscribe("COMMAND_RECEIVED", self.handle_command)
        # Use a thread pool to avoid blocking the EventBus
        self.executor = ThreadPoolExecutor(max_workers=3)
        print("[AutomationService] Async Executor Started")

    def on_stop(self):
        self.executor.shutdown(wait=False)

    def handle_command(self, event):
        # Offload execution to thread pool
        self.executor.submit(self._execute_action, event.payload)

    def _execute_action(self, data):
        action_type = data.get('type')
        value = data.get('value')
        
        # print(f"[AutomationService] Processing: {action_type} -> {value}") # Too verbose

        try:
            if action_type == 'OPEN_URL':
                webbrowser.open(value)

            elif action_type == 'COMMAND':
                subprocess.Popen(value, shell=True)

            elif action_type == 'LAUNCH_APP':
                self.launch_app(value)

            elif action_type == 'KEYPRESS':
                self.press_key(value)
            
            elif action_type == 'WAIT':
                time.sleep(float(value))

            # Publish success event
            self.bus.publish("ACTION_COMPLETED", {"status": "success", "id": data.get('id')}) 

            
        except Exception as e:
            print(f"Error executing command: {e}")
            self.bus.publish("ACTION_FAILED", {"error": str(e), "id": data.get('id')})

    def launch_app(self, value):
        lower_val = value.lower().strip()
        
        # Known protocols
        app_map = {
            'whatsapp': 'start whatsapp:',
            'spotify': 'start spotify:',
            'netflix': 'start netflix:',
            'instagram': 'start instagram:',
            'calculator': 'calc',
            'notepad': 'notepad',
            'paint': 'mspaint',
            'explorer': 'explorer',
            'chrome': 'start chrome',
            'edge': 'start microsoft-edge:'
        }

        if lower_val in app_map:
            subprocess.Popen(app_map[lower_val], shell=True)
            return

        # Smart Search (Heavy Operation)
        try:
            app_path = find_installed_app(lower_val)
            if app_path:
                os.startfile(app_path)
            else:
                # Fallback
                subprocess.Popen(value, shell=True)
        except Exception as e:
            print(f"App launch error: {e}")

    def press_key(self, value):
        special_keys = [
            'enter', 'tab', 'esc', 'space', 'backspace', 'delete', 
            'up', 'down', 'left', 'right', 'win', 'ctrl', 'alt', 'shift', 'capslock'
        ]
        
        val_lower = value.lower()
        if val_lower in special_keys:
            pyautogui.press(val_lower)
        else:
            pyautogui.write(value, interval=0.05)

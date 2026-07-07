import os
import re
import shlex
import subprocess
import time
import psutil
import pyautogui
import webbrowser
import logging
from core.service_interface import Service
from utils.win_search import find_installed_app
from utils.win_windows import find_pids_by_window_title

# Optional dependencies
try:
    from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume
    from comtypes import CLSCTX_ALL
    from ctypes import cast, POINTER
except ImportError:
    print("Warning: Audio dependencies missing.")

import threading
from concurrent.futures import ThreadPoolExecutor

# Named actions the agent will launch, mapped to a target passed to
# os.startfile (never through a shell, so no injection is possible via value).
# Both LAUNCH_APP and COMMAND resolve against this same allowlist.
_APP_TARGETS = {
    'whatsapp': 'whatsapp:',
    'spotify': 'spotify:',
    'netflix': 'netflix:',
    'instagram': 'instagram:',
    'calculator': 'calc',
    'calc': 'calc',
    'notepad': 'notepad',
    'paint': 'mspaint',
    'mspaint': 'mspaint',
    'explorer': 'explorer',
    'chrome': 'chrome',
    'edge': 'microsoft-edge:',
    'taskmgr': 'taskmgr',
    'task manager': 'taskmgr',
    'control panel': 'control',
    'control': 'control',
}

# Processes CLOSE_APP must never touch, no matter what name the AI produces.
_PROTECTED_PROCESSES = {
    'system', 'registry', 'idle', 'csrss', 'winlogon', 'wininit', 'services',
    'lsass', 'smss', 'svchost', 'dwm', 'explorer', 'fontdrvhost', 'conhost',
    'python', 'pythonw',  # the agent itself
}


def _normalize_name(name):
    """Lowercase and strip everything but letters/digits for fuzzy matching."""
    return re.sub(r'[^a-z0-9]', '', name.lower())


def _proc_base(name):
    """Normalized process name without its .exe extension."""
    name = name or ''
    if name.lower().endswith('.exe'):
        name = name[:-4]
    return _normalize_name(name)


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

        try:
            if action_type == 'OPEN_URL':
                webbrowser.open(value)

            elif action_type == 'COMMAND':
                self.run_allowlisted(value)

            elif action_type == 'LAUNCH_APP':
                self.launch_app(value)

            elif action_type == 'CLOSE_APP':
                self.close_app(value)

            elif action_type == 'KEYPRESS':
                self.press_key(value)

            elif action_type == 'WAIT':
                time.sleep(float(value))

            elif action_type == 'SYSTEM_POWER':
                self.handle_system_power(value)

            # Publish success event
            self.bus.publish("ACTION_COMPLETED", {"status": "success", "id": data.get('id')})

        except Exception as e:
            logging.warning(f"[AutomationService] Error executing {action_type}: {e}")
            self.bus.publish("ACTION_FAILED", {"error": str(e), "id": data.get('id')})

    def run_allowlisted(self, value):
        """Run a COMMAND action. Only names known to _APP_TARGETS are allowed;
        arbitrary shell strings are rejected instead of being executed."""
        if not value:
            raise ValueError("Empty command")

        # Only the bare action name is honored — any extra shell-style
        # arguments in `value` are rejected rather than passed through.
        first_token = shlex.split(value.lower().strip())[0] if value.strip() else ''
        target = _APP_TARGETS.get(first_token)
        if not target:
            raise ValueError(f"Command not in allowlist: {value!r}")

        os.startfile(target)

    def launch_app(self, value):
        lower_val = value.lower().strip()

        target = _APP_TARGETS.get(lower_val)
        if target:
            os.startfile(target)
            return

        # Smart Search: look up an installed app by name and launch its
        # resolved executable path directly (no shell involved).
        try:
            app_path = find_installed_app(lower_val)
            if app_path:
                os.startfile(app_path)
            else:
                raise ValueError(f"App not found and not in allowlist: {value!r}")
        except Exception as e:
            logging.warning(f"[AutomationService] App launch error: {e}")
            raise

    def close_app(self, value):
        """Close an app by name: match process names first (e.g. 'cs2' ->
        cs2.exe), then visible window titles (e.g. 'counter strike 2' ->
        'Counter-Strike 2'). Protected system processes are never killed."""
        search = _normalize_name(value or '')
        if not search:
            raise ValueError("Empty app name")

        own_pid = os.getpid()
        targets = {}

        for proc in psutil.process_iter(['pid', 'name']):
            try:
                base = _proc_base(proc.info['name'])
                if not base or base in _PROTECTED_PROCESSES or proc.info['pid'] == own_pid:
                    continue
                if search == base or (len(search) >= 4 and search in base):
                    targets[proc.info['pid']] = proc
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        if not targets:
            for pid in find_pids_by_window_title(search):
                if pid == own_pid:
                    continue
                try:
                    proc = psutil.Process(pid)
                    if _proc_base(proc.name()) not in _PROTECTED_PROCESSES:
                        targets[pid] = proc
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue

        if not targets:
            raise ValueError(f"No running app matches: {value!r}")

        procs = list(targets.values())
        for proc in procs:
            try:
                proc.terminate()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        gone, alive = psutil.wait_procs(procs, timeout=5)
        for proc in alive:
            try:
                proc.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        logging.info(f"[AutomationService] Closed {len(procs)} process(es) for {value!r}")

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

    def handle_system_power(self, value):
        val_lower = value.lower().strip()
        logging.info(f"[AutomationService] Executing system power action: {val_lower}")
        if val_lower == 'lock':
            import ctypes
            ctypes.windll.user32.LockWorkStation()
        elif val_lower == 'shutdown':
            subprocess.run(["shutdown", "/s", "/t", "0"], shell=False)
        elif val_lower == 'restart':
            subprocess.run(["shutdown", "/r", "/t", "0"], shell=False)
        elif val_lower == 'sleep':
            subprocess.run(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"], shell=False)
        else:
            raise ValueError(f"Unknown power action: {value!r}")

import logging
import os

import psutil

from utils.win_windows import find_pids_by_window_title

from ._targets import PROTECTED_PROCESSES, normalize_name, proc_base
from .base import Action
from .registry import register_action


@register_action("CLOSE_APP")
class CloseAppAction(Action):
    """Close an app by name: match process names first (e.g. 'cs2' ->
    cs2.exe), then visible window titles (e.g. 'counter strike 2' ->
    'Counter-Strike 2'). Protected system processes are never killed."""
    prompt_examples = [
        '- "Spotify\'ı kapat": {{ "type": "CLOSE_APP", "value": "spotify", "description": "Spotify kapatılıyor" }}',
        '- "cs2\'yi kapat": {{ "type": "CLOSE_APP", "value": "counter strike 2", "description": "Counter-Strike 2 kapatılıyor" }}',
    ]
    prompt_hint = (
        'Bir uygulamayı/oyunu kapatmak için HER ZAMAN CLOSE_APP kullan. '
        'Kısaltmaları uygulamanın tam adına genişlet (örn: "cs2" -> '
        '"counter strike 2", "lol" -> "league of legends", "ws" -> "whatsapp").'
    )

    def execute(self, value, context):
        search = normalize_name(value or '')
        if not search:
            raise ValueError("Empty app name")

        own_pid = os.getpid()
        targets = {}

        for proc in psutil.process_iter(['pid', 'name']):
            try:
                base = proc_base(proc.info['name'])
                if not base or base in PROTECTED_PROCESSES or proc.info['pid'] == own_pid:
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
                    if proc_base(proc.name()) not in PROTECTED_PROCESSES:
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
        logging.info(f"[CloseApp] Closed {len(procs)} process(es) for {value!r}")

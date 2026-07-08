import logging
import subprocess

from .base import Action
from .registry import register_action


@register_action("SYSTEM_POWER")
class SystemPowerAction(Action):
    prompt_examples = [
        '- "Bilgisayarı kilitle": {{ "type": "SYSTEM_POWER", "value": "lock", "description": "Bilgisayar kilitleniyor" }}',
        '- "Bilgisayarı kapat": {{ "type": "SYSTEM_POWER", "value": "shutdown", "description": "Bilgisayar kapatılıyor" }}',
    ]
    prompt_hint = (
        "Önemli kısıtlama: Kapatma/yeniden başlatma/uyku/kilitleme için HER "
        "ZAMAN SYSTEM_POWER kullan (value: lock|shutdown|restart|sleep)."
    )

    def execute(self, value, context):
        val_lower = value.lower().strip()
        logging.info(f"[SystemPower] Executing system power action: {val_lower}")
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

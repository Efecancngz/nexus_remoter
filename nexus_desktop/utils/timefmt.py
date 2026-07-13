"""Turkish relative-time formatting for the desktop GUI."""
import time


def format_relative(ts, now=None):
    now = time.time() if now is None else now
    delta = max(0, int(now - ts))
    if delta < 60:
        return "az önce"
    if delta < 3600:
        return f"{delta // 60} dk önce"
    if delta < 86400:
        return f"{delta // 3600} saat önce"
    return f"{delta // 86400} gün önce"

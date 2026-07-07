"""Win32 helpers for enumerating visible top-level windows."""
import ctypes
import ctypes.wintypes
import re


def _normalize(text):
    return re.sub(r'[^a-z0-9]', '', text.lower())


def find_pids_by_window_title(search_term):
    """
    Returns the set of PIDs owning a visible top-level window whose title
    matches `search_term` (normalized substring match). `search_term` must
    already be normalized (lowercase alphanumerics only).
    """
    user32 = ctypes.windll.user32
    pids = set()

    @ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    def _on_window(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        if search_term in _normalize(buffer.value):
            pid = ctypes.wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value:
                pids.add(pid.value)
        return True

    user32.EnumWindows(_on_window, 0)
    return pids

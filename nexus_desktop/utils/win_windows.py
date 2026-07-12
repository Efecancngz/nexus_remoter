# nexus_desktop/utils/win_windows.py
"""Win32 helpers for enumerating and focusing visible top-level windows."""
import ctypes
import ctypes.wintypes

from utils.name_match import normalize

ctypes.windll.user32.GetForegroundWindow.restype = ctypes.wintypes.HWND

_SW_RESTORE = 9
_SW_MAXIMIZE = 3
_SW_MINIMIZE = 6


def list_windows():
    """Returns [(hwnd, title, pid)] for every visible, titled top-level window."""
    user32 = ctypes.windll.user32
    windows = []

    @ctypes.WINFUNCTYPE(ctypes.wintypes.BOOL, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    def _on_window(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length == 0:
            return True
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        pid = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        windows.append((hwnd, buffer.value, pid.value))
        return True

    user32.EnumWindows(_on_window, 0)
    return windows


def find_pids_by_window_title(search_term):
    """
    Returns the set of PIDs owning a visible top-level window whose title
    matches `search_term` (normalized substring match). `search_term` must
    already be normalized (lowercase alphanumerics only).
    """
    return {
        pid for _hwnd, title, pid in list_windows()
        if search_term in normalize(title) and pid
    }


def focus_window_handle(hwnd):
    """Restore (if minimized) and bring a window to the foreground."""
    user32 = ctypes.windll.user32
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, _SW_RESTORE)
    user32.SetForegroundWindow(hwnd)


def minimize(hwnd):
    """Minimize a window."""
    ctypes.windll.user32.ShowWindow(hwnd, _SW_MINIMIZE)


def maximize(hwnd):
    """Maximize a window."""
    ctypes.windll.user32.ShowWindow(hwnd, _SW_MAXIMIZE)


def restore(hwnd):
    """Restore a window to its non-minimized/maximized size."""
    ctypes.windll.user32.ShowWindow(hwnd, _SW_RESTORE)


def get_foreground():
    """Return the handle of the current foreground window, or None."""
    hwnd = ctypes.windll.user32.GetForegroundWindow()
    return hwnd or None

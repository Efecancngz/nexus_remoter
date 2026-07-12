"""Windows clipboard get/set via ctypes (no third-party dependency)."""
import ctypes
from ctypes import wintypes

_CF_UNICODETEXT = 13
_GMEM_MOVEABLE = 0x0002

_user32 = ctypes.windll.user32
_kernel32 = ctypes.windll.kernel32

# Declare pointer-returning functions as pointer-sized so 64-bit handles are
# not truncated to 32 bits (a classic ctypes default-restype bug).
_user32.OpenClipboard.argtypes = [wintypes.HWND]
_user32.OpenClipboard.restype = wintypes.BOOL
_user32.GetClipboardData.argtypes = [wintypes.UINT]
_user32.GetClipboardData.restype = wintypes.HANDLE
_user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
_user32.SetClipboardData.restype = wintypes.HANDLE
_kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
_kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
_kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
_kernel32.GlobalLock.restype = wintypes.LPVOID
_kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]


def get_text():
    """Return clipboard text, or '' if empty/non-text."""
    if not _user32.OpenClipboard(None):
        return ""
    try:
        handle = _user32.GetClipboardData(_CF_UNICODETEXT)
        if not handle:
            return ""
        locked = _kernel32.GlobalLock(handle)
        if not locked:
            return ""
        try:
            return ctypes.c_wchar_p(locked).value or ""
        finally:
            _kernel32.GlobalUnlock(handle)
    finally:
        _user32.CloseClipboard()


def set_text(text):
    """Replace clipboard contents with `text`."""
    text = text or ""
    if not _user32.OpenClipboard(None):
        raise OSError("Could not open clipboard")
    try:
        _user32.EmptyClipboard()
        buffer_size = (len(text) + 1) * ctypes.sizeof(ctypes.c_wchar)
        handle = _kernel32.GlobalAlloc(_GMEM_MOVEABLE, buffer_size)
        locked = _kernel32.GlobalLock(handle)
        ctypes.memmove(locked, ctypes.create_unicode_buffer(text), buffer_size)
        _kernel32.GlobalUnlock(handle)
        _user32.SetClipboardData(_CF_UNICODETEXT, handle)
    finally:
        _user32.CloseClipboard()

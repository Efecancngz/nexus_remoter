import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils import win_clipboard


def test_clipboard_round_trip():
    win_clipboard.set_text("nexus-test-123")
    assert win_clipboard.get_text() == "nexus-test-123"

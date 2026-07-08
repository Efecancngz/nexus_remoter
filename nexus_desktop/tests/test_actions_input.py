import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions.base import ActionContext

CTX = ActionContext(bus=None)


class TestHotkey:
    def _action(self):
        from actions.hotkey import HotkeyAction
        return HotkeyAction()

    def test_valid_combo_calls_pyautogui(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: calls.append(keys))
        self._action().execute("Ctrl + Shift + S", CTX)
        assert calls == [("ctrl", "shift", "s")]

    def test_single_key_allowed(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: calls.append(keys))
        self._action().execute("f5", CTX)
        assert calls == [("f5",)]

    def test_unknown_key_rejected(self, monkeypatch):
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: pytest.fail("must not run"))
        with pytest.raises(ValueError):
            self._action().execute("ctrl+launchmissiles", CTX)

    def test_empty_value_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("  ", CTX)

    def test_empty_segment_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("ctrl++s", CTX)


class TestFocusWindow:
    def _action(self):
        from actions.focus_window import FocusWindowAction
        return FocusWindowAction()

    def test_focuses_best_matching_window(self, monkeypatch):
        focused = []
        monkeypatch.setattr(
            "actions.focus_window.list_windows",
            lambda: [(111, "Counter-Strike 2", 100), (222, "Notepad", 200)],
        )
        monkeypatch.setattr(
            "actions.focus_window.focus_window_handle", lambda hwnd: focused.append(hwnd)
        )
        self._action().execute("counter strike 2", CTX)
        assert focused == [111]

    def test_typo_matches_fuzzily(self, monkeypatch):
        focused = []
        monkeypatch.setattr(
            "actions.focus_window.list_windows", lambda: [(111, "Spotify Premium", 100)]
        )
        monkeypatch.setattr(
            "actions.focus_window.focus_window_handle", lambda hwnd: focused.append(hwnd)
        )
        self._action().execute("spotfy", CTX)
        assert focused == [111]

    def test_no_match_raises(self, monkeypatch):
        monkeypatch.setattr("actions.focus_window.list_windows", lambda: [(111, "Notepad", 100)])
        monkeypatch.setattr(
            "actions.focus_window.focus_window_handle",
            lambda hwnd: pytest.fail("must not focus"),
        )
        with pytest.raises(ValueError):
            self._action().execute("photoshop", CTX)

    def test_empty_value_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("", CTX)

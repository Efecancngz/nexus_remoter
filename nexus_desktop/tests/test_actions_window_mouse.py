import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions.base import ActionContext

CTX = ActionContext(bus=None)


class TestWindowManage:
    def _action(self):
        from actions.window_manage import WindowManageAction
        return WindowManageAction()

    def test_minimizes_matched_window(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.window_manage.list_windows", lambda: [(111, "Spotify Premium", 100)])
        monkeypatch.setattr("actions.window_manage.minimize", lambda hwnd: calls.append(("min", hwnd)))
        self._action().execute("minimize spotify", CTX)
        assert calls == [("min", 111)]

    def test_maximizes_foreground_when_no_target(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.window_manage.get_foreground", lambda: 222)
        monkeypatch.setattr("actions.window_manage.maximize", lambda hwnd: calls.append(("max", hwnd)))
        self._action().execute("maximize", CTX)
        assert calls == [("max", 222)]

    def test_unknown_op_raises(self):
        with pytest.raises(ValueError):
            self._action().execute("wobble spotify", CTX)

    def test_no_matching_window_raises(self, monkeypatch):
        monkeypatch.setattr("actions.window_manage.list_windows", lambda: [(111, "Notepad", 100)])
        with pytest.raises(ValueError):
            self._action().execute("minimize photoshop", CTX)


class TestMouseMove:
    def test_percent_moves(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.mouse_move.pyautogui.size", lambda: (1920, 1080))
        monkeypatch.setattr("actions.mouse_move.pyautogui.moveTo", lambda x, y: calls.append((x, y)))
        from actions.mouse_move import MouseMoveAction
        MouseMoveAction().execute("50%,50%", CTX)
        assert calls == [(960, 540)]

    def test_bad_format_raises(self, monkeypatch):
        monkeypatch.setattr("actions.mouse_move.pyautogui.size", lambda: (1920, 1080))
        from actions.mouse_move import MouseMoveAction
        with pytest.raises(ValueError):
            MouseMoveAction().execute("100", CTX)


class TestMouseScroll:
    def test_scrolls_int(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.mouse_move.pyautogui.scroll", lambda a: calls.append(a))
        from actions.mouse_move import MouseScrollAction
        MouseScrollAction().execute("-500", CTX)
        assert calls == [-500]

    def test_bad_amount_raises(self):
        from actions.mouse_move import MouseScrollAction
        with pytest.raises(ValueError):
            MouseScrollAction().execute("abc", CTX)


class TestTypeText:
    def test_pastes_text_via_clipboard(self, monkeypatch):
        clip = []
        hotkeys = []
        monkeypatch.setattr("actions.type_text.set_text", lambda t: clip.append(t))
        monkeypatch.setattr("actions.type_text.pyautogui.hotkey", lambda *keys: hotkeys.append(keys))
        from actions.type_text import TypeTextAction
        TypeTextAction().execute("Merhaba dünya", CTX)
        assert clip == ["Merhaba dünya"]
        assert hotkeys == [("ctrl", "v")]

    def test_empty_raises(self):
        from actions.type_text import TypeTextAction
        with pytest.raises(ValueError):
            TypeTextAction().execute("  ", CTX)

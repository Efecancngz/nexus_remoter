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

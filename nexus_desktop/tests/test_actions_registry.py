import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest


class TestRegistry:
    def test_register_and_get(self):
        from actions.registry import register_action, get_action, _REGISTRY

        @register_action("TEST_DUMMY")
        class Dummy:
            pass
        try:
            assert get_action("TEST_DUMMY") is Dummy
            assert Dummy.action_type == "TEST_DUMMY"
        finally:
            _REGISTRY.pop("TEST_DUMMY", None)

    def test_duplicate_registration_raises(self):
        from actions.registry import register_action, _REGISTRY

        @register_action("TEST_DUP")
        class First:
            pass
        try:
            with pytest.raises(ValueError):
                @register_action("TEST_DUP")
                class Second:
                    pass
        finally:
            _REGISTRY.pop("TEST_DUP", None)

    def test_unknown_type_returns_none(self):
        from actions.registry import get_action
        assert get_action("NO_SUCH_TYPE") is None

    def test_all_actions_returns_copy(self):
        from actions.registry import all_actions
        snapshot = all_actions()
        snapshot["INJECTED"] = object
        assert "INJECTED" not in all_actions()


class TestBase:
    def test_action_defaults(self):
        from actions.base import Action, ActionContext
        act = Action()
        assert act.prompt_examples == []
        assert act.prompt_hint == ""
        with pytest.raises(NotImplementedError):
            act.execute("x", ActionContext(bus=None))

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from actions import all_actions
from services import ai_service


def test_action_types_come_from_registry():
    assert ai_service._ACTION_TYPES == sorted(all_actions().keys())


def test_prompt_contains_every_example_and_hint():
    for cls in all_actions().values():
        for example in cls.prompt_examples:
            # examples are written with doubled braces for f-string templates
            assert example.replace("{{", "{").replace("}}", "}") in ai_service._MACRO_INSTRUCTION
        if cls.prompt_hint:
            assert cls.prompt_hint in ai_service._MACRO_INSTRUCTION


def test_schema_enum_matches_registry():
    enum = ai_service._STEP_SCHEMA["items"]["properties"]["type"]["enum"]
    assert enum == ai_service._ACTION_TYPES

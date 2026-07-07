"""Auto-discovering action package.

Importing this package imports every non-underscore sibling module, which
lets each module register itself. Adding a new action == adding a file.
"""
import importlib
import pkgutil

from .registry import register_action, get_action, all_actions  # noqa: F401
from .base import Action, ActionContext  # noqa: F401

_SKIP = {"registry", "base"}

for _mod in pkgutil.iter_modules(__path__):
    if _mod.name in _SKIP or _mod.name.startswith("_"):
        continue
    importlib.import_module(f"{__name__}.{_mod.name}")

"""Action registry. Action modules register themselves with
@register_action("TYPE"); the dispatcher and the AI prompt read from here."""

_REGISTRY = {}


def register_action(action_type):
    """Class decorator: register an Action subclass for an action type."""
    def decorator(cls):
        if action_type in _REGISTRY:
            raise ValueError(f"Action type already registered: {action_type!r}")
        cls.action_type = action_type
        _REGISTRY[action_type] = cls
        return cls
    return decorator


def get_action(action_type):
    """Returns the Action class for a type, or None."""
    return _REGISTRY.get(action_type)


def all_actions():
    """Returns a snapshot dict of {action_type: Action class}."""
    return dict(_REGISTRY)

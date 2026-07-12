"""Shared coordinate parsing for mouse actions. Underscore-prefixed: not an
action module, skipped by discovery."""


def parse_coord(part, span):
    """Parse a '50%'-style percentage or a pixel int into a clamped pixel."""
    part = part.strip()
    try:
        if part.endswith('%'):
            pixel = int(span * float(part[:-1]) / 100)
        else:
            pixel = int(part)
    except ValueError:
        raise ValueError(f"Invalid coordinate: {part!r}")
    return max(0, min(pixel, span - 1))

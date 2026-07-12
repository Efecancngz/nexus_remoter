import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest

from actions._coords import parse_coord


def test_percent():
    assert parse_coord("50%", 1000) == 500


def test_pixel():
    assert parse_coord("300", 1920) == 300


def test_clamps_high():
    assert parse_coord("5000", 1920) == 1919


def test_clamps_low():
    assert parse_coord("-10", 1920) == 0


def test_invalid_raises():
    with pytest.raises(ValueError):
        parse_coord("abc", 1920)

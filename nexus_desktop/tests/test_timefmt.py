import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.timefmt import format_relative


def test_seconds_ago():
    assert format_relative(1000.0, now=1030.0) == "az önce"


def test_minutes_ago():
    assert format_relative(1000.0, now=1000.0 + 5 * 60) == "5 dk önce"


def test_hours_ago():
    assert format_relative(1000.0, now=1000.0 + 3 * 3600) == "3 saat önce"


def test_days_ago():
    assert format_relative(1000.0, now=1000.0 + 2 * 86400) == "2 gün önce"

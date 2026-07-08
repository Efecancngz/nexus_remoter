import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.name_match import best_match


def test_exact_match_wins_over_substring():
    assert best_match("portal", ["Portal 2", "Portal"]) == "Portal"


def test_substring_prefers_shortest():
    assert best_match("portal2", ["Portal 2 Soundtrack", "Portal 2"]) == "Portal 2"


def test_fuzzy_typo_matches():
    # 'spotfy' has no exact/substring hit; difflib should still find Spotify
    assert best_match("spotfy", ["Spotify", "Discord"]) == "Spotify"


def test_fuzzy_below_threshold_returns_none():
    assert best_match("qqqq", ["Spotify", "Discord"]) is None


def test_short_query_requires_exact():
    # 3-char query must not substring/fuzzy into long names
    assert best_match("cs2", ["briefcs2sync"]) is None
    assert best_match("cs2", ["CS2"]) == "CS2"


def test_empty_inputs():
    assert best_match("", ["Spotify"]) is None
    assert best_match("spotify", []) is None

"""Shared fuzzy name resolution for launch/close/focus actions.

Tier order: exact normalized match -> substring (shortest candidate) ->
difflib similarity >= threshold. Below threshold we return None: failing
loudly beats closing or focusing the wrong app.
"""
import difflib
import re

_MIN_PARTIAL_LEN = 4


def normalize(text):
    """Lowercase and strip everything but letters/digits."""
    return re.sub(r'[^a-z0-9]', '', (text or '').lower())


def best_match(query, candidates, *, threshold=0.75):
    """Returns the best-matching original candidate string, or None."""
    norm_query = normalize(query)
    if not norm_query:
        return None

    normalized = [(candidate, normalize(candidate)) for candidate in candidates]
    normalized = [(c, n) for c, n in normalized if n]
    if not normalized:
        return None

    for candidate, norm in normalized:
        if norm == norm_query:
            return candidate

    if len(norm_query) < _MIN_PARTIAL_LEN:
        return None

    substrings = [(len(norm), candidate) for candidate, norm in normalized if norm_query in norm]
    if substrings:
        substrings.sort()
        return substrings[0][1]

    best_score, best_candidate = 0.0, None
    for candidate, norm in normalized:
        score = difflib.SequenceMatcher(None, norm_query, norm).ratio()
        if score > best_score:
            best_score, best_candidate = score, candidate
    if best_score >= threshold:
        return best_candidate
    return None

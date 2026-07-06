import os
import sys
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.security_manager import SecurityManager


def test_correct_pin_validates():
    sec = SecurityManager()
    assert sec.validate_pin(sec.pin) is True


def test_wrong_pin_rejected():
    sec = SecurityManager()
    wrong = "0000" if sec.pin != "0000" else "1111"
    assert sec.validate_pin(wrong) is False


def test_lockout_after_max_attempts():
    sec = SecurityManager()
    sec.MAX_ATTEMPTS = 3
    wrong = "0000" if sec.pin != "0000" else "1111"

    for _ in range(3):
        assert sec.validate_pin(wrong) is False

    # Locked out now, even the correct PIN is rejected
    assert sec.is_locked is True
    assert sec.validate_pin(sec.pin) is False


def test_lockout_expires(monkeypatch):
    sec = SecurityManager()
    sec.MAX_ATTEMPTS = 1
    sec.LOCKOUT_SECONDS = 0.01
    wrong = "0000" if sec.pin != "0000" else "1111"

    sec.validate_pin(wrong)
    assert sec.is_locked is True

    time.sleep(0.02)
    assert sec.is_locked is False
    assert sec.validate_pin(sec.pin) is True


def test_successful_pin_resets_failed_attempts():
    sec = SecurityManager()
    wrong = "0000" if sec.pin != "0000" else "1111"

    sec.validate_pin(wrong)
    assert sec._failed_attempts == 1

    sec.validate_pin(sec.pin)
    assert sec._failed_attempts == 0


def test_issue_token_returns_unique_values():
    sec = SecurityManager()
    t1 = sec.issue_token()
    t2 = sec.issue_token()
    assert t1 != t2
    assert len(t1) > 20


def test_issued_token_validates():
    sec = SecurityManager()
    token = sec.issue_token()
    assert sec.validate_token(token) is True


def test_unknown_token_rejected():
    sec = SecurityManager()
    sec.issue_token()
    assert sec.validate_token("not-a-real-token") is False


def test_empty_or_missing_token_rejected():
    sec = SecurityManager()
    sec.issue_token()
    assert sec.validate_token("") is False
    assert sec.validate_token(None) is False


def test_revoke_all_tokens_invalidates_sessions():
    sec = SecurityManager()
    token = sec.issue_token()
    assert sec.validate_token(token) is True

    sec.revoke_all_tokens()
    assert sec.validate_token(token) is False

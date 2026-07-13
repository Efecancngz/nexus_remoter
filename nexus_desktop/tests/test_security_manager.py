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


import core.security_manager as sm_mod
from core.security_manager import _sanitize_name


def test_issue_token_stores_sanitized_device_name():
    sec = SecurityManager()
    tok = sec.issue_token("  Efe's\tiPhone  ")
    devices = sec.list_devices()
    assert len(devices) == 1
    assert devices[0]["device_name"] == "Efe's iPhone"
    assert sec.validate_token(tok) is True


def test_issue_token_default_device_name():
    sec = SecurityManager()
    sec.issue_token("")
    assert sec.list_devices()[0]["device_name"] == "Bilinmeyen Cihaz"


def test_validate_slides_expiry_and_last_seen(monkeypatch):
    sec = SecurityManager()
    t0 = 1_000_000.0
    monkeypatch.setattr(sm_mod.time, "time", lambda: t0)
    tok = sec.issue_token("iPhone")
    first_expiry = sec.list_devices()[0]["expires_at"]

    monkeypatch.setattr(sm_mod.time, "time", lambda: t0 + 10_000)
    assert sec.validate_token(tok) is True
    slid = sec.list_devices()[0]
    assert slid["expires_at"] > first_expiry
    assert slid["last_seen"] == t0 + 10_000


def test_expired_token_rejected_and_removed(monkeypatch):
    sec = SecurityManager()
    t0 = 1_000_000.0
    monkeypatch.setattr(sm_mod.time, "time", lambda: t0)
    tok = sec.issue_token("iPhone")

    monkeypatch.setattr(sm_mod.time, "time", lambda: t0 + sm_mod.TOKEN_TTL_SECONDS + 1)
    assert sec.validate_token(tok) is False
    assert sec.list_devices() == []


def test_token_survives_restart(tmp_path):
    p = str(tmp_path / "tokens.json")
    sec = SecurityManager(store_path=p)
    tok = sec.issue_token("iPhone")

    sec2 = SecurityManager(store_path=p)  # simulate agent restart
    assert sec2.validate_token(tok) is True


def test_list_devices_exposes_no_secrets():
    sec = SecurityManager()
    sec.issue_token("iPhone")
    d = sec.list_devices()[0]
    assert "hash" not in d
    assert set(d.keys()) == {"id", "device_name", "last_seen", "expires_at"}


def test_flush_is_throttled_on_validate(tmp_path, monkeypatch):
    p = str(tmp_path / "tokens.json")
    sec = SecurityManager(store_path=p)
    tok = sec.issue_token("iPhone")  # flush #1

    calls = []
    orig_flush = sec._store.flush
    monkeypatch.setattr(sec._store, "flush", lambda: calls.append(1) or orig_flush())

    t = [2_000_000.0]
    monkeypatch.setattr(sm_mod.time, "time", lambda: t[0])
    sec._last_flush = t[0]
    sec.validate_token(tok)          # within interval -> no flush
    assert calls == []

    t[0] += sm_mod.PERSIST_MIN_INTERVAL + 1
    sec.validate_token(tok)          # interval elapsed -> flush
    assert calls == [1]


def test_sanitize_name_edge_cases():
    assert _sanitize_name("") == "Bilinmeyen Cihaz"
    assert _sanitize_name(None) == "Bilinmeyen Cihaz"
    assert _sanitize_name("a\x00b\x1fc") == "abc"
    assert _sanitize_name("x" * 100) == "x" * 40


def test_revoke_single_device_invalidates_only_that_token():
    sec = SecurityManager()
    tok_a = sec.issue_token("iPhone")
    tok_b = sec.issue_token("Android")

    dev_a = next(d for d in sec.list_devices() if d["device_name"] == "iPhone")
    assert sec.revoke(dev_a["id"]) is True

    assert sec.validate_token(tok_a) is False
    assert sec.validate_token(tok_b) is True
    assert [d["device_name"] for d in sec.list_devices()] == ["Android"]


def test_revoke_unknown_id_returns_false():
    sec = SecurityManager()
    sec.issue_token("iPhone")
    assert sec.revoke("no-such-id") is False


def test_list_devices_sorted_by_last_seen_desc(monkeypatch):
    sec = SecurityManager()
    t = [1_000.0]
    monkeypatch.setattr(sm_mod.time, "time", lambda: t[0])
    sec.issue_token("Older")
    t[0] = 2_000.0
    sec.issue_token("Newer")
    assert [d["device_name"] for d in sec.list_devices()] == ["Newer", "Older"]

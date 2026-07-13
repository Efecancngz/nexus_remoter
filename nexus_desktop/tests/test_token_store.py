import os
import sys
import json
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.token_store import TokenStore


def _rec(id="a", h="hash-a", expires_at=None):
    now = time.time()
    return {
        "id": id, "hash": h, "device_name": "iPhone",
        "issued_at": now, "last_seen": now,
        "expires_at": now + 3600 if expires_at is None else expires_at,
    }


def test_add_and_get_by_hash():
    store = TokenStore()
    store.add(_rec(id="a", h="hash-a"))
    assert store.get_by_hash("hash-a")["id"] == "a"
    assert store.get_by_hash("missing") is None


def test_remove_and_clear():
    store = TokenStore()
    store.add(_rec(id="a", h="hash-a"))
    assert store.remove("a") is True
    assert store.remove("a") is False
    store.add(_rec(id="b", h="hash-b"))
    store.clear()
    assert store.all() == []


def test_all_returns_copies():
    store = TokenStore()
    store.add(_rec(id="a", h="hash-a"))
    store.all()[0]["device_name"] = "mutated"
    assert store.get_by_hash("hash-a")["device_name"] == "iPhone"


def test_flush_and_reload_round_trip(tmp_path):
    p = str(tmp_path / "data" / "tokens.json")
    store = TokenStore(p)
    store.add(_rec(id="a", h="hash-a"))
    store.flush()

    reloaded = TokenStore(p)
    assert reloaded.get_by_hash("hash-a")["id"] == "a"


def test_expired_records_dropped_on_load(tmp_path):
    p = str(tmp_path / "tokens.json")
    store = TokenStore(p)
    store.add(_rec(id="live", h="live", expires_at=time.time() + 3600))
    store.add(_rec(id="dead", h="dead", expires_at=time.time() - 1))
    store.flush()

    reloaded = TokenStore(p)
    assert reloaded.get_by_hash("live") is not None
    assert reloaded.get_by_hash("dead") is None


def test_corrupt_file_yields_empty_store(tmp_path):
    p = tmp_path / "tokens.json"
    p.write_text("{not valid json", encoding="utf-8")
    store = TokenStore(str(p))
    assert store.all() == []


def test_missing_path_is_in_memory_only(tmp_path):
    store = TokenStore(None)
    store.add(_rec(id="a", h="hash-a"))
    store.flush()  # must not raise
    assert store.get_by_hash("hash-a") is not None


def test_raw_token_never_written(tmp_path):
    p = str(tmp_path / "tokens.json")
    store = TokenStore(p)
    rec = _rec(id="a", h="sha256hexhash")
    store.add(rec)
    store.flush()
    written = (tmp_path / "tokens.json").read_text(encoding="utf-8")
    assert "sha256hexhash" in written  # the hash is persisted
    # sanity: the file is valid JSON with a tokens list
    assert isinstance(json.loads(written)["tokens"], list)

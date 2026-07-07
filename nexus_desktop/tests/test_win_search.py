"""Tests for utils.win_search Steam-library app lookup."""
import pytest

from utils import win_search


def _write_manifest(apps_dir, appid, name):
    apps_dir.mkdir(parents=True, exist_ok=True)
    (apps_dir / f"appmanifest_{appid}.acf").write_text(
        '"AppState"\n{\n'
        f'\t"appid"\t\t"{appid}"\n'
        f'\t"name"\t\t"{name}"\n'
        '}\n',
        encoding="utf-8",
    )


@pytest.fixture
def steam_library(tmp_path, monkeypatch):
    apps = tmp_path / "steamapps"
    monkeypatch.setattr(win_search, "_steam_library_dirs", lambda: iter([str(apps)]))
    return apps


class TestFindSteamApp:
    def test_exact_name_match_returns_rungameid_uri(self, steam_library):
        _write_manifest(steam_library, 431960, "Wallpaper Engine")
        assert win_search.find_steam_app("wallpaperengine") == "steam://rungameid/431960"

    def test_partial_match_prefers_shortest_name(self, steam_library):
        _write_manifest(steam_library, 111, "Portal 2")
        _write_manifest(steam_library, 222, "Portal 2 Soundtrack")
        assert win_search.find_steam_app("portal2") == "steam://rungameid/111"

    def test_no_match_returns_none(self, steam_library):
        _write_manifest(steam_library, 111, "Portal 2")
        assert win_search.find_steam_app("halflife3") is None

    def test_missing_library_dir_returns_none(self, steam_library):
        # steam_library dir is never created
        assert win_search.find_steam_app("anything") is None

    def test_malformed_manifest_is_skipped(self, steam_library):
        steam_library.mkdir(parents=True)
        (steam_library / "appmanifest_999.acf").write_text("not a manifest", encoding="utf-8")
        _write_manifest(steam_library, 111, "Portal 2")
        assert win_search.find_steam_app("portal2") == "steam://rungameid/111"

    def test_no_steam_installed_returns_none(self, monkeypatch):
        monkeypatch.setattr(win_search, "_steam_library_dirs", lambda: iter([]))
        assert win_search.find_steam_app("portal2") is None

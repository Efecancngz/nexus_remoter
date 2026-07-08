import os
import re

from utils.name_match import best_match


def find_installed_app(search_term):
    """
    Scans Windows Start Menu for .lnk files matching the search term,
    falling back to installed Steam apps (returned as a steam:// URI).
    Returns a launchable target (path or URI) or None.
    """
    paths = [
        os.path.join(os.environ["ProgramData"], r"Microsoft\Windows\Start Menu\Programs"),
        os.path.join(os.environ["APPDATA"], r"Microsoft\Windows\Start Menu\Programs"),
    ]

    candidates = {}  # display name -> full path
    for path in paths:
        if not os.path.exists(path):
            continue
        for root, dirs, files in os.walk(path):
            for file in files:
                if file.endswith(".lnk"):
                    candidates.setdefault(file[:-len(".lnk")], os.path.join(root, file))

    winner = best_match(search_term, candidates.keys())
    if winner:
        return candidates[winner]

    return find_steam_app(search_term)


def _steam_library_dirs():
    """Yields every steamapps directory of every Steam library folder."""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            steam_path = winreg.QueryValueEx(key, "SteamPath")[0]
    except OSError:
        return

    main_apps = os.path.join(steam_path, "steamapps")
    if os.path.isdir(main_apps):
        yield main_apps

    vdf = os.path.join(main_apps, "libraryfolders.vdf")
    if not os.path.isfile(vdf):
        return
    try:
        with open(vdf, encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError:
        return
    for raw_path in re.findall(r'"path"\s+"([^"]+)"', content):
        apps = os.path.join(raw_path.replace("\\\\", "\\"), "steamapps")
        if os.path.isdir(apps) and not os.path.samefile(apps, main_apps):
            yield apps


def find_steam_app(search_term):
    """
    Looks up an installed Steam app by name across all Steam libraries.
    Returns a steam://rungameid/<appid> URI or None.
    """
    candidates = {}  # game name -> appid
    for apps_dir in _steam_library_dirs():
        try:
            manifests = os.listdir(apps_dir)
        except OSError:
            continue
        for fname in manifests:
            if not (fname.startswith("appmanifest_") and fname.endswith(".acf")):
                continue
            try:
                with open(os.path.join(apps_dir, fname), encoding="utf-8", errors="replace") as f:
                    content = f.read()
            except OSError:
                continue
            appid = re.search(r'"appid"\s+"(\d+)"', content)
            name = re.search(r'"name"\s+"([^"]+)"', content)
            if appid and name:
                candidates.setdefault(name.group(1), appid.group(1))

    winner = best_match(search_term, candidates.keys())
    if winner:
        return f"steam://rungameid/{candidates[winner]}"
    return None

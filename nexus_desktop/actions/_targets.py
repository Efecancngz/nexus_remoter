"""Shared allowlists and name normalization for action modules.
Underscore-prefixed: not an action module, skipped by discovery."""
import re

# Named actions the agent will launch, mapped to a target passed to
# os.startfile (never through a shell, so no injection is possible via value).
# Both LAUNCH_APP and COMMAND resolve against this same allowlist.
APP_TARGETS = {
    'whatsapp': 'whatsapp:',
    'spotify': 'spotify:',
    'netflix': 'netflix:',
    'instagram': 'instagram:',
    'calculator': 'calc',
    'calc': 'calc',
    'notepad': 'notepad',
    'paint': 'mspaint',
    'mspaint': 'mspaint',
    'explorer': 'explorer',
    'chrome': 'chrome',
    'edge': 'microsoft-edge:',
    'taskmgr': 'taskmgr',
    'task manager': 'taskmgr',
    'control panel': 'control',
    'control': 'control',
}

# Processes CLOSE_APP must never touch, no matter what name the AI produces.
PROTECTED_PROCESSES = {
    'system', 'registry', 'idle', 'csrss', 'winlogon', 'wininit', 'services',
    'lsass', 'smss', 'svchost', 'dwm', 'explorer', 'fontdrvhost', 'conhost',
    'python', 'pythonw',  # the agent itself
}


def normalize_name(name):
    """Lowercase and strip everything but letters/digits for fuzzy matching."""
    return re.sub(r'[^a-z0-9]', '', name.lower())


def proc_base(name):
    """Normalized process name without its .exe extension."""
    name = name or ''
    if name.lower().endswith('.exe'):
        name = name[:-4]
    return normalize_name(name)

[English](CONTRIBUTING.md) | [Türkçe](CONTRIBUTING_TR.md) | [Deutsch](CONTRIBUTING_DE.md)

> Englisches Original: [CONTRIBUTING.md](CONTRIBUTING.md) (bei Abweichungen gilt der englische Text).

# Beitrag zu Nexus Remote

Danke, dass du Nexus Remote verbessern möchtest! Diese Anleitung bringt dich von einem frischen Klon bis zu einem gemergten PR. Kurz gesagt: Das Projekt ist bewusst so aufgebaut, dass die meisten Beiträge **neue Dateien sind, keine Änderungen** — lies den Abschnitt "Eine neue Aktion hinzufügen", bevor du irgendetwas anfasst.

## Entwicklungsumgebung einrichten

Das Repository enthält zwei Anwendungen: den Python-Agenten, der auf dem PC läuft (`nexus_desktop/`), und die React-PWA, die das Telefon lädt (Repo-Wurzel).

- **Python-Agent:** Erstelle eine virtuelle Umgebung (virtualenv) und installiere die Abhängigkeiten, führe den Agenten dann aus dem Quellcode aus:

  ```bash
  python -m venv venv
  venv\Scripts\pip install -r requirements.txt
  venv\Scripts\python.exe nexus_desktop\main.py
  ```

  Für KI-Funktionen (Sprachbefehle, Makrogenerierung) trage `GEMINI_API_KEY="..."` in eine `.env`-Datei im Repo-Root ein. Der Schlüssel verbleibt auf dem PC; er wird niemals an das Telefon übertragen.

- **Web-Client:** standardmäßiger Vite-Workflow:

  ```bash
  npm install
  npm run dev
  ```

  Dies startet einen HTTPS-Entwicklungsserver auf :5173 (HTTPS ist erforderlich, damit die PWA mit dem TLS-Endpunkt des Agenten kommunizieren kann).

- **Tests:** Führe vor dem Öffnen eines PRs beide Testsuiten vom Repo-Root aus aus.

  Backend:

  ```bash
  venv\Scripts\python.exe -m pytest nexus_desktop\tests -q
  ```

  Frontend:

  ```bash
  npx vitest run
  npx tsc --noEmit
  ```

## Architektur in 60 Sekunden

Telefon-PWA (React) → HTTPS+Token → Flask-Agent (`nexus_desktop/`) → EventBus → Services.

Das Telefon greift nie direkt auf deinen PC zu: Jede Anfrage trägt ein Session-Token und läuft über TLS zum Flask-Agenten, der die Arbeit auf einen EventBus veröffentlicht, den die Services (system, media, automation, scheduler, …) abonnieren.

KI-Befehle machen einen zusätzlichen Zwischenschritt: Die PWA sendet Freitext an die `/ai/*`-Routen; der Agent bittet Gemini (mit einem **serverseitigen** API-Schlüssel), JSON-Automatisierungsschritte zu erzeugen; diese Schritte kommen zum Telefon zurück und werden über `/execute` nacheinander ausgeführt. Die KI führt selbst nie etwas aus — sie schlägt nur typisierte Schritte vor, die die Aktionsschicht validiert.

## Eine neue Aktion hinzufügen (die Open/Closed-Regel)

Das System ist so konzipiert, dass du Dateien **HINZUFÜGST, bestehende aber niemals änderst**. Eine Aktion = eine Datei in `nexus_desktop/actions/`. Jedes Modul in diesem Paket (außer mit Unterstrich beginnenden Hilfsmodulen wie `_targets.py`) wird zur Importzeit automatisch erkannt, registriert sich über den `@register_action`-Dekorator selbst und ab diesem Moment gilt:

- der `/execute`-Dispatcher kann sie ausführen,
- der Gemini-Systemprompt enthält automatisch ihre Beispiele und Hinweise,
- das Frontend rendert sie (mit einem Standardsymbol, falls sie kein eigenes hat).

Hier ist `nexus_desktop/actions/hotkey.py` wortgetreu — sie ist die Referenzimplementierung, da sie alle vier Elemente zeigt, die du brauchst: den Registry-Dekorator, `prompt_examples`, `prompt_hint` und eine Allowlist-Validierung, die bei feindlicher Eingabe einen `ValueError` auslöst:

```python
import pyautogui

from .base import Action
from .registry import register_action

_ALLOWED_KEYS = (
    {chr(c) for c in range(ord('a'), ord('z') + 1)}
    | {str(d) for d in range(10)}
    | {f'f{i}' for i in range(1, 25)}
    | {
        'ctrl', 'alt', 'shift', 'win', 'enter', 'tab', 'esc', 'space',
        'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
        'delete', 'backspace', 'insert', 'capslock', 'printscreen',
        'volumemute', 'volumeup', 'volumedown', 'playpause', 'nexttrack', 'prevtrack',
    }
)


@register_action("HOTKEY")
class HotkeyAction(Action):
    prompt_examples = [
        '- "Kaydet": {{ "type": "HOTKEY", "value": "ctrl+s", "description": "Kaydediliyor" }}',
        '- "Sekmeyi kapat": {{ "type": "HOTKEY", "value": "ctrl+w", "description": "Sekme kapatılıyor" }}',
    ]
    prompt_hint = (
        'Tuş kombinasyonları için HER ZAMAN HOTKEY kullan (value: "ctrl+s" '
        'gibi, tuşlar + ile ayrılır). Tek tuş veya metin yazmak için KEYPRESS kullan.'
    )

    def execute(self, value, context):
        keys = [k.strip().lower() for k in (value or '').split('+')]
        if not keys or any(not k for k in keys):
            raise ValueError(f"Invalid hotkey: {value!r}")
        for key in keys:
            if key not in _ALLOWED_KEYS:
                raise ValueError(f"Key not allowed in hotkey: {key!r}")
        pyautogui.hotkey(*keys)
```

Ein paar Anmerkungen dazu, was du hier siehst:

- `@register_action("HOTKEY")` ist die *einzige* Verdrahtung. Es gibt keine Dispatch-Tabelle, keine Importliste, kein Enum, das auf der Backend-Seite erweitert werden muss.
- Die Zeilen von `prompt_examples` verwenden absichtlich doppelte `{{ }}`-Klammern — `services/ai_service.py` entfernt die Verdopplung zu `{ }`, wenn es den Gemini-Systemprompt erstellt. Halte dich in deinen eigenen Beispielen an diese Konvention. (Die Beispiele sind auf Türkisch, weil der ausgelieferte Systemprompt Türkisch ist; passe dich dem an.)
- `execute` behandelt `value` als feindliche Eingabe: Alles wird gegen `_ALLOWED_KEYS` geprüft und mit `ValueError` abgelehnt, *bevor* irgendetwas das Betriebssystem berührt. Der Dispatcher wandelt `ValueError` in einen sauberen Client-Fehler um.

Und hier ist die passende Testvorlage — die `TestHotkey`-Klasse aus `nexus_desktop/tests/test_actions_input.py`, wortgetreu (die `CTX`-Fixture am Anfang dieser Datei ist `ActionContext(bus=None)` aus `actions.base`):

```python
class TestHotkey:
    def _action(self):
        from actions.hotkey import HotkeyAction
        return HotkeyAction()

    def test_valid_combo_calls_pyautogui(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: calls.append(keys))
        self._action().execute("Ctrl + Shift + S", CTX)
        assert calls == [("ctrl", "shift", "s")]

    def test_single_key_allowed(self, monkeypatch):
        calls = []
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: calls.append(keys))
        self._action().execute("f5", CTX)
        assert calls == [("f5",)]

    def test_unknown_key_rejected(self, monkeypatch):
        monkeypatch.setattr("actions.hotkey.pyautogui.hotkey", lambda *keys: pytest.fail("must not run"))
        with pytest.raises(ValueError):
            self._action().execute("ctrl+launchmissiles", CTX)

    def test_empty_value_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("  ", CTX)

    def test_empty_segment_rejected(self):
        with pytest.raises(ValueError):
            self._action().execute("ctrl++s", CTX)
```

Das Muster: den betriebssystemberührenden Aufruf (hier `pyautogui.hotkey`) per Monkeypatch ersetzen, sodass nichts Echtes passiert, sicherstellen, dass der Happy Path die richtigen Argumente weiterleitet, und sicherstellen, dass jede feindliche Eingabe einen `ValueError` auslöst, **ohne** dass der Betriebssystemaufruf jemals ausgeführt wird.

### Checkliste

1. Erstelle `nexus_desktop/actions/<deine_aktion>.py` — wird automatisch erkannt, nirgendwo müssen Importe bearbeitet werden.
2. Erstelle `nexus_desktop/tests/test_<deine_aktion>.py` nach der obigen Vorlage.
3. `prompt_examples`/`prompt_hint` bringen Gemini deine Aktion automatisch bei — überprüfe dies mit dem Prompt-Snapshot-Test (`tests/test_ai_prompt.py` muss ohne Änderungen bestehen).
4. Frontend: nichts zu tun. Unbekannte Aktionstypen werden mit einem Standardsymbol gerendert. Optional kannst du für individuelles Styling ein Enum-Mitglied + einen Symbol-Fall (icon case) in `components/CommandPreviewModal.tsx` hinzufügen.

## Sicherheitsregeln (PRs, die diese verletzen, werden abgelehnt)

Diese App nimmt natürlichsprachliche Befehle von einem Telefon entgegen und lässt ein LLM daraus Aktionen auf dem PC einer Person machen. Die folgenden Regeln verhindern, dass daraus ein Remote-Code-Execution-Dienst wird:

- **Niemals über eine Shell ausführen.** Verwende `os.startfile` mit einem in einer Allowlist geführten Ziel oder `subprocess.run([...], shell=False)` mit einem festen argv. String-zusammengesetzte Befehle, `shell=True`, `os.system` — sofortige Ablehnung.
- **Vom Benutzer/von der KI gelieferte Werte sind feindliche Eingaben.** Validiere sie gegen Allowlists (siehe `actions/hotkey.py`, `actions/command.py`) und löse bei allem Unerwarteten einen `ValueError` aus. Die Gemini-Ausgabe ist eine nicht vertrauenswürdige Eingabe wie jede andere.
- **`actions/_targets.py: PROTECTED_PROCESSES` ist nicht verhandelbar** für alles, was Prozesse berührt. Keine Aktion darf jemals `csrss`, `lsass` oder den eigenen `python`-Prozess des Agenten beenden, egal welchen Namen die KI erzeugt.
- **Jede Flask-Route muss das Session-Token prüfen**; KI-Routen bleiben ausschließlich mit serverseitigem Schlüssel. Der Gemini-API-Schlüssel verlässt den PC nie und erscheint nie im Frontend-Bundle.

## Ein stärkeres Modell verwenden / Vision hinzufügen

- **Modellwechsel:** Ändere `MODEL_NAME` in `nexus_desktop/services/ai_service.py` (derzeit `"gemini-2.5-flash"`); jedes Gemini-Modell, auf das dein Schlüssel Zugriff hat, funktioniert. Für einen völlig anderen Anbieter ersetze die `genai`-Aufrufe innerhalb von `AiService._model`/den Handlern — die Routen und das JSON-Schrittschema sind anbieterunabhängig, sodass sich sonst nichts ändert.
- **Vision ("Computer-Nutzung"):** Implementiere dies einfach als ein weiteres Aktionsmodul (z. B. `SMART_CLICK`): den Bildschirm erfassen (`pyautogui.screenshot`), ihn zusammen mit dem Zieltext an ein vision-fähiges Modell senden, die zurückgegebenen Koordinaten parsen und dann die Begrenzungslogik (Clamping) von MOUSE_CLICK wiederverwenden, um Klicks auf dem Bildschirm zu halten. Es ist ein Erweiterungspunkt, keine Neufassung: eine einzige neue Datei.

## Branch- und PR-Konventionen

- Ein Branch pro Arbeitseinheit (`feat/...`, `fix/...`), PRs gegen `main`.
- Alle Testsuiten grün (pytest + vitest + tsc), bevor ein Review angefordert wird — die Befehle aus dem Abschnitt Entwicklungsumgebung einrichten, genau wie dort geschrieben.

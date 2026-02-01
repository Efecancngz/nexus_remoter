# 🇩🇪 Nexus Remote Kommandozentrale

![Nexus Remote](https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2070&auto=format&fit=crop)

**Nexus Remote** verwandelt Ihr Smartphone in eine KI-gestützte PC-Zentrale. Egal, ob Sie es nur verwenden oder den Code anpassen möchten – alles ist Open Source.

---

## 🏁 Schnellstart (Für Benutzer)
Keine Lust auf Programmieren? So geht's:

### 1. 📥 Herunterladen
Gehen Sie auf dieser GitHub-Seite rechts zu **[Releases]** und laden Sie die neueste `NexusAgent.exe` herunter.

### 2. 🖱️ Ausführen
Starten Sie die `NexusAgent.exe` auf Ihrem PC. (Keine Installation nötig).

### 3. 📱 Verbinden
1.  Öffnen Sie die Web-App auf Ihrem Handy.
2.  Klicken Sie oben links auf das **NEXUS** Logo.
3.  Geben Sie den **PIN-Code** und die **IP-Adresse** ein, die auf Ihrem PC angezeigt werden.
4.  Fertig!

---

## 👨‍💻 Entwicklerhandbuch (Source & Build)
Möchten Sie mitwirken oder Ihre eigene Version erstellen?

### 📂 Projektstruktur
*   `/nexus_desktop`: Python-Backend-Agent auf dem PC.
*   `/src` (Root): React-Frontend für die mobile Oberfläche.

### 🛠️ Agenten vom Quellcode ausführen
Statt der EXE können Sie den Python-Code direkt ausführen:

```bash
# Abhängigkeiten installieren
pip install flask flask-cors pyinstaller psutil

# Agenten starten
python nexus_desktop/main.py
```

### 📦 Eigene EXE erstellen
Code geändert und neu verpacken? Verwenden Sie diesen Befehl:

```bash
cd nexus_desktop
# Mit PyInstaller verpacken (Alle Module sammeln)
py -m PyInstaller --onefile --noconsole --name "NexusAgent" --paths . --collect-all services --collect-all core --collect-all utils main.py
```
*Die Datei finden Sie im Ordner `dist/NexusAgent.exe`.*

### 🎨 Frontend-Entwicklung
Um die Benutzeroberfläche zu ändern:
```bash
npm install
npm run dev
```

---
[🏠 Zurück zur Startseite](README.md)

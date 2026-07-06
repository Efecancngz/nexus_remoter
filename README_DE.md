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
3.  Geben Sie die **IP-Adresse** ein, die auf Ihrem PC angezeigt wird.
4.  **Zum ersten Mal auf diesem Gerät?** Tippen Sie auf den Link „Zertifikat bestätigen", der unter dem IP-Feld erscheint (er öffnet `https://<pc-ip>:8080/`), akzeptieren Sie die Sicherheitswarnung des Browsers einmalig und kehren Sie zurück. Der Agent verwendet ein selbstsigniertes HTTPS-Zertifikat; dieser Schritt ist pro Gerät einmal erforderlich. Details in [SECURITY.md](SECURITY.md) — Hinweis: Auf iOS wird der installierte PWA-Modus (Startbildschirm) für diesen Schritt derzeit nicht unterstützt.
5.  Geben Sie den **PIN-Code** vom PC-Bildschirm ein und verbinden Sie sich. Fertig!

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
pip install -r requirements.txt

# Agenten starten
python nexus_desktop/main.py
```

Für die KI-Funktionen (Sprach-/Makro-Generierung) legen Sie im Stammverzeichnis eine `.env`-Datei mit `GEMINI_API_KEY="Ihr-Schlüssel"` an — der Schlüssel bleibt auf dem PC und wird nie an das Handy ausgeliefert. Beim ersten Start erzeugt der Agent außerdem automatisch ein selbstsigniertes TLS-Zertifikat unter `data/certs/`.

### 📦 Eigene EXE erstellen
Code geändert und neu verpacken? Verwenden Sie diesen Befehl:

```bash
pip install pyinstaller
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

# 🇺🇸 Nexus Remote Command Center

![Nexus Remote](https://images.unsplash.com/photo-1550751827-4bd374c3f58b?q=80&w=2070&auto=format&fit=crop)

**Nexus Remote** turns your smartphone into an AI-powered PC command center. Whether you just want to use it or dive into the code, everything is Open Source.

---

## 🏁 Quick Start (For Users)
Don't want to deal with code? Here is how to use it:

### 1. 📥 Download
Go to the **[Releases]** section on the right side of this GitHub page and download the latest `NexusAgent.exe`.

### 2. 🖱️ Run
Run the `NexusAgent.exe` on your PC. (No installation required, portable).

### 3. 📱 Connect
1.  Open the web app on your phone.
2.  Click the **NEXUS** logo in the top-left.
3.  Enter the **IP Address** shown on your PC screen.
4.  **First time on this device?** Tap the "trust the certificate" link that appears below the IP field (it opens `https://<pc-ip>:8080/`), accept the browser's security warning once, and come back. The agent uses a self-signed HTTPS certificate; this one-time step is required per device. See [SECURITY.md](SECURITY.md) for details — note that iOS installed-PWA (home screen) mode is currently not supported for this trust step.
5.  Enter the **PIN Code** shown on your PC screen and connect. You are ready to go!

---

## 👨‍💻 Developer Guide (Source & Build)
Want to contribute or build your own version?

### 📂 Project Structure
*   `/nexus_desktop`: Python backend agent running on the PC.
*   `/src` (Root): React frontend for the mobile interface.

### 🛠️ Running Agent from Source
Instead of the EXE, you can run the raw Python code:

```bash
# Install dependencies
pip install -r requirements.txt

# Run the agent
python nexus_desktop/main.py
```

For the AI features (voice/macro generation), create a `.env` file in the repo root with `GEMINI_API_KEY="your-key"` — the key stays on the PC; it is never shipped to the phone. On first start the agent also generates a self-signed TLS certificate under `data/certs/` automatically.

### 📦 Build Your Own EXE
Modified the code and want to repackage it? Use this magic command:

```bash
pip install pyinstaller
cd nexus_desktop
# Package with PyInstaller (Collecting all modules)
py -m PyInstaller --onefile --noconsole --name "NexusAgent" --paths . --collect-all services --collect-all core --collect-all utils main.py
```
*The output will be in the `dist/NexusAgent.exe` folder.*

### 🎨 Frontend Development
To modify the UI:
```bash
npm install
npm run dev
```

---
[🏠 Back to Home](README.md)

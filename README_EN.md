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
3.  Enter the **PIN Code** and **IP Address** shown on your PC screen.
4.  You are ready to go!

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
pip install flask flask-cors pyinstaller psutil

# Run the agent
python nexus_desktop/main.py
```

### 📦 Build Your Own EXE
Modified the code and want to repackage it? Use this magic command:

```bash
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

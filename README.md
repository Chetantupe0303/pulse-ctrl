<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0F172A,50:312E81,100:06B6D4&height=190&section=header&text=PulseCtrl&fontSize=56&fontColor=F8FAFC&animation=fadeIn&fontAlignY=38&desc=YOUR%20PHONE.%20YOUR%20LAPTOP.%20ONE%20SCAN.&descSize=15&descAlignY=62" alt="PulseCtrl — Your phone. Your laptop. One scan." width="100%">

Turn a phone into a wireless trackpad and keyboard, paired over your local network or cloud with a QR code.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853D?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Express](https://img.shields.io/badge/Express-4-111111?logo=express&logoColor=white)](https://expressjs.com/)
[![WebSocket](https://img.shields.io/badge/WebSocket-ws-4B32C3)](https://github.com/websockets/ws)

</div>

<br>

PulseCtrl links a mobile web control surface to native laptop input. Start the server and helper, scan the pairing QR code from a phone, approve the connection, and use the phone to move, click, drag, scroll, zoom, and type.

## At a glance

| **Pair** | **Control** | **Stay in charge** |
|:--|:--|:--|
| One-time QR session over LAN or Cloud (WSS) | Touchpad gestures, clicking & dragging, 2D scrolling, pinch-zoom, and typing | Laptop approval modal, single-instance lock, system tray, and session rate limits |

## Stack

`Electron` · `Node.js` · `Express` · `ws` · `qrcode` · `Vanilla HTML/CSS/JS` · `nut.js` · `electron-builder`

---

## 🪟 Windows Desktop App (Electron)

PulseCtrl Helper is available as a native Windows desktop application so non-technical users can install and use it without opening a terminal:

- **System Tray Integration:** Runs in the system tray without a terminal window. Left-click or use the tray menu (`Show QR`, `Disconnect`, `Start with Windows`, `Quit`).
- **Background Persistence:** Closing the app window minimizes to the tray; the helper continues running in the background.
- **Single Instance:** Enforces single-instance execution (`requestSingleInstanceLock`). Launching a second instance restores and focuses the active window.
- **In-App Device Approval Security:** When a phone scans the QR code, the desktop app presents the `"Allow this device?"` prompt directly in the window, keeping laptop details private and protected.
- **Auto-Start:** Toggle `"Start with Windows"` directly from the tray menu to launch PulseCtrl automatically at logon.

### Installing the Desktop App:
1. Double-click `PulseCtrl-Helper-Setup-1.0.0.exe` generated in `/dist` (or download from the web interface).
2. Choose install location and finish setup. A desktop shortcut and start menu entry will be created.
3. Launch **PulseCtrl Helper**. It connects to the configured server, opens in the system tray, and shows your QR pairing window.

---

## 📱 Mobile Control Surface Features

The mobile web client (`/phone`) includes advanced trackpad and laptop controls:

1. **Mouse Sensitivity (Percentage Control):**
   - Adjust cursor sensitivity from 20% to 300% via the quick slider.
   - Percentage is saved in `localStorage` and persists across sessions.
2. **Clicking & Dragging:**
   - **Double-Tap & Hold:** Tap once, then tap-and-hold down to drag windows, files, or selections.
   - **Drag Lock Button:** Tap `✋ Drag: ON / OFF` in the click bar to hold the left mouse button down while moving freely.
3. **Scrolling & Zooming:**
   - **2-Finger Scroll:** Swipe 2 fingers vertically for vertical scrolling or horizontally for horizontal scrolling.
   - **Pinch-to-Zoom:** Pinch in/out on the trackpad to zoom in or out (`Ctrl + =` / `Ctrl + -`).
   - **Quick Zoom Buttons:** Tap `+` or `−` in the tools bar for instant zoom.
4. **Navigation & Window Management:**
   - Tap `⚙️` to open the quick-actions drawer:
     - 🗔 `Alt+Tab` (Switch applications)
     - 🖥️ `Win+D` (Show Desktop)
     - ⛶ `Win+↑` (Maximize window)
     - 🗕 `Win+↓` (Minimize window)
     - ◧ `Win+←` / ◨ `Win+→` (Snap window left / right)
     - ✕ `Alt+F4` (Close active window)
     - ⬅ `Back` (`Alt+←`), ➡ `Forward` (`Alt+→`), 🔄 `Refresh` (`F5`), `+ New Tab` (`Ctrl+T`)

---

## Quick Start (Development)

**Requirements:** Node.js 18+ and npm.

```bash
git clone https://github.com/Chetantupe0303/pulse-ctrl.git
cd pulse-ctrl
npm install
```

### Running Server & Helper:

```bash
# Terminal 1: Start Web & WebSocket Server
npm run server

# Terminal 2: Start Desktop Electron Helper
npm run helper

# (Optional): Start CLI Helper without Electron
npm run helper:cli
```

---

## Building the Windows Installer

Build the NSIS Windows Installer (`.exe`) with electron-builder:

```bash
npm run build:win
```

The installer will be generated in `dist/`:
- `dist/PulseCtrl-Helper-Setup-1.0.0.exe` (Complete Windows NSIS installer)
- `dist/win-unpacked/` (Unpacked standalone directory)

All native modules (`@nut-tree/nut-js` / `libnut.node` and runtime DLLs) are automatically unpacked into `app.asar.unpacked` for direct execution on Windows.

---

## Running Tests

Verify all components and security flows:

```bash
# 1. Desktop App integration test (Helper, QR, phone pairing & approval flow)
node test/test-desktop-app.js

# 2. Mobile features test (Sensitivity, Click/Drag, 2D Scroll, Window keys)
node test/test-features.js

# 3. Stage 1 Electron wrapper verification
node test/test-stage1.js
```

---

## Hosting & Deployment (Render, Railway, etc.)

PulseCtrl is 100% cloud-ready with automatic HTTPS/WSS origin detection and QR generation.

### Render Setup:
1. Connect your GitHub repository to [Render](https://render.com) and create a **Web Service**.
2. Settings from `render.yaml`:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm run server`
3. Click **Deploy**. Render will assign you a live HTTPS URL (e.g. `https://pulse-ctrl.onrender.com`).
4. On the web page, visitors can click **"Download for Windows (.exe)"** to get the desktop helper installer.

<div align="center">

<sub>MIT licensed · Built for the small distance between devices</sub>

</div>

# PulseCtrl

> Turn your phone into a wireless trackpad and keyboard for your laptop with instant QR pairing like WhatsApp Web.

PulseCtrl is a low-latency, mobile-first wireless input system. A website running in a browser cannot directly synthesize native OS input events due to browser security sandboxing. PulseCtrl solves this by connecting a mobile web touch interface with a lightweight native laptop helper process over WebSocket.

---

## Architecture Overview

PulseCtrl is structured as a clean 3-part monorepo:

```
pulse-ctrl/
├── package.json          # Root scripts: server, helper, test
├── server/               # Node.js + Express + ws WebSocket relay
│   ├── index.js          # Express app, HTTP routes & WebSocket router
│   ├── session.js        # Unguessable one-time pairing tokens & session timeouts
│   ├── rateLimiter.js    # Per-session token-bucket rate limiter
│   └── validator.js      # Strict message schema validator & mode permission guard
├── web/                  # Plain HTML, CSS, JavaScript (zero frontend build steps)
│   ├── index.html        # Laptop UI (/) showing pairing QR code & Allow/Deny modal
│   ├── laptop.css        # Dark theme with pulse glow animation
│   ├── laptop.js         # Laptop web client managing pairing & approvals
│   ├── phone.html        # Mobile-first touch surface & virtual keyboard (/phone)
│   ├── phone.css         # Touch-action: none styling & mobile layouts
│   └── phone.js          # 60fps touch delta engine, gesture recognition & keyboard listener
├── helper/               # Native background helper
│   ├── index.js          # WebSocket client connecting to server
│   └── executor.js       # Native OS input synthesizer using @nut-tree/nut-js
└── test/
    ├── stage1-test.js    # Stage 1 pairing & approval verification
    └── end-to-end-test.js # Full end-to-end test suite (Stages 1–4)
```

---

## Features

- **WhatsApp Web-style QR Pairing**: Scan the QR code displayed on the laptop screen with your phone camera to pair instantly.
- **Strict Approval Security**: The laptop displays an **"Allow this device?"** prompt with device metadata before any control events can execute.
- **Trackpad Mode**:
  - **1-Finger Drag**: Cursor movement throttled to ~60 events/second using `requestAnimationFrame`.
  - **Single Tap**: Left click.
  - **Two-Finger Tap**: Right click.
  - **Two-Finger Drag**: Natural vertical scrolling.
- **Keyboard Mode**:
  - Hidden input listening to native `input` events for reliable mobile typing and backspace handling.
  - Dedicated buttons for **Enter**, **Backspace**, **Tab**, **Esc**, **Space**, **Arrow keys** (↑, ↓, ←, →), and modifier toggles (**Ctrl**, **Alt**, **Shift**).
- **Both Mode**: Split screen with a responsive touchpad on top and keyboard controls below.
- **Mode Permissions**: Strict permission enforcement on both server and helper—events not permitted by the active mode are dropped immediately.
- **Session Lifecycles**:
  - Automatically expires after **2 minutes** if unpaired.
  - Automatically expires after **15 minutes** of inactivity once paired.
- **Dark UI with Pulse Animation**: Elegant dark theme with a subtle pulse glow on the connection status indicator.

---

## Message Protocol

All messages are exchanged in JSON format:

```json
{ "type": "move", "dx": -12, "dy": 8 }
{ "type": "click", "button": "left" }
{ "type": "click", "button": "right" }
{ "type": "scroll", "dy": 5 }
{ "type": "text", "value": "Hello world" }
{ "type": "key", "key": "Enter", "modifiers": [] }
{ "type": "key", "key": "c", "modifiers": ["ctrl"] }
{ "type": "mode", "value": "trackpad" }
```

---

## Installation

### Prerequisites
- Node.js (v18 or newer recommended; tested on Node.js v24)
- npm

### Install Dependencies
Clone the repository and install dependencies:
```bash
git clone https://github.com/your-username/pulse-ctrl.git
cd pulse-ctrl
npm install
```

---

## How to Run

Running PulseCtrl requires two processes on your laptop:

### 1. Start the Server
In terminal 1:
```bash
npm run server
```
The server will start listening on port `3000` (bound to `0.0.0.0`):
```
=======================================================
  PulseCtrl Server is running!
  Local:   http://localhost:3000
  Network: http://192.168.1.5:3000
=======================================================
```

### 2. Start the Laptop Helper
In terminal 2:
```bash
npm run helper
```
The helper connects to the server over WebSocket, receives a session, and automatically launches the laptop browser page at `http://localhost:3000/?session=<id>`.

---

## Testing on a Phone on the Same Wi-Fi

1. **Connect both devices** (laptop and phone) to the same Wi-Fi network.
2. The laptop web page displays a high-contrast QR code encoding `http://<your-laptop-lan-ip>:3000/phone?session=<id>&token=<token>`.
3. Open your phone camera or QR scanner and scan the QR code.
4. On your phone, tap the link to open the PulseCtrl Phone UI.
5. On your phone screen, you will see: **"Waiting for Laptop: Please click Allow on your laptop screen"**.
6. On your laptop screen, a modal pops up asking **"Allow this device?"** with device details.
7. Click **Allow** on your laptop:
   - The status indicator pulses green: **"Phone connected"**.
   - Your phone unlocks the **Trackpad**, **Keyboard**, and **Both** controls.
8. Drag your finger on the phone screen—your laptop mouse cursor moves in real-time! Tap with one finger to left-click, tap with two fingers to right-click, and drag two fingers to scroll.

> **Tip for Windows Firewall**: If your phone cannot load the page, ensure Windows Defender Firewall allows incoming connections on port 3000 for Node.js on Private networks.

---

## OS Permissions & Platforms

### Windows (Default)
PulseCtrl runs out of the box on Windows without extra drivers. nut-js synthesizes native mouse and keyboard inputs via the Windows API.

### macOS Accessibility Permission
On macOS, operating system security requires that any application simulating user inputs be granted Accessibility permissions:
1. Open **System Settings** > **Privacy & Security** > **Accessibility**.
2. Click **+** and add your Terminal application (e.g. `Terminal`, `iTerm2`, or `VS Code`) or the `node` binary.
3. Toggle the checkbox to **Allow** the application to control your computer.
4. Restart the helper script: `npm run helper`.

### Linux
On Linux (X11), install `libxtst-dev` and `libpng-dev` if required by the native addon. On Wayland, ensure your compositor supports synthetic input or run under XWayland.

---

## Security Considerations

1. **Cryptographic Tokens**: Session IDs and pairing tokens are generated using `crypto.randomBytes` (16 bytes / 128-bit entropy).
2. **One-Time Pairing**: Pairing tokens are single-use. Once claimed and approved, the token is permanently invalidated and cannot be reused.
3. **Explicit User Consent**: Even with a valid token, the laptop user must explicitly click **"Allow"** on the laptop before any input events are executed.
4. **Input Sanitization**: Every event payload is validated against strict bounds and schemas. Unknown event types are dropped.
5. **Rate Limiting**: High-frequency events are capped via a token-bucket rate limiter to prevent denial-of-service or input flooding.
6. **HTTPS / WSS in Production**:
   - In production or across public networks, **HTTPS and WSS (WebSocket Secure) must be used** to encrypt tokens and touch data in transit.
   - You can place the server behind a reverse proxy (e.g., Caddy or Nginx) with Let's Encrypt SSL certificates, or use a secure tunnel (e.g. Cloudflare Tunnels).

---

## How to Deploy

### Option 1: Reverse Proxy (Caddy / Nginx)
Run the Node.js server with PM2 or Docker and terminate SSL with Caddy:
```caddy
pulse.yourdomain.com {
    reverse_proxy localhost:3000
}
```
Caddy handles automatic HTTPS and WebSocket proxying (`wss://`).

### Option 2: Cloudflare Tunnel
For remote control over the internet without port forwarding:
```bash
cloudflared tunnel --url http://localhost:3000
```
This gives you an instant `https://*.trycloudflare.com` URL that works on mobile devices anywhere.

---

## Converting Into an App Later

PulseCtrl was designed for seamless packaging as a native app:

### 1. Progressive Web App (PWA) for the Phone
- Add a `manifest.json` and a minimal Service Worker to `/web`.
- The phone page can then be installed to the home screen via "Add to Home Screen" on iOS Safari and Android Chrome, running in fullscreen standalone mode without browser URL bars.

### 2. Electron App for the Laptop
- Bundle `/server` and `/helper` into a single Electron application.
- The Electron main process runs the helper and local server internally, displaying the laptop UI inside a native BrowserWindow.
- System tray minimization and auto-startup on boot can be added easily.

---

## Automated Tests

Run the comprehensive end-to-end test suite:
```bash
npm test
```
This runs the full test suite verifying session creation, token validation, security rejection of bad tokens, the "Allow this device?" flow, mode permissions, and clean disconnects.

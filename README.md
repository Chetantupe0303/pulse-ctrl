<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0F172A,50:312E81,100:06B6D4&height=190&section=header&text=PulseCtrl&fontSize=56&fontColor=F8FAFC&animation=fadeIn&fontAlignY=38&desc=YOUR%20PHONE.%20YOUR%20LAPTOP.%20ONE%20SCAN.&descSize=15&descAlignY=62" alt="PulseCtrl — Your phone. Your laptop. One scan." width="100%">

Turn a phone into a wireless trackpad and keyboard, paired over your local network with a QR code.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-43853D?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4-111111?logo=express&logoColor=white)](https://expressjs.com/)
[![WebSocket](https://img.shields.io/badge/WebSocket-ws-4B32C3)](https://github.com/websockets/ws)

</div>

<br>

PulseCtrl links a mobile web control surface to native laptop input. Start the server and helper, scan the laptop’s pairing code from a phone on the same Wi-Fi, approve the connection, and use the phone to move, click, scroll, and type.

## At a glance

| **Pair** | **Control** | **Stay in charge** |
|:--|:--|:--|
| One-time QR session over your local network | Touchpad gestures, clicks, scrolling, and keyboard controls | Laptop approval, validated events, and session rate limits |

## Stack

`Node.js` · `Express` · `ws` · `qrcode` · `Vanilla HTML/CSS/JS` · `nut.js`

## Quick start

**Requirements:** Node.js 18+ and npm. Keep the laptop and phone on the same Wi-Fi network.

```bash
git clone https://github.com/Chetantupe0303/pulse-ctrl.git
cd pulse-ctrl
npm install
```

Start both processes in separate terminals:

```bash
npm run server
```

```bash
npm run helper
```

Open the laptop page at the URL printed by the server, scan its QR code with your phone, then approve the connection on the laptop. The server normally uses port `3000` and checks nearby ports if it is occupied.

> Native input permissions may be required by your operating system. On macOS, grant Accessibility access to the terminal or Node.js running the helper.

## Hosting & Deployment (Render, Railway, etc.)

PulseCtrl is 100% cloud-ready with automatic HTTPS/WSS origin detection and QR generation.

### Render Setup:
1. Connect your GitHub repository to [Render](https://render.com) and create a **Web Service**.
2. Render will automatically detect the settings from `render.yaml` (or enter them manually):
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm run server`
3. Click **Deploy**. Render will assign you a live HTTPS URL (e.g. `https://pulse-ctrl.onrender.com`).

### Linking Your Laptop to Render:
Once your server is live on Render:
1. Open your Render site on your laptop: `https://pulse-ctrl.onrender.com`
2. Run this single command on your laptop terminal:
   ```bash
   node helper/index.js --server=pulse-ctrl.onrender.com
   ```
   *(Or on Windows, double-click `connect-render.bat`)*.
3. The helper remembers your Render domain in `.pulse-target.txt`, so in the future you only have to type `npm run helper`!
4. The QR code appears on your screen—scan it with your phone (from Wi-Fi or 4G/5G mobile data) to control your laptop from anywhere!

<div align="center">

<sub>MIT licensed · Built for the small distance between devices</sub>

</div>

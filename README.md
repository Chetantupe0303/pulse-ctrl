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

<div align="center">

<sub>MIT licensed · Built for the small distance between devices</sub>

</div>

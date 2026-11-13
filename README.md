# PulseCtrl

### Your laptop, one tap away.

PulseCtrl turns your phone into a wireless trackpad and keyboard for your laptop. Both devices connect over your local Wi-Fi; the laptop asks you to approve a phone before it can control anything.

## Get ready

- Install [Node.js 18 or newer](https://nodejs.org/).
- Connect your laptop and phone to the same Wi-Fi network.
- Open a terminal in the PulseCtrl project folder and install dependencies:

```bash
npm install
```

## Start PulseCtrl

Open **two terminals** in the project folder. The server and helper both need to stay running, so leave each terminal open while you use PulseCtrl.

**Terminal 1 — start the server:**

```bash
cd server
npm run server
```

**Terminal 2 — start the laptop helper:**

```bash
cd helper
npm run helper
```

The server displays your laptop's local IP and port. The helper opens the laptop control page; if it does not open automatically, use the `Laptop Web` URL it prints. If you set a custom port, use the same `PORT` value for both processes.

## Pair your phone

1. Keep both devices on the same Wi-Fi network. Allow local network access in your laptop firewall if prompted.
2. Open the laptop control page and scan its QR code with your phone.
3. Approve the request on the laptop when **Allow this device?** appears. Choose **Deny** to refuse it.
4. Use the phone as a trackpad or keyboard. Choose **Disconnect** on the laptop to end the session.

Each QR code works once and expires after 2 minutes. Approved sessions end after 15 minutes without activity. Only one phone can connect per session; a fresh QR code appears when a session ends.

## A note about permissions

The helper uses your operating system's input APIs to move and click the cursor and type. macOS may ask you to grant Accessibility permission to the terminal or Node.js process running the helper.

## Run the checks

```bash
npm test
npm run test:lifecycle
```

## License

MIT

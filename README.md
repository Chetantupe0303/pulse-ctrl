# PulseCtrl

PulseCtrl turns a phone into a trackpad and keyboard for a laptop over the same Wi-Fi network. The HTTP server and input helper run on the laptop; pairing and control stay on the local network.

## Requirements

- Node.js 18 or newer
- A laptop and phone connected to the same Wi-Fi network

## Install

```bash
npm install
```

## Run

Run both local processes together:

```bash
npm run dev
```

Or use two terminals (from the root or inside `/server` and `/helper`):

```bash
# Terminal 1: Server
npm run start:server   # or: npm run server

# Terminal 2: Helper
npm run start:helper   # or: npm run helper
```

The server prints the laptop's local IP and port. The helper opens a session-specific laptop control page on the laptop. If it does not open automatically, copy the `Laptop Web` URL printed by the helper. If you use a custom port, set `PORT` to the same value for both processes.

## Pair a phone over Wi-Fi

1. Keep the laptop and phone on the same Wi-Fi network. Allow local network access in the laptop firewall if prompted.
2. Start the server and helper on the laptop, then open the laptop control page.
3. Scan the QR code with the phone. It contains the laptop's detected local IP and a short lived, one-time session token.
4. On the laptop, click **Allow** when **Allow this device?** appears. **Deny** closes the phone connection.
5. Use the phone as a trackpad or keyboard. Click **Disconnect** on the laptop page to end the session immediately.

An unused QR expires after 2 minutes, and an approved session disconnects after 15 minutes without activity. Each session accepts one phone, and a new QR code is created when a session ends.

## Test

Run the local integration checks:

```bash
npm test
npm run test:lifecycle
```

For a phone check, follow the Wi-Fi pairing steps above and confirm that the phone only controls the laptop after approval. Test **Deny** and **Disconnect** as well.

## Permissions

The helper uses the operating system's input APIs to move and click the cursor and type. macOS may ask you to grant accessibility permission to the terminal or Node.js process running the helper.

## License

MIT

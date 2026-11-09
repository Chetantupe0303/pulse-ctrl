/**
 * PulseCtrl - Laptop Helper
 * Background Node.js client using @nut-tree/nut-js.
 * Connects to the local PulseCtrl server via WebSocket, requests a session,
 * and executes native mouse and keyboard events sent from the paired phone.
 */

const { exec } = require('child_process');
const WebSocket = require('ws');
const { executeEvent } = require('./executor');

const SERVER_HOST = process.env.PULSE_SERVER || 'localhost:3000';
let ws = null;
let currentMode = 'trackpad';
let currentSessionId = null;

function openBrowser(url) {
  // Attempt to open the laptop webpage automatically on start
  const startCmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(startCmd, (err) => {
    // Non-fatal if browser open fails
    if (err) {
      // Ignored
    }
  });
}

function connect() {
  const wsUrl = `ws://${SERVER_HOST}/ws?role=helper`;
  console.log(`[Helper] Connecting to PulseCtrl server at ${wsUrl}...`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[Helper] Connected to PulseCtrl Server!');
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'session_ready') {
        currentSessionId = msg.sessionId;
        const webUrl = `http://localhost:${SERVER_HOST.split(':')[1] || '3000'}/?session=${msg.sessionId}`;

        console.log('');
        console.log('='.repeat(60));
        console.log('  ⚡ PulseCtrl Helper Ready');
        console.log(`  Session ID: ${msg.sessionId}`);
        console.log(`  Laptop Web: ${webUrl}`);
        console.log(`  Phone URL:  ${msg.phoneUrl}`);
        console.log('='.repeat(60));
        console.log('  Waiting for phone to scan QR code and pair...');
        console.log('');

        // Automatically open the laptop webpage in the browser
        openBrowser(webUrl);
      } else if (msg.type === 'paired') {
        currentMode = msg.mode || 'trackpad';
        console.log(`[Helper] Phone paired successfully! Mode: ${currentMode.toUpperCase()}`);
      } else if (msg.type === 'mode') {
        currentMode = msg.value;
        console.log(`[Helper] Switched to mode: ${currentMode.toUpperCase()}`);
      } else if (msg.type === 'status') {
        console.log(`[Helper] Status: ${msg.status} ${msg.message ? `(${msg.message})` : ''}`);
      } else if (msg.type === 'disconnect') {
        console.log('[Helper] Phone disconnected.');
      } else if (msg.type === 'expired') {
        console.warn(`[Helper] Session expired: ${msg.message}`);
      } else {
        // Control event from phone: move, click, scroll, text, key
        await executeEvent(msg, currentMode);
      }
    } catch (e) {
      console.error('[Helper] Message handling error:', e.message);
    }
  });

  ws.on('close', () => {
    console.warn('[Helper] Disconnected from server. Reconnecting in 3 seconds...');
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('[Helper] Connection error:', err.message);
  });
}

connect();

/**
 * PulseCtrl - Laptop Helper
 * Background Node.js client using @nut-tree/nut-js.
 * Connects to the local PulseCtrl server via WebSocket, requests a session,
 * and executes native mouse and keyboard events sent from the paired phone.
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { executeEvent } = require('./executor');

const CONFIG_FILE = path.join(__dirname, '..', '.pulse-config.json');

let ws = null;
let currentMode = 'trackpad';
let currentSessionId = null;
let reconnectTimer = null;

// Sequential queue to guarantee in-order execution of rapid mouse/keyboard events
let executionChain = Promise.resolve();

function queueEvent(event, mode) {
  executionChain = executionChain
    .then(() => executeEvent(event, mode))
    .catch((err) => {
      console.error('[Helper Queue Error]:', err.message);
    });
}

/**
 * Determines target server host and port.
 * Prioritizes environment variables, then .pulse-config.json, then defaults to localhost:3000.
 */
function getServerTarget() {
  if (process.env.PULSE_SERVER) {
    return process.env.PULSE_SERVER;
  }

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (config.port) {
        return `localhost:${config.port}`;
      }
    }
  } catch (_) {}

  return 'localhost:3000';
}

let hasOpenedBrowser = false;

function openBrowserOnce(url) {
  if (hasOpenedBrowser) return;
  hasOpenedBrowser = true;
  openBrowser(url);
}

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

function connect(overrideTarget) {
  const serverTarget = overrideTarget || getServerTarget();
  const wsUrl = `ws://${serverTarget}/ws?role=helper`;
  console.log(`[Helper] Connecting to PulseCtrl server at ${wsUrl}...`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log(`[Helper] Connected to PulseCtrl Server on ${serverTarget}!`);
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'session_ready') {
        currentSessionId = msg.sessionId;
        const port = serverTarget.split(':')[1] || '3000';
        const webUrl = `http://localhost:${port}/?session=${msg.sessionId}`;

        console.log('');
        console.log('='.repeat(60));
        console.log('  ⚡ PulseCtrl Helper Ready');
        console.log(`  Session ID: ${msg.sessionId}`);
        console.log(`  Laptop Web: ${webUrl}`);
        console.log(`  Phone URL:  ${msg.phoneUrl}`);
        console.log('='.repeat(60));
        console.log('  Waiting for phone to scan QR code and pair...');
        console.log('');

        // Automatically open the laptop webpage in the browser once on launch
        openBrowserOnce(webUrl);
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
        queueEvent(msg, currentMode);
      }
    } catch (e) {
      console.error('[Helper] Message handling error:', e.message);
    }
  });

  ws.on('close', () => {
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error(`[Helper] Connection error: ${err.message}`);

    // If port 3000 responded with 404 (e.g. hijacked by another app like DevTrack)
    if (err.message.includes('404') && serverTarget === 'localhost:3000') {
      console.warn('[Helper] Port 3000 returned 404 (another app is occupying port 3000).');
      console.warn('[Helper] Probing fallback port 3001...');
      if (ws) {
        ws.terminate();
      }
      setTimeout(() => connect('localhost:3001'), 1000);
      return;
    }

    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
  }, 3000);
}

connect();

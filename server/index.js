/**
 * PulseCtrl Main Server
 * Express + ws WebSocket Server for wireless trackpad and keyboard pairing.
 */

const http = require('http');
const path = require('path');
const os = require('os');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const { SessionManager } = require('./session');
const { validateMessage } = require('./validator');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

/**
 * Detects the first non-internal IPv4 LAN address of the host machine.
 * This is crucial so mobile devices on the same Wi-Fi can reach the laptop.
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sessionManager = new SessionManager();

// Serve static assets from /web directory
const webDir = path.join(__dirname, '..', 'web');
app.use(express.static(webDir));

// Route for laptop UI
app.get('/', (req, res) => {
  res.sendFile(path.join(webDir, 'index.html'));
});

// Route for phone UI
app.get('/phone', (req, res) => {
  res.sendFile(path.join(webDir, 'phone.html'));
});

// Endpoint to fetch network info & server status
app.get('/api/info', (req, res) => {
  const lanIp = getLocalIpAddress();
  res.json({
    lanIp,
    port: PORT,
    localUrl: `http://localhost:${PORT}`,
    lanUrl: `http://${lanIp}:${PORT}`
  });
});

// Endpoint to fetch active session details
app.get('/api/session', async (req, res) => {
  const requestedId = req.query.id;
  const session = requestedId
    ? sessionManager.getSession(requestedId)
    : sessionManager.getLatestActiveSession();

  if (!session) {
    return res.status(404).json({ error: 'No active session found' });
  }

  const lanIp = getLocalIpAddress();
  const phoneUrl = `http://${lanIp}:${PORT}/phone?session=${session.id}&token=${session.token}`;
  const qrDataUrl = await QRCode.toDataURL(phoneUrl, {
    width: 280,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });

  res.json({
    sessionId: session.id,
    token: session.token,
    phoneUrl,
    qrDataUrl,
    status: session.status,
    mode: session.mode
  });
});

/**
 * Generates pairing QR code data URL for a given session.
 */
async function generateQrForSession(sessionId, token) {
  const lanIp = getLocalIpAddress();
  const phoneUrl = `http://${lanIp}:${PORT}/phone?session=${sessionId}&token=${token}`;
  const qrDataUrl = await QRCode.toDataURL(phoneUrl, {
    width: 280,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
  return { phoneUrl, qrDataUrl };
}

// WebSocket connection handling
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const role = url.searchParams.get('role');
  const sessionId = url.searchParams.get('session');
  const token = url.searchParams.get('token');

  const clientIp = req.socket.remoteAddress || '';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  // --- ROLE: LAPTOP HELPER ---
  if (role === 'helper') {
    console.log('[WS] Laptop helper connected from', clientIp);
    const session = sessionManager.createSession(ws);
    const { phoneUrl, qrDataUrl } = await generateQrForSession(session.id, session.token);

    ws.send(JSON.stringify({
      type: 'session_ready',
      sessionId: session.id,
      token: session.token,
      phoneUrl,
      qrDataUrl
    }));

    // If laptop web UI is waiting, notify it immediately
    const waitingLaptopWeb = sessionManager.getLatestActiveSession()?.laptopWebWs;
    if (waitingLaptopWeb && waitingLaptopWeb.readyState === 1) {
      waitingLaptopWeb.send(JSON.stringify({
        type: 'session_info',
        sessionId: session.id,
        token: session.token,
        phoneUrl,
        qrDataUrl,
        status: session.status
      }));
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'disconnect') {
          sessionManager.disconnectSession(session.id, 'helper');
        }
      } catch (e) {
        console.error('[Helper WS] Invalid JSON message:', e.message);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Laptop helper disconnected for session ${session.id}`);
      sessionManager.disconnectSession(session.id, 'helper');
    });

    return;
  }

  // --- ROLE: LAPTOP WEB UI (/) ---
  if (role === 'laptop_web') {
    let session = sessionId
      ? sessionManager.getSession(sessionId)
      : sessionManager.getLatestActiveSession();

    if (session) {
      sessionManager.attachLaptopWeb(session.id, ws);
      const { phoneUrl, qrDataUrl } = await generateQrForSession(session.id, session.token);

      ws.send(JSON.stringify({
        type: 'session_info',
        sessionId: session.id,
        token: session.token,
        phoneUrl,
        qrDataUrl,
        status: session.status,
        mode: session.mode
      }));
    } else {
      // Waiting for helper to register
      ws.send(JSON.stringify({
        type: 'waiting_helper',
        message: 'Waiting for Laptop Helper to connect. Run `npm run helper` on your laptop.'
      }));
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const activeSession = sessionManager.getLatestActiveSession();
        if (!activeSession) return;

        if (msg.type === 'pair_response') {
          const allow = Boolean(msg.allow);
          sessionManager.handleApprovalResponse(activeSession.id, allow);
        } else if (msg.type === 'disconnect') {
          sessionManager.disconnectSession(activeSession.id, 'laptop');
        }
      } catch (e) {
        console.error('[Laptop Web WS] Invalid JSON message:', e.message);
      }
    });

    ws.on('close', () => {
      // Laptop web tab closed
    });

    return;
  }

  // --- ROLE: PHONE UI (/phone) ---
  if (role === 'phone') {
    const validation = sessionManager.validatePhoneJoin(sessionId, token);

    if (!validation.valid) {
      console.warn(`[WS] Phone join rejected (${validation.error}) from ${clientIp}`);
      ws.send(JSON.stringify({
        type: 'error',
        code: 'PAIRING_FAILED',
        message: validation.error
      }));
      ws.close(4001, validation.error);
      return;
    }

    const session = validation.session;
    console.log(`[WS] Phone requesting pairing for session ${session.id} from ${clientIp}`);

    // Initiate "Allow this device?" flow on laptop web
    sessionManager.requestPhoneApproval(session.id, ws, {
      userAgent,
      ip: clientIp
    });

    ws.on('message', (data) => {
      try {
        // Enforce approval check before any control events
        if (session.status !== 'connected' || session.phoneWs !== ws) {
          return;
        }

        // Reset 15-minute inactivity timer
        session.touch((expiredId, reason) => {
          sessionManager.expireSession(expiredId, reason);
        });

        // Enforce rate limiting
        if (!session.rateLimiter.allow()) {
          return; // Drop excessive events to keep connection responsive
        }

        const msg = JSON.parse(data.toString());

        // Validate and sanitize according to message protocol and mode permission
        const result = validateMessage(msg, session.mode);
        if (!result.valid) {
          console.warn(`[WS] Invalid message ignored: ${result.error}`);
          return;
        }

        const sanitized = result.sanitized;

        // Disconnect handling
        if (sanitized.type === 'disconnect') {
          sessionManager.disconnectSession(session.id, 'phone');
          return;
        }

        // Mode switch handling
        if (sanitized.type === 'mode') {
          session.mode = sanitized.value;
          // Notify laptop web UI
          if (session.laptopWebWs && session.laptopWebWs.readyState === 1) {
            session.laptopWebWs.send(JSON.stringify({
              type: 'mode',
              value: session.mode
            }));
          }
          // Notify laptop helper
          if (session.helperWs && session.helperWs.readyState === 1) {
            session.helperWs.send(JSON.stringify({
              type: 'mode',
              value: session.mode
            }));
          }
          return;
        }

        // Relay control events (move, click, scroll, text, key) to helper
        if (session.helperWs && session.helperWs.readyState === 1) {
          session.helperWs.send(JSON.stringify(sanitized));
        }
      } catch (e) {
        console.error('[Phone WS] Invalid JSON message:', e.message);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Phone disconnected for session ${session.id}`);
      if (session.phoneWs === ws) {
        sessionManager.disconnectSession(session.id, 'phone');
      }
    });

    return;
  }

  // Unknown role: reject connection
  ws.send(JSON.stringify({ type: 'error', message: 'Unknown connection role' }));
  ws.close(4000, 'Unknown role');
});

// Only auto-listen if run directly as main script
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const lanIp = getLocalIpAddress();
    console.log('='.repeat(55));
    console.log('  PulseCtrl Server is running!');
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log(`  Network: http://${lanIp}:${PORT}`);
    console.log('='.repeat(55));
  });
}

module.exports = { app, server, sessionManager, getLocalIpAddress };

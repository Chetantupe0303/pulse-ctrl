/**
 * PulseCtrl Main Server
 * Express + ws WebSocket Server for wireless trackpad and keyboard pairing.
 * Features automated session rotation, seamless reconnection, and zero-leakage device pairing.
 */

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const { SessionManager } = require('./session');
const { validateMessage } = require('./validator');

const DEFAULT_PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const CONFIG_FILE = path.join(__dirname, '..', '.pulse-config.json');

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

/**
 * Tests if a specific port is completely free on 127.0.0.1 (not hijacked by another process).
 */
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = http.createServer();
    tester.once('error', () => resolve(false));
    tester.listen(port, '127.0.0.1', () => {
      tester.close(() => resolve(true));
    });
  });
}

/**
 * Finds an available port starting from the desired port.
 */
async function findAvailablePort(startPort) {
  let port = startPort;
  while (port < startPort + 20) {
    const available = await isPortAvailable(port);
    if (available) return port;
    console.warn(`[Server] Port ${port} is occupied by another application. Checking port ${port + 1}...`);
    port++;
  }
  return startPort;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sessionManager = new SessionManager();

// Track current listening port dynamically
let activePort = DEFAULT_PORT;

// Active helper socket reference across session lifecycles
let currentHelperWs = null;
const laptopWebSockets = new Set();
let currentLaptopWebWs = null;
let latestKnownOrigin = null;

function inferOriginFromReq(req) {
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.replace(/\/$/, '');
  }
  if (!req || !req.headers) return null;
  const host = req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (req.socket && req.socket.encrypted ? 'https' : 'http');
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    return `${proto}://${host}`;
  }
  return null;
}

function broadcastToLaptop(payload) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  for (const ws of laptopWebSockets) {
    if (ws.readyState === 1) {
      try {
        ws.send(json);
      } catch (e) {
        console.error('[WS Broadcast Error]:', e.message);
      }
    }
  }
}

sessionManager.broadcastToLaptop = broadcastToLaptop;

// Capture origin for cloud deployments (Railway, Render, Fly.io, custom domains)
app.use((req, res, next) => {
  const detected = inferOriginFromReq(req);
  if (detected) {
    latestKnownOrigin = detected;
  }
  next();
});

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

// Route to download Windows desktop helper installer
app.get('/download/windows', (req, res) => {
  const distDir = path.join(__dirname, '..', 'dist');
  try {
    if (fs.existsSync(distDir)) {
      const files = fs.readdirSync(distDir);
      const exeFile = files.find(f => f.endsWith('.exe') && !f.includes('blockmap'));
      if (exeFile) {
        return res.download(path.join(distDir, exeFile), exeFile);
      }
    }
  } catch (_) {}
  res.status(404).send('Windows installer not found. Build it with `npm run build:win` or check GitHub releases.');
});

// Endpoint to fetch network info & server status
app.get('/api/info', (req, res) => {
  const lanIp = getLocalIpAddress();
  res.json({
    lanIp,
    port: activePort,
    localUrl: `http://localhost:${activePort}`,
    lanUrl: `http://${lanIp}:${activePort}`,
    publicUrl: latestKnownOrigin || `http://${lanIp}:${activePort}`
  });
});

/**
 * Generates pairing QR code data URL for a given session.
 * Supports public cloud deployments (Railway, Render, Fly.io) via PUBLIC_URL or detected origin.
 */
async function generateQrForSession(sessionId, token, customOrigin = null) {
  let origin = process.env.PUBLIC_URL;
  if (!origin) {
    if (customOrigin) {
      origin = customOrigin;
    } else if (latestKnownOrigin) {
      origin = latestKnownOrigin;
    } else {
      const lanIp = getLocalIpAddress();
      origin = `http://${lanIp}:${activePort}`;
    }
  }
  origin = origin.replace(/\/$/, '');

  const phoneUrl = `${origin}/phone?session=${sessionId}&token=${token}`;
  const qrDataUrl = await QRCode.toDataURL(phoneUrl, {
    width: 280,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
  return { phoneUrl, qrDataUrl };
}

// Endpoint to fetch active session details
app.get('/api/session', async (req, res) => {
  let session = sessionManager.getLatestActiveSession();

  // If no active session but helper is connected, provision one immediately
  if (!session && currentHelperWs && currentHelperWs.readyState === 1) {
    session = sessionManager.createSession(currentHelperWs);
  }

  if (!session) {
    return res.status(404).json({ error: 'No active session found' });
  }

  const { phoneUrl, qrDataUrl } = await generateQrForSession(session.id, session.token);

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
 * Handles automatic re-provisioning of fresh QR sessions whenever a device disconnects.
 * This guarantees the laptop always displays a fresh, working QR code immediately upon disconnection.
 */
sessionManager.onSessionDisconnect = async ({ helperWs }) => {
  try {
    const helper = helperWs || currentHelperWs;

    if (helper && helper.readyState === 1) {
      const newSession = sessionManager.createSession(helper);

      for (const laptop of laptopWebSockets) {
        if (laptop.readyState === 1) {
          sessionManager.attachLaptopWeb(newSession.id, laptop);
        }
      }

      const { phoneUrl, qrDataUrl } = await generateQrForSession(newSession.id, newSession.token);

      helper.send(JSON.stringify({
        type: 'session_ready',
        sessionId: newSession.id,
        token: newSession.token,
        phoneUrl,
        qrDataUrl
      }));

      broadcastToLaptop({
        type: 'session_info',
        sessionId: newSession.id,
        token: newSession.token,
        phoneUrl,
        qrDataUrl,
        status: 'waiting'
      });
    }
  } catch (err) {
    console.error('[Server] Error in onSessionDisconnect:', err);
  }
};

// WebSocket connection handling
wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const role = url.searchParams.get('role');
  const sessionId = url.searchParams.get('session');
  const token = url.searchParams.get('token');
  const reconnectToken = url.searchParams.get('reconnect');

  const userAgent = req.headers['user-agent'] || '';

  // --- ROLE: LAPTOP HELPER ---
  if (role === 'helper') {
    console.log('[WS] Laptop helper connected');
    currentHelperWs = ws;
    const session = sessionManager.createSession(ws);
    const { phoneUrl, qrDataUrl } = await generateQrForSession(session.id, session.token);

    ws.send(JSON.stringify({
      type: 'session_ready',
      sessionId: session.id,
      token: session.token,
      phoneUrl,
      qrDataUrl
    }));

    // If laptop web UI is waiting, link and update it immediately
    if (currentLaptopWebWs && currentLaptopWebWs.readyState === 1) {
      sessionManager.attachLaptopWeb(session.id, currentLaptopWebWs);
      currentLaptopWebWs.send(JSON.stringify({
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
      if (currentHelperWs === ws) {
        currentHelperWs = null;
      }
      sessionManager.disconnectSession(session.id, 'helper');
    });

    return;
  }

  // --- ROLE: LAPTOP WEB UI (/) ---
  if (role === 'laptop_web') {
    laptopWebSockets.add(ws);
    currentLaptopWebWs = ws;
    let session = sessionManager.getLatestActiveSession();

    // If helper is active but has no waiting session, create one
    if (!session && currentHelperWs && currentHelperWs.readyState === 1) {
      session = sessionManager.createSession(currentHelperWs);
    }

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
        mode: session.mode,
        deviceName: session.deviceName
      }));
    } else {
      // Waiting for helper to register
      ws.send(JSON.stringify({
        type: 'waiting_helper',
        message: 'Waiting for Laptop Helper. Run `npm run helper` on your laptop.'
      }));
    }

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        let activeSession = sessionManager.getLatestActiveSession();

        if (msg.type === 'pair_response') {
          if (activeSession) {
            const allow = Boolean(msg.allow);
            sessionManager.handleApprovalResponse(activeSession.id, allow);
          }
        } else if (msg.type === 'disconnect') {
          if (activeSession) {
            sessionManager.disconnectSession(activeSession.id, 'laptop');
          }
        } else if (msg.type === 'request_new_qr') {
          // Explicit manual QR refresh requested by laptop user
          if (currentHelperWs && currentHelperWs.readyState === 1) {
            if (activeSession) {
              sessionManager.disconnectSession(activeSession.id, 'laptop');
            } else {
              const fresh = sessionManager.createSession(currentHelperWs);
              for (const lws of laptopWebSockets) {
                if (lws.readyState === 1) {
                  sessionManager.attachLaptopWeb(fresh.id, lws);
                }
              }
              const { phoneUrl, qrDataUrl } = await generateQrForSession(fresh.id, fresh.token);
              broadcastToLaptop({
                type: 'session_info',
                sessionId: fresh.id,
                token: fresh.token,
                phoneUrl,
                qrDataUrl,
                status: 'waiting'
              });
            }
          }
        }
      } catch (e) {
        console.error('[Laptop Web WS] Invalid JSON message:', e.message);
      }
    });

    ws.on('close', () => {
      laptopWebSockets.delete(ws);
      if (currentLaptopWebWs === ws) {
        currentLaptopWebWs = laptopWebSockets.size > 0 ? Array.from(laptopWebSockets)[0] : null;
      }
    });

    return;
  }

  // --- ROLE: PHONE UI (/phone) ---
  if (role === 'phone') {
    // 1. Check for seamless reconnection (e.g. mobile screen was briefly turned off)
    if (reconnectToken) {
      const reconn = sessionManager.validatePhoneReconnect(sessionId, reconnectToken);
      if (reconn.valid) {
        console.log(`[WS] Phone resumed session ${sessionId}`);
        sessionManager.resumePhoneConnection(reconn.session, ws);
        bindPhoneEventHandlers(ws, reconn.session);
        return;
      }
      // If reconnection invalid/expired, notify phone to re-scan
      ws.send(JSON.stringify({
        type: 'expired',
        message: reconn.error || 'Session expired. Please scan the QR code again.'
      }));
      ws.close(4002, 'Reconnection expired');
      return;
    }

    // 2. Initial Join via QR Code token
    const validation = sessionManager.validatePhoneJoin(sessionId, token);

    if (!validation.valid) {
      console.warn(`[WS] Phone join rejected: ${validation.error}`);
      ws.send(JSON.stringify({
        type: 'error',
        code: 'PAIRING_FAILED',
        message: validation.error
      }));
      ws.close(4001, validation.error);
      return;
    }

    const session = validation.session;
    console.log(`[WS] Phone requesting pairing for session ${session.id}`);

    // Initiate clean "Allow this device?" flow (only device name sent)
    sessionManager.requestPhoneApproval(session.id, ws, userAgent);

    bindPhoneEventHandlers(ws, session);
    return;
  }

  // Unknown role: reject connection
  ws.send(JSON.stringify({ type: 'error', message: 'Unknown connection role' }));
  ws.close(4000, 'Unknown role');
});

/**
 * Binds control event listeners for a phone WebSocket.
 */
function bindPhoneEventHandlers(ws, session) {
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
        return;
      }

      const msg = JSON.parse(data.toString());

      // Validate and sanitize according to message protocol and mode permission
      const result = validateMessage(msg, session.mode);
      if (!result.valid) {
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
    console.log(`[WS] Phone socket closed for session ${session.id}`);
    if (session.pendingPhoneWs === ws) {
      session.pendingPhoneWs = null;
    }
    if (session.phoneWs === ws) {
      session.phoneWs = null; // Unbind socket
      // If disconnected without reconnectToken or after grace, trigger disconnect
      setTimeout(() => {
        if (!session.phoneWs && session.status === 'connected') {
          sessionManager.disconnectSession(session.id, 'phone');
        }
      }, 2000); // 2-second grace period for quick network / screen-lock recovery
    }
  });
}

// Auto-start server with intelligent port conflict detection
if (require.main === module) {
  (async () => {
    activePort = await findAvailablePort(DEFAULT_PORT);

    server.listen(activePort, HOST, () => {
      const lanIp = getLocalIpAddress();
      console.log('');
      console.log('='.repeat(55));
      console.log('  ⚡ PulseCtrl Server is running!');
      console.log(`  Local:   http://localhost:${activePort}`);
      console.log(`  Network: http://${lanIp}:${activePort}`);
      console.log('='.repeat(55));
      console.log('');

      // Persist active configuration for helper and client tools
      try {
        fs.writeFileSync(
          CONFIG_FILE,
          JSON.stringify({
            port: activePort,
            lanIp,
            localUrl: `http://localhost:${activePort}`,
            lanUrl: `http://${lanIp}:${activePort}`,
            updatedAt: Date.now()
          }, null, 2),
          'utf8'
        );
      } catch (err) {
        console.warn('[Server] Could not write config file:', err.message);
      }
    });
  })();
}

module.exports = { app, server, sessionManager, getLocalIpAddress };

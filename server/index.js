/** Local HTTP and WebSocket server for PulseCtrl. */

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
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sessionManager = new SessionManager();
let activePort = DEFAULT_PORT;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = http.createServer();
    tester.once('error', () => resolve(false));
    tester.listen(port, '127.0.0.1', () => {
      tester.close(() => resolve(true));
    });
  });
}

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

function getLocalIpAddress() {
  const candidates = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        candidates.push(iface.address);
      }
    }
  }
  return candidates.find((ip) => ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip))
    || candidates[0]
    || '127.0.0.1';
}

async function generateQrForSession(session) {
  const phoneUrl = `http://${getLocalIpAddress()}:${activePort}/phone?session=${encodeURIComponent(session.id)}&token=${encodeURIComponent(session.token)}`;
  const qrDataUrl = await QRCode.toDataURL(phoneUrl, {
    width: 280,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' }
  });
  return { phoneUrl, qrDataUrl };
}

function send(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function isLoopbackAddress(address = '') {
  return address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.');
}

async function publishSession(session) {
  const { phoneUrl, qrDataUrl } = await generateQrForSession(session);
  const payload = {
    sessionId: session.id, token: session.token, phoneUrl, qrDataUrl,
    approvalToken: session.approvalToken,
    status: session.status, mode: session.mode, deviceName: session.deviceName
  };
  send(session.laptopWebWs, { ...payload, type: 'session_info' });
  send(session.helperWs, { ...payload, type: 'session_ready' });
}

function createFreshSession(previous) {
  if (!previous.helperWs || previous.helperWs.readyState !== 1) return;
  const session = sessionManager.createSession(previous.helperWs);
  session.helperWs.sessionId = session.id;
  session.laptopWebWs = previous.laptopWebWs;
  if (session.laptopWebWs && session.laptopWebWs.readyState === 1) {
    session.laptopWebWs.sessionId = session.id;
    session.laptopWebWs.helperWs = session.helperWs;
  }
  publishSession(session).catch((err) => console.error('[Server] Could not create QR:', err));
}

sessionManager.onSessionDisconnect = createFreshSession;

const webDir = path.join(__dirname, '..', 'web');
app.use(express.static(webDir));
app.get('/', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
app.get('/phone', (_req, res) => res.sendFile(path.join(webDir, 'phone.html')));
app.get('/api/info', (_req, res) => {
  const lanIp = getLocalIpAddress();
  res.json({ lanIp, port: activePort, localUrl: `http://localhost:${activePort}`, lanUrl: `http://${lanIp}:${activePort}` });
});

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const role = url.searchParams.get('role');
  const sessionId = url.searchParams.get('session');
  const token = url.searchParams.get('token');
  const reconnectToken = url.searchParams.get('reconnect');

  if (role === 'helper') {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      send(ws, { type: 'error', message: 'The helper can connect only from this laptop.' });
      ws.close(4003, 'Local helper required');
      return;
    }
    const session = sessionManager.createSession(ws);
    ws.sessionId = session.id;
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'disconnect') sessionManager.disconnectSession(ws.sessionId, 'helper');
      } catch (_) {}
    });
    ws.on('close', () => sessionManager.disconnectSession(ws.sessionId, 'helper'));
    await publishSession(session);
    return;
  }

  if (role === 'laptop_web') {
    const session = sessionManager.validateLaptopPage(sessionId, url.searchParams.get('approval'));
    if (!session || session.status === 'disconnected') {
      send(ws, { type: 'waiting_helper', message: 'Open the laptop page from the local helper.' });
      if (sessionId && url.searchParams.has('approval')) ws.close(4001, 'Laptop page authorization failed');
      return;
    } else {
      session.laptopWebWs = ws;
      ws.sessionId = session.id;
      ws.helperWs = session.helperWs;
      await publishSession(session);
    }

    ws.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (_) { return; }
      let active = sessionManager.getSession(ws.sessionId);
      if (!active && msg.type === 'request_new_qr' && ws.helperWs && ws.helperWs.readyState === 1) {
        active = sessionManager.createSession(ws.helperWs);
        active.laptopWebWs = ws;
        ws.sessionId = active.id;
        await publishSession(active);
        return;
      }
      if (!active) return;
      if (msg.type === 'pair_response') {
        sessionManager.handleApprovalResponse(active.id, msg.allow === true);
      } else if (msg.type === 'disconnect' || msg.type === 'request_new_qr') {
        sessionManager.disconnectSession(active.id, 'laptop');
      }
    });

    ws.on('close', () => {
      const active = sessionManager.getSession(ws.sessionId);
      if (active && active.laptopWebWs === ws) active.laptopWebWs = null;
    });
    return;
  }

  if (role === 'phone') {
    let session;
    if (reconnectToken) {
      const result = sessionManager.validatePhoneReconnect(sessionId, reconnectToken);
      if (!result.valid) {
        send(ws, { type: 'expired', message: result.error });
        ws.close(4002, 'Reconnection expired');
        return;
      }
      session = result.session;
      if (session.phoneWs) {
        send(ws, { type: 'error', message: 'A phone is already connected to this session.' });
        ws.close(4001, 'Phone already connected');
        return;
      }
      sessionManager.resumePhoneConnection(session, ws);
    } else {
      const result = sessionManager.validatePhoneJoin(sessionId, token);
      if (!result.valid) {
        send(ws, { type: 'error', code: 'PAIRING_FAILED', message: result.error });
        ws.close(4001, result.error);
        return;
      }
      session = result.session;
      sessionManager.requestPhoneApproval(session.id, ws, req.headers['user-agent'] || '');
    }
    bindPhoneEventHandlers(ws, session);
    return;
  }

  send(ws, { type: 'error', message: 'Unknown connection role' });
  ws.close(4000, 'Unknown role');
});

function bindPhoneEventHandlers(ws, session) {
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (_) { return; }
    if (session.status !== 'connected' || session.phoneWs !== ws) return;
    const result = validateMessage(msg, session.mode);
    if (!result.valid) return;
    session.touch((id, reason) => sessionManager.expireSession(id, reason));
    if (!session.rateLimiter.allow()) return;
    const event = result.sanitized;
    if (event.type === 'disconnect') {
      sessionManager.disconnectSession(session.id, 'phone');
    } else if (event.type === 'mode') {
      session.mode = event.value;
      send(session.laptopWebWs, { type: 'mode', value: session.mode });
      send(session.helperWs, { type: 'mode', value: session.mode });
    } else {
      send(session.helperWs, event);
    }
  });

  ws.on('close', () => {
    if (session.pendingPhoneWs === ws) session.pendingPhoneWs = null;
    if (session.phoneWs === ws) {
      session.phoneWs = null;
      setTimeout(() => {
        if (!session.phoneWs && session.status === 'connected') sessionManager.disconnectSession(session.id, 'phone');
      }, 2000);
    }
  });
}

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

      try {
        fs.writeFileSync(
          path.join(__dirname, '..', '.pulse-config.json'),
          JSON.stringify({
            port: activePort,
            lanIp,
            localUrl: `http://localhost:${activePort}`,
            lanUrl: `http://${lanIp}:${activePort}`,
            updatedAt: Date.now()
          }, null, 2),
          'utf8'
        );
      } catch (_) {}
    });
  })();
}

module.exports = { app, server, sessionManager, getLocalIpAddress, generateQrForSession };

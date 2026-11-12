/**
 * PulseCtrl Helper Client
 * Manages WebSocket connection to PulseCtrl server, dispatches incoming
 * input events to nut-js executor, and handles pairing approvals and session lifecycle.
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { executeEvent } = require('./executor');

const DEFAULT_CLOUD_TARGET = 'pulse-ctrl.onrender.com';

class PulseHelperClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.ws = null;
    this.laptopWebWs = null;
    this.currentMode = 'trackpad';
    this.currentSessionId = null;
    this.currentSession = null;
    this.reconnectTimer = null;
    this.isDestroyed = false;
    this.executionChain = Promise.resolve();
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'paired'
    this.target = null;
    this.resolvedUrls = null;

    // Config paths
    this.configPath = options.configPath || path.join(__dirname, '..', '.pulse-config.json');
    this.savedTargetPath = options.savedTargetPath || path.join(__dirname, '..', '.pulse-target.txt');
  }

  /**
   * Resolves target server hostname/URL according to priority:
   * 1. Explicit override passed to method
   * 2. CLI arguments (--server=... or -s ...)
   * 3. Environment variable (PULSE_SERVER)
   * 4. Saved target file (.pulse-target.txt)
   * 5. Local config file (.pulse-config.json)
   * 6. Default cloud target (pulse-ctrl.onrender.com)
   */
  resolveTarget(overrideTarget) {
    if (overrideTarget) {
      this.saveTarget(overrideTarget);
      return overrideTarget;
    }

    // 1. CLI arguments
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg.startsWith('--server=')) {
        const target = arg.slice(9).trim();
        this.saveTarget(target);
        return target;
      }
      if ((arg === '--server' || arg === '-s') && process.argv[i + 1]) {
        const target = process.argv[i + 1].trim();
        this.saveTarget(target);
        return target;
      }
    }

    // 2. Environment variable
    if (process.env.PULSE_SERVER) {
      const target = process.env.PULSE_SERVER.trim();
      this.saveTarget(target);
      return target;
    }

    // 3. Saved cloud target from previous run
    try {
      if (fs.existsSync(this.savedTargetPath)) {
        const saved = fs.readFileSync(this.savedTargetPath, 'utf8').trim();
        if (saved) return saved;
      }
    } catch (_) {}

    // 4. Local dev auto-detected port from config
    try {
      if (fs.existsSync(this.configPath)) {
        const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        if (config.port) {
          return `localhost:${config.port}`;
        }
      }
    } catch (_) {}

    // 5. Default cloud target
    return DEFAULT_CLOUD_TARGET;
  }

  saveTarget(target) {
    try {
      if (target && !target.includes('localhost') && !target.includes('127.0.0.1')) {
        fs.writeFileSync(this.savedTargetPath, target.trim(), 'utf8');
      }
    } catch (_) {}
  }

  /**
   * Resolves ws/wss and http/https protocols based on the target.
   */
  resolveUrls(target) {
    let cleaned = (target || DEFAULT_CLOUD_TARGET).trim();
    let isSecure = false;

    if (cleaned.startsWith('https://') || cleaned.startsWith('wss://')) {
      isSecure = true;
      cleaned = cleaned.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
    } else if (cleaned.startsWith('http://') || cleaned.startsWith('ws://')) {
      isSecure = false;
      cleaned = cleaned.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
    } else {
      if (!cleaned.startsWith('localhost') && !cleaned.startsWith('127.0.0.1') && !/^\d+\.\d+\.\d+\.\d+/.test(cleaned)) {
        isSecure = true;
      }
    }

    cleaned = cleaned.replace(/\/+$/, '');

    const wsProto = isSecure ? 'wss:' : 'ws:';
    const httpProto = isSecure ? 'https:' : 'http:';

    return {
      wsUrl: `${wsProto}//${cleaned}/ws?role=helper`,
      laptopWebWsUrl: `${wsProto}//${cleaned}/ws?role=laptop_web`,
      getWebUrl: (sessionId) => `${httpProto}//${cleaned}/?session=${sessionId}`,
      displayTarget: cleaned,
      isSecure
    };
  }

  /**
   * Sequential queue ensuring in-order execution of rapid input events
   */
  queueEvent(event, mode) {
    this.executionChain = this.executionChain
      .then(() => executeEvent(event, mode))
      .catch((err) => {
        console.error('[Helper Queue Error]:', err.message);
      });
  }

  /**
   * Connects to the PulseCtrl server
   */
  connect(overrideTarget) {
    if (this.isDestroyed) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate();
      } catch (_) {}
      this.ws = null;
    }

    this.target = this.resolveTarget(overrideTarget);
    this.resolvedUrls = this.resolveUrls(this.target);
    this.status = 'connecting';
    this.emit('status', { status: 'connecting', target: this.resolvedUrls.displayTarget });

    console.log(`[Helper] Connecting to PulseCtrl server at ${this.resolvedUrls.wsUrl}...`);

    try {
      this.ws = new WebSocket(this.resolvedUrls.wsUrl);
    } catch (err) {
      this.handleConnectionFailure(err);
      return;
    }

    this.ws.on('open', () => {
      this.status = 'connected';
      console.log(`[Helper] Connected to PulseCtrl Server on ${this.resolvedUrls.displayTarget}!`);
      this.emit('connected', { target: this.resolvedUrls.displayTarget });
      this.emit('status', { status: 'connected', target: this.resolvedUrls.displayTarget });
    });

    this.ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch (e) {
        console.error('[Helper] Message handling error:', e.message);
      }
    });

    this.ws.on('close', () => {
      console.log('[Helper] Connection closed.');
      this.status = 'disconnected';
      this.emit('disconnected');
      this.emit('status', { status: 'disconnected' });
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error(`[Helper] Connection error: ${err.message}`);
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
      this.handleConnectionFailure(err);
    });
  }

  /**
   * Connects to companion role=laptop_web socket to receive "Allow this device?"
   * approval requests and send approval/denial responses.
   */
  connectLaptopControl(sessionId) {
    if (this.laptopWebWs) {
      try {
        this.laptopWebWs.removeAllListeners();
        this.laptopWebWs.terminate();
      } catch (_) {}
      this.laptopWebWs = null;
    }

    const laptopWsUrl = `${this.resolvedUrls.laptopWebWsUrl}&session=${encodeURIComponent(sessionId || '')}`;
    try {
      this.laptopWebWs = new WebSocket(laptopWsUrl);
    } catch (_) {
      return;
    }

    this.laptopWebWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'pair_request') {
          console.log(`[Helper] Received pairing approval request from ${msg.deviceName}`);
          this.emit('pair_request', {
            sessionId: msg.sessionId,
            deviceName: msg.deviceName || 'Mobile Device'
          });
        } else if (msg.type === 'session_info') {
          if (msg.qrDataUrl) {
            this.currentSession = {
              ...this.currentSession,
              sessionId: msg.sessionId,
              qrDataUrl: msg.qrDataUrl,
              phoneUrl: msg.phoneUrl,
              status: msg.status,
              deviceName: msg.deviceName,
              mode: msg.mode
            };
            this.emit('session_ready', {
              sessionId: msg.sessionId,
              token: msg.token,
              phoneUrl: msg.phoneUrl,
              qrDataUrl: msg.qrDataUrl,
              webUrl: this.resolvedUrls.getWebUrl(msg.sessionId)
            });
          }
          if (msg.status === 'connected') {
            this.status = 'paired';
            this.emit('paired', {
              mode: msg.mode || this.currentMode,
              sessionId: msg.sessionId,
              deviceName: msg.deviceName
            });
            this.emit('status', { status: 'paired', deviceName: msg.deviceName, mode: msg.mode });
          }
        } else if (msg.type === 'status') {
          if (msg.status === 'connected') {
            this.status = 'paired';
            this.emit('paired', {
              mode: msg.mode || this.currentMode,
              sessionId: this.currentSessionId,
              deviceName: msg.deviceName
            });
            this.emit('status', { status: 'paired', deviceName: msg.deviceName, mode: msg.mode });
          } else if (msg.status === 'waiting') {
            this.status = 'connected';
            this.emit('status', { status: 'connected' });
          }
        }
      } catch (err) {
        console.error('[Helper Laptop WS Error]:', err.message);
      }
    });

    this.laptopWebWs.on('error', () => {});
    this.laptopWebWs.on('close', () => {
      this.laptopWebWs = null;
    });
  }

  handleMessage(msg) {
    if (msg.type === 'session_ready') {
      this.currentSessionId = msg.sessionId;
      this.currentSession = msg;
      const webUrl = this.resolvedUrls.getWebUrl(msg.sessionId);

      this.connectLaptopControl(msg.sessionId);

      this.emit('session_ready', {
        sessionId: msg.sessionId,
        token: msg.token,
        phoneUrl: msg.phoneUrl,
        qrDataUrl: msg.qrDataUrl,
        webUrl
      });
    } else if (msg.type === 'paired') {
      this.currentMode = msg.mode || 'trackpad';
      this.status = 'paired';
      console.log(`[Helper] Phone paired successfully! Mode: ${this.currentMode.toUpperCase()}`);
      this.emit('paired', {
        mode: this.currentMode,
        sessionId: msg.sessionId,
        deviceName: msg.deviceName
      });
      this.emit('status', { status: 'paired', deviceName: msg.deviceName, mode: this.currentMode });
    } else if (msg.type === 'mode') {
      this.currentMode = msg.value;
      console.log(`[Helper] Switched to mode: ${this.currentMode.toUpperCase()}`);
      this.emit('mode', this.currentMode);
    } else if (msg.type === 'status') {
      console.log(`[Helper] Status: ${msg.status} ${msg.message ? `(${msg.message})` : ''}`);
      this.emit('server_status', msg);
    } else if (msg.type === 'disconnect') {
      console.log('[Helper] Phone disconnected.');
      this.status = 'connected';
      this.emit('phone_disconnected');
      this.emit('status', { status: 'connected' });
    } else if (msg.type === 'expired') {
      console.warn(`[Helper] Session expired: ${msg.message}`);
      this.emit('expired', msg);
    } else {
      // Input event: move, click, scroll, text, key
      this.queueEvent(msg, this.currentMode);
    }
  }

  handleConnectionFailure(err) {
    if (err && err.message && err.message.includes('404') && this.target === 'localhost:3000') {
      console.warn('[Helper] Port 3000 returned 404. Probing fallback port 3001...');
      if (this.ws) {
        try { this.ws.terminate(); } catch (_) {}
      }
      setTimeout(() => this.connect('localhost:3001'), 1000);
      return;
    }
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.isDestroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, 3000);
  }

  respondPairApproval(allow) {
    if (this.laptopWebWs && this.laptopWebWs.readyState === WebSocket.OPEN) {
      this.laptopWebWs.send(JSON.stringify({
        type: 'pair_response',
        allow: Boolean(allow)
      }));
    }
  }

  requestNewQr() {
    if (this.laptopWebWs && this.laptopWebWs.readyState === WebSocket.OPEN) {
      this.laptopWebWs.send(JSON.stringify({ type: 'request_new_qr' }));
    } else {
      this.connect();
    }
  }

  disconnectSession() {
    if (this.laptopWebWs && this.laptopWebWs.readyState === WebSocket.OPEN) {
      this.laptopWebWs.send(JSON.stringify({ type: 'disconnect' }));
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'disconnect' }));
      } catch (_) {}
    }
  }

  destroy() {
    this.isDestroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.laptopWebWs) {
      try {
        this.laptopWebWs.removeAllListeners();
        this.laptopWebWs.terminate();
      } catch (_) {}
      this.laptopWebWs = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.terminate();
      } catch (_) {}
      this.ws = null;
    }
    this.status = 'disconnected';
    this.removeAllListeners();
  }
}

module.exports = {
  PulseHelperClient,
  DEFAULT_CLOUD_TARGET
};

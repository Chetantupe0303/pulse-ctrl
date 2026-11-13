/**
 * PulseCtrl Session Manager
 * Handles session lifecycle, unguessable one-time tokens, seamless reconnections,
 * single-pairing constraints, and 2-min unpaired / 15-min inactivity timeouts.
 */

const crypto = require('crypto');
const RateLimiter = require('./rateLimiter');

// Timeout configurations as specified
const UNPAIRED_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes if not paired
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes of inactivity once paired

/**
 * Extracts a friendly, privacy-preserving device name from the User-Agent.
 * Prevents leaking technical internal details.
 * @param {string} userAgent
 * @returns {string}
 */
function parseDeviceName(userAgent = '') {
  const ua = (userAgent || '').toLowerCase();
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('android')) {
    return ua.includes('tablet') ? 'Android Tablet' : 'Android Phone';
  }
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'Mac';
  if (ua.includes('windows')) return 'Windows Device';
  if (ua.includes('linux')) return 'Linux Device';
  return 'Mobile Device';
}

class Session {
  constructor(sessionId, token) {
    this.id = sessionId;
    this.token = token; // One-time pairing token
    this.approvalToken = crypto.randomBytes(32).toString('hex');
    this.tokenUsed = false;
    this.reconnectToken = null; // Secret token issued upon pairing to allow seamless reconnection

    this.helperWs = null;
    this.laptopWebWs = null;
    this.phoneWs = null;
    this.pendingPhoneWs = null;

    this.status = 'waiting'; // 'waiting' | 'pending_approval' | 'connected' | 'disconnected'
    this.mode = 'trackpad'; // 'trackpad' | 'keyboard' | 'both'
    this.deviceName = 'Mobile Device';

    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.rateLimiter = new RateLimiter(120, 80);

    this.unpairedTimer = null;
    this.inactivityTimer = null;
  }

  /**
   * Resets the 15-minute inactivity timer.
   * @param {Function} onExpire Callback when session expires from inactivity
   */
  touch(onExpire) {
    this.lastActivity = Date.now();
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
    if (this.status === 'connected') {
      this.inactivityTimer = setTimeout(() => {
        if (typeof onExpire === 'function') {
          onExpire(this.id, 'Session expired due to 15 minutes of inactivity');
        }
      }, INACTIVITY_TIMEOUT_MS);
    }
  }

  /**
   * Starts the 2-minute unpaired timer.
   * @param {Function} onExpire Callback when session expires unpaired
   */
  startUnpairedTimer(onExpire) {
    if (this.unpairedTimer) {
      clearTimeout(this.unpairedTimer);
    }
    this.unpairedTimer = setTimeout(() => {
      if (this.status === 'waiting' || this.status === 'pending_approval') {
        if (typeof onExpire === 'function') {
          onExpire(this.id, 'Session expired after 2 minutes without pairing');
        }
      }
    }, UNPAIRED_TIMEOUT_MS);
  }

  clearTimers() {
    if (this.unpairedTimer) {
      clearTimeout(this.unpairedTimer);
      this.unpairedTimer = null;
    }
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}

class SessionManager {
  constructor() {
    /** @type {Map<string, Session>} */
    this.sessions = new Map();
    /** Callback invoked after a session ends. */
    this.onSessionDisconnect = null;
  }

  /**
   * Generates a cryptographically strong random session ID and one-time token.
   * @returns {{ sessionId: string, token: string }}
   */
  generateCredentials() {
    const sessionId = crypto.randomBytes(8).toString('hex');
    const token = crypto.randomBytes(16).toString('hex');
    return { sessionId, token };
  }

  /**
   * Creates a new session bound to a helper WebSocket.
   * @param {WebSocket} helperWs
   * @returns {Session}
   */
  createSession(helperWs) {
    const { sessionId, token } = this.generateCredentials();
    const session = new Session(sessionId, token);
    session.helperWs = helperWs;

    this.sessions.set(sessionId, session);

    // Start 2-minute unpaired expiration timer
    session.startUnpairedTimer((expiredId, reason) => {
      this.expireSession(expiredId, reason);
    });

    return session;
  }

  /**
   * Retrieves an existing session by ID.
   * @param {string} sessionId
   * @returns {Session|null}
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  validateLaptopPage(sessionId, approvalToken) {
    const session = this.getSession(sessionId);
    if (!session || !approvalToken) return null;
    const expected = Buffer.from(session.approvalToken, 'utf8');
    const provided = Buffer.from(approvalToken, 'utf8');
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;
    return session;
  }

  /**
   * Attaches the laptop web browser to an existing session.
   * @param {string} sessionId
   * @param {WebSocket} ws
   * @returns {boolean}
   */
  attachLaptopWeb(sessionId, ws) {
    const session = this.getSession(sessionId);
    if (!session) return false;
    session.laptopWebWs = ws;
    return true;
  }

  /**
   * Validates pairing credentials for a phone attempting to join via initial QR scan.
   * @param {string} sessionId
   * @param {string} token
   * @returns {{ valid: boolean, error?: string, session?: Session }}
   */
  validatePhoneJoin(sessionId, token) {
    if (!sessionId || !token) {
      return { valid: false, error: 'Missing session ID or pairing token' };
    }

    const session = this.getSession(sessionId);
    if (!session) {
      return { valid: false, error: 'Session not found or expired. Please scan the new QR code.' };
    }

    if (session.status === 'disconnected') {
      return { valid: false, error: 'Session has ended. Please scan the new QR code.' };
    }

    if (session.tokenUsed || session.pendingPhoneWs || session.phoneWs) {
      return { valid: false, error: 'Pairing token has already been used. Please scan the new QR code.' };
    }

    // Constant-time token comparison to avoid timing attacks
    const expected = Buffer.from(session.token, 'utf8');
    const provided = Buffer.from(token, 'utf8');
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      return { valid: false, error: 'Invalid pairing token' };
    }

    if (session.phoneWs !== null) {
      return { valid: false, error: 'A phone is already paired with this laptop' };
    }

    return { valid: true, session };
  }

  /**
   * Validates reconnection attempt for a previously paired phone (e.g. after transient network drop).
   * @param {string} sessionId
   * @param {string} reconnectToken
   * @returns {{ valid: boolean, error?: string, session?: Session }}
   */
  validatePhoneReconnect(sessionId, reconnectToken) {
    if (!sessionId || !reconnectToken) {
      return { valid: false, error: 'Missing reconnection credentials' };
    }

    const session = this.getSession(sessionId);
    if (!session || session.status === 'disconnected') {
      return { valid: false, error: 'Session expired or closed. Please scan again.' };
    }

    const expected = Buffer.from(session.reconnectToken || '', 'utf8');
    const provided = Buffer.from(reconnectToken, 'utf8');
    if (!session.reconnectToken || expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      return { valid: false, error: 'Invalid reconnection token. Please scan again.' };
    }

    return { valid: true, session };
  }

  /**
   * Handles the phone join request and notifies laptop web UI for approval.
   * Only the device name is shared (no IP, no laptop info).
   * @param {string} sessionId
   * @param {WebSocket} phoneWs
   * @param {string} userAgent
   */
  requestPhoneApproval(sessionId, phoneWs, userAgent = '') {
    const session = this.getSession(sessionId);
    if (!session) return;

    const deviceName = parseDeviceName(userAgent);
    session.deviceName = deviceName;

    // Claim the one-time QR token as soon as the phone asks for approval.
    session.tokenUsed = true;
    session.pendingPhoneWs = phoneWs;
    session.status = 'pending_approval';

    // Notify only the laptop page bound to this session.
    const pairRequestMsg = JSON.stringify({
      type: 'pair_request',
      sessionId: session.id,
      deviceName: deviceName
    });

    if (session.laptopWebWs && session.laptopWebWs.readyState === 1) {
      session.laptopWebWs.send(pairRequestMsg);
    }

    // Notify phone that it is awaiting laptop confirmation
    if (phoneWs && phoneWs.readyState === 1) {
      phoneWs.send(JSON.stringify({
        type: 'waiting_approval',
        message: 'Waiting for laptop approval...'
      }));
    }
  }

  /**
   * Processes the laptop user's Allow / Deny response.
   * @param {string} sessionId
   * @param {boolean} allow
   */
  handleApprovalResponse(sessionId, allow) {
    const session = this.getSession(sessionId);
    if (!session || session.status !== 'pending_approval' || !session.pendingPhoneWs) return;

    const phoneWs = session.pendingPhoneWs;

    if (!allow) {
      // Denied
      session.pendingPhoneWs = null;
      session.status = 'disconnected';

      if (phoneWs && phoneWs.readyState === 1) {
        phoneWs.send(JSON.stringify({
          type: 'denied',
          message: 'Connection was denied by the laptop.'
        }));
        phoneWs.close(4003, 'Denied by laptop');
      }

      if (session.laptopWebWs && session.laptopWebWs.readyState === 1) {
        session.laptopWebWs.send(JSON.stringify({ type: 'status', status: 'disconnected', message: 'Device connection denied' }));
      }
      session.clearTimers();
      this.sessions.delete(session.id);
      if (typeof this.onSessionDisconnect === 'function') this.onSessionDisconnect(session);
      return;
    }

    // Approved: complete pairing
    session.tokenUsed = true; // One-time token consumed
    session.reconnectToken = crypto.randomBytes(16).toString('hex'); // Create secret reconnect token
    session.phoneWs = phoneWs;
    session.pendingPhoneWs = null;
    session.status = 'connected';

    // Clear the 2-minute unpaired timer
    if (session.unpairedTimer) {
      clearTimeout(session.unpairedTimer);
      session.unpairedTimer = null;
    }

    // Start 15-minute inactivity timer
    session.touch((expiredId, reason) => {
      this.expireSession(expiredId, reason);
    });

    // Notify phone
    if (session.phoneWs && session.phoneWs.readyState === 1) {
      session.phoneWs.send(JSON.stringify({
        type: 'paired',
        mode: session.mode,
        sessionId: session.id,
        reconnectToken: session.reconnectToken,
        message: 'Connected to laptop'
      }));
    }

    // Notify only the laptop page bound to this session.
    const connectedMsg = JSON.stringify({
      type: 'status',
      status: 'connected',
      mode: session.mode,
      deviceName: session.deviceName
    });
    if (session.laptopWebWs && session.laptopWebWs.readyState === 1) {
      session.laptopWebWs.send(connectedMsg);
    }

    // Notify laptop helper
    if (session.helperWs && session.helperWs.readyState === 1) {
      session.helperWs.send(JSON.stringify({
        type: 'paired',
        mode: session.mode,
        sessionId: session.id,
        deviceName: session.deviceName
      }));
    }
  }

  /**
   * Resumes connection for a previously paired phone using reconnect token.
   * @param {Session} session
   * @param {WebSocket} phoneWs
   */
  resumePhoneConnection(session, phoneWs) {
    // Rotate the reconnect credential so the credential just used cannot be reused.
    session.reconnectToken = crypto.randomBytes(16).toString('hex');
    session.phoneWs = phoneWs;
    session.status = 'connected';

    session.touch((expiredId, reason) => {
      this.expireSession(expiredId, reason);
    });

    if (phoneWs && phoneWs.readyState === 1) {
      phoneWs.send(JSON.stringify({
        type: 'paired',
        mode: session.mode,
        sessionId: session.id,
        reconnectToken: session.reconnectToken,
        resumed: true,
        message: 'Reconnected'
      }));
    }

    const resumedMsg = JSON.stringify({
      type: 'status',
      status: 'connected',
      mode: session.mode,
      deviceName: session.deviceName
    });
    if (session.laptopWebWs && session.laptopWebWs.readyState === 1) {
      session.laptopWebWs.send(resumedMsg);
    }
  }

  /**
   * Terminates and cleans up an expired session.
   * @param {string} sessionId
   * @param {string} reason
   */
  expireSession(sessionId, reason) {
    const session = this.getSession(sessionId);
    if (!session) return;

    session.clearTimers();
    session.status = 'disconnected';

    const expireMsg = JSON.stringify({ type: 'expired', message: reason });

    if (session.phoneWs && session.phoneWs.readyState === 1) {
      session.phoneWs.send(expireMsg);
      session.phoneWs.close(4001, reason);
    }
    if (session.pendingPhoneWs && session.pendingPhoneWs.readyState === 1) {
      session.pendingPhoneWs.send(expireMsg);
      session.pendingPhoneWs.close(4001, reason);
    }

    if (session.laptopWebWs && session.laptopWebWs.readyState === 1) {
      session.laptopWebWs.send(expireMsg);
    }

    const helperWs = session.helperWs;
    const laptopWebWs = session.laptopWebWs;

    this.sessions.delete(sessionId);

    // Trigger auto-reset so a new QR is ready immediately
    if (typeof this.onSessionDisconnect === 'function') {
      this.onSessionDisconnect({ helperWs, laptopWebWs, reason });
    }
  }

  /**
   * Explicit disconnection initiated by either party.
   * Immediately resets so a new QR code can be scanned right away.
   * @param {string} sessionId
   * @param {string} initiatedBy 'laptop' | 'phone' | 'helper'
   */
  disconnectSession(sessionId, initiatedBy = 'user') {
    const session = this.getSession(sessionId);
    if (!session) return;

    session.clearTimers();
    session.status = 'disconnected';

    const disconnectMsg = JSON.stringify({
      type: 'status',
      status: 'disconnected',
      message: `Disconnected by ${initiatedBy}`
    });

    if (session.phoneWs && session.phoneWs.readyState === 1) {
      session.phoneWs.send(disconnectMsg);
      session.phoneWs.close(1000, `Disconnected by ${initiatedBy}`);
    }
    if (session.pendingPhoneWs && session.pendingPhoneWs.readyState === 1) {
      session.pendingPhoneWs.close(1000, `Disconnected by ${initiatedBy}`);
    }

    if (session.laptopWebWs && session.laptopWebWs.readyState === 1) {
      session.laptopWebWs.send(disconnectMsg);
    }

    const helperWs = session.helperWs;
    const laptopWebWs = session.laptopWebWs;

    this.sessions.delete(sessionId);

    // Trigger auto-reset callback
    if (typeof this.onSessionDisconnect === 'function') {
      this.onSessionDisconnect({ helperWs, laptopWebWs, reason: `Disconnected by ${initiatedBy}` });
    }
  }
}

module.exports = {
  Session,
  SessionManager,
  parseDeviceName,
  UNPAIRED_TIMEOUT_MS,
  INACTIVITY_TIMEOUT_MS
};

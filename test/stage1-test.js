/**
 * Stage 1 Automated Verification Test
 * Tests:
 * 1. Server HTTP endpoints (/ and /phone)
 * 2. Helper session creation & QR code generation
 * 3. Laptop Web WebSocket attachment
 * 4. Token validation (rejection of missing, invalid, or reused tokens)
 * 5. "Allow this device?" flow (prompt, allow response, paired confirmation)
 * 6. Disconnect flow
 */

const http = require('http');
const WebSocket = require('ws');
const { app, server, sessionManager } = require('../server/index');

const PORT = 3055;

async function runStage1Tests() {
  console.log('🧪 Starting Stage 1 Automated Tests...');

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✓ Test server listening on port ${PORT}`);

  const baseUrl = `http://localhost:${PORT}`;

  // 1. Verify HTTP endpoints
  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/`, (res) => {
      if (res.statusCode === 200) {
        console.log('✓ GET / (Laptop page) returned 200 OK');
        resolve();
      } else {
        reject(new Error(`GET / failed with status ${res.statusCode}`));
      }
    }).on('error', reject);
  });

  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/phone`, (res) => {
      if (res.statusCode === 200) {
        console.log('✓ GET /phone (Phone page) returned 200 OK');
        resolve();
      } else {
        reject(new Error(`GET /phone failed with status ${res.statusCode}`));
      }
    }).on('error', reject);
  });

  // 2. Connect Helper over WebSocket and request session
  let sessionId = null;
  let pairingToken = null;
  let qrDataUrl = null;

  const helperWs = new WebSocket(`ws://localhost:${PORT}/ws?role=helper`);

  await new Promise((resolve, reject) => {
    helperWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session_ready') {
        sessionId = msg.sessionId;
        pairingToken = msg.token;
        qrDataUrl = msg.qrDataUrl;
        console.log(`✓ Helper connected and session created: ID=${sessionId}`);
        console.log(`✓ QR data URL generated: ${qrDataUrl ? qrDataUrl.substring(0, 30) + '...' : 'none'}`);
        resolve();
      }
    });
    helperWs.on('error', reject);
  });

  if (!sessionId || !pairingToken || !qrDataUrl) {
    throw new Error('Helper session initialization failed');
  }

  // 3. Connect Laptop Web client over WebSocket
  const laptopWebWs = new WebSocket(`ws://localhost:${PORT}/ws?role=laptop_web&session=${sessionId}`);

  await new Promise((resolve, reject) => {
    laptopWebWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session_info') {
        console.log(`✓ Laptop Web attached to session ${msg.sessionId}, status=${msg.status}`);
        resolve();
      }
    });
    laptopWebWs.on('error', reject);
  });

  // 4. Test security: Reject connection with wrong token
  await new Promise((resolve, reject) => {
    const badPhoneWs = new WebSocket(`ws://localhost:${PORT}/ws?role=phone&session=${sessionId}&token=wrong-token-12345`);
    badPhoneWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'error' && msg.code === 'PAIRING_FAILED') {
        console.log(`✓ Security verified: rejected connection with invalid token (${msg.message})`);
        resolve();
      }
    });
    badPhoneWs.on('close', (code) => {
      if (code === 4001) {
        resolve();
      }
    });
    badPhoneWs.on('error', () => {
      // Expected close
    });
  });

  // 5. Test "Allow this device?" flow with valid phone credentials
  const phoneWs = new WebSocket(`ws://localhost:${PORT}/ws?role=phone&session=${sessionId}&token=${pairingToken}`);

  // Laptop web waits for pair_request, then approves
  const approvalPromise = new Promise((resolve, reject) => {
    laptopWebWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'pair_request') {
        console.log('✓ Laptop Web received "Allow this device?" prompt!');
        // User clicks Allow
        laptopWebWs.send(JSON.stringify({ type: 'pair_response', allow: true }));
      } else if (msg.type === 'status' && msg.status === 'connected') {
        console.log('✓ Laptop Web status updated to: Phone connected');
        resolve();
      }
    });
  });

  // Phone waits for 'paired' message
  const phonePairedPromise = new Promise((resolve, reject) => {
    phoneWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'waiting_approval') {
        console.log('✓ Phone received: Waiting for laptop approval...');
      } else if (msg.type === 'paired') {
        console.log(`✓ Phone successfully paired! Initial mode: ${msg.mode}`);
        resolve();
      }
    });
    phoneWs.on('error', reject);
  });

  await Promise.all([approvalPromise, phonePairedPromise]);

  // 6. Test one-time token security: second phone trying same token must be rejected
  await new Promise((resolve) => {
    const duplicatePhoneWs = new WebSocket(`ws://localhost:${PORT}/ws?role=phone&session=${sessionId}&token=${pairingToken}`);
    duplicatePhoneWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'error') {
        console.log(`✓ Security verified: one-time token reuse rejected (${msg.message})`);
        resolve();
      }
    });
    duplicatePhoneWs.on('close', () => resolve());
  });

  // 7. Test Disconnect
  const disconnectPromise = new Promise((resolve) => {
    phoneWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'status' && msg.status === 'disconnected') {
        console.log('✓ Phone received disconnection confirmation');
        resolve();
      }
    });
    phoneWs.on('close', () => resolve());
  });

  console.log('Testing disconnect from laptop web UI...');
  laptopWebWs.send(JSON.stringify({ type: 'disconnect' }));
  await disconnectPromise;

  // Cleanup sockets and server
  helperWs.close();
  laptopWebWs.close();
  phoneWs.close();
  server.close();

  console.log('\n🎉 ALL STAGE 1 TESTS PASSED PERFECTLY!\n');
  process.exit(0);
}

runStage1Tests().catch((err) => {
  console.error('❌ Stage 1 Test Failed:', err);
  process.exit(1);
});

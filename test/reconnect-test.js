/**
 * PulseCtrl Reconnect & Auto-Reset Lifecycle Test
 */

const WebSocket = require('ws');
const { server, sessionManager } = require('../server/index');

async function runReconnectTests() {
  console.log('🧪 Starting Reconnect & Lifecycle Tests...\n');

  await new Promise((resolve) => server.listen(0, resolve));
  const TEST_PORT = server.address().port;
  console.log(`[1] Server listening on dynamic port ${TEST_PORT}`);

  // Connect helper
  const helperWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws?role=helper`);
  let initialSessionId = null;
  let initialToken = null;

  await new Promise((resolve) => {
    const onHelperMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session_ready') {
        initialSessionId = msg.sessionId;
        initialToken = msg.token;
        helperWs.removeListener('message', onHelperMsg);
        resolve();
      }
    };
    helperWs.on('message', onHelperMsg);
  });
  console.log(`[2] Helper registered initial session: ${initialSessionId}`);

  // Connect laptop web
  const laptopWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws?role=laptop_web`);
  await new Promise((resolve) => {
    laptopWs.once('message', (data) => {
      resolve();
    });
  });
  console.log('[3] Laptop Web attached to session');

  // Connect phone with iPhone User-Agent
  const phoneWs1 = new WebSocket(
    `ws://localhost:${TEST_PORT}/ws?role=phone&session=${initialSessionId}&token=${initialToken}`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X)' } }
  );

  let phoneReconnectToken = null;

  // Prepare promises concurrently BEFORE approval is sent
  const laptopApprovalPromise = new Promise((resolve) => {
    const onMessage = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'pair_request') {
        console.log(`[4] Laptop received pair_request with deviceName="${msg.deviceName}"`);
        if (msg.deviceName === 'iPhone' && !msg.device?.ip) {
          console.log('✓ Privacy verified: Device name is "iPhone", zero IP/laptop info sent');
        }
        laptopWs.send(JSON.stringify({ type: 'pair_response', allow: true }));
      } else if (msg.type === 'status' && msg.status === 'connected') {
        laptopWs.removeListener('message', onMessage);
        resolve();
      }
    };
    laptopWs.on('message', onMessage);
  });

  const phonePairedPromise = new Promise((resolve) => {
    phoneWs1.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'paired') {
        phoneReconnectToken = msg.reconnectToken;
        console.log(`[5] Phone paired and received reconnectToken: ${phoneReconnectToken.substring(0, 8)}...`);
        resolve();
      }
    });
  });

  await Promise.all([laptopApprovalPromise, phonePairedPromise]);

  // TEST AUTO-RESET: Disconnect phone -> Server must immediately provision fresh session and QR for laptop
  console.log('\n--- Testing Auto-Reset on Disconnect ---');

  const newQrPromise = new Promise((resolve) => {
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session_info' && msg.status === 'waiting' && msg.sessionId !== initialSessionId) {
        console.log(`✓ Auto-Reset Passed: Server generated new session ${msg.sessionId} with fresh QR code`);
        laptopWs.removeListener('message', onMsg);
        resolve(msg);
      }
    };
    laptopWs.on('message', onMsg);
  });

  phoneWs1.send(JSON.stringify({ type: 'disconnect' }));
  const freshSession = await newQrPromise;

  // Now verify that a new phone can immediately connect to the new session!
  console.log('\n--- Testing Immediate Re-Connection with New QR ---');
  const phoneWs2 = new WebSocket(
    `ws://localhost:${TEST_PORT}/ws?role=phone&session=${freshSession.sessionId}&token=${freshSession.token}`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7)' } }
  );

  const phone2Approval = new Promise((resolve) => {
    const onMsg2 = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'pair_request') {
        console.log(`✓ Second phone requested pairing with deviceName="${msg.deviceName}"`);
        laptopWs.send(JSON.stringify({ type: 'pair_response', allow: true }));
        laptopWs.removeListener('message', onMsg2);
        resolve();
      }
    };
    laptopWs.on('message', onMsg2);
  });

  const phone2Paired = new Promise((resolve) => {
    phoneWs2.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'paired') {
        console.log('✓ Second phone successfully paired with the fresh QR code!');
        resolve();
      }
    });
  });

  await Promise.all([phone2Approval, phone2Paired]);

  phoneWs2.close();
  helperWs.close();
  laptopWs.close();
  server.close();

  console.log('\n🎉 ALL RECONNECT & AUTO-RESET LIFECYCLE TESTS PASSED 100%!\n');
  process.exit(0);
}

runReconnectTests().catch((err) => {
  console.error('❌ Reconnect Test Failed:', err);
  process.exit(1);
});

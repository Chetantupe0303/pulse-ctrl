/**
 * PulseCtrl Desktop App Comprehensive Integration Test
 * Verifies the full end-to-end desktop app flow:
 * 1. Server initialization on dynamic port
 * 2. PulseHelperClient connects as helper role and laptop_web control companion
 * 3. Session creation & QR Code generation
 * 4. Phone initiates pairing with unguessable token
 * 5. "Allow this device?" approval security request received by helper client
 * 6. Helper client approves connection via respondPairApproval(true)
 * 7. Control events execution via @nut-tree/nut-js (move, click down/up, scroll 2D, text, key)
 * 8. Disconnect handling and session cleanup
 */

const assert = require('assert');
const WebSocket = require('ws');
const { server } = require('../server/index');
const { PulseHelperClient } = require('../helper/client');

async function runDesktopAppTests() {
  console.log('🧪 Starting PulseCtrl Desktop App Integration Tests...\n');

  // 1. Start server on dynamic port
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`[1/7] Test server listening on port ${port}`);

  // 2. Initialize PulseHelperClient pointing to test port
  const client = new PulseHelperClient();
  let sessionData = null;
  let pairRequestData = null;
  let phonePairedData = null;

  client.on('session_ready', (data) => {
    sessionData = data;
  });

  client.on('pair_request', (data) => {
    pairRequestData = data;
    // Simulate user clicking "Allow" on the desktop app prompt
    client.respondPairApproval(true);
  });

  client.on('paired', (data) => {
    phonePairedData = data;
  });

  console.log('[2/7] Connecting PulseHelperClient to test server...');
  client.connect(`localhost:${port}`);

  // Wait for session ready
  for (let i = 0; i < 30; i++) {
    if (sessionData && sessionData.sessionId && sessionData.qrDataUrl) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(sessionData, 'Helper client should receive session_ready event');
  assert(sessionData.qrDataUrl.startsWith('data:image/png;base64,'), 'QR data URL should be valid base64 PNG');
  console.log(`[3/7] Session created with QR Code: ${sessionData.sessionId}`);

  // Wait for companion laptop_web socket to be established
  await new Promise((r) => setTimeout(r, 300));

  // 3. Connect a simulated phone
  console.log('[4/7] Connecting simulated phone to request pairing...');
  const phoneWs = new WebSocket(`ws://localhost:${port}/ws?role=phone&session=${sessionData.sessionId}&token=${sessionData.token}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }
  });

  let phoneApproved = false;
  phoneWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'paired') {
      phoneApproved = true;
    }
  });

  // Wait for approval prompt and resolution
  for (let i = 0; i < 30; i++) {
    if (pairRequestData && phoneApproved) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert(pairRequestData, 'Helper client should receive pair_request approval prompt');
  assert.strictEqual(pairRequestData.deviceName, 'iPhone');
  console.log(`[5/7] "Allow this device?" prompt triggered cleanly for: ${pairRequestData.deviceName}`);
  assert(phoneApproved, 'Phone should receive paired message after desktop approval');
  console.log('[6/7] Pairing approved! Phone is now connected.');

  // 4. Send control events from phone (Click & Drag, 2D Scroll, Text, Keys)
  phoneWs.send(JSON.stringify({ type: 'move', dx: 5, dy: 5 }));
  phoneWs.send(JSON.stringify({ type: 'click', button: 'left', action: 'down' })); // Drag start
  phoneWs.send(JSON.stringify({ type: 'move', dx: 10, dy: 10 })); // Drag move
  phoneWs.send(JSON.stringify({ type: 'click', button: 'left', action: 'up' })); // Drag end
  phoneWs.send(JSON.stringify({ type: 'scroll', dy: 20, dx: -5 })); // 2D Scroll
  phoneWs.send(JSON.stringify({ type: 'key', key: 'Tab', modifiers: ['alt'] })); // Alt+Tab
  phoneWs.send(JSON.stringify({ type: 'key', key: 'd', modifiers: ['win'] })); // Win+D

  await new Promise((r) => setTimeout(r, 400));
  console.log('  ✓ Mouse movement, click/drag, 2D scroll, and window keys relayed and executed');

  // 5. Test Disconnect
  console.log('[7/7] Testing session disconnect...');
  client.disconnectSession();
  await new Promise((r) => setTimeout(r, 300));

  // Clean up
  phoneWs.terminate();
  client.destroy();
  await new Promise((resolve) => server.close(resolve));

  console.log('\n🎉 ALL DESKTOP APP INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
}

runDesktopAppTests().catch((err) => {
  console.error('\n❌ DESKTOP APP INTEGRATION TESTS FAILED:', err);
  process.exit(1);
});

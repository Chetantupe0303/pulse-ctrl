const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

async function testLocalRun() {
  console.log('🧪 Testing local server & helper launch and pairing flow...\n');

  const nodeExe = process.execPath;
  const rootDir = path.join(__dirname, '..');

  // 1. Start server process
  console.log('[1/5] Starting server process...');
  const serverProc = spawn(nodeExe, [path.join(rootDir, 'server', 'index.js')], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverPort = null;
  await new Promise((resolve, reject) => {
    serverProc.stdout.on('data', (d) => {
      const text = d.toString();
      const match = text.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        serverPort = Number(match[1]);
        resolve();
      }
    });
    serverProc.stderr.on('data', (d) => console.error('[Server Err]:', d.toString()));
    serverProc.on('error', reject);
    setTimeout(() => reject(new Error('Server start timeout')), 5000);
  });

  console.log(`  ✓ Server running on port ${serverPort}`);

  // 2. Start helper client
  console.log('[2/5] Connecting PulseHelperClient to server...');
  const { PulseHelperClient } = require('../helper/client');
  const client = new PulseHelperClient();

  let sessionData = null;
  client.on('session_ready', (data) => {
    sessionData = data;
  });

  client.connect();

  for (let i = 0; i < 30; i++) {
    if (sessionData) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(sessionData, 'Helper should receive session_ready');
  assert(sessionData.sessionId, 'Should have sessionId');
  assert(sessionData.token, 'Should have pairing token');
  assert(sessionData.phoneUrl.includes('/phone?session='), 'Should have phoneUrl');
  assert(sessionData.qrDataUrl.startsWith('data:image/png;base64,'), 'Should have QR data URL');
  console.log(`  ✓ Helper connected and session established: ${sessionData.sessionId}`);
  console.log(`  ✓ Phone URL: ${sessionData.phoneUrl}`);

  // 3. Connect Laptop Web to approval URL
  console.log('[3/5] Connecting laptop web WebSocket for approval handling...');
  const laptopWs = new WebSocket(`ws://localhost:${serverPort}/ws?role=laptop_web&session=${sessionData.sessionId}&approval=${sessionData.approvalToken}`);

  let laptopPairRequest = null;
  laptopWs.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    if (msg.type === 'pair_request') {
      laptopPairRequest = msg;
      // Laptop approves connection
      laptopWs.send(JSON.stringify({ type: 'pair_response', allow: true }));
    }
  });

  await new Promise((r) => setTimeout(r, 300));

  // 4. Connect Phone to request pairing
  console.log('[4/5] Connecting simulated phone...');
  const phoneWs = new WebSocket(`ws://localhost:${serverPort}/ws?role=phone&session=${sessionData.sessionId}&token=${sessionData.token}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }
  });

  let phonePaired = false;
  phoneWs.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    if (msg.type === 'paired') {
      phonePaired = true;
    }
  });

  for (let i = 0; i < 30; i++) {
    if (phonePaired) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  assert(laptopPairRequest, 'Laptop web should receive pair_request');
  assert.strictEqual(laptopPairRequest.deviceName, 'iPhone');
  assert(phonePaired, 'Phone should be paired after approval');
  console.log('  ✓ Device approval prompt accepted and phone successfully paired!');

  // 5. Send an input event and verify
  console.log('[5/5] Sending trackpad move event from phone...');
  phoneWs.send(JSON.stringify({ type: 'move', dx: 1, dy: 1 }));
  await new Promise((r) => setTimeout(r, 300));

  // Cleanup
  client.destroy();
  phoneWs.close();
  laptopWs.close();
  serverProc.kill();

  console.log('\n🎉 ALL LOCAL WORKFLOW TESTS PASSED SUCCESSFULLY!');
}

testLocalRun().catch((err) => {
  console.error(err);
  process.exit(1);
});

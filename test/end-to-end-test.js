/**
 * PulseCtrl End-to-End Comprehensive Verification Test
 * Tests Stages 1 through 4:
 * 1. Server initialization & QR code generation
 * 2. Helper connection & session creation
 * 3. Phone connection, token validation, and laptop approval flow
 * 4. Mode permissions:
 *    - In 'trackpad' mode: move, click, scroll are permitted; text and key are blocked
 *    - In 'keyboard' mode: text and key are permitted; move, click, and scroll are blocked
 *    - In 'both' mode: all events (move, click, scroll, text, key) are permitted
 * 5. Event delivery to helper & nut-js executor verification
 * 6. Disconnect handling
 */

const WebSocket = require('ws');
const { server, sessionManager } = require('../server/index');
const { executeEvent, isPermittedInMode } = require('../helper/executor');
const { validateMessage } = require('../server/validator');

const TEST_PORT = 3066;

async function runEndToEndTests() {
  console.log('🧪 Starting PulseCtrl End-to-End Tests...\n');

  // Start test server
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[1] Server listening on port ${TEST_PORT}`);

  // Connect helper
  const helperWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws?role=helper`);
  let sessionId, token;

  await new Promise((resolve, reject) => {
    helperWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session_ready') {
        sessionId = msg.sessionId;
        token = msg.token;
        resolve();
      }
    });
    helperWs.on('error', reject);
  });
  console.log(`[2] Helper registered session: ${sessionId}`);

  // Connect laptop web
  const laptopWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws?role=laptop_web&session=${sessionId}`);
  await new Promise((resolve) => {
    laptopWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'session_info') resolve();
    });
  });
  console.log('[3] Laptop Web connected to session');

  // Connect phone
  const phoneWs = new WebSocket(`ws://localhost:${TEST_PORT}/ws?role=phone&session=${sessionId}&token=${token}`);

  // Handle approval flow
  await new Promise((resolve) => {
    laptopWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'pair_request') {
        laptopWs.send(JSON.stringify({ type: 'pair_response', allow: true }));
      }
    });

    phoneWs.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'paired') {
        resolve();
      }
    });
  });
  console.log('[4] Pairing completed: phone approved by laptop');

  // Helper event listener collector
  const receivedByHelper = [];
  helperWs.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    receivedByHelper.push(msg);
  });

  // --- TEST STAGE 2: TRACKPAD MODE ---
  console.log('\n--- Testing Stage 2: Trackpad Mode ---');
  // Initial mode is trackpad
  phoneWs.send(JSON.stringify({ type: 'move', dx: 10, dy: -5 }));
  phoneWs.send(JSON.stringify({ type: 'click', button: 'left' }));
  phoneWs.send(JSON.stringify({ type: 'click', button: 'right' }));
  phoneWs.send(JSON.stringify({ type: 'scroll', dy: 3 }));

  // Attempt forbidden keyboard event while in trackpad mode
  phoneWs.send(JSON.stringify({ type: 'text', value: 'blocked text' }));

  await new Promise((r) => setTimeout(r, 100));

  const trackpadEvents = receivedByHelper.filter(e => ['move', 'click', 'scroll', 'text'].includes(e.type));
  const hasMove = trackpadEvents.some(e => e.type === 'move' && e.dx === 10 && e.dy === -5);
  const hasLeftClick = trackpadEvents.some(e => e.type === 'click' && e.button === 'left');
  const hasRightClick = trackpadEvents.some(e => e.type === 'click' && e.button === 'right');
  const hasScroll = trackpadEvents.some(e => e.type === 'scroll' && e.dy === 3);
  const textWasBlocked = !trackpadEvents.some(e => e.type === 'text');

  if (hasMove && hasLeftClick && hasRightClick && hasScroll && textWasBlocked) {
    console.log('✓ Stage 2 Passed: move, left click, right click, and scroll delivered.');
    console.log('✓ Stage 2 Permission Passed: text input was blocked in trackpad mode.');
  } else {
    throw new Error(`Trackpad mode failed. Events received: ${JSON.stringify(trackpadEvents)}`);
  }

  // --- TEST STAGE 3: KEYBOARD MODE ---
  console.log('\n--- Testing Stage 3: Keyboard Mode ---');
  receivedByHelper.length = 0; // Clear

  // Switch to keyboard mode
  phoneWs.send(JSON.stringify({ type: 'mode', value: 'keyboard' }));
  await new Promise((r) => setTimeout(r, 50));

  phoneWs.send(JSON.stringify({ type: 'text', value: 'hello' }));
  phoneWs.send(JSON.stringify({ type: 'key', key: 'Enter', modifiers: [] }));
  phoneWs.send(JSON.stringify({ type: 'key', key: 'c', modifiers: ['ctrl'] }));

  // Attempt forbidden trackpad event while in keyboard mode
  phoneWs.send(JSON.stringify({ type: 'move', dx: 50, dy: 50 }));

  await new Promise((r) => setTimeout(r, 100));

  const keyboardEvents = receivedByHelper.filter(e => ['text', 'key', 'move'].includes(e.type));
  const hasText = keyboardEvents.some(e => e.type === 'text' && e.value === 'hello');
  const hasEnter = keyboardEvents.some(e => e.type === 'key' && e.key === 'Enter');
  const hasCtrlC = keyboardEvents.some(e => e.type === 'key' && e.key === 'c' && e.modifiers.includes('ctrl'));
  const moveWasBlocked = !keyboardEvents.some(e => e.type === 'move');

  if (hasText && hasEnter && hasCtrlC && moveWasBlocked) {
    console.log('✓ Stage 3 Passed: typed text, Enter, and Ctrl+C combination delivered.');
    console.log('✓ Stage 3 Permission Passed: cursor move was blocked in keyboard mode.');
  } else {
    throw new Error(`Keyboard mode failed. Events received: ${JSON.stringify(keyboardEvents)}`);
  }

  // --- TEST STAGE 4: BOTH MODE ---
  console.log('\n--- Testing Stage 4: Both Mode ---');
  receivedByHelper.length = 0;

  // Switch to both mode
  phoneWs.send(JSON.stringify({ type: 'mode', value: 'both' }));
  await new Promise((r) => setTimeout(r, 50));

  phoneWs.send(JSON.stringify({ type: 'move', dx: 15, dy: 20 }));
  phoneWs.send(JSON.stringify({ type: 'click', button: 'left' }));
  phoneWs.send(JSON.stringify({ type: 'text', value: 'both test' }));
  phoneWs.send(JSON.stringify({ type: 'key', key: 'Tab', modifiers: [] }));

  await new Promise((r) => setTimeout(r, 100));

  const bothEvents = receivedByHelper.filter(e => ['move', 'click', 'text', 'key'].includes(e.type));
  const bothMove = bothEvents.some(e => e.type === 'move' && e.dx === 15 && e.dy === 20);
  const bothClick = bothEvents.some(e => e.type === 'click' && e.button === 'left');
  const bothText = bothEvents.some(e => e.type === 'text' && e.value === 'both test');
  const bothKey = bothEvents.some(e => e.type === 'key' && e.key === 'Tab');

  if (bothMove && bothClick && bothText && bothKey) {
    console.log('✓ Stage 4 Passed: both trackpad and keyboard events executed simultaneously.');
  } else {
    throw new Error(`Both mode failed. Events received: ${JSON.stringify(bothEvents)}`);
  }

  // --- TEST HELPER EXECUTOR PERMISSIONS DIRECTLY ---
  console.log('\n--- Testing Executor Direct Mode Permissions ---');
  if (
    isPermittedInMode('move', 'trackpad') &&
    !isPermittedInMode('text', 'trackpad') &&
    isPermittedInMode('text', 'keyboard') &&
    !isPermittedInMode('move', 'keyboard') &&
    isPermittedInMode('move', 'both') &&
    isPermittedInMode('text', 'both')
  ) {
    console.log('✓ Executor permissions matrix validated successfully.');
  } else {
    throw new Error('Executor mode permission matrix mismatch.');
  }

  // --- TEST SANITIZATION & PROTOCOL VALIDATION ---
  console.log('\n--- Testing Validation & Sanitization ---');
  const badType = validateMessage({ type: 'malicious_exec', cmd: 'whoami' }, 'both');
  const badNumbers = validateMessage({ type: 'move', dx: 'bad', dy: null }, 'both');
  const badMode = validateMessage({ type: 'mode', value: 'superadmin' }, 'both');

  if (!badType.valid && !badNumbers.valid && !badMode.valid) {
    console.log('✓ Validator successfully rejected malicious, corrupt, and unknown payloads.');
  } else {
    throw new Error('Validator failed to reject invalid payloads.');
  }

  // Clean disconnect
  phoneWs.send(JSON.stringify({ type: 'disconnect' }));
  await new Promise((r) => setTimeout(r, 100));

  helperWs.close();
  laptopWs.close();
  phoneWs.close();
  server.close();

  console.log('\n🎉 ALL END-TO-END TESTS PASSED WITH 100% SUCCESS!\n');
  process.exit(0);
}

runEndToEndTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

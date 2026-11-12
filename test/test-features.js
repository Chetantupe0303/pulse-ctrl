/**
 * Test for Mouse Sensitivity, Clicking & Dragging, Scrolling & Zooming, and Navigation/Window Management
 */

const assert = require('assert');
const { validateMessage } = require('../server/validator');
const { executeEvent } = require('../helper/executor');

async function testFeatures() {
  console.log('🧪 Testing Enhanced Mobile Features...\n');

  // 1. Click & Drag events
  console.log('[1/4] Testing Click & Drag validation...');
  const clickDown = validateMessage({ type: 'click', button: 'left', action: 'down' }, 'trackpad');
  assert(clickDown.valid, 'Click down should be valid');
  assert.strictEqual(clickDown.sanitized.action, 'down');

  const clickUp = validateMessage({ type: 'click', button: 'left', action: 'up' }, 'trackpad');
  assert(clickUp.valid, 'Click up should be valid');
  assert.strictEqual(clickUp.sanitized.action, 'up');

  const regularClick = validateMessage({ type: 'click', button: 'right' }, 'trackpad');
  assert(regularClick.valid, 'Regular click should be valid');
  assert.strictEqual(regularClick.sanitized.action, 'click');
  console.log('  ✓ Click & Drag events validate correctly');

  // 2. 2D Scroll & Zoom events
  console.log('[2/4] Testing 2D Scroll validation...');
  const scroll2D = validateMessage({ type: 'scroll', dy: 20, dx: -15 }, 'trackpad');
  assert(scroll2D.valid, 'Scroll 2D should be valid');
  assert.strictEqual(scroll2D.sanitized.dy, 20);
  assert.strictEqual(scroll2D.sanitized.dx, -15);
  console.log('  ✓ 2D Scroll events validate correctly');

  // 3. Navigation & Window Management Key events
  console.log('[3/4] Testing Navigation & Window Management key events...');
  const altTab = validateMessage({ type: 'key', key: 'Tab', modifiers: ['alt'] }, 'both');
  assert(altTab.valid, 'Alt+Tab should be valid');
  assert.strictEqual(altTab.sanitized.key, 'Tab');
  assert.deepStrictEqual(altTab.sanitized.modifiers, ['alt']);

  const winD = validateMessage({ type: 'key', key: 'd', modifiers: ['win'] }, 'both');
  assert(winD.valid, 'Win+D should be valid');

  const altF4 = validateMessage({ type: 'key', key: 'F4', modifiers: ['alt'] }, 'both');
  assert(altF4.valid, 'Alt+F4 should be valid');

  const zoomIn = validateMessage({ type: 'key', key: '=', modifiers: ['control'] }, 'both');
  assert(zoomIn.valid, 'Ctrl+= should be valid');
  console.log('  ✓ Navigation & Window Management keys validate correctly');

  // 4. Executor execution test
  console.log('[4/4] Testing executor handling with nut-js...');
  await executeEvent({ type: 'click', button: 'left', action: 'down' }, 'trackpad');
  await executeEvent({ type: 'move', dx: 0, dy: 0 }, 'trackpad');
  await executeEvent({ type: 'click', button: 'left', action: 'up' }, 'trackpad');
  await executeEvent({ type: 'scroll', dy: 1, dx: 0 }, 'trackpad');
  console.log('  ✓ Executor executed click down/up and scroll without errors');

  console.log('\n🎉 ALL FEATURE TESTS PASSED SUCCESSFULLY!\n');
}

testFeatures().catch((err) => {
  console.error('\n❌ FEATURE TESTS FAILED:', err);
  process.exit(1);
});

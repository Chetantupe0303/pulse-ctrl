/**
 * PulseCtrl Helper - OS Input Executor
 * Uses @nut-tree/nut-js for native mouse and keyboard simulation.
 * Enforces mode-based execution permissions directly on the laptop.
 */

const { mouse, keyboard, Button, Key, Point } = require('@nut-tree/nut-js');

// Eliminate artificial delays to ensure ultra-smooth 60fps tracking
mouse.config.autoDelayMs = 0;
keyboard.config.autoDelayMs = 0;

// Mapping of protocol key names to nut-js Key enums
const KEY_MAP = {
  enter: Key.Return,
  return: Key.Return,
  backspace: Key.Backspace,
  tab: Key.Tab,
  escape: Key.Escape,
  esc: Key.Escape,
  space: Key.Space,
  arrowup: Key.Up,
  up: Key.Up,
  arrowdown: Key.Down,
  down: Key.Down,
  arrowleft: Key.Left,
  left: Key.Left,
  arrowright: Key.Right,
  right: Key.Right,
  home: Key.Home,
  end: Key.End,
  pageup: Key.PageUp,
  pagedown: Key.PageDown,
  delete: Key.Delete,
  del: Key.Delete,
  f1: Key.F1,
  f2: Key.F2,
  f3: Key.F3,
  f4: Key.F4,
  f5: Key.F5,
  f6: Key.F6,
  f7: Key.F7,
  f8: Key.F8,
  f9: Key.F9,
  f10: Key.F10,
  f11: Key.F11,
  f12: Key.F12,
  plus: Key.Add,
  add: Key.Add,
  equal: Key.Equal,
  '=': Key.Equal,
  minus: Key.Minus,
  subtract: Key.Subtract,
  '-': Key.Minus,
  '0': Key.Num0,
  '1': Key.Num1,
  '2': Key.Num2,
  '3': Key.Num3,
  '4': Key.Num4,
  '5': Key.Num5,
  '6': Key.Num6,
  '7': Key.Num7,
  '8': Key.Num8,
  '9': Key.Num9,
  a: Key.A,
  b: Key.B,
  c: Key.C,
  d: Key.D,
  e: Key.E,
  f: Key.F,
  g: Key.G,
  h: Key.H,
  i: Key.I,
  j: Key.J,
  k: Key.K,
  l: Key.L,
  m: Key.M,
  n: Key.N,
  o: Key.O,
  p: Key.P,
  q: Key.Q,
  r: Key.R,
  s: Key.S,
  t: Key.T,
  u: Key.U,
  v: Key.V,
  w: Key.W,
  x: Key.X,
  y: Key.Y,
  z: Key.Z
};

const MODIFIER_MAP = {
  control: Key.LeftControl,
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
  command: Key.LeftSuper,
  cmd: Key.LeftSuper,
  meta: Key.LeftSuper,
  win: Key.LeftSuper,
  windows: Key.LeftSuper,
  super: Key.LeftSuper
};

/**
 * Checks if the event type is permitted under the current mode.
 * @param {string} type - Event type
 * @param {string} mode - 'trackpad' | 'keyboard' | 'both'
 * @returns {boolean}
 */
function isPermittedInMode(type, mode) {
  if (mode === 'trackpad') {
    return type === 'move' || type === 'click' || type === 'scroll';
  }
  if (mode === 'keyboard') {
    return type === 'text' || type === 'key';
  }
  if (mode === 'both') {
    return ['move', 'click', 'scroll', 'text', 'key'].includes(type);
  }
  return false;
}

/**
 * Executes a sanitized message on the host OS.
 * @param {object} event - Sanitized protocol event
 * @param {string} currentMode - Active session mode
 */
async function executeEvent(event, currentMode = 'trackpad') {
  if (!event || !event.type) return;

  // Enforce mode permission check on the laptop helper
  if (!isPermittedInMode(event.type, currentMode)) {
    console.warn(`[Executor] Blocked "${event.type}" event: not permitted in ${currentMode} mode.`);
    return;
  }

  try {
    switch (event.type) {
      case 'move': {
        const { dx, dy } = event;
        const current = await mouse.getPosition();
        const targetX = Math.round(current.x + dx);
        const targetY = Math.round(current.y + dy);
        await mouse.setPosition(new Point(targetX, targetY));
        break;
      }

      case 'click': {
        const btn = event.button === 'right' ? Button.RIGHT : Button.LEFT;
        if (event.action === 'down') {
          await mouse.pressButton(btn);
        } else if (event.action === 'up') {
          await mouse.releaseButton(btn);
        } else {
          if (event.button === 'right') {
            await mouse.rightClick();
          } else {
            await mouse.leftClick();
          }
        }
        break;
      }

      case 'scroll': {
        const { dy, dx } = event;
        if (dy > 0) {
          await mouse.scrollDown(Math.abs(dy));
        } else if (dy < 0) {
          await mouse.scrollUp(Math.abs(dy));
        }
        if (dx > 0) {
          await mouse.scrollRight(Math.abs(dx));
        } else if (dx < 0) {
          await mouse.scrollLeft(Math.abs(dx));
        }
        break;
      }

      case 'text': {
        if (typeof event.value === 'string' && event.value.length > 0) {
          await keyboard.type(event.value);
        }
        break;
      }

      case 'key': {
        const rawKey = (event.key || '').toLowerCase();
        const nutKey = KEY_MAP[rawKey];
        const modifiers = Array.isArray(event.modifiers) ? event.modifiers : [];

        // Collect modifier keys to press
        const modsToPress = [];
        for (const mod of modifiers) {
          const modKey = MODIFIER_MAP[mod.toLowerCase()];
          if (modKey !== undefined) {
            modsToPress.push(modKey);
          }
        }

        // Press modifiers down
        for (const modKey of modsToPress) {
          await keyboard.pressKey(modKey);
        }

        // Press and release the primary key
        if (nutKey !== undefined) {
          await keyboard.pressKey(nutKey);
          await keyboard.releaseKey(nutKey);
        } else if (event.key.length === 1) {
          // Single character fallback
          await keyboard.type(event.key);
        }

        // Release modifiers in reverse order
        for (let i = modsToPress.length - 1; i >= 0; i--) {
          await keyboard.releaseKey(modsToPress[i]);
        }
        break;
      }

      default:
        // Ignore unrecognized events
        break;
    }
  } catch (err) {
    console.error(`[Executor] Error executing ${event.type}:`, err.message);
  }
}

module.exports = {
  executeEvent,
  isPermittedInMode,
  KEY_MAP,
  MODIFIER_MAP
};

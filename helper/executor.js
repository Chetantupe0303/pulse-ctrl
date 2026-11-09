/**
 * PulseCtrl Helper - OS Input Executor
 * Uses @nut-tree/nut-js for native mouse and keyboard simulation.
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
  right: Key.Right
};

const MODIFIER_MAP = {
  control: Key.LeftControl,
  ctrl: Key.LeftControl,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
  command: Key.LeftSuper,
  cmd: Key.LeftSuper,
  meta: Key.LeftSuper,
  win: Key.LeftSuper
};

/**
 * Executes a sanitized message on the host OS.
 * @param {object} event - Sanitized protocol event
 * @param {string} currentMode - Active session mode
 */
async function executeEvent(event, currentMode = 'trackpad') {
  if (!event || !event.type) return;

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
        if (event.button === 'right') {
          await mouse.rightClick();
        } else {
          await mouse.leftClick();
        }
        break;
      }

      case 'scroll': {
        const { dy } = event;
        if (dy > 0) {
          await mouse.scrollDown(Math.abs(dy));
        } else if (dy < 0) {
          await mouse.scrollUp(Math.abs(dy));
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
        // Ignored or handled elsewhere
        break;
    }
  } catch (err) {
    console.error(`[Executor] Error executing ${event.type}:`, err.message);
  }
}

module.exports = {
  executeEvent,
  KEY_MAP,
  MODIFIER_MAP
};

/**
 * PulseCtrl Message Validator & Sanitizer
 * Validates incoming JSON messages according to the protocol and active mode permissions.
 */

const ALLOWED_MODES = new Set(['trackpad', 'keyboard', 'both']);
const ALLOWED_BUTTONS = new Set(['left', 'right']);

/**
 * Validates message structure, types, and mode-based permissions.
 *
 * Mode Permissions:
 * - 'trackpad': move, click, scroll
 * - 'keyboard': text, key
 * - 'both': move, click, scroll, text, key
 *
 * @param {any} msg - Parsed JSON object from client
 * @param {string} currentMode - Current session mode ('trackpad' | 'keyboard' | 'both')
 * @returns {{ valid: boolean, error?: string, sanitized?: any }}
 */
function validateMessage(msg, currentMode = 'trackpad') {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { valid: false, error: 'Message must be a non-null object' };
  }

  const { type } = msg;
  if (!type || typeof type !== 'string') {
    return { valid: false, error: 'Message type must be a string' };
  }

  // 1. Mode switch event (always allowed regardless of current mode)
  if (type === 'mode') {
    if (!ALLOWED_MODES.has(msg.value)) {
      return { valid: false, error: `Invalid mode value: ${msg.value}` };
    }
    return { valid: true, sanitized: { type: 'mode', value: msg.value } };
  }

  // 2. Disconnect event (always allowed)
  if (type === 'disconnect') {
    return { valid: true, sanitized: { type: 'disconnect' } };
  }

  // Check if current event type is permitted under active mode
  if (currentMode === 'trackpad') {
    if (type !== 'move' && type !== 'click' && type !== 'scroll') {
      return { valid: false, error: `Event type "${type}" not permitted in trackpad mode` };
    }
  } else if (currentMode === 'keyboard') {
    if (type !== 'text' && type !== 'key') {
      return { valid: false, error: `Event type "${type}" not permitted in keyboard mode` };
    }
  } else if (currentMode === 'both') {
    if (!['move', 'click', 'scroll', 'text', 'key'].includes(type)) {
      return { valid: false, error: `Unsupported event type "${type}"` };
    }
  } else {
    return { valid: false, error: `Unknown active mode "${currentMode}"` };
  }

  // 3. Move event
  if (type === 'move') {
    const { dx, dy } = msg;
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) {
      return { valid: false, error: 'Move requires finite dx and dy numbers' };
    }
    // Cap relative deltas to prevent abnormal cursor jumping
    const clampedDx = Math.max(-1000, Math.min(1000, dx));
    const clampedDy = Math.max(-1000, Math.min(1000, dy));
    return { valid: true, sanitized: { type: 'move', dx: clampedDx, dy: clampedDy } };
  }

  // 4. Click event
  if (type === 'click') {
    const { button } = msg;
    if (!ALLOWED_BUTTONS.has(button)) {
      return { valid: false, error: 'Click button must be "left" or "right"' };
    }
    return { valid: true, sanitized: { type: 'click', button } };
  }

  // 5. Scroll event
  if (type === 'scroll') {
    const { dy } = msg;
    if (typeof dy !== 'number' || !Number.isFinite(dy)) {
      return { valid: false, error: 'Scroll requires finite dy number' };
    }
    const clampedDy = Math.max(-500, Math.min(500, dy));
    return { valid: true, sanitized: { type: 'scroll', dy: clampedDy } };
  }

  // 6. Text input event
  if (type === 'text') {
    const { value } = msg;
    if (typeof value !== 'string') {
      return { valid: false, error: 'Text value must be a string' };
    }
    // Limit single input payload length
    if (value.length > 256) {
      return { valid: false, error: 'Text value exceeds maximum allowed length (256)' };
    }
    return { valid: true, sanitized: { type: 'text', value } };
  }

  // 7. Key event
  if (type === 'key') {
    const { key, modifiers } = msg;
    if (typeof key !== 'string' || !key.trim()) {
      return { valid: false, error: 'Key must be a non-empty string' };
    }
    if (key.length > 32) {
      return { valid: false, error: 'Key name exceeds maximum allowed length' };
    }
    const cleanModifiers = Array.isArray(modifiers)
      ? modifiers.filter(m => typeof m === 'string' && m.length <= 16).map(m => m.toLowerCase())
      : [];
    return { valid: true, sanitized: { type: 'key', key: key.trim(), modifiers: cleanModifiers } };
  }

  return { valid: false, error: `Unknown event type "${type}"` };
}

module.exports = {
  validateMessage,
  ALLOWED_MODES,
  ALLOWED_BUTTONS
};

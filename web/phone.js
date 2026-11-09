/**
 * PulseCtrl - Phone Client Controller
 * Manages WebSocket pairing, mode tabs, touch gestures (60fps drag, tap left/right, 2-finger scroll),
 * and mobile keyboard input.
 */

(function () {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session');
  const token = urlParams.get('token');

  // UI elements
  const statusPill = document.getElementById('phoneStatusPill');
  const statusText = document.getElementById('phoneStatusText');
  const disconnectBtn = document.getElementById('phoneDisconnectBtn');
  const overlayScreen = document.getElementById('overlayScreen');
  const overlayIcon = document.getElementById('overlayIcon');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayDesc = document.getElementById('overlayDesc');

  // Mode panels & tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panelTrackpad = document.getElementById('panelTrackpad');
  const panelKeyboard = document.getElementById('panelKeyboard');
  const panelBoth = document.getElementById('panelBoth');
  const panels = {
    trackpad: panelTrackpad,
    keyboard: panelKeyboard,
    both: panelBoth
  };

  // Input & keyboard elements
  const nativeKeyboardInput = document.getElementById('nativeKeyboardInput');
  const btnOpenKeyboard = document.getElementById('btnOpenKeyboard');
  const btnOpenKeyboardBoth = document.getElementById('btnOpenKeyboardBoth');

  let ws = null;
  let isPaired = false;
  let currentMode = 'trackpad';

  // Active modifier keys (Ctrl, Alt, Shift)
  const activeModifiers = new Set();

  // Status & overlay management
  function setStatus(state, text) {
    statusPill.className = 'status-pill status-' + state;
    statusText.textContent = text;
  }

  function showOverlay(icon, title, desc) {
    overlayIcon.textContent = icon;
    overlayTitle.textContent = title;
    overlayDesc.textContent = desc;
    overlayScreen.classList.remove('hidden');
  }

  function hideOverlay() {
    overlayScreen.classList.add('hidden');
  }

  if (!sessionId || !token) {
    showOverlay('❌', 'Invalid Link', 'Missing session ID or security token. Please scan the QR code again.');
    setStatus('disconnected', 'Invalid QR');
    return;
  }

  // WebSocket Connection
  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?role=phone&session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;

    showOverlay('⏳', 'Connecting...', 'Contacting laptop server...');
    setStatus('waiting', 'Connecting');

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Phone] Connected to WebSocket');
      showOverlay('⏳', 'Waiting for Laptop', 'Please look at your laptop screen and click "Allow".');
      setStatus('waiting', 'Awaiting approval');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'waiting_approval') {
          showOverlay('⏳', 'Waiting for Laptop', 'Please click "Allow" on your laptop screen.');
          setStatus('waiting', 'Awaiting approval');
        } else if (msg.type === 'paired') {
          isPaired = true;
          hideOverlay();
          setStatus('connected', 'Connected');
          if (msg.mode) {
            setMode(msg.mode, false);
          }
        } else if (msg.type === 'denied') {
          isPaired = false;
          showOverlay('🚫', 'Connection Denied', 'The laptop user denied access.');
          setStatus('disconnected', 'Denied');
        } else if (msg.type === 'status' && msg.status === 'disconnected') {
          isPaired = false;
          showOverlay('🔌', 'Disconnected', msg.message || 'Connection was closed.');
          setStatus('disconnected', 'Disconnected');
        } else if (msg.type === 'expired') {
          isPaired = false;
          showOverlay('⏰', 'Session Expired', msg.message || 'Session expired.');
          setStatus('disconnected', 'Expired');
        } else if (msg.type === 'error') {
          isPaired = false;
          showOverlay('⚠️', 'Pairing Error', msg.message || 'Unable to pair with laptop.');
          setStatus('disconnected', 'Error');
        } else if (msg.type === 'mode') {
          setMode(msg.value, false);
        }
      } catch (e) {
        console.error('[Phone] Parse error:', e);
      }
    };

    ws.onclose = (event) => {
      console.warn('[Phone] Connection closed:', event.code, event.reason);
      if (isPaired) {
        showOverlay('🔌', 'Disconnected', 'Lost connection to laptop.');
        setStatus('disconnected', 'Disconnected');
      }
      isPaired = false;
    };

    ws.onerror = (err) => {
      console.error('[Phone] WebSocket error:', err);
    };
  }

  // Safe message dispatch helper
  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN && isPaired) {
      ws.send(JSON.stringify(data));
    }
  }

  // Disconnect button
  disconnectBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'disconnect' }));
    }
    showOverlay('🔌', 'Disconnected', 'You disconnected from the laptop.');
    setStatus('disconnected', 'Disconnected');
  });

  // Mode switching
  function setMode(mode, notifyServer = true) {
    currentMode = mode;

    tabButtons.forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    Object.keys(panels).forEach(key => {
      if (key === mode) {
        panels[key].classList.add('active');
      } else {
        panels[key].classList.remove('active');
      }
    });

    if (notifyServer) {
      send({ type: 'mode', value: mode });
    }
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode && mode !== currentMode) {
        setMode(mode, true);
      }
    });
  });

  // -------------------------------------------------------------
  // TRACKPAD GESTURES ENGINE (60 FPS Throttling & Multi-Touch)
  // -------------------------------------------------------------
  function setupTrackpadSurface(element) {
    if (!element) return;

    let touchStartTime = 0;
    let maxTouchCount = 0;
    let initialTouchX = 0;
    let initialTouchY = 0;
    let lastX = 0;
    let lastY = 0;
    let lastScrollY = 0;
    let hasMoved = false;

    // Movement delta accumulator for 60fps dispatch
    let pendingDx = 0;
    let pendingDy = 0;
    let pendingScrollDy = 0;
    let rafScheduled = false;
    let lastFlushTime = 0;

    function flushDeltas() {
      rafScheduled = false;

      if (pendingDx !== 0 || pendingDy !== 0) {
        // Send small relative deltas throttled to ~60 per second
        send({
          type: 'move',
          dx: Math.round(pendingDx),
          dy: Math.round(pendingDy)
        });
        pendingDx = 0;
        pendingDy = 0;
      }

      if (pendingScrollDy !== 0) {
        send({
          type: 'scroll',
          dy: Math.round(pendingScrollDy)
        });
        pendingScrollDy = 0;
      }
    }

    function scheduleFlush() {
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame((now) => {
          rafScheduled = false;
          // Strictly throttle to ~60fps (16ms interval)
          if (now - lastFlushTime >= 15) {
            lastFlushTime = now;
            flushDeltas();
          } else {
            scheduleFlush();
          }
        });
      }
    }

    element.addEventListener('touchstart', (e) => {
      maxTouchCount = Math.max(maxTouchCount, e.touches.length);
      touchStartTime = Date.now();
      hasMoved = false;

      if (e.touches.length === 1) {
        lastX = e.touches[0].clientX;
        lastY = e.touches[0].clientY;
        initialTouchX = lastX;
        initialTouchY = lastY;
      } else if (e.touches.length === 2) {
        lastScrollY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    }, { passive: false });

    element.addEventListener('touchmove', (e) => {
      e.preventDefault(); // Prevent native browser pull-to-refresh or panning

      maxTouchCount = Math.max(maxTouchCount, e.touches.length);

      if (e.touches.length === 1) {
        // 1-finger cursor movement
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;

        const dx = currentX - lastX;
        const dy = currentY - lastY;

        lastX = currentX;
        lastY = currentY;

        if (Math.hypot(currentX - initialTouchX, currentY - initialTouchY) > 5) {
          hasMoved = true;
        }

        // Apply smooth sensitivity multiplier
        pendingDx += dx * 1.5;
        pendingDy += dy * 1.5;
        scheduleFlush();

      } else if (e.touches.length === 2) {
        // 2-finger scroll
        const currentScrollY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const scrollDelta = currentScrollY - lastScrollY;
        lastScrollY = currentScrollY;

        hasMoved = true;

        // Invert scroll delta for natural scrolling feel
        pendingScrollDy += -scrollDelta * 1.2;
        scheduleFlush();
      }
    }, { passive: false });

    element.addEventListener('touchend', (e) => {
      const elapsed = Date.now() - touchStartTime;

      // Handle taps if fingers did not drag
      if (!hasMoved && elapsed < 320) {
        if (maxTouchCount === 1) {
          // Single tap = left click
          send({ type: 'click', button: 'left' });
        } else if (maxTouchCount === 2) {
          // Two-finger tap = right click
          send({ type: 'click', button: 'right' });
        }
      }

      if (e.touches.length === 0) {
        // All fingers lifted, flush any remaining movement and reset
        flushDeltas();
        maxTouchCount = 0;
      }
    }, { passive: false });

    element.addEventListener('touchcancel', () => {
      pendingDx = 0;
      pendingDy = 0;
      pendingScrollDy = 0;
      maxTouchCount = 0;
    });
  }

  setupTrackpadSurface(document.getElementById('touchSurface'));
  setupTrackpadSurface(document.getElementById('touchSurfaceBoth'));

  // -------------------------------------------------------------
  // KEYBOARD ENGINE
  // -------------------------------------------------------------
  function triggerNativeKeyboard() {
    nativeKeyboardInput.value = '';
    nativeKeyboardInput.focus();
  }

  if (btnOpenKeyboard) {
    btnOpenKeyboard.addEventListener('click', triggerNativeKeyboard);
  }
  if (btnOpenKeyboardBoth) {
    btnOpenKeyboardBoth.addEventListener('click', triggerNativeKeyboard);
  }

  // Listen to "input" event (more reliable than keydown on mobile browsers)
  nativeKeyboardInput.addEventListener('input', (e) => {
    const inputType = e.inputType;
    const value = e.data || nativeKeyboardInput.value;

    if (inputType === 'deleteContentBackward' || (!nativeKeyboardInput.value && inputType === 'deleteWordBackward')) {
      // User tapped mobile backspace
      send({
        type: 'key',
        key: 'Backspace',
        modifiers: Array.from(activeModifiers)
      });
    } else if (value) {
      // User typed characters
      send({
        type: 'text',
        value: value
      });
    }

    // Reset input value to allow continuous input detection
    nativeKeyboardInput.value = '';
  });

  // Fallback for enter key on mobile virtual keyboards
  nativeKeyboardInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      send({
        type: 'key',
        key: 'Enter',
        modifiers: Array.from(activeModifiers)
      });
      e.preventDefault();
    }
  });

  // Special key buttons (Enter, Backspace, Tab, Esc, Arrows, Space)
  document.querySelectorAll('.key-btn[data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const keyName = btn.dataset.key;
      send({
        type: 'key',
        key: keyName,
        modifiers: Array.from(activeModifiers)
      });

      // Clear modifiers after executing combination unless held
      if (activeModifiers.size > 0) {
        activeModifiers.clear();
        document.querySelectorAll('.key-btn.modifier').forEach(m => m.classList.remove('active'));
      }
    });
  });

  // Modifier toggle buttons (Ctrl, Alt, Shift)
  document.querySelectorAll('.key-btn.modifier[data-modifier]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mod = btn.dataset.modifier;
      if (activeModifiers.has(mod)) {
        activeModifiers.delete(mod);
        btn.classList.remove('active');
      } else {
        activeModifiers.add(mod);
        btn.classList.add('active');
      }
    });
  });

  // Start connection
  connect();
})();

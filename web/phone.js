/**
 * PulseCtrl - Phone Client Controller
 * Clean, minimal, utility-focused wireless trackpad & keyboard engine.
 * Supports 2 modes: Mousepad and Both (Mousepad + Keyboard).
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
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayDesc = document.getElementById('overlayDesc');

  // Mode panels & tabs
  const tabButtons = document.querySelectorAll('.tab-btn');
  const panelTrackpad = document.getElementById('panelTrackpad');
  const panelBoth = document.getElementById('panelBoth');
  const panels = {
    trackpad: panelTrackpad,
    both: panelBoth
  };

  // Typing elements in Both mode
  const bothTextInput = document.getElementById('bothTextInput');
  const btnBothSend = document.getElementById('btnBothSend');
  const btnBothBackspace = document.getElementById('btnBothBackspace');

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

  function showOverlay(title, desc) {
    overlayTitle.textContent = title;
    overlayDesc.textContent = desc;
    overlayScreen.classList.remove('hidden');
  }

  function hideOverlay() {
    overlayScreen.classList.add('hidden');
  }

  if (!sessionId || !token) {
    showOverlay('Invalid Link', 'Missing session ID or security token. Please scan the QR code on your laptop.');
    setStatus('disconnected', 'Invalid QR');
    return;
  }

  // WebSocket Connection
  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?role=phone&session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;

    showOverlay('Connecting...', 'Contacting laptop server...');
    setStatus('waiting', 'Connecting');

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      showOverlay('Waiting for Approval', 'Please click "Allow" on your laptop screen.');
      setStatus('waiting', 'Awaiting approval');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'waiting_approval') {
          showOverlay('Waiting for Approval', 'Please click "Allow" on your laptop screen.');
          setStatus('waiting', 'Awaiting approval');
        } else if (msg.type === 'paired') {
          isPaired = true;
          hideOverlay();
          setStatus('connected', 'Connected');
          if (msg.mode) {
            setMode(msg.mode === 'both' ? 'both' : 'trackpad', false);
          }
        } else if (msg.type === 'denied') {
          isPaired = false;
          showOverlay('Connection Denied', 'The laptop user denied access.');
          setStatus('disconnected', 'Denied');
        } else if (msg.type === 'status' && msg.status === 'disconnected') {
          isPaired = false;
          showOverlay('Disconnected', msg.message || 'Connection was closed.');
          setStatus('disconnected', 'Disconnected');
        } else if (msg.type === 'expired') {
          isPaired = false;
          showOverlay('Session Expired', msg.message || 'Session timed out.');
          setStatus('disconnected', 'Expired');
        } else if (msg.type === 'error') {
          isPaired = false;
          showOverlay('Connection Error', msg.message || 'Unable to pair with laptop.');
          setStatus('disconnected', 'Error');
        } else if (msg.type === 'mode') {
          setMode(msg.value === 'both' ? 'both' : 'trackpad', false);
        }
      } catch (e) {
        console.error('[Phone] Parse error:', e);
      }
    };

    ws.onclose = () => {
      if (isPaired) {
        showOverlay('Disconnected', 'Lost connection to laptop.');
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
    showOverlay('Disconnected', 'You disconnected from the laptop.');
    setStatus('disconnected', 'Disconnected');
  });

  // 2-Mode switching (Mousepad vs Both)
  function setMode(mode, notifyServer = true) {
    currentMode = mode === 'both' ? 'both' : 'trackpad';

    tabButtons.forEach(btn => {
      if (btn.dataset.mode === currentMode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    Object.keys(panels).forEach(key => {
      if (key === currentMode) {
        panels[key].classList.add('active');
      } else {
        panels[key].classList.remove('active');
      }
    });

    if (notifyServer) {
      send({ type: 'mode', value: currentMode });
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
  // MOUSEPAD ENGINE (Ultra-responsive, 60fps, rock-solid deltas)
  // -------------------------------------------------------------
  function setupTrackpadSurface(element) {
    if (!element) return;

    let touchStartTime = 0;
    let maxTouchCount = 0;
    let lastX = 0;
    let lastY = 0;
    let initialTouchX = 0;
    let initialTouchY = 0;
    let lastScrollY = 0;
    let hasMoved = false;

    let pendingDx = 0;
    let pendingDy = 0;
    let pendingScrollDy = 0;
    let lastSendTime = 0;

    function flushDeltas() {
      if (pendingDx !== 0 || pendingDy !== 0) {
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

    function checkThrottle() {
      const now = performance.now();
      if (now - lastSendTime >= 15) { // ~60 FPS
        lastSendTime = now;
        flushDeltas();
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
      e.preventDefault(); // Stop native scrolling & bounce
      maxTouchCount = Math.max(maxTouchCount, e.touches.length);

      if (e.touches.length === 1) {
        // 1-finger mouse movement
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;

        const dx = currentX - lastX;
        const dy = currentY - lastY;

        lastX = currentX;
        lastY = currentY;

        if (Math.abs(currentX - initialTouchX) > 4 || Math.abs(currentY - initialTouchY) > 4) {
          hasMoved = true;
        }

        // Apply smooth trackpad sensitivity
        pendingDx += dx * 1.5;
        pendingDy += dy * 1.5;
        checkThrottle();

      } else if (e.touches.length === 2) {
        // 2-finger vertical scroll
        const currentScrollY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const scrollDelta = currentScrollY - lastScrollY;
        lastScrollY = currentScrollY;

        hasMoved = true;

        pendingScrollDy += -scrollDelta * 1.4;
        checkThrottle();
      }
    }, { passive: false });

    element.addEventListener('touchend', (e) => {
      const elapsed = Date.now() - touchStartTime;

      // Tap detection (single-finger = left click, two-finger = right click)
      if (!hasMoved && elapsed < 350) {
        if (maxTouchCount === 1) {
          send({ type: 'click', button: 'left' });
        } else if (maxTouchCount === 2) {
          send({ type: 'click', button: 'right' });
        }
      }

      if (e.touches.length === 0) {
        // Flush remaining deltas when fingers lift
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

  // Initialize both touch surfaces
  setupTrackpadSurface(document.getElementById('touchSurfaceFull'));
  setupTrackpadSurface(document.getElementById('touchSurfaceBoth'));

  // Physical Left / Right click buttons
  function bindClickButtons(leftId, rightId) {
    const btnLeft = document.getElementById(leftId);
    const btnRight = document.getElementById(rightId);

    if (btnLeft) {
      btnLeft.addEventListener('click', (e) => {
        e.preventDefault();
        send({ type: 'click', button: 'left' });
      });
    }
    if (btnRight) {
      btnRight.addEventListener('click', (e) => {
        e.preventDefault();
        send({ type: 'click', button: 'right' });
      });
    }
  }

  bindClickButtons('btnLeftClick', 'btnRightClick');
  bindClickButtons('btnLeftClickBoth', 'btnRightClickBoth');

  // -------------------------------------------------------------
  // KEYBOARD & INPUT ENGINE (Both Mode)
  // -------------------------------------------------------------
  if (bothTextInput) {
    // Stream characters directly on input event (reliable on mobile virtual keyboards)
    bothTextInput.addEventListener('input', (e) => {
      const inputType = e.inputType;
      const val = e.data || bothTextInput.value;

      if (inputType === 'deleteContentBackward' || (!bothTextInput.value && inputType === 'deleteWordBackward')) {
        send({
          type: 'key',
          key: 'Backspace',
          modifiers: Array.from(activeModifiers)
        });
      } else if (val) {
        send({
          type: 'text',
          value: val
        });
      }

      // Reset value so next keystroke is captured freshly
      bothTextInput.value = '';
    });

    bothTextInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        send({
          type: 'key',
          key: 'Enter',
          modifiers: Array.from(activeModifiers)
        });
        e.preventDefault();
      }
    });
  }

  if (btnBothSend) {
    btnBothSend.addEventListener('click', () => {
      if (bothTextInput.value) {
        send({ type: 'text', value: bothTextInput.value });
        bothTextInput.value = '';
      } else {
        send({ type: 'key', key: 'Enter', modifiers: Array.from(activeModifiers) });
      }
    });
  }

  if (btnBothBackspace) {
    btnBothBackspace.addEventListener('click', () => {
      send({
        type: 'key',
        key: 'Backspace',
        modifiers: Array.from(activeModifiers)
      });
    });
  }

  // Special keys & Arrow buttons (Escape, Tab, Enter, Space, Arrows)
  document.querySelectorAll('.key-btn[data-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const keyName = btn.dataset.key;
      send({
        type: 'key',
        key: keyName,
        modifiers: Array.from(activeModifiers)
      });

      // Clear modifiers after executing combination unless toggled again
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

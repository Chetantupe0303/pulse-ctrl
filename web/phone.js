/**
 * PulseCtrl - Phone Client Controller
 * Clean, minimal, utility-focused wireless trackpad & keyboard engine.
 * Supports automated session recovery, seamless reconnection, and 2 operational modes.
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
  const btnOverlayAction = document.getElementById('btnOverlayAction');

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
  let reconnectAttempts = 0;
  let isExplicitDisconnect = false;
  let terminalState = false;

  // Active modifier keys (Ctrl, Alt, Shift)
  const activeModifiers = new Set();

  // Storage key for seamless session resumption
  const STORAGE_KEY = 'pulse_reconnect_session';

  function setStatus(state, text) {
    statusPill.className = 'status-pill status-' + state;
    statusText.textContent = text;
  }

  function showOverlay(title, desc, showAction = false, actionText = 'Reconnect') {
    overlayTitle.textContent = title;
    overlayDesc.textContent = desc;
    overlayScreen.classList.remove('hidden');

    if (showAction && btnOverlayAction) {
      btnOverlayAction.style.display = 'inline-block';
      btnOverlayAction.textContent = actionText;
    } else if (btnOverlayAction) {
      btnOverlayAction.style.display = 'none';
    }
  }

  function hideOverlay() {
    overlayScreen.classList.add('hidden');
    if (btnOverlayAction) {
      btnOverlayAction.style.display = 'none';
    }
  }

  // Retrieve any stored reconnect token
  function getSavedReconnectData() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function saveReconnectData(reconnectToken) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        sessionId,
        reconnectToken,
        savedAt: Date.now()
      }));
    } catch (_) {}
  }

  function clearReconnectData() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  if (!sessionId && !getSavedReconnectData()?.sessionId) {
    showOverlay('Scan QR Code', 'Open the laptop page and scan the QR code to connect.', false);
    setStatus('disconnected', 'Scan QR');
    return;
  }

  // WebSocket Connection & Reconnection Engine
  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const saved = getSavedReconnectData();
    let wsUrl = '';

    // If we have a saved reconnect token for this session, use seamless reconnection
    if (saved && saved.sessionId === sessionId && saved.reconnectToken && !isExplicitDisconnect) {
      wsUrl = `${protocol}//${window.location.host}/ws?role=phone&session=${encodeURIComponent(saved.sessionId)}&reconnect=${encodeURIComponent(saved.reconnectToken)}`;
      showOverlay('Reconnecting...', 'Resuming session...');
      setStatus('waiting', 'Reconnecting');
    } else if (sessionId && token) {
      wsUrl = `${protocol}//${window.location.host}/ws?role=phone&session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
      showOverlay('Connecting...', 'Contacting laptop...');
      setStatus('waiting', 'Connecting');
    } else {
      showOverlay('Session Ended', 'Please scan the new QR code on your laptop screen.', false);
      setStatus('disconnected', 'Scan QR');
      return;
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      reconnectAttempts = 0;
      if (!saved || !saved.reconnectToken) {
        showOverlay('Waiting for Approval', 'Please click "Allow" on your laptop screen.');
        setStatus('waiting', 'Awaiting approval');
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'waiting_approval') {
          terminalState = false;
          showOverlay('Waiting for Approval', 'Please click "Allow" on your laptop screen.', false);
          setStatus('waiting', 'Awaiting approval');
        } else if (msg.type === 'paired') {
          isPaired = true;
          isExplicitDisconnect = false;
          terminalState = false;
          hideOverlay();
          setStatus('connected', 'Connected');

          if (msg.reconnectToken) {
            saveReconnectData(msg.reconnectToken);
          }

          if (msg.mode) {
            setMode(msg.mode === 'both' ? 'both' : 'trackpad', false);
          }
        } else if (msg.type === 'denied') {
          isPaired = false;
          terminalState = true;
          clearReconnectData();
          showOverlay('Connection Denied', 'The laptop denied connection. Please scan the QR code again.', false);
          setStatus('disconnected', 'Denied');
        } else if (msg.type === 'status' && msg.status === 'disconnected') {
          isPaired = false;
          terminalState = true;
          clearReconnectData();
          showOverlay('Disconnected', 'Connection ended. Scan the new QR code on your laptop to connect again.', false);
          setStatus('disconnected', 'Disconnected');
        } else if (msg.type === 'expired') {
          isPaired = false;
          terminalState = true;
          clearReconnectData();
          showOverlay('Session Expired', 'Session timed out. Scan the new QR code on your laptop to connect again.', false);
          setStatus('disconnected', 'Expired');
        } else if (msg.type === 'error') {
          isPaired = false;
          terminalState = true;
          clearReconnectData();
          showOverlay('Connection Error', msg.message || 'Unable to connect. Scan the new QR code on your laptop.', false);
          setStatus('disconnected', 'Error');
        } else if (msg.type === 'mode') {
          setMode(msg.value === 'both' ? 'both' : 'trackpad', false);
        }
      } catch (e) {
        console.error('[Phone] Parse error:', e);
      }
    };

    ws.onclose = () => {
      const hadSession = isPaired;
      isPaired = false;

      // Do not overwrite explicit terminal messages
      if (terminalState) {
        return;
      }

      if (isExplicitDisconnect) {
        clearReconnectData();
        showOverlay('Disconnected', 'You disconnected from the laptop. Scan the new QR code to connect again.', false);
        setStatus('disconnected', 'Disconnected');
        return;
      }

      // If unexpected disconnect (e.g. mobile lock or Wi-Fi blip), attempt auto-reconnect
      if (hadSession && reconnectAttempts < 5) {
        reconnectAttempts++;
        showOverlay('Reconnecting...', `Reconnecting (attempt ${reconnectAttempts}/5)...`);
        setStatus('waiting', 'Reconnecting');
        setTimeout(connect, 1500);
      } else {
        clearReconnectData();
        showOverlay('Disconnected', 'Connection lost. Scan the new QR code on your laptop to connect again.', false);
        setStatus('disconnected', 'Disconnected');
      }
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
    isExplicitDisconnect = true;
    terminalState = true;
    clearReconnectData();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'disconnect' }));
      try { ws.close(1000, 'User disconnect'); } catch (_) {}
    }
    showOverlay('Disconnected', 'You disconnected from the laptop. Scan the new QR code to connect again.', false);
    setStatus('disconnected', 'Disconnected');
  });

  if (btnOverlayAction) {
    btnOverlayAction.addEventListener('click', () => {
      isExplicitDisconnect = false;
      connect();
    });
  }

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

  // Handle mobile browser tab focus, back-forward cache, and new QR scans
  function checkUrlUpdate() {
    const currentParams = new URLSearchParams(window.location.search);
    const newSession = currentParams.get('session');
    const newToken = currentParams.get('token');

    // If URL has fresh session/token params different from current, reload with fresh state
    if (newSession && (newSession !== sessionId || newToken !== token)) {
      clearReconnectData();
      window.location.reload();
      return;
    }

    // If socket is closed and we have valid credentials but aren't in terminal state, reconnect
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      if (!terminalState && sessionId && token) {
        connect();
      }
    }
  }

  window.addEventListener('pageshow', checkUrlUpdate);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkUrlUpdate();
    }
  });

  // Start connection
  connect();
})();

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
  // SENSITIVITY, TOOLS & WINDOW MANAGEMENT
  // -------------------------------------------------------------
  let mouseSensitivity = 100;
  try {
    const savedSens = localStorage.getItem('pulse_mouse_sensitivity');
    if (savedSens) {
      mouseSensitivity = Math.max(20, Math.min(300, parseInt(savedSens, 10)));
    }
  } catch (_) {}

  const sensitivitySlider = document.getElementById('sensitivitySlider');
  const sensitivityDisplay = document.getElementById('sensitivityDisplay');
  const headerSensLabel = document.getElementById('headerSensLabel');

  function updateSensitivity(val) {
    mouseSensitivity = Math.max(20, Math.min(300, parseInt(val, 10)));
    if (sensitivitySlider) sensitivitySlider.value = mouseSensitivity;
    if (sensitivityDisplay) sensitivityDisplay.textContent = mouseSensitivity + '%';
    if (headerSensLabel) headerSensLabel.textContent = mouseSensitivity + '%';
    try {
      localStorage.setItem('pulse_mouse_sensitivity', mouseSensitivity.toString());
    } catch (_) {}
  }

  if (sensitivitySlider) {
    sensitivitySlider.value = mouseSensitivity;
    if (sensitivityDisplay) sensitivityDisplay.textContent = mouseSensitivity + '%';
    if (headerSensLabel) headerSensLabel.textContent = mouseSensitivity + '%';
    sensitivitySlider.addEventListener('input', (e) => {
      updateSensitivity(e.target.value);
    });
  }

  // Toggle Windows & Navigation Drawer
  const btnToggleTools = document.getElementById('btnToggleTools');
  const navDrawer = document.getElementById('navDrawer');
  if (btnToggleTools && navDrawer) {
    btnToggleTools.addEventListener('click', () => {
      const isHidden = navDrawer.style.display === 'none';
      navDrawer.style.display = isHidden ? 'block' : 'none';
      btnToggleTools.classList.toggle('active', isHidden);
    });
  }

  // Quick Zoom buttons
  const btnZoomIn = document.getElementById('btnZoomIn');
  const btnZoomOut = document.getElementById('btnZoomOut');
  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => {
      send({ type: 'key', key: '=', modifiers: ['control'] });
    });
  }
  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => {
      send({ type: 'key', key: '-', modifiers: ['control'] });
    });
  }

  // Navigation & Window Management Key Action mappings
  const NAV_KEY_ACTIONS = {
    'alt-tab': { key: 'Tab', modifiers: ['alt'] },
    'desktop': { key: 'd', modifiers: ['win'] },
    'maximize': { key: 'ArrowUp', modifiers: ['win'] },
    'minimize': { key: 'ArrowDown', modifiers: ['win'] },
    'snap-left': { key: 'ArrowLeft', modifiers: ['win'] },
    'snap-right': { key: 'ArrowRight', modifiers: ['win'] },
    'close-win': { key: 'F4', modifiers: ['alt'] },
    'back': { key: 'ArrowLeft', modifiers: ['alt'] },
    'forward': { key: 'ArrowRight', modifiers: ['alt'] },
    'refresh': { key: 'F5', modifiers: [] },
    'new-tab': { key: 't', modifiers: ['control'] }
  };

  document.querySelectorAll('.btn-nav-action[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const actionName = btn.dataset.nav;
      const mapping = NAV_KEY_ACTIONS[actionName];
      if (mapping) {
        send({
          type: 'key',
          key: mapping.key,
          modifiers: mapping.modifiers
        });
      }
    });
  });

  // Clicking & Dragging Lock state
  let isDragLocked = false;
  const btnDragToggle = document.getElementById('btnDragToggle');
  const btnDragToggleBoth = document.getElementById('btnDragToggleBoth');

  function setDragLock(locked) {
    isDragLocked = locked;
    const text = locked ? '✋ Drag: ON' : '✋ Drag: OFF';
    const textBoth = locked ? '✋ Dragging' : '✋ Drag';
    if (btnDragToggle) {
      btnDragToggle.textContent = text;
      btnDragToggle.classList.toggle('active', locked);
    }
    if (btnDragToggleBoth) {
      btnDragToggleBoth.textContent = textBoth;
      btnDragToggleBoth.classList.toggle('active', locked);
    }
    send({
      type: 'click',
      button: 'left',
      action: locked ? 'down' : 'up'
    });
  }

  function toggleDragLock() {
    setDragLock(!isDragLocked);
  }

  if (btnDragToggle) btnDragToggle.addEventListener('click', toggleDragLock);
  if (btnDragToggleBoth) btnDragToggleBoth.addEventListener('click', toggleDragLock);

  // -------------------------------------------------------------
  // MOUSEPAD ENGINE (Sensitivity, Dragging, Scrolling & Zooming)
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
    let lastScrollX = 0;
    let hasMoved = false;

    // Double-tap & hold drag state
    let lastTapEndTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let isDoubleTapDrag = false;

    // Pinch-to-zoom state
    let initialPinchDist = 0;
    let lastZoomTime = 0;

    let pendingDx = 0;
    let pendingDy = 0;
    let pendingScrollDy = 0;
    let pendingScrollDx = 0;
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

      if (pendingScrollDy !== 0 || pendingScrollDx !== 0) {
        send({
          type: 'scroll',
          dy: Math.round(pendingScrollDy),
          dx: Math.round(pendingScrollDx)
        });
        pendingScrollDy = 0;
        pendingScrollDx = 0;
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

        // Check for double-tap and hold (start drag gesture)
        const timeSinceLastTap = touchStartTime - lastTapEndTime;
        const distFromLastTap = Math.hypot(lastX - lastTapX, lastY - lastTapY);
        if (timeSinceLastTap < 300 && distFromLastTap < 35 && !isDragLocked) {
          isDoubleTapDrag = true;
          send({ type: 'click', button: 'left', action: 'down' });
        }
      } else if (e.touches.length === 2) {
        lastScrollX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastScrollY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        initialPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: false });

    element.addEventListener('touchmove', (e) => {
      e.preventDefault(); // Stop native scrolling & bounce
      maxTouchCount = Math.max(maxTouchCount, e.touches.length);

      if (e.touches.length === 1) {
        // 1-finger mouse movement (with percentage sensitivity scaling)
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;

        const dx = currentX - lastX;
        const dy = currentY - lastY;

        lastX = currentX;
        lastY = currentY;

        if (Math.abs(currentX - initialTouchX) > 4 || Math.abs(currentY - initialTouchY) > 4) {
          hasMoved = true;
        }

        // Apply sensitivity percentage (100% = 1.5 multiplier)
        const sensMultiplier = mouseSensitivity / 100;
        pendingDx += dx * 1.5 * sensMultiplier;
        pendingDy += dy * 1.5 * sensMultiplier;
        checkThrottle();

      } else if (e.touches.length === 2) {
        // 2-finger gesture: Scroll or Pinch-Zoom
        const currentPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const pinchDelta = currentPinchDist - initialPinchDist;

        // If finger distance changes significantly, interpret as Pinch-to-Zoom
        const now = Date.now();
        if (Math.abs(pinchDelta) > 30 && now - lastZoomTime > 180) {
          lastZoomTime = now;
          hasMoved = true;
          if (pinchDelta > 0) {
            // Pinch-out: Zoom In (Ctrl + =)
            send({ type: 'key', key: '=', modifiers: ['control'] });
          } else {
            // Pinch-in: Zoom Out (Ctrl + -)
            send({ type: 'key', key: '-', modifiers: ['control'] });
          }
          initialPinchDist = currentPinchDist;
          return;
        }

        // Otherwise, 2-finger 2D scrolling (vertical dy + horizontal dx)
        const currentScrollX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const currentScrollY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        const scrollDeltaX = currentScrollX - lastScrollX;
        const scrollDeltaY = currentScrollY - lastScrollY;

        lastScrollX = currentScrollX;
        lastScrollY = currentScrollY;

        hasMoved = true;

        pendingScrollDy += -scrollDeltaY * 1.4;
        pendingScrollDx += -scrollDeltaX * 1.4;
        checkThrottle();
      }
    }, { passive: false });

    element.addEventListener('touchend', (e) => {
      const elapsed = Date.now() - touchStartTime;

      if (isDoubleTapDrag) {
        // End double-tap drag on lift
        isDoubleTapDrag = false;
        send({ type: 'click', button: 'left', action: 'up' });
      } else if (!hasMoved && elapsed < 350) {
        // Tap detection (single-finger = left click, two-finger = right click)
        if (maxTouchCount === 1) {
          // If drag locked, tapping can release it
          if (isDragLocked) {
            setDragLock(false);
          } else {
            send({ type: 'click', button: 'left' });
            lastTapEndTime = Date.now();
            lastTapX = lastX;
            lastTapY = lastY;
          }
        } else if (maxTouchCount === 2) {
          send({ type: 'click', button: 'right' });
        }
      }

      if (e.touches.length === 0) {
        flushDeltas();
        maxTouchCount = 0;
      }
    }, { passive: false });

    element.addEventListener('touchcancel', () => {
      if (isDoubleTapDrag) {
        isDoubleTapDrag = false;
        send({ type: 'click', button: 'left', action: 'up' });
      }
      pendingDx = 0;
      pendingDy = 0;
      pendingScrollDy = 0;
      pendingScrollDx = 0;
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

/**
 * PulseCtrl - Laptop UI Controller
 * Manages WebSocket connection, QR code display, status updates, and "Allow this device?" flow.
 */

(function () {
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const qrSection = document.getElementById('qrSection');
  const qrImage = document.getElementById('qrImage');
  const qrDirectLink = document.getElementById('qrDirectLink');
  const connectedSection = document.getElementById('connectedSection');
  const activeModeBadge = document.getElementById('activeModeBadge');
  const disconnectBtn = document.getElementById('disconnectBtn');

  // Modal elements
  const allowModal = document.getElementById('allowModal');
  const modalDeviceUA = document.getElementById('modalDeviceUA');
  const modalDeviceIP = document.getElementById('modalDeviceIP');
  const allowBtn = document.getElementById('allowBtn');
  const denyBtn = document.getElementById('denyBtn');

  let ws = null;
  let currentSessionId = null;

  // Read URL query parameter for explicit session ID if provided
  const urlParams = new URLSearchParams(window.location.search);
  const paramSession = urlParams.get('session');

  function setStatus(state, text) {
    statusPill.className = 'status-pill status-' + state;
    statusText.textContent = text;

    if (state === 'connected') {
      qrSection.style.display = 'none';
      connectedSection.classList.add('active');
      disconnectBtn.disabled = false;
    } else if (state === 'waiting') {
      qrSection.style.display = 'flex';
      connectedSection.classList.remove('active');
      disconnectBtn.disabled = true;
    } else if (state === 'disconnected') {
      connectedSection.classList.remove('active');
      disconnectBtn.disabled = true;
    }
  }

  function showModal(device) {
    modalDeviceUA.textContent = device?.userAgent || 'Mobile Phone';
    modalDeviceIP.textContent = device?.ip || 'LAN Client';
    allowModal.classList.add('active');
  }

  function hideModal() {
    allowModal.classList.remove('active');
  }

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${protocol}//${window.location.host}/ws?role=laptop_web`;
    if (paramSession) {
      wsUrl += `&session=${encodeURIComponent(paramSession)}`;
    }

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Laptop] Connected to server via WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'session_info') {
          currentSessionId = msg.sessionId;
          if (msg.qrDataUrl) {
            qrImage.src = msg.qrDataUrl;
            qrDirectLink.href = msg.phoneUrl;
            qrDirectLink.textContent = msg.phoneUrl;
          }

          if (msg.status === 'connected') {
            setStatus('connected', 'Phone connected');
          } else {
            setStatus('waiting', 'Waiting for phone');
          }

          if (msg.mode) {
            activeModeBadge.textContent = 'Mode: ' + msg.mode.toUpperCase();
          }
        } else if (msg.type === 'waiting_helper') {
          setStatus('waiting', 'Waiting for laptop helper...');
          qrDirectLink.textContent = msg.message;
        } else if (msg.type === 'pair_request') {
          // Phone scanned QR and wants to connect!
          showModal(msg.device);
        } else if (msg.type === 'status') {
          if (msg.status === 'connected') {
            hideModal();
            setStatus('connected', 'Phone connected');
          } else if (msg.status === 'waiting') {
            hideModal();
            setStatus('waiting', 'Waiting for phone');
          } else if (msg.status === 'disconnected') {
            hideModal();
            setStatus('disconnected', msg.message || 'Disconnected');
          }
        } else if (msg.type === 'mode') {
          activeModeBadge.textContent = 'Mode: ' + msg.value.toUpperCase();
        } else if (msg.type === 'expired') {
          hideModal();
          setStatus('disconnected', msg.message || 'Session expired');
        }
      } catch (e) {
        console.error('[Laptop] Error parsing message:', e);
      }
    };

    ws.onclose = () => {
      console.warn('[Laptop] WebSocket closed. Retrying in 2 seconds...');
      setStatus('disconnected', 'Disconnected from server');
      setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = (err) => {
      console.error('[Laptop] WebSocket error:', err);
    };
  }

  // Handle Allow button
  allowBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pair_response', allow: true }));
    }
    hideModal();
  });

  // Handle Deny button
  denyBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'pair_response', allow: false }));
    }
    hideModal();
  });

  // Handle Disconnect button
  disconnectBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'disconnect' }));
    }
  });

  // Initialize connection
  connectWebSocket();
})();

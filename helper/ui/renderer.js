/**
 * PulseCtrl Helper - UI Renderer Script
 * Controls QR display, session transitions, and "Allow this device?" approval security.
 */

(function () {
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const serverTargetText = document.getElementById('serverTargetText');

  const qrSection = document.getElementById('qrSection');
  const qrLoading = document.getElementById('qrLoading');
  const qrImage = document.getElementById('qrImage');

  const connectedSection = document.getElementById('connectedSection');
  const connectedDeviceName = document.getElementById('connectedDeviceName');
  const modeBadge = document.getElementById('modeBadge');

  const btnNewQr = document.getElementById('btnNewQr');
  const btnDisconnect = document.getElementById('btnDisconnect');

  const allowModal = document.getElementById('allowModal');
  const modalDeviceName = document.getElementById('modalDeviceName');
  const btnAllow = document.getElementById('btnAllow');
  const btnDeny = document.getElementById('btnDeny');

  function setStatus(state, label) {
    statusPill.className = 'status-pill status-' + state;
    statusText.textContent = label;

    if (state === 'connected') {
      qrSection.style.display = 'none';
      connectedSection.style.display = 'flex';
      btnDisconnect.disabled = false;
      allowModal.style.display = 'none';
    } else if (state === 'waiting' || state === 'connecting') {
      qrSection.style.display = 'flex';
      connectedSection.style.display = 'none';
      btnDisconnect.disabled = true;
    } else {
      connectedSection.style.display = 'none';
      btnDisconnect.disabled = true;
    }
  }

  function showModal(deviceName) {
    modalDeviceName.textContent = deviceName || 'Mobile Device';
    allowModal.style.display = 'flex';
  }

  function hideModal() {
    allowModal.style.display = 'none';
  }

  if (window.pulseAPI) {
    // 1. Status updates
    window.pulseAPI.onStatus((data) => {
      if (data.target) {
        serverTargetText.textContent = data.target;
      }

      if (data.status === 'paired') {
        setStatus('connected', 'Phone connected');
        if (data.deviceName) connectedDeviceName.textContent = data.deviceName;
        if (data.mode) {
          const modeName = data.mode === 'both' ? 'Both (Trackpad + Keys)' : 'Mousepad';
          modeBadge.textContent = 'Mode: ' + modeName;
        }
      } else if (data.status === 'connected') {
        setStatus('waiting', 'Waiting for phone');
      } else if (data.status === 'connecting') {
        setStatus('connecting', 'Connecting...');
      } else {
        setStatus('connecting', 'Reconnecting...');
      }
    });

    // 2. Session Ready (QR Code available)
    window.pulseAPI.onSessionReady((data) => {
      hideModal();
      if (data.qrDataUrl) {
        qrImage.src = data.qrDataUrl;
        qrImage.style.display = 'block';
        qrLoading.style.display = 'none';
      }
      setStatus('waiting', 'Waiting for phone');
    });

    // 3. Pair Request ("Allow this device?" prompt)
    window.pulseAPI.onPairRequest((data) => {
      showModal(data.deviceName);
    });

    // 4. Phone paired
    window.pulseAPI.onPaired((data) => {
      hideModal();
      setStatus('connected', 'Phone connected');
      if (data.deviceName) connectedDeviceName.textContent = data.deviceName;
      if (data.mode) {
        const modeName = data.mode === 'both' ? 'Both (Trackpad + Keys)' : 'Mousepad';
        modeBadge.textContent = 'Mode: ' + modeName;
      }
    });

    // 5. Button Actions
    btnAllow.addEventListener('click', () => {
      hideModal();
      window.pulseAPI.sendPairApproval(true);
    });

    btnDeny.addEventListener('click', () => {
      hideModal();
      window.pulseAPI.sendPairApproval(false);
    });

    btnNewQr.addEventListener('click', () => {
      qrImage.style.display = 'none';
      qrLoading.style.display = 'flex';
      hideModal();
      window.pulseAPI.requestNewQr();
    });

    btnDisconnect.addEventListener('click', () => {
      hideModal();
      window.pulseAPI.disconnect();
      setStatus('waiting', 'Waiting for phone');
    });
  }
})();

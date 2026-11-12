/**
 * PulseCtrl Helper - Electron Main Process
 * System Tray, Single Instance Lock, Auto-start with Windows, and QR Pairing UI.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { PulseHelperClient } = require('./client');

// 1. Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let helperClient = null;
let isQuitting = false;

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const ICON_PATH = path.join(ASSETS_DIR, 'icon.png');
const TRAY_ICON_PATH = path.join(ASSETS_DIR, 'tray-icon.png');

function getTrayIcon() {
  if (fs.existsSync(TRAY_ICON_PATH)) {
    return nativeImage.createFromPath(TRAY_ICON_PATH);
  }
  if (fs.existsSync(ICON_PATH)) {
    return nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  }
  return nativeImage.createEmpty();
}

function getAppIcon() {
  if (fs.existsSync(ICON_PATH)) {
    return nativeImage.createFromPath(ICON_PATH);
  }
  return null;
}

function createWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 380,
    height: 540,
    resizable: false,
    maximizable: false,
    title: 'PulseCtrl Helper',
    icon: getAppIcon(),
    backgroundColor: '#0a0e17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.removeMenu(); // Clean desktop window without default menu bar
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  // Closing window minimizes to system tray
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Relay current state once DOM is loaded
  mainWindow.webContents.on('did-finish-load', () => {
    if (helperClient) {
      sendClientState();
    }
  });
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function sendClientState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const target = helperClient.resolvedUrls
    ? helperClient.resolvedUrls.displayTarget
    : helperClient.target;

  mainWindow.webContents.send('helper-status', {
    status: helperClient.status,
    target: target
  });

  if (helperClient.currentSession) {
    mainWindow.webContents.send('session-ready', helperClient.currentSession);
  }
}

// 2. Tray Menu & Auto-Start Configuration
function buildTrayMenu() {
  const loginSettings = app.getLoginItemSettings();
  const isAutoStart = loginSettings.openAtLogin;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show QR',
      click: () => showWindow()
    },
    {
      label: 'Disconnect',
      enabled: helperClient ? (helperClient.status === 'paired') : false,
      click: () => {
        if (helperClient) {
          helperClient.disconnectSession();
        }
      }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: isAutoStart,
      click: (menuItem) => {
        const nextState = menuItem.checked;
        app.setLoginItemSettings({
          openAtLogin: nextState,
          path: process.execPath
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        if (helperClient) {
          helperClient.destroy();
        }
        app.quit();
      }
    }
  ]);

  return contextMenu;
}

function createTray() {
  if (tray) return;

  tray = new Tray(getTrayIcon());
  tray.setToolTip('PulseCtrl Helper');
  tray.setContextMenu(buildTrayMenu());

  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      showWindow();
    }
  });

  tray.on('double-click', () => {
    showWindow();
  });
}

function updateTrayState() {
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
}

// 3. Start Helper Client & Hook Events
function startHelper() {
  helperClient = new PulseHelperClient({
    configPath: path.join(__dirname, '..', '.pulse-config.json'),
    savedTargetPath: path.join(app.getPath('userData'), '.pulse-target.txt')
  });

  helperClient.on('status', (data) => {
    updateTrayState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('helper-status', data);
    }
  });

  helperClient.on('session_ready', (data) => {
    updateTrayState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-ready', data);
    }
  });

  helperClient.on('pair_request', (data) => {
    // If window is minimized or hidden, surface it so user can approve
    showWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pair-request', data);
    }
  });

  helperClient.on('paired', (data) => {
    updateTrayState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('phone-paired', data);
    }
  });

  helperClient.on('phone_disconnected', () => {
    updateTrayState();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('helper-status', { status: 'connected' });
    }
  });

  helperClient.connect();
}

// 4. IPC handlers from Renderer
ipcMain.handle('pair-approval', (_, allow) => {
  if (helperClient) {
    helperClient.respondPairApproval(allow);
  }
});

ipcMain.handle('request-new-qr', () => {
  if (helperClient) {
    helperClient.requestNewQr();
  }
});

ipcMain.handle('disconnect-session', () => {
  if (helperClient) {
    helperClient.disconnectSession();
  }
});

// 5. App Lifecycle
if (gotTheLock) {
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    startHelper();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    // On Windows, keep app running in tray when window is closed
  });
}

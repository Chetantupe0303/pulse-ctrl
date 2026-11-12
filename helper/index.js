/**
 * PulseCtrl - Laptop Helper (CLI entry point)
 * Connects to the PulseCtrl server and executes mouse and keyboard events.
 */

const { exec } = require('child_process');
const { PulseHelperClient } = require('./client');

let hasOpenedBrowser = false;

function openBrowserOnce(url) {
  if (hasOpenedBrowser) return;
  hasOpenedBrowser = true;
  const startCmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(startCmd, () => {});
}

const client = new PulseHelperClient();

client.on('session_ready', (session) => {
  console.log('');
  console.log('='.repeat(60));
  console.log('  ⚡ PulseCtrl Helper Ready');
  console.log(`  Session ID: ${session.sessionId}`);
  console.log(`  Laptop Web: ${session.webUrl}`);
  console.log(`  Phone URL:  ${session.phoneUrl}`);
  console.log('='.repeat(60));
  console.log('  Waiting for phone to scan QR code and pair...');
  console.log('');

  openBrowserOnce(session.webUrl);
});

client.connect();

module.exports = client;

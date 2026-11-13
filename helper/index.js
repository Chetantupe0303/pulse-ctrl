/**
 * PulseCtrl local laptop helper. Run the server before starting this process.
 */

const { exec } = require('child_process');
const { PulseHelperClient } = require('./client');

function openBrowserOnce(url) {
  const startCmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(startCmd, () => {});
}

const client = new PulseHelperClient();
let openPageForNextSession = true;

client.on('status', ({ status }) => {
  if (status === 'disconnected') openPageForNextSession = true;
});

client.on('session_ready', (session) => {
  console.log('');
  console.log('='.repeat(60));
  console.log('  ⚡ PulseCtrl Helper Ready');
  console.log(`  Session ID: ${session.sessionId}`);
  console.log(`  Laptop Web: ${session.webUrl}`);
  console.log(`  Phone URL:  ${session.phoneUrl}`);
  console.log('='.repeat(60));
  console.log('  The local laptop page shows the QR code and approval prompt.');
  console.log('  Waiting for phone to scan and request approval...');
  console.log('');

  if (openPageForNextSession) {
    openBrowserOnce(session.webUrl);
    openPageForNextSession = false;
  }
});

client.connect();

module.exports = client;

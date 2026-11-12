/**
 * Generates brand icons for PulseCtrl:
 * assets/icon.png (256x256)
 * assets/tray-icon.png (32x32)
 * assets/icon.ico (Windows icon)
 */

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

function drawPulseIcon(image, size) {
  const bg = Jimp.rgbaToInt(15, 23, 42, 255); // Dark Slate #0f172a
  const border = Jimp.rgbaToInt(56, 189, 248, 255); // Sky Blue #38bdf8
  const cyan = Jimp.rgbaToInt(6, 182, 212, 255); // Cyan #06b6d4
  const white = Jimp.rgbaToInt(255, 255, 255, 255);

  const radius = size * 0.2;
  const cx = size / 2;
  const cy = size / 2;

  // Draw rounded card background
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const dx = Math.max(Math.abs(x - cx) - (cx - radius), 0);
      const dy = Math.max(Math.abs(y - cy) - (cy - radius), 0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= radius) {
        if (dist >= radius - (size > 64 ? 6 : 2)) {
          image.setPixelColor(border, x, y);
        } else {
          image.setPixelColor(bg, x, y);
        }
      }
    }
  }

  // Draw Lightning Bolt ⚡ shape in the center
  const scale = size / 256;
  const points = [
    [135, 35],
    [85, 135],
    [130, 135],
    [115, 220],
    [175, 115],
    [130, 115],
    [155, 35]
  ].map(([px, py]) => [Math.round(px * scale), Math.round(py * scale)]);

  function fillPolygon(pts, color) {
    let minX = pts[0][0], maxX = pts[0][0], minY = pts[0][1], maxY = pts[0][1];
    for (const [x, y] of pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    for (let y = minY; y <= maxY; y++) {
      const nodes = [];
      let j = pts.length - 1;
      for (let i = 0; i < pts.length; i++) {
        if ((pts[i][1] < y && pts[j][1] >= y) || (pts[j][1] < y && pts[i][1] >= y)) {
          nodes.push(Math.round(pts[i][0] + (y - pts[i][1]) / (pts[j][1] - pts[i][1]) * (pts[j][0] - pts[i][0])));
        }
        j = i;
      }
      nodes.sort((a, b) => a - b);
      for (let i = 0; i < nodes.length; i += 2) {
        if (nodes[i] >= maxX) break;
        if (nodes[i + 1] > minX) {
          const start = Math.max(nodes[i], minX);
          const end = Math.min(nodes[i + 1], maxX);
          for (let x = start; x <= end; x++) {
            image.setPixelColor(color, x, y);
          }
        }
      }
    }
  }

  fillPolygon(points, cyan);

  // Inner highlight
  const innerPoints = points.map(([x, y]) => [
    Math.round(cx + (x - cx) * 0.75),
    Math.round(cy + (y - cy) * 0.75)
  ]);
  fillPolygon(innerPoints, white);
}

function createIcoFromPngBuffers(pngBuffers) {
  // ICO header
  const count = pngBuffers.length;
  const header = Buffer.alloc(6 + count * 16);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type 1 = ICO
  header.writeUInt16LE(count, 4); // Number of images

  let offset = 6 + count * 16;
  const entryBuffers = [];

  for (let i = 0; i < count; i++) {
    const { buffer, size } = pngBuffers[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // Width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // Height
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(buffer.length, 8); // Image size in bytes
    entry.writeUInt32LE(offset, 12); // Offset to image data

    entryBuffers.push(entry);
    offset += buffer.length;
  }

  return Buffer.concat([header.subarray(0, 6), ...entryBuffers, ...pngBuffers.map(p => p.buffer)]);
}

async function generate() {
  console.log('Generating PulseCtrl icons...');

  // 1. 256x256 app icon
  const icon256 = new Jimp(256, 256, 0x00000000);
  drawPulseIcon(icon256, 256);
  const buf256 = await icon256.getBufferAsync(Jimp.MIME_PNG);
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.png'), buf256);
  console.log('  ✓ assets/icon.png created (256x256)');

  // 2. 32x32 tray icon
  const icon32 = new Jimp(32, 32, 0x00000000);
  drawPulseIcon(icon32, 32);
  const buf32 = await icon32.getBufferAsync(Jimp.MIME_PNG);
  fs.writeFileSync(path.join(ASSETS_DIR, 'tray-icon.png'), buf32);
  console.log('  ✓ assets/tray-icon.png created (32x32)');

  // 3. 64x64 icon
  const icon64 = new Jimp(64, 64, 0x00000000);
  drawPulseIcon(icon64, 64);
  const buf64 = await icon64.getBufferAsync(Jimp.MIME_PNG);

  // 4. Combine into icon.ico
  const icoBuffer = createIcoFromPngBuffers([
    { buffer: buf32, size: 32 },
    { buffer: buf64, size: 64 },
    { buffer: buf256, size: 256 }
  ]);
  fs.writeFileSync(path.join(ASSETS_DIR, 'icon.ico'), icoBuffer);
  console.log('  ✓ assets/icon.ico created (multi-size ICO)');
}

generate().catch(console.error);

import fs from 'node:fs';
import path from 'node:path';
import { app, nativeImage } from 'electron';

function makeOuterWhiteTransparent(img, targetSize) {
  const resized = img.resize({ width: targetSize, height: targetSize, quality: 'best' });
  const { width, height } = resized.getSize();
  const buf = Buffer.from(resized.toBitmap()); // BGRA

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const isNearWhite = (idx) => {
    const off = idx * 4;
    const b = buf[off];
    const g = buf[off + 1];
    const r = buf[off + 2];
    return r >= 242 && g >= 242 && b >= 242;
  };

  const pushIfWhite = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    if (visited[idx] || !isNearWhite(idx)) return;
    visited[idx] = 1;
    queue[tail++] = idx;
  };

  for (let x = 0; x < width; x++) {
    pushIfWhite(x, 0);
    pushIfWhite(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushIfWhite(0, y);
    pushIfWhite(width - 1, y);
  }

  while (head < tail) {
    const idx = queue[head++];
    const off = idx * 4;
    buf[off + 3] = 0; // transparent alpha
    const x = idx % width;
    const y = (idx - x) / width;
    pushIfWhite(x + 1, y);
    pushIfWhite(x - 1, y);
    pushIfWhite(x, y + 1);
    pushIfWhite(x, y - 1);
  }

  return nativeImage.createFromBitmap(buf, { width, height });
}

function buildIcoFromPngBuffers(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dirEntries = [];
  let offset = 6 + entries.length * 16;

  for (const { size, buffer } of entries) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...entries.map((e) => e.buffer)]);
}

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error('Usage: electron scripts/generate-icons.mjs <source-image-path>');
  process.exit(1);
}

app.whenReady().then(() => {
  const raw = nativeImage.createFromPath(path.resolve(sourcePath));
  if (raw.isEmpty()) {
    throw new Error(`Failed to load source image: ${sourcePath}`);
  }

  const base512 = makeOuterWhiteTransparent(raw, 512);

  fs.mkdirSync(path.resolve('build'), { recursive: true });
  fs.mkdirSync(path.resolve('src/renderer/assets'), { recursive: true });

  fs.writeFileSync(path.resolve('build/icon.png'), base512.toPNG());
  fs.writeFileSync(
    path.resolve('src/renderer/assets/icon.png'),
    base512.resize({ width: 128, height: 128, quality: 'best' }).toPNG(),
  );

  const icoSizes = [256, 128, 64, 48, 32, 16];
  const entries = icoSizes.map((size) => ({
    size,
    buffer: base512.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));
  fs.writeFileSync(path.resolve('build/icon.ico'), buildIcoFromPngBuffers(entries));

  console.log('ICONS_GENERATED_OK');
  app.quit();
});

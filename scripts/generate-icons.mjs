import fs from 'node:fs';
import path from 'node:path';
import { app, nativeImage } from 'electron';

function unpremultiplyChannel(c, a) {
  if (a === 0) return 0;
  if (a === 255) return c;
  return Math.min(255, Math.round((c * 255) / a));
}

function makeOuterWhiteTransparent(img) {
  const srcSize = img.getSize();
  const workSize = Math.min(1024, Math.max(srcSize.width, srcSize.height, 512));
  const working =
    srcSize.width === workSize && srcSize.height === workSize
      ? img
      : img.resize({ width: workSize, height: workSize, quality: 'best' });

  const { width, height } = working.getSize();
  const buf = Buffer.from(working.toBitmap()); // premultiplied BGRA

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const isOuterBg = (idx) => {
    const off = idx * 4;
    const a = buf[off + 3];
    if (a === 0) return true;
    const b = unpremultiplyChannel(buf[off], a);
    const g = unpremultiplyChannel(buf[off + 1], a);
    const r = unpremultiplyChannel(buf[off + 2], a);
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return minC >= 200 && maxC - minC <= 28;
  };

  const pushIfBg = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * width + x;
    if (visited[idx] || !isOuterBg(idx)) return;
    visited[idx] = 1;
    queue[tail++] = idx;
  };

  for (let x = 0; x < width; x++) {
    pushIfBg(x, 0);
    pushIfBg(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushIfBg(0, y);
    pushIfBg(width - 1, y);
  }

  while (head < tail) {
    const idx = queue[head++];
    const off = idx * 4;
    // Zero all 4 bytes (valid premultiplied BGRA) so Electron resize never restores RGB halo
    buf[off] = 0;
    buf[off + 1] = 0;
    buf[off + 2] = 0;
    buf[off + 3] = 0;
    const x = idx % width;
    const y = (idx - x) / width;
    pushIfBg(x + 1, y);
    pushIfBg(x - 1, y);
    pushIfBg(x, y + 1);
    pushIfBg(x, y - 1);
  }

  // 1-pixel outer-edge defringe pass for residual light-grey/white anti-aliasing halo
  const defringeIndices = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const off = idx * 4;
      const a = buf[off + 3];
      if (a === 0) continue;

      let hasTransparentNeighbor = false;
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || buf[(ny * width + nx) * 4 + 3] === 0) {
          hasTransparentNeighbor = true;
          break;
        }
      }
      if (!hasTransparentNeighbor) continue;

      const b = unpremultiplyChannel(buf[off], a);
      const g = unpremultiplyChannel(buf[off + 1], a);
      const r = unpremultiplyChannel(buf[off + 2], a);
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (minC >= 175 && maxC - minC <= 35) {
        defringeIndices.push(idx);
      }
    }
  }

  for (const idx of defringeIndices) {
    const off = idx * 4;
    buf[off] = 0;
    buf[off + 1] = 0;
    buf[off + 2] = 0;
    buf[off + 3] = 0;
  }

  // Compute tight bounding box of opaque foreground and frame it cleanly (~3.5% margin per side)
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (buf[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('All pixels became transparent during icon background removal.');
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const contentMax = Math.max(boxW, boxH);
  const canvasSize = Math.round(contentMax / 0.93);
  const paddedBuf = Buffer.alloc(canvasSize * canvasSize * 4); // zero-initialized transparent BGRA
  const dstStartX = Math.floor((canvasSize - boxW) / 2);
  const dstStartY = Math.floor((canvasSize - boxH) / 2);

  for (let sy = 0; sy < boxH; sy++) {
    for (let sx = 0; sx < boxW; sx++) {
      const sOff = ((minY + sy) * width + (minX + sx)) * 4;
      const dOff = ((dstStartY + sy) * canvasSize + (dstStartX + sx)) * 4;
      const a = buf[sOff + 3];
      if (a === 0) continue;
      // Enforce valid premultiplied BGRA (B, G, R <= A)
      paddedBuf[dOff] = Math.min(buf[sOff], a);
      paddedBuf[dOff + 1] = Math.min(buf[sOff + 1], a);
      paddedBuf[dOff + 2] = Math.min(buf[sOff + 2], a);
      paddedBuf[dOff + 3] = a;
    }
  }

  // Verify premultiplied invariant across the output buffer
  for (let i = 0; i < paddedBuf.length; i += 4) {
    const a = paddedBuf[i + 3];
    if (paddedBuf[i] > a || paddedBuf[i + 1] > a || paddedBuf[i + 2] > a) {
      throw new Error(`Invalid premultiplied BGRA pixel at byte offset ${i}`);
    }
  }

  return nativeImage.createFromBitmap(paddedBuf, { width: canvasSize, height: canvasSize });
}

function resizeClean(img, size) {
  const resized = img.resize({ width: size, height: size, quality: 'good' });
  const { width, height } = resized.getSize();
  const buf = Buffer.from(resized.toBitmap());
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3];
    if (a <= 8) {
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = 0;
    } else {
      buf[i] = Math.min(buf[i], a);
      buf[i + 1] = Math.min(buf[i + 1], a);
      buf[i + 2] = Math.min(buf[i + 2], a);
    }
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

  const cleaned = makeOuterWhiteTransparent(raw);
  const base512 = resizeClean(cleaned, 512);

  fs.mkdirSync(path.resolve('build'), { recursive: true });
  fs.mkdirSync(path.resolve('src/renderer/assets'), { recursive: true });

  fs.writeFileSync(path.resolve('build/icon.png'), base512.toPNG());
  fs.writeFileSync(
    path.resolve('src/renderer/assets/icon.png'),
    resizeClean(cleaned, 128).toPNG(),
  );

  const icoSizes = [256, 128, 64, 48, 32, 16];
  const entries = icoSizes.map((size) => ({
    size,
    buffer: resizeClean(cleaned, size).toPNG(),
  }));
  fs.writeFileSync(path.resolve('build/icon.ico'), buildIcoFromPngBuffers(entries));

  console.log('ICONS_GENERATED_OK');
  app.quit();
});

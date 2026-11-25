import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foxreader-sel-test-'));
  const bundlePath = path.join(tempRoot, 'selection.mjs');

  try {
    await esbuild.build({
      entryPoints: [path.resolve('src/renderer/lib/selection.ts')],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
    });

    const { cleanAndNormalizeRects } = await import(pathToFileURL(bundlePath).toString());

    const pageRect = { left: 100, top: 50, width: 600, height: 800 };

    // 1. Same-line adjacent fragments merge into 1 rect
    const sameLine = cleanAndNormalizeRects(
      [
        { left: 140, top: 120, right: 200, bottom: 136 },
        { left: 203, top: 121, right: 260, bottom: 135 },
      ],
      pageRect,
    );
    assert.equal(sameLine.length, 1);
    assert.ok(sameLine[0].x >= 0 && sameLine[0].x <= 1);
    assert.ok(Math.abs(sameLine[0].w - (260 - 140) / 600) < 0.001);

    // 2. Two-column gutter (>= 24px gap) MUST NOT merge across columns
    const twoCols = cleanAndNormalizeRects(
      [
        { left: 130, top: 200, right: 370, bottom: 215 },
        { left: 400, top: 200, right: 650, bottom: 215 },
      ],
      pageRect,
    );
    assert.equal(twoCols.length, 2, 'Two-column rects across gutter must stay separate');

    // 3. Noise rects (<2px wide, <3px tall) & giant ghost wrappers (>20% page height) are filtered
    const filtered = cleanAndNormalizeRects(
      [
        { left: 130, top: 300, right: 131, bottom: 314 }, // too narrow
        { left: 130, top: 300, right: 200, bottom: 302 }, // too thin
        { left: 100, top: 50, right: 700, bottom: 500 }, // giant ghost box
        { left: 140, top: 340, right: 250, bottom: 356 }, // valid rect
      ],
      pageRect,
    );
    assert.equal(filtered.length, 1);

    // 4. Duplicate contained rects are deduplicated
    const deduped = cleanAndNormalizeRects(
      [
        { left: 140, top: 400, right: 300, bottom: 416 },
        { left: 142, top: 401, right: 298, bottom: 415 },
      ],
      pageRect,
    );
    assert.equal(deduped.length, 1);

    // 5. All normalized coords stay within [0, 1]
    for (const r of [...sameLine, ...twoCols, ...filtered, ...deduped]) {
      assert.ok(r.x >= 0 && r.x <= 1);
      assert.ok(r.y >= 0 && r.y <= 1);
      assert.ok(r.w > 0 && r.x + r.w <= 1.00001);
      assert.ok(r.h > 0 && r.y + r.h <= 1.00001);
    }

    console.log('ALL_SELECTION_TESTS_PASSED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

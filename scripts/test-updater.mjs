import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foxreader-updater-test-'));
  const bundlePath = path.join(tempRoot, 'updaterCore.mjs');

  try {
    await esbuild.build({
      entryPoints: [path.resolve('src/main/updaterCore.ts')],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
    });

    const {
      selectReleaseAsset,
      parseSha256Sums,
      buildWindowsNsisSilentArgs,
      isAllowedReleaseAssetUrl,
    } = await import(pathToFileURL(bundlePath).toString());

    const base = 'https://github.com/minorfox/FoxReader/releases/download/v0.2.2/';
    const sampleAssets = [
      { name: 'FoxReader.Setup.0.2.2.exe', browser_download_url: base + 'FoxReader.Setup.0.2.2.exe', size: 100 },
      { name: 'FoxReader.0.2.2.exe', browser_download_url: base + 'FoxReader.0.2.2.exe', size: 95 },
      { name: 'FoxReader-0.2.2-arm64.dmg', browser_download_url: base + 'FoxReader-0.2.2-arm64.dmg', size: 110 },
      { name: 'FoxReader-0.2.2.dmg', browser_download_url: base + 'FoxReader-0.2.2.dmg', size: 112 },
      { name: 'SHA256SUMS.txt', browser_download_url: base + 'SHA256SUMS.txt', size: 1 },
      {
        name: 'FoxReader.Setup.9.9.9.exe',
        browser_download_url: 'https://evil.example.com/FoxReader.Setup.9.9.9.exe',
        size: 10,
      },
    ];

    assert.equal(isAllowedReleaseAssetUrl(base + 'FoxReader.Setup.0.2.2.exe'), true);
    assert.equal(isAllowedReleaseAssetUrl('https://evil.example.com/foo.exe'), false);

    assert.equal(selectReleaseAsset(sampleAssets, 'win-nsis').asset?.name, 'FoxReader.Setup.0.2.2.exe');
    assert.equal(selectReleaseAsset(sampleAssets, 'win-portable').asset?.name, 'FoxReader.0.2.2.exe');
    assert.equal(selectReleaseAsset(sampleAssets, 'mac-arm64').asset?.name, 'FoxReader-0.2.2-arm64.dmg');
    assert.equal(selectReleaseAsset(sampleAssets, 'mac-x64').asset?.name, 'FoxReader-0.2.2.dmg');
    assert.equal(selectReleaseAsset(sampleAssets, 'win-nsis').checksumAsset?.name, 'SHA256SUMS.txt');
    assert.equal(selectReleaseAsset(sampleAssets, 'dev', 'darwin', 'arm64').asset?.name, 'FoxReader-0.2.2-arm64.dmg');
    assert.equal(selectReleaseAsset(sampleAssets, 'dev', 'win32', 'x64').asset?.name, 'FoxReader.Setup.0.2.2.exe');

    // Reject untrusted origins even if filename matches
    const untrustedOnly = [sampleAssets[5]];
    assert.equal(selectReleaseAsset(untrustedOnly, 'win-nsis').asset, undefined);

    // Parse SHA256SUMS.txt format (including spaced electron-builder names matched against GitHub's dotted asset names)
    const shaA = 'a'.repeat(64);
    const shaB = 'B'.repeat(64);
    const shaC = 'c'.repeat(64);
    const parsedSums = parseSha256Sums(
      `${shaA} *FoxReader Setup 0.3.0.exe\n${shaC} *FoxReader 0.3.0.exe\n${shaB} *./FoxReader-0.3.0-arm64.dmg\n`,
    );
    assert.equal(parsedSums.get('FoxReader.Setup.0.3.0.exe'), shaA);
    assert.equal(parsedSums.get('FoxReader Setup 0.3.0.exe'), shaA);
    assert.equal(parsedSums.get('FoxReader.0.3.0.exe'), shaC);
    assert.equal(parsedSums.get('FoxReader-0.3.0-arm64.dmg'), shaB.toLowerCase());

    // Build NSIS silent update arguments without whitespace so quoting is safe
    const nsisArgs = buildWindowsNsisSilentArgs();
    assert.deepEqual(nsisArgs, ['--updated', '/S', '--force-run']);
    assert.ok(nsisArgs.every((arg) => !/\s/.test(arg)));

    console.log('ALL_UPDATER_TESTS_PASSED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

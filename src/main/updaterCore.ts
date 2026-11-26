import type { UpdateInstallMode } from '../shared/types.js';

export const ALLOWED_RELEASE_DOWNLOAD_PREFIX =
  'https://github.com/minorfox/FoxReader/releases/download/';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export function isAllowedReleaseAssetUrl(url: string | undefined): url is string {
  return typeof url === 'string' && url.startsWith(ALLOWED_RELEASE_DOWNLOAD_PREFIX);
}

/**
 * Selects the matching installer/DMG asset and SHA256SUMS.txt for the current runtime mode.
 */
export function selectReleaseAsset(
  assets: ReleaseAsset[],
  mode: UpdateInstallMode,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { asset?: ReleaseAsset; checksumAsset?: ReleaseAsset } {
  const validAssets = assets.filter(
    (a) => typeof a?.name === 'string' && isAllowedReleaseAssetUrl(a.browser_download_url),
  );

  const checksumAsset = validAssets.find((a) => /^SHA256SUMS\.txt$/i.test(a.name.trim()));

  const effectiveMode: Exclude<UpdateInstallMode, 'dev'> =
    mode === 'dev'
      ? platform === 'win32'
        ? 'win-nsis'
        : arch === 'arm64'
          ? 'mac-arm64'
          : 'mac-x64'
      : mode;

  let asset: ReleaseAsset | undefined;
  if (effectiveMode === 'win-nsis') {
    asset =
      validAssets.find((a) => /^FoxReader\.Setup\..*\.exe$/i.test(a.name.trim())) ??
      validAssets.find((a) => /Setup.*\.exe$/i.test(a.name.trim()));
  } else if (effectiveMode === 'win-portable') {
    asset = validAssets.find(
      (a) => /^FoxReader\..*\.exe$/i.test(a.name.trim()) && !/Setup/i.test(a.name),
    );
  } else if (effectiveMode === 'mac-arm64') {
    asset = validAssets.find((a) => /arm64.*\.dmg$/i.test(a.name.trim()));
  } else {
    asset = validAssets.find((a) => /\.dmg$/i.test(a.name.trim()) && !/arm64/i.test(a.name));
  }

  return { asset, checksumAsset };
}

/**
 * Parses `sha256sum` output lines (`<64-hex>  <filename>` or `<64-hex> *<filename>`).
 */
export function parseSha256Sums(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line);
    if (!match) continue;
    const hash = match[1].toLowerCase();
    const fileName = match[2].trim().replace(/^\.\//, '');
    if (fileName) {
      map.set(fileName, hash);
      map.set(fileName.toLowerCase(), hash);
      const dotted = fileName.replace(/\s+/g, '.');
      if (dotted !== fileName) {
        map.set(dotted, hash);
        map.set(dotted.toLowerCase(), hash);
      }
    }
  }
  return map;
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Builds a UTF-16LE Base64 encoded PowerShell `-EncodedCommand` script that waits for the
 * running FoxReader PID to exit, executes the NSIS installer silently (`/S`), relaunches
 * the installed binary, and removes the temporary installer file.
 */
export function buildWindowsSilentInstallCommand(
  pid: number,
  installerPath: string,
  exePath: string,
): string {
  const safePid = Math.max(1, Math.floor(pid));
  const psInstaller = escapePowerShellSingleQuoted(installerPath);
  const psExe = escapePowerShellSingleQuoted(exePath);

  const script = [
    `$ErrorActionPreference = 'SilentlyContinue'`,
    `Wait-Process -Id ${safePid} -Timeout 30`,
    `Start-Sleep -Milliseconds 350`,
    `$p = Start-Process -FilePath '${psInstaller}' -ArgumentList '/S' -Wait -PassThru`,
    `Remove-Item -LiteralPath '${psInstaller}' -Force -ErrorAction SilentlyContinue`,
    `if (Test-Path -LiteralPath '${psExe}') { Start-Process -FilePath '${psExe}' }`,
  ].join('\n');

  return Buffer.from(script, 'utf16le').toString('base64');
}

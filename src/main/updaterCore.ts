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

/**
 * Returns electron-builder NSIS silent-update arguments:
 * - `--updated`: waits/stops running app instances in `$INSTDIR`, preserves shortcuts, and keeps user data
 * - `/S`: silent install (automatically reuses HKCU/HKLM `InstallLocation` including custom directories)
 * - `--force-run`: relaunches the app as the normal user after assisted (`oneClick: false`) silent install
 */
export function buildWindowsNsisSilentArgs(): string[] {
  return ['--updated', '/S', '--force-run'];
}

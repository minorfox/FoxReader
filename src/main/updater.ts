import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, net, shell } from 'electron';
import type {
  DownloadUpdateInput,
  UpdateDownloadState,
  UpdateInstallMode,
} from '../shared/types.js';
import {
  buildWindowsNsisSilentArgs,
  isAllowedReleaseAssetUrl,
  parseSha256Sums,
} from './updaterCore.js';

const CHECKSUM_TIMEOUT_MS = 15_000;
const STALE_UPDATE_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getUpdatesTempDir(): string {
  return path.join(os.tmpdir(), 'foxreader-updates');
}

export function detectInstallMode(): UpdateInstallMode {
  if (!app.isPackaged) {
    return 'dev';
  }
  if (process.platform === 'win32') {
    if (process.env.PORTABLE_EXECUTABLE_FILE) {
      return 'win-portable';
    }
    const uninstallerPath = path.join(path.dirname(process.execPath), 'Uninstall FoxReader.exe');
    return fs.existsSync(uninstallerPath) ? 'win-nsis' : 'win-portable';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  }
  return 'dev';
}

export class AppUpdaterManager {
  private activeAbort: AbortController | null = null;
  private verifiedFilePath: string | null = null;
  private currentState: UpdateDownloadState = {
    phase: 'idle',
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
  };

  public getState(): UpdateDownloadState {
    return { ...this.currentState };
  }

  public cancelDownload(): void {
    if (this.activeAbort) {
      this.activeAbort.abort();
      this.activeAbort = null;
    }
  }

  public async downloadUpdate(
    input: DownloadUpdateInput,
    onProgress: (state: UpdateDownloadState) => void,
  ): Promise<UpdateDownloadState> {
    const safeName = path.basename((input.assetName || '').trim());
    if (
      !safeName ||
      safeName === '.' ||
      safeName === '..' ||
      !isAllowedReleaseAssetUrl(input.assetUrl)
    ) {
      const errState: UpdateDownloadState = {
        phase: 'error',
        assetName: safeName || undefined,
        downloadedBytes: 0,
        totalBytes: 0,
        percent: 0,
        error: '无效的更新包下载地址或文件名。',
      };
      this.currentState = errState;
      onProgress(errState);
      return errState;
    }

    if (input.checksumUrl && !isAllowedReleaseAssetUrl(input.checksumUrl)) {
      const errState: UpdateDownloadState = {
        phase: 'error',
        assetName: safeName,
        downloadedBytes: 0,
        totalBytes: 0,
        percent: 0,
        error: '校验文件地址不受信任。',
      };
      this.currentState = errState;
      onProgress(errState);
      return errState;
    }

    this.cancelDownload();
    this.verifiedFilePath = null;

    const controller = new AbortController();
    this.activeAbort = controller;

    const updatesDir = getUpdatesTempDir();
    await fs.promises.mkdir(updatesDir, { recursive: true });
    const destPath = path.join(updatesDir, safeName);

    const emit = (next: UpdateDownloadState) => {
      this.currentState = next;
      onProgress(next);
    };

    emit({
      phase: 'downloading',
      assetName: safeName,
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
    });

    let downloadedBytes = 0;
    let totalBytes = 0;

    try {
      const response = await net.fetch(input.assetUrl, {
        method: 'GET',
        headers: { 'User-Agent': `FoxReader/${app.getVersion()}` },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`下载更新包失败 (HTTP ${response.status})`);
      }

      const contentLen = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
      totalBytes = Number.isFinite(contentLen) && contentLen > 0 ? contentLen : 0;

      const hasher = crypto.createHash('sha256');
      const fh = await fs.promises.open(destPath, 'w');
      let lastEmitAt = 0;

      try {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;

          await fh.write(value, 0, value.byteLength);
          hasher.update(value);
          downloadedBytes += value.byteLength;

          const now = Date.now();
          if (now - lastEmitAt >= 100) {
            lastEmitAt = now;
            const percent =
              totalBytes > 0 ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
            emit({
              phase: 'downloading',
              assetName: safeName,
              downloadedBytes,
              totalBytes,
              percent,
            });
          }
        }
      } finally {
        await fh.close();
      }

      if (controller.signal.aborted) {
        await fs.promises.rm(destPath, { force: true }).catch(() => undefined);
        const cancelledState: UpdateDownloadState = {
          phase: 'cancelled',
          assetName: safeName,
          downloadedBytes,
          totalBytes,
          percent: 0,
        };
        emit(cancelledState);
        return cancelledState;
      }

      const actualHash = hasher.digest('hex').toLowerCase();

      emit({
        phase: 'verifying',
        assetName: safeName,
        downloadedBytes,
        totalBytes: totalBytes || downloadedBytes,
        percent: 100,
      });

      if (input.checksumUrl) {
        const checksumCtrl = new AbortController();
        const checksumTimer = setTimeout(() => checksumCtrl.abort(), CHECKSUM_TIMEOUT_MS);
        try {
          const sumRes = await net.fetch(input.checksumUrl, {
            method: 'GET',
            headers: { 'User-Agent': `FoxReader/${app.getVersion()}` },
            signal: checksumCtrl.signal,
          });
          if (!sumRes.ok) {
            throw new Error(`获取 SHA-256 校验文件失败 (HTTP ${sumRes.status})`);
          }
          const sumText = await sumRes.text();
          const sums = parseSha256Sums(sumText);
          const expectedHash = sums.get(safeName) ?? sums.get(safeName.toLowerCase());
          if (!expectedHash) {
            throw new Error(`SHA256SUMS.txt 中未找到 ${safeName} 的校验条目。`);
          }
          if (expectedHash !== actualHash) {
            throw new Error('安装包 SHA-256 校验不匹配，已自动清理损坏文件，请重试或前往 GitHub 手动下载。');
          }
        } finally {
          clearTimeout(checksumTimer);
        }
      }

      this.verifiedFilePath = destPath;
      const readyState: UpdateDownloadState = {
        phase: 'ready',
        assetName: safeName,
        downloadedBytes,
        totalBytes: totalBytes || downloadedBytes,
        percent: 100,
        filePath: destPath,
      };
      emit(readyState);
      return readyState;
    } catch (error) {
      await fs.promises.rm(destPath, { force: true }).catch(() => undefined);
      const isAbort =
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
      if (isAbort) {
        const cancelledState: UpdateDownloadState = {
          phase: 'cancelled',
          assetName: safeName,
          downloadedBytes,
          totalBytes,
          percent: 0,
        };
        emit(cancelledState);
        return cancelledState;
      }
      const errState: UpdateDownloadState = {
        phase: 'error',
        assetName: safeName,
        downloadedBytes,
        totalBytes,
        percent: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      emit(errState);
      return errState;
    } finally {
      if (this.activeAbort === controller) {
        this.activeAbort = null;
      }
    }
  }

  public async cleanupStaleUpdateFiles(forceAll = false): Promise<void> {
    if (this.activeAbort !== null) {
      return;
    }

    const updatesDir = getUpdatesTempDir();
    let entries: string[];
    try {
      entries = await fs.promises.readdir(updatesDir);
    } catch {
      return;
    }

    const now = Date.now();
    for (const entry of entries) {
      const fullPath = path.join(updatesDir, entry);
      if (!forceAll && this.verifiedFilePath && path.resolve(fullPath) === path.resolve(this.verifiedFilePath)) {
        continue;
      }
      try {
        const stat = await fs.promises.stat(fullPath);
        if (!stat.isFile()) continue;
        if (forceAll || now - stat.mtimeMs > STALE_UPDATE_FILE_MAX_AGE_MS) {
          await fs.promises.rm(fullPath, { force: true }).catch(() => undefined);
        }
      } catch {
        // Ignore entries removed concurrently or temporarily locked
      }
    }
  }

  public async applyUpdate(
    filePath: string,
    onBeforeQuit: () => void,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.verifiedFilePath || filePath !== this.verifiedFilePath || !fs.existsSync(filePath)) {
      return { ok: false, error: '未找到已通过 SHA-256 校验的更新安装包，请重新下载。' };
    }

    const mode = detectInstallMode();

    if (mode === 'win-nsis') {
      const args = buildWindowsNsisSilentArgs();
      const spawnResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const child = spawn(filePath, args, {
          detached: true,
          stdio: 'ignore',
        });
        let settled = false;
        child.once('error', (err) => {
          if (settled) return;
          settled = true;
          resolve({ ok: false, error: `启动更新安装程序失败：${err.message}` });
        });
        child.once('spawn', () => {
          if (settled) return;
          settled = true;
          child.unref();
          resolve({ ok: true });
        });
      });

      if (!spawnResult.ok) {
        return spawnResult;
      }

      onBeforeQuit();
      setTimeout(() => app.quit(), 150);
      return { ok: true };
    }

    if (mode === 'win-portable') {
      shell.showItemInFolder(filePath);
      onBeforeQuit();
      setTimeout(() => app.quit(), 250);
      return { ok: true };
    }

    if (mode === 'mac-arm64' || mode === 'mac-x64') {
      const openErr = await shell.openPath(filePath);
      if (openErr) {
        return { ok: false, error: `打开 DMG 失败：${openErr}` };
      }
      return { ok: true };
    }

    // dev mode: open containing folder safely without overwriting electron.exe
    shell.showItemInFolder(filePath);
    return { ok: true };
  }
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DataDirLockInfo } from '../shared/types.js';

const LOCK_FILE_NAME = '.foxreader.lock';

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

export class DataDirLock {
  private activeLockPath: string | null = null;
  private pendingDataDir: string | null = null;
  private readonly hostname = os.hostname();
  private readonly pid = process.pid;

  public acquire(dataDir: string): DataDirLockInfo | null {
    fs.mkdirSync(dataDir, { recursive: true });
    const lockPath = path.join(dataDir, LOCK_FILE_NAME);

    if (fs.existsSync(lockPath)) {
      try {
        const raw = fs.readFileSync(lockPath, 'utf-8');
        const existing = JSON.parse(raw) as Partial<DataDirLockInfo>;
        if (
          typeof existing.hostname === 'string' &&
          typeof existing.pid === 'number' &&
          typeof existing.startedAt === 'number'
        ) {
          const sameHost = existing.hostname === this.hostname;
          if (!sameHost) {
            this.pendingDataDir = dataDir;
            return {
              hostname: existing.hostname,
              pid: existing.pid,
              startedAt: existing.startedAt,
            };
          }
          if (existing.pid !== this.pid && isPidAlive(existing.pid)) {
            this.pendingDataDir = dataDir;
            return {
              hostname: existing.hostname,
              pid: existing.pid,
              startedAt: existing.startedAt,
            };
          }
        }
      } catch {
        // Ignore corrupted stale lock and overwrite
      }
    }

    this.writeLock(lockPath);
    this.pendingDataDir = null;
    return null;
  }

  public forceAcquire(dataDir?: string): void {
    const targetDir = dataDir ?? this.pendingDataDir;
    if (!targetDir) return;
    fs.mkdirSync(targetDir, { recursive: true });
    const lockPath = path.join(targetDir, LOCK_FILE_NAME);
    this.writeLock(lockPath);
    this.pendingDataDir = null;
  }

  private writeLock(lockPath: string): void {
    const payload: DataDirLockInfo = {
      hostname: this.hostname,
      pid: this.pid,
      startedAt: Date.now(),
    };
    fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), 'utf-8');
    this.activeLockPath = lockPath;
  }

  public release(): void {
    this.pendingDataDir = null;
    if (!this.activeLockPath) return;
    const lockPath = this.activeLockPath;
    this.activeLockPath = null;

    if (!fs.existsSync(lockPath)) return;
    try {
      const raw = fs.readFileSync(lockPath, 'utf-8');
      const current = JSON.parse(raw) as Partial<DataDirLockInfo>;
      if (current.hostname === this.hostname && current.pid === this.pid) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch {
      // Do not remove if unreadable/replaced by another instance
    }
  }
}

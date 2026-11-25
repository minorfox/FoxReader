import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings } from '../shared/types.js';

export class SettingsManager {
  private readonly settingsPath: string;
  private readonly defaultDataDir: string;
  private settings: AppSettings;

  constructor(userDataDir: string) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.settingsPath = path.join(userDataDir, 'settings.json');
    this.defaultDataDir = path.join(userDataDir, 'FoxReaderData');
    this.settings = this.load();
    this.ensureDataDirStructure(this.settings.dataDir);
  }

  private load(): AppSettings {
    if (fs.existsSync(this.settingsPath)) {
      try {
        const raw = fs.readFileSync(this.settingsPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        if (parsed.dataDir && typeof parsed.dataDir === 'string' && parsed.dataDir.trim().length > 0) {
          return { dataDir: path.resolve(parsed.dataDir) };
        }
      } catch {
        // Fall back to default settings if corrupted
      }
    }
    const defaults: AppSettings = { dataDir: this.defaultDataDir };
    this.save(defaults);
    return defaults;
  }

  private save(next: AppSettings): void {
    fs.writeFileSync(this.settingsPath, JSON.stringify(next, null, 2), 'utf-8');
  }

  public ensureDataDirStructure(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'pdfs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });
  }

  public getSettings(): AppSettings {
    return { ...this.settings };
  }

  public getDataDir(): string {
    return this.settings.dataDir;
  }

  public setDataDir(newDir: string): AppSettings {
    const resolved = path.resolve(newDir);
    this.ensureDataDirStructure(resolved);
    this.settings = { dataDir: resolved };
    this.save(this.settings);
    return this.getSettings();
  }
}

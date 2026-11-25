import fs from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { DataDirLock } from './dataLock.js';
import { FoxReaderDatabase } from './database.js';
import { checkLatestGithubRelease, fetchOpenAlexMetadata, translateSelectionText } from './onlineMetadata.js';
import { SettingsManager } from './settings.js';
import type {
  CreateAnnotationInput,
  DataDirLockInfo,
  EnrichPaperOnlineInput,
  PaperListQuery,
  UpdateAnnotationInput,
  UpdatePaperMetadataInput,
} from '../shared/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'foxpdf',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
let settingsManager: SettingsManager;
let database: FoxReaderDatabase;
const dataDirLock = new DataDirLock();
let currentLockWarning: DataDirLockInfo | null = null;

function getAppIconPath(): string | undefined {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.resolve(app.getAppPath(), 'build', 'icon.png');
  return fs.existsSync(candidate) ? candidate : undefined;
}

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.cjs');
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'FoxReader',
    icon: getAppIconPath(),
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  return win;
}

function getPdfjsDistRoot(): string {
  if (app.isPackaged) {
    const fromResources = path.resolve(process.resourcesPath, 'pdfjs-dist');
    if (fs.existsSync(fromResources)) return fromResources;
  }
  const fromApp = path.resolve(app.getAppPath(), 'node_modules', 'pdfjs-dist');
  if (fs.existsSync(fromApp)) return fromApp;
  return path.resolve(__dirname, '../../node_modules/pdfjs-dist');
}

const ALLOWED_PDFJS_BUCKETS = new Set(['cmaps', 'standard_fonts', 'wasm', 'iccs']);
const pdfAssetCache = new Map<string, Uint8Array>();

function getAssetContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.wasm') return 'application/wasm';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

function parseByteRange(rangeHeader: string, fileSize: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (!startStr && !endStr) return null;

  let start: number;
  let end: number;
  if (!startStr) {
    const suffixLen = Number.parseInt(endStr, 10);
    if (!Number.isFinite(suffixLen) || suffixLen <= 0) return 'unsatisfiable';
    start = Math.max(0, fileSize - suffixLen);
    end = fileSize - 1;
  } else {
    start = Number.parseInt(startStr, 10);
    end = endStr ? Number.parseInt(endStr, 10) : fileSize - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'unsatisfiable';
    end = Math.min(end, fileSize - 1);
  }

  if (start < 0 || start >= fileSize || start > end) {
    return 'unsatisfiable';
  }
  return { start, end };
}

const MAX_SYNC_RANGE_BYTES = 4 * 1024 * 1024;

async function readFileSlice(filePath: string, start: number, end: number): Promise<Uint8Array> {
  const length = end - start + 1;
  const buffer = Buffer.allocUnsafe(length);
  const fh = await fs.promises.open(filePath, 'r');
  try {
    let totalRead = 0;
    while (totalRead < length) {
      const { bytesRead } = await fh.read(buffer, totalRead, length - totalRead, start + totalRead);
      if (bytesRead === 0) break;
      totalRead += bytesRead;
    }
    return new Uint8Array(buffer.buffer, buffer.byteOffset, totalRead);
  } finally {
    await fh.close();
  }
}

function createAbortableStreamResponse(
  stream: fs.ReadStream,
  signal: AbortSignal | undefined,
  status: number,
  headers: Record<string, string>,
): Response {
  const onAbort = () => {
    stream.destroy();
  };
  if (signal?.aborted) {
    stream.destroy();
  } else if (signal) {
    signal.addEventListener('abort', onAbort, { once: true });
    stream.once('close', () => signal.removeEventListener('abort', onAbort));
  }
  stream.on('error', () => {
    // Ignore stream errors triggered by request cancellation
  });
  return new Response(
    Readable.toWeb(stream) as unknown as NonNullable<ConstructorParameters<typeof Response>[0]>,
    { status, headers },
  );
}

function registerFoxPdfProtocol(): void {
  protocol.handle('foxpdf', async (request) => {
    try {
      const parsed = new URL(request.url);
      const fileName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));

      if (parsed.hostname === 'paper') {
        if (!/^[a-f0-9]{64}\.pdf$/i.test(fileName)) {
          return new Response('Invalid PDF identifier', { status: 400 });
        }
        const pdfsRoot = path.resolve(settingsManager.getDataDir(), 'pdfs');
        const targetPath = path.resolve(pdfsRoot, fileName);
        if (!targetPath.startsWith(pdfsRoot + path.sep)) {
          return new Response('Forbidden', { status: 403 });
        }
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(targetPath);
        } catch {
          return new Response('PDF not found', { status: 404 });
        }
        const fileSize = stat.size;
        if (request.method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'Accept-Ranges': 'bytes',
              'Content-Length': String(fileSize),
            },
          });
        }
        if (fileSize === 0) {
          return new Response(new Uint8Array(0), {
            status: 200,
            headers: {
              'Content-Type': 'application/pdf',
              'Accept-Ranges': 'bytes',
              'Content-Length': '0',
            },
          });
        }

        const rangeHeader = request.headers.get('range');
        if (rangeHeader) {
          const byteRange = parseByteRange(rangeHeader, fileSize);
          if (byteRange === 'unsatisfiable') {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${fileSize}` },
            });
          }
          if (byteRange) {
            const { start, end } = byteRange;
            const rangeLen = end - start + 1;
            const headers = {
              'Content-Type': 'application/pdf',
              'Accept-Ranges': 'bytes',
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Content-Length': String(rangeLen),
            };
            // Close file handles immediately on chunked PDF.js reads to avoid Windows EBUSY on delete
            if (rangeLen <= MAX_SYNC_RANGE_BYTES) {
              const slice = await readFileSlice(targetPath, start, end);
              return new Response(slice, { status: 206, headers });
            }
            const stream = fs.createReadStream(targetPath, { start, end });
            return createAbortableStreamResponse(stream, request.signal, 206, headers);
          }
        }

        const stream = fs.createReadStream(targetPath);
        return createAbortableStreamResponse(stream, request.signal, 200, {
          'Content-Type': 'application/pdf',
          'Accept-Ranges': 'bytes',
          'Content-Length': String(fileSize),
        });
      }

      if (parsed.hostname === 'snapshot') {
        if (!/^[a-f0-9-]{36}\.png$/i.test(fileName)) {
          return new Response('Invalid snapshot identifier', { status: 400 });
        }
        const snapshotsRoot = path.resolve(settingsManager.getDataDir(), 'snapshots');
        const targetPath = path.resolve(snapshotsRoot, fileName);
        if (!targetPath.startsWith(snapshotsRoot + path.sep)) {
          return new Response('Forbidden', { status: 403 });
        }
        try {
          const data = await fs.promises.readFile(targetPath);
          return new Response(new Uint8Array(data), {
            status: 200,
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=3600',
            },
          });
        } catch {
          return new Response('Snapshot not found', { status: 404 });
        }
      }

      if (parsed.hostname === 'assets') {
        const segments = fileName.split('/').filter(Boolean);
        if (segments.length !== 2) {
          return new Response('Invalid asset path', { status: 400 });
        }
        const [bucket, assetFile] = segments;
        if (!ALLOWED_PDFJS_BUCKETS.has(bucket) || !/^[a-zA-Z0-9._-]+$/.test(assetFile)) {
          return new Response('Invalid asset path', { status: 400 });
        }
        const cacheKey = `${bucket}/${assetFile}`;
        let bytes = pdfAssetCache.get(cacheKey);
        if (!bytes) {
          const bucketRoot = path.resolve(getPdfjsDistRoot(), bucket);
          const targetPath = path.resolve(bucketRoot, assetFile);
          if (!targetPath.startsWith(bucketRoot + path.sep)) {
            return new Response('Forbidden', { status: 403 });
          }
          if (!fs.existsSync(targetPath)) {
            return new Response('Asset not found', { status: 404 });
          }
          bytes = new Uint8Array(await fs.promises.readFile(targetPath));
          pdfAssetCache.set(cacheKey, bytes);
        }
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            'Content-Type': getAssetContentType(assetFile),
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        });
      }

      return new Response('Forbidden', { status: 403 });
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:getSettings', () => ({
    ...settingsManager.getSettings(),
    appVersion: app.getVersion(),
    lockWarning: currentLockWarning,
  }));

  ipcMain.handle('app:acknowledgeLockWarning', () => {
    dataDirLock.forceAcquire(settingsManager.getDataDir());
    currentLockWarning = null;
  });

  ipcMain.handle('app:quit', () => {
    dataDirLock.release();
    database?.close();
    app.quit();
  });

  ipcMain.handle('app:selectDataDir', async () => {
    const dialogOpts = {
      title: '选择 FoxReader 数据目录',
      defaultPath: settingsManager.getDataDir(),
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    const nextDir = result.filePaths[0];
    if (path.resolve(nextDir) === path.resolve(settingsManager.getDataDir())) {
      return {
        ...settingsManager.getSettings(),
        appVersion: app.getVersion(),
        lockWarning: currentLockWarning,
      };
    }
    dataDirLock.release();
    database.close();
    const updated = settingsManager.setDataDir(nextDir);
    currentLockWarning = dataDirLock.acquire(updated.dataDir);
    database = new FoxReaderDatabase(updated.dataDir);
    return {
      ...updated,
      appVersion: app.getVersion(),
      lockWarning: currentLockWarning,
    };
  });

  ipcMain.handle('app:openDataDir', async () => {
    await shell.openPath(settingsManager.getDataDir());
  });

  ipcMain.handle('app:checkUpdate', () => checkLatestGithubRelease(app.getVersion()));

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://github.com/minorfox/FoxReader')) {
      throw new Error('Blocked external URL outside allowed repository origin.');
    }
    await shell.openExternal(url);
  });

  ipcMain.handle('library:getOverview', () => database.getLibraryOverview());

  ipcMain.handle('folders:create', (_event, name: string, parentId: string | null) =>
    database.createFolder(name, parentId),
  );

  ipcMain.handle('folders:rename', (_event, id: string, name: string) =>
    database.renameFolder(id, name),
  );

  ipcMain.handle('folders:delete', (_event, id: string) => database.deleteFolder(id));

  ipcMain.handle('papers:list', (_event, query: PaperListQuery) => database.listPapers(query));

  ipcMain.handle('papers:importPaths', async (_event, filePaths: string[], folderId: string | null) => {
    const dataDir = settingsManager.getDataDir();
    const results = [];
    for (const filePath of filePaths) {
      results.push(await database.importPdfFile(filePath, folderId, dataDir));
    }
    return results;
  });

  ipcMain.handle('papers:pickAndImport', async (_event, folderId: string | null) => {
    const dialogOpts = {
      title: '导入文档',
      filters: [
        { name: '支持的文档 (PDF / Markdown)', extensions: ['pdf', 'md', 'markdown'] },
        { name: 'PDF 文件', extensions: ['pdf'] },
        { name: 'Markdown 文件', extensions: ['md', 'markdown'] },
      ],
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOpts)
      : await dialog.showOpenDialog(dialogOpts);
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    const dataDir = settingsManager.getDataDir();
    const items = [];
    for (const filePath of result.filePaths) {
      items.push(await database.importPdfFile(filePath, folderId, dataDir));
    }
    return items;
  });

  ipcMain.handle('papers:readMarkdown', (_event, sha256: string) =>
    database.readMarkdownContent(sha256, settingsManager.getDataDir()),
  );

  ipcMain.handle('papers:updateMetadata', (_event, paperId: string, input: UpdatePaperMetadataInput) =>
    database.updatePaperMetadata(paperId, input),
  );

  ipcMain.handle('papers:enrichOnline', (_event, input: EnrichPaperOnlineInput) =>
    fetchOpenAlexMetadata(input),
  );

  ipcMain.handle('translate:text', (_event, text: string) => translateSelectionText(text));

  ipcMain.handle('papers:moveToFolder', (_event, paperId: string, folderId: string | null) =>
    database.movePaperToFolder(paperId, folderId),
  );

  ipcMain.handle('papers:updateProgress', (_event, paperId: string, lastPage: number, lastZoom: number) => {
    database.updatePaperProgress(paperId, lastPage, lastZoom);
  });

  ipcMain.handle('papers:delete', async (_event, paperId: string) => {
    await database.deletePaper(paperId, settingsManager.getDataDir());
  });

  ipcMain.handle('papers:deleteMany', async (_event, paperIds: string[]) =>
    database.deletePapers(paperIds, settingsManager.getDataDir()),
  );

  ipcMain.handle('annotations:list', (_event, paperId: string) => database.listAnnotations(paperId));

  ipcMain.handle('annotations:create', (_event, input: CreateAnnotationInput) =>
    database.createAnnotation(input, settingsManager.getDataDir()),
  );

  ipcMain.handle('annotations:update', (_event, id: string, input: UpdateAnnotationInput) =>
    database.updateAnnotation(id, input),
  );

  ipcMain.handle('annotations:delete', (_event, id: string) =>
    database.deleteAnnotation(id, settingsManager.getDataDir()),
  );

  ipcMain.handle('tags:setPaperTags', (_event, paperId: string, tagNames: string[]) =>
    database.setPaperTags(paperId, tagNames),
  );

  ipcMain.handle('tags:delete', (_event, tagId: string) => database.deleteTag(tagId));

  ipcMain.handle('notes:get', (_event, paperId: string) => database.getPaperNote(paperId));

  ipcMain.handle('notes:save', (_event, paperId: string, contentMd: string) =>
    database.savePaperNote(paperId, contentMd),
  );
}

app.whenReady().then(() => {
  settingsManager = new SettingsManager(app.getPath('userData'));
  const dataDir = settingsManager.getDataDir();
  currentLockWarning = dataDirLock.acquire(dataDir);
  database = new FoxReaderDatabase(dataDir);

  registerFoxPdfProtocol();
  registerIpcHandlers();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  dataDirLock.release();
  database?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    dataDirLock.release();
    database?.close();
    app.quit();
  }
});

import fs from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { FoxReaderDatabase } from './database.js';
import { SettingsManager } from './settings.js';
import type {
  CreateAnnotationInput,
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

function createMainWindow(): BrowserWindow {
  const preloadPath = path.join(__dirname, '../preload/index.cjs');
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    title: 'FoxReader',
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

function registerFoxPdfProtocol(): void {
  protocol.handle('foxpdf', (request) => {
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
        if (!fs.existsSync(targetPath)) {
          return new Response('PDF not found', { status: 404 });
        }
        return net.fetch(pathToFileURL(targetPath).toString());
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
        if (!fs.existsSync(targetPath)) {
          return new Response('Snapshot not found', { status: 404 });
        }
        return net.fetch(pathToFileURL(targetPath).toString());
      }

      return new Response('Forbidden', { status: 403 });
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:getSettings', () => settingsManager.getSettings());

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
      return settingsManager.getSettings();
    }
    const updated = settingsManager.setDataDir(nextDir);
    database.close();
    database = new FoxReaderDatabase(updated.dataDir);
    return updated;
  });

  ipcMain.handle('app:openDataDir', async () => {
    await shell.openPath(settingsManager.getDataDir());
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
      title: '导入 PDF 论文',
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
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

  ipcMain.handle('papers:updateMetadata', (_event, paperId: string, input: UpdatePaperMetadataInput) =>
    database.updatePaperMetadata(paperId, input),
  );

  ipcMain.handle('papers:moveToFolder', (_event, paperId: string, folderId: string | null) =>
    database.movePaperToFolder(paperId, folderId),
  );

  ipcMain.handle('papers:updateProgress', (_event, paperId: string, lastPage: number, lastZoom: number) => {
    database.updatePaperProgress(paperId, lastPage, lastZoom);
  });

  ipcMain.handle('papers:delete', async (_event, paperId: string) => {
    await database.deletePaper(paperId, settingsManager.getDataDir());
  });

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
}

app.whenReady().then(() => {
  settingsManager = new SettingsManager(app.getPath('userData'));
  database = new FoxReaderDatabase(settingsManager.getDataDir());

  registerFoxPdfProtocol();
  registerIpcHandlers();
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    database?.close();
    app.quit();
  }
});

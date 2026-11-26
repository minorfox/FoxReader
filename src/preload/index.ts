import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppMenuAction,
  CreateAnnotationInput,
  DownloadUpdateInput,
  EnrichPaperOnlineInput,
  FoxReaderApi,
  PaperListQuery,
  UpdateAnnotationInput,
  UpdateDownloadState,
  UpdatePaperMetadataInput,
} from '../shared/types.js';

const api: FoxReaderApi = {
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  selectDataDir: () => ipcRenderer.invoke('app:selectDataDir'),
  openDataDir: (subDir?: 'pdfs' | 'docs' | 'snapshots') =>
    ipcRenderer.invoke('app:openDataDir', subDir),
  checkForUpdates: () => ipcRenderer.invoke('app:checkUpdate'),
  downloadUpdate: (input: DownloadUpdateInput) => ipcRenderer.invoke('app:downloadUpdate', input),
  cancelUpdateDownload: () => ipcRenderer.invoke('app:cancelUpdateDownload'),
  applyDownloadedUpdate: (filePath: string) =>
    ipcRenderer.invoke('app:applyDownloadedUpdate', filePath),
  onUpdateDownloadState: (listener: (state: UpdateDownloadState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateDownloadState) => {
      listener(state);
    };
    ipcRenderer.on('app:updateDownloadState', handler);
    return () => {
      ipcRenderer.removeListener('app:updateDownloadState', handler);
    };
  },
  onMenuAction: (listener: (action: AppMenuAction) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: AppMenuAction) => {
      listener(action);
    };
    ipcRenderer.on('app:menuAction', handler);
    return () => {
      ipcRenderer.removeListener('app:menuAction', handler);
    };
  },
  openExternalUrl: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  getLibraryOverview: () => ipcRenderer.invoke('library:getOverview'),
  createFolder: (name: string, parentId: string | null) =>
    ipcRenderer.invoke('folders:create', name, parentId),
  renameFolder: (id: string, name: string) => ipcRenderer.invoke('folders:rename', id, name),
  moveFolder: (id: string, parentId: string | null) =>
    ipcRenderer.invoke('folders:move', id, parentId),
  deleteFolder: (id: string) => ipcRenderer.invoke('folders:delete', id),
  listPapers: (query: PaperListQuery) => ipcRenderer.invoke('papers:list', query),
  importPaths: (filePaths: string[], folderId: string | null) =>
    ipcRenderer.invoke('papers:importPaths', filePaths, folderId),
  pickAndImportPdfs: (folderId: string | null) =>
    ipcRenderer.invoke('papers:pickAndImport', folderId),
  updatePaperMetadata: (paperId: string, input: UpdatePaperMetadataInput) =>
    ipcRenderer.invoke('papers:updateMetadata', paperId, input),
  enrichPaperOnline: (input: EnrichPaperOnlineInput) =>
    ipcRenderer.invoke('papers:enrichOnline', input),
  translateText: (text: string) => ipcRenderer.invoke('translate:text', text),
  readMarkdownContent: (sha256: string) => ipcRenderer.invoke('papers:readMarkdown', sha256),
  checkPaperFileStatus: (paperId: string) => ipcRenderer.invoke('papers:checkFileStatus', paperId),
  relinkPaperFile: (paperId: string) => ipcRenderer.invoke('papers:relinkFile', paperId),
  exportBibtex: (paperIds: string[], defaultFileName?: string) =>
    ipcRenderer.invoke('papers:exportBibtex', paperIds, defaultFileName),
  movePaperToFolder: (paperId: string, folderId: string | null) =>
    ipcRenderer.invoke('papers:moveToFolder', paperId, folderId),
  updatePaperProgress: (paperId: string, lastPage: number, lastZoom: number) =>
    ipcRenderer.invoke('papers:updateProgress', paperId, lastPage, lastZoom),
  deletePaper: (paperId: string) => ipcRenderer.invoke('papers:delete', paperId),
  deletePapers: (paperIds: string[]) => ipcRenderer.invoke('papers:deleteMany', paperIds),
  listAnnotations: (paperId: string) => ipcRenderer.invoke('annotations:list', paperId),
  createAnnotation: (input: CreateAnnotationInput) =>
    ipcRenderer.invoke('annotations:create', input),
  updateAnnotation: (id: string, input: UpdateAnnotationInput) =>
    ipcRenderer.invoke('annotations:update', id, input),
  deleteAnnotation: (id: string) => ipcRenderer.invoke('annotations:delete', id),
  setPaperTags: (paperId: string, tagNames: string[]) =>
    ipcRenderer.invoke('tags:setPaperTags', paperId, tagNames),
  deleteTag: (tagId: string) => ipcRenderer.invoke('tags:delete', tagId),
  getPaperNote: (paperId: string) => ipcRenderer.invoke('notes:get', paperId),
  savePaperNote: (paperId: string, contentMd: string) =>
    ipcRenderer.invoke('notes:save', paperId, contentMd),
  acknowledgeLockWarning: () => ipcRenderer.invoke('app:acknowledgeLockWarning'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('foxreader', api);

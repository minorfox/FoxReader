import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  CreateAnnotationInput,
  FoxReaderApi,
  PaperListQuery,
  UpdateAnnotationInput,
  UpdatePaperMetadataInput,
} from '../shared/types.js';

const api: FoxReaderApi = {
  getSettings: () => ipcRenderer.invoke('app:getSettings'),
  selectDataDir: () => ipcRenderer.invoke('app:selectDataDir'),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  getLibraryOverview: () => ipcRenderer.invoke('library:getOverview'),
  createFolder: (name: string, parentId: string | null) =>
    ipcRenderer.invoke('folders:create', name, parentId),
  renameFolder: (id: string, name: string) => ipcRenderer.invoke('folders:rename', id, name),
  deleteFolder: (id: string) => ipcRenderer.invoke('folders:delete', id),
  listPapers: (query: PaperListQuery) => ipcRenderer.invoke('papers:list', query),
  importPaths: (filePaths: string[], folderId: string | null) =>
    ipcRenderer.invoke('papers:importPaths', filePaths, folderId),
  pickAndImportPdfs: (folderId: string | null) =>
    ipcRenderer.invoke('papers:pickAndImport', folderId),
  updatePaperMetadata: (paperId: string, input: UpdatePaperMetadataInput) =>
    ipcRenderer.invoke('papers:updateMetadata', paperId, input),
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

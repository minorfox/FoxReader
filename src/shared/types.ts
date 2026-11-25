export type PaperStatus = 'unread' | 'reading' | 'read';

export type LibraryView = 'all' | 'unclassified' | 'folder';

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Paper {
  id: string;
  sha256: string;
  title: string;
  authors: string;
  year: number | null;
  folderId: string | null;
  status: PaperStatus;
  pageCount: number;
  lastPage: number;
  lastZoom: number;
  fileName: string;
  createdAt: number;
  updatedAt: number;
  tags: Tag[];
}

export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Annotation {
  id: string;
  paperId: string;
  type: 'text' | 'area';
  pageNumber: number;
  rects: NormalizedRect[];
  color: string;
  quoteText: string;
  snapshotPath: string;
  comment: string;
  createdAt: number;
  updatedAt: number;
}

export interface PaperNote {
  paperId: string;
  contentMd: string;
  updatedAt: number;
}

export interface AppSettings {
  dataDir: string;
}

export interface LibraryOverview {
  folders: Folder[];
  totalCount: number;
  unclassifiedCount: number;
  folderCounts: Record<string, number>;
  tags: Tag[];
}

export interface PaperListQuery {
  view: LibraryView;
  folderId?: string | null;
  status?: PaperStatus | 'all';
  tagId?: string | null;
  search?: string;
}

export interface ImportPdfItemResult {
  sourcePath: string;
  status: 'imported' | 'duplicate' | 'error';
  paper?: Paper;
  error?: string;
}

export interface UpdatePaperMetadataInput {
  title?: string;
  authors?: string;
  year?: number | null;
  status?: PaperStatus;
  folderId?: string | null;
  pageCount?: number;
}

export interface DeleteFolderResult {
  movedPaperCount: number;
}

export interface FoxReaderApi {
  getSettings: () => Promise<AppSettings>;
  selectDataDir: () => Promise<AppSettings | null>;
  openDataDir: () => Promise<void>;
  getLibraryOverview: () => Promise<LibraryOverview>;
  createFolder: (name: string, parentId: string | null) => Promise<Folder>;
  renameFolder: (id: string, name: string) => Promise<Folder>;
  deleteFolder: (id: string) => Promise<DeleteFolderResult>;
  listPapers: (query: PaperListQuery) => Promise<Paper[]>;
  importPaths: (filePaths: string[], folderId: string | null) => Promise<ImportPdfItemResult[]>;
  pickAndImportPdfs: (folderId: string | null) => Promise<ImportPdfItemResult[]>;
  updatePaperMetadata: (paperId: string, input: UpdatePaperMetadataInput) => Promise<Paper>;
  movePaperToFolder: (paperId: string, folderId: string | null) => Promise<Paper>;
  updatePaperProgress: (paperId: string, lastPage: number, lastZoom: number) => Promise<void>;
  deletePaper: (paperId: string) => Promise<void>;
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    foxreader: FoxReaderApi;
  }
}

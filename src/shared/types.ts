export type PaperStatus = 'unread' | 'reading' | 'read';

export type LibraryView = 'all' | 'unclassified' | 'folder';

export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple';

export interface AnnotationColorMeta {
  id: AnnotationColor;
  label: string;
  swatch: string;
  overlayBg: string;
  areaBg: string;
  border: string;
}

export const ANNOTATION_COLORS: readonly AnnotationColorMeta[] = [
  {
    id: 'yellow',
    label: '黄',
    swatch: '#FACC15',
    overlayBg: 'rgba(250, 204, 21, 0.36)',
    areaBg: 'rgba(250, 204, 21, 0.14)',
    border: '#EAB308',
  },
  {
    id: 'green',
    label: '绿',
    swatch: '#4ADE80',
    overlayBg: 'rgba(74, 222, 128, 0.34)',
    areaBg: 'rgba(74, 222, 128, 0.14)',
    border: '#22C55E',
  },
  {
    id: 'blue',
    label: '蓝',
    swatch: '#60A5FA',
    overlayBg: 'rgba(96, 165, 250, 0.34)',
    areaBg: 'rgba(96, 165, 250, 0.14)',
    border: '#3B82F6',
  },
  {
    id: 'pink',
    label: '粉',
    swatch: '#F472B6',
    overlayBg: 'rgba(244, 114, 182, 0.34)',
    areaBg: 'rgba(244, 114, 182, 0.14)',
    border: '#EC4899',
  },
  {
    id: 'purple',
    label: '紫',
    swatch: '#C084FC',
    overlayBg: 'rgba(192, 132, 252, 0.36)',
    areaBg: 'rgba(192, 132, 252, 0.14)',
    border: '#A855F7',
  },
] as const;

export function getAnnotationColorMeta(color: string): AnnotationColorMeta {
  return ANNOTATION_COLORS.find((c) => c.id === color) ?? ANNOTATION_COLORS[0];
}

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
  color: AnnotationColor;
  quoteText: string;
  snapshotPath: string;
  comment: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAnnotationInput {
  paperId: string;
  type: 'text' | 'area';
  pageNumber: number;
  rects: NormalizedRect[];
  color: AnnotationColor;
  quoteText?: string;
  snapshotPngBase64?: string;
  comment?: string;
}

export interface UpdateAnnotationInput {
  color?: AnnotationColor;
  comment?: string;
}

export interface PaperNote {
  paperId: string;
  contentMd: string;
  updatedAt: number;
}

export interface DataDirLockInfo {
  hostname: string;
  pid: number;
  startedAt: number;
}

export interface AppSettings {
  dataDir: string;
  lockWarning?: DataDirLockInfo | null;
}

export interface LibraryOverview {
  folders: Folder[];
  totalCount: number;
  unclassifiedCount: number;
  folderCounts: Record<string, number>;
  tags: Tag[];
  tagCounts: Record<string, number>;
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
  listAnnotations: (paperId: string) => Promise<Annotation[]>;
  createAnnotation: (input: CreateAnnotationInput) => Promise<Annotation>;
  updateAnnotation: (id: string, input: UpdateAnnotationInput) => Promise<Annotation>;
  deleteAnnotation: (id: string) => Promise<void>;
  setPaperTags: (paperId: string, tagNames: string[]) => Promise<Paper>;
  deleteTag: (tagId: string) => Promise<void>;
  getPaperNote: (paperId: string) => Promise<PaperNote>;
  savePaperNote: (paperId: string, contentMd: string) => Promise<PaperNote>;
  acknowledgeLockWarning: () => Promise<void>;
  quitApp: () => Promise<void>;
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    foxreader: FoxReaderApi;
  }
}

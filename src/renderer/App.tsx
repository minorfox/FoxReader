import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Annotation,
  AnnotationColor,
  DataDirLockInfo,
  Folder,
  ImportPdfItemResult,
  LibraryOverview,
  LibraryView,
  NormalizedRect,
  Paper,
  PaperNote,
  PaperStatus,
  Tag,
  UpdateAnnotationInput,
  UpdatePaperMetadataInput,
} from '../shared/types';
import { buildBibtexFromPaper } from '../shared/bibtex';
import { extractPdfMetadata } from './lib/pdf';
import { LeftSidebar } from './components/LeftSidebar';
import { MarkdownReader } from './components/MarkdownReader';
import { PdfReader } from './components/PdfReader';
import { RightSidebar } from './components/RightSidebar';
import {
  ConfirmModal,
  LockWarningModal,
  MetadataModal,
  SettingsModal,
  ToastContainer,
  type ToastMessage,
} from './components/Modals';

function sortAnnotations(items: Annotation[]): Annotation[] {
  return [...items].sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    const ay = a.rects[0]?.y ?? 0;
    const by = b.rects[0]?.y ?? 0;
    if (ay !== by) return ay - by;
    return a.createdAt - b.createdAt;
  });
}

export function App() {
  const [dataDir, setDataDir] = useState('');
  const [appVersion, setAppVersion] = useState('0.1.0');
  const [lockWarning, setLockWarning] = useState<DataDirLockInfo | null>(null);
  const [reextractingMeta, setReextractingMeta] = useState(false);
  const [enrichingOnline, setEnrichingOnline] = useState(false);
  const [overview, setOverview] = useState<LibraryOverview>({
    folders: [],
    totalCount: 0,
    unclassifiedCount: 0,
    folderCounts: {},
    tags: [],
    tagCounts: {},
  });
  const [papers, setPapers] = useState<Paper[]>([]);

  const [activeView, setActiveView] = useState<LibraryView>('all');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PaperStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  // M2 & M3 Annotation / Note state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [paperNote, setPaperNote] = useState<PaperNote | null>(null);
  const [activeColor, setActiveColor] = useState<AnnotationColor>('yellow');
  const [rightTab, setRightTab] = useState<'annotations' | 'notes'>('annotations');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [cardRevealRequest, setCardRevealRequest] = useState<{
    id: string;
    focusComment: boolean;
    nonce: number;
  } | null>(null);
  const [jumpRequest, setJumpRequest] = useState<{ annotation: Annotation; nonce: number } | null>(null);

  const [editingPaper, setEditingPaper] = useState<Paper | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<Folder | null>(null);
  const [confirmDeletePaper, setConfirmDeletePaper] = useState<Paper | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState<{
    papers: Paper[];
    onDone: () => void;
  } | null>(null);
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<Tag | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsAutoCheckNonce, setSettingsAutoCheckNonce] = useState(0);
  const [windowFileDragOver, setWindowFileDragOver] = useState(false);
  const [readerReloadNonce, setReaderReloadNonce] = useState(0);
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [pageJumpRequest, setPageJumpRequest] = useState<{ pageNumber: number; nonce: number } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((kind: ToastMessage['kind'], text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 180);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const refreshOverview = useCallback(async () => {
    const next = await window.foxreader.getLibraryOverview();
    setOverview(next);
  }, []);

  const refreshPapers = useCallback(async () => {
    const next = await window.foxreader.listPapers({
      view: activeView,
      folderId: activeFolderId,
      tagId: activeTagId,
      status: statusFilter,
      search: debouncedSearch,
    });
    setPapers(next);
  }, [activeView, activeFolderId, activeTagId, statusFilter, debouncedSearch]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshOverview(), refreshPapers()]);
  }, [refreshOverview, refreshPapers]);

  useEffect(() => {
    void window.foxreader.getSettings().then((s) => {
      setDataDir(s.dataDir);
      setAppVersion(s.appVersion || '0.1.0');
      setLockWarning(s.lockWarning ?? null);
    });
    void refreshOverview();
  }, [refreshOverview]);

  useEffect(() => {
    void refreshPapers();
  }, [refreshPapers]);

  const selectedPaper = useMemo(
    () => papers.find((p) => p.id === selectedPaperId) ?? null,
    [papers, selectedPaperId],
  );

  useEffect(() => {
    document.title = selectedPaper ? `${selectedPaper.title} — FoxReader` : 'FoxReader';
  }, [selectedPaper?.title]);

  useEffect(() => {
    if (selectedPaper?.fileType === 'md') {
      setRightTab('notes');
    }
  }, [selectedPaper?.id, selectedPaper?.fileType]);

  const handleChangePaperStatus = useCallback(
    async (paperId: string, status: PaperStatus) => {
      const updated = await window.foxreader.updatePaperMetadata(paperId, { status });
      setPapers((prev) => prev.map((p) => (p.id === paperId ? updated : p)));
      if (statusFilter !== 'all') {
        await refreshPapers();
      }
    },
    [refreshPapers, statusFilter],
  );

  // Automatically promote 'unread' -> 'reading' when opening a document
  useEffect(() => {
    if (selectedPaper && selectedPaper.status === 'unread') {
      void handleChangePaperStatus(selectedPaper.id, 'reading');
    }
  }, [selectedPaper?.id, selectedPaper?.status, handleChangePaperStatus]);

  // Load annotations & Markdown note whenever selectedPaperId changes
  useEffect(() => {
    setSelectedAnnotationId(null);
    setCardRevealRequest(null);
    setJumpRequest(null);
    if (!selectedPaperId) {
      setAnnotations([]);
      setPaperNote(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      window.foxreader.listAnnotations(selectedPaperId),
      window.foxreader.getPaperNote(selectedPaperId),
    ]).then(([annItems, noteItem]) => {
      if (!cancelled) {
        setAnnotations(annItems);
        setPaperNote(noteItem);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPaperId]);

  const metadataQueueRef = useRef<Array<{ id: string; sha256: string }>>([]);
  const metadataWorkerRunningRef = useRef(false);

  const drainMetadataQueue = useCallback(() => {
    if (metadataWorkerRunningRef.current) return;
    metadataWorkerRunningRef.current = true;
    // Brief delay lets the newly opened document render Page 1 before background metadata parsing runs
    setTimeout(async () => {
      try {
        while (metadataQueueRef.current.length > 0) {
          const next = metadataQueueRef.current.shift();
          if (!next) continue;
          const meta = await extractPdfMetadata(next.sha256);
          if (!meta) continue;
          await window.foxreader.updatePaperMetadata(next.id, {
            pageCount: meta.pageCount,
            ...(meta.title ? { title: meta.title } : {}),
            ...(meta.authors ? { authors: meta.authors } : {}),
            ...(meta.affiliations ? { affiliations: meta.affiliations } : {}),
            ...(meta.year ? { year: meta.year } : {}),
            ...(meta.doi ? { doi: meta.doi } : {}),
            ...(meta.arxivId ? { arxivId: meta.arxivId } : {}),
          });
          await refreshPapers();
        }
      } finally {
        metadataWorkerRunningRef.current = false;
        if (metadataQueueRef.current.length > 0) {
          drainMetadataQueue();
        }
      }
    }, 350);
  }, [refreshPapers]);

  const handleImportResults = useCallback(
    async (results: ImportPdfItemResult[]) => {
      if (results.length === 0) return;

      let importedCount = 0;
      let duplicatePaper: Paper | null = null;
      let repairedPaper: Paper | null = null;
      let firstImportedPaper: Paper | null = null;
      let errorCount = 0;

      for (const item of results) {
        if (item.status === 'imported' && item.paper) {
          importedCount += 1;
          if (!firstImportedPaper) firstImportedPaper = item.paper;
          if (item.paper.fileType === 'pdf') {
            metadataQueueRef.current.push({ id: item.paper.id, sha256: item.paper.sha256 });
          }
        } else if (item.status === 'duplicate' && item.paper) {
          duplicatePaper = item.paper;
          if (item.repaired) {
            repairedPaper = item.paper;
          }
        } else if (item.status === 'error') {
          errorCount += 1;
        }
      }

      if (metadataQueueRef.current.length > 0) {
        drainMetadataQueue();
      }

      await refreshAll();

      if (firstImportedPaper) {
        setSelectedPaperId(firstImportedPaper.id);
      } else if (duplicatePaper) {
        if (duplicatePaper.folderId) {
          setActiveView('folder');
          setActiveFolderId(duplicatePaper.folderId);
        } else {
          setActiveView('all');
          setActiveFolderId(null);
        }
        setSelectedPaperId(duplicatePaper.id);
      }

      if (repairedPaper) {
        setReaderReloadNonce((n) => n + 1);
      }

      if (importedCount > 0) {
        pushToast('success', `成功导入 ${importedCount} 篇文档`);
      }
      if (repairedPaper) {
        pushToast('success', `已自动补齐缺失的托管文件：${repairedPaper.title}`);
      } else if (duplicatePaper && importedCount === 0) {
        pushToast('info', `检测到重复文档（SHA-256 相同），已定位打开：${duplicatePaper.title}`);
      } else if (duplicatePaper) {
        pushToast('info', `部分文件已存在于文档库中（SHA-256 去重跳过）`);
      }
      if (errorCount > 0) {
        pushToast('warning', `${errorCount} 个文件未导入（仅支持有效的 .pdf / .md 文件）`);
      }
    },
    [pushToast, refreshAll, refreshPapers],
  );

  const handleRelinkPaperFile = useCallback(
    async (paperId: string) => {
      const res = await window.foxreader.relinkPaperFile(paperId);
      if (res.canceled) return;
      if (res.ok) {
        setReaderReloadNonce((n) => n + 1);
        pushToast('success', '已重新关联原始文档，正在重新加载');
      } else {
        pushToast('warning', res.error || '重新关联失败');
      }
    },
    [pushToast],
  );

  const handlePickAndImport = useCallback(
    async (folderId: string | null) => {
      const results = await window.foxreader.pickAndImportPdfs(folderId);
      await handleImportResults(results);
    },
    [handleImportResults],
  );

  const handleImportFiles = useCallback(
    async (files: File[], folderId: string | null) => {
      const docPaths = files
        .filter((f) => {
          const lower = f.name.toLowerCase();
          return lower.endsWith('.pdf') || lower.endsWith('.md') || lower.endsWith('.markdown');
        })
        .map((f) => window.foxreader.getPathForFile(f))
        .filter((p) => p.length > 0);
      if (docPaths.length === 0) {
        pushToast('warning', '请拖入 .pdf 或 .md 格式的文档文件');
        return;
      }
      const results = await window.foxreader.importPaths(docPaths, folderId);
      await handleImportResults(results);
    },
    [handleImportResults, pushToast],
  );

  const handleCreateFolder = async (name: string, parentId: string | null) => {
    await window.foxreader.createFolder(name, parentId);
    await refreshOverview();
  };

  const handleRenameFolder = async (id: string, name: string) => {
    await window.foxreader.renameFolder(id, name);
    await refreshOverview();
  };

  const handleMoveFolder = async (id: string, parentId: string | null) => {
    try {
      await window.foxreader.moveFolder(id, parentId);
      await refreshAll();
      pushToast('success', parentId ? '已移动文件夹' : '已移至顶层文件夹');
    } catch (error) {
      pushToast('warning', error instanceof Error ? error.message : '移动文件夹失败');
    }
  };

  const handleConfirmDeleteFolder = async () => {
    if (!confirmDeleteFolder) return;
    const target = confirmDeleteFolder;
    setConfirmDeleteFolder(null);
    const { movedPaperCount } = await window.foxreader.deleteFolder(target.id);
    if (activeView === 'folder' && activeFolderId === target.id) {
      setActiveView('all');
      setActiveFolderId(null);
    }
    await refreshAll();
    pushToast(
      'info',
      movedPaperCount > 0
        ? `已删除文件夹「${target.name}」，${movedPaperCount} 篇论文已安全移至「未分类」`
        : `已删除文件夹「${target.name}」`,
    );
  };

  const handleConfirmDeleteTag = async () => {
    if (!confirmDeleteTag) return;
    const target = confirmDeleteTag;
    setConfirmDeleteTag(null);
    await window.foxreader.deleteTag(target.id);
    if (activeTagId === target.id) {
      setActiveTagId(null);
    }
    await refreshAll();
    pushToast('info', `已删除标签「#${target.name}」`);
  };

  const handleMovePaperToFolder = async (paperId: string, folderId: string | null) => {
    await window.foxreader.movePaperToFolder(paperId, folderId);
    await refreshAll();
    pushToast('success', folderId ? '已移动论文到目标文件夹' : '已移至「未分类」');
  };

  const handleSaveMetadata = async (
    paperId: string,
    input: UpdatePaperMetadataInput,
    tagNames: string[],
  ) => {
    await window.foxreader.updatePaperMetadata(paperId, input);
    await window.foxreader.setPaperTags(paperId, tagNames);
    await refreshAll();
    pushToast('success', '论文元数据与标签已更新');
  };

  const handleSearchByTerm = useCallback(
    (term: string) => {
      const clean = term.trim();
      if (!clean) return;
      setSearchQuery(clean);
      setDebouncedSearch(clean);
      if (leftCollapsed) {
        setLeftCollapsed(false);
      }
      pushToast('info', `已按「${clean}」搜索论文库`);
    },
    [leftCollapsed, pushToast],
  );

  const handleReextractMetadata = useCallback(
    async (paper: Paper) => {
      setReextractingMeta(true);
      try {
        const meta = await extractPdfMetadata(paper.sha256);
        if (!meta || (!meta.title && !meta.authors && !meta.affiliations && !meta.year)) {
          pushToast('warning', '未能从 PDF 首页识别出有效标题、作者或机构信息');
          return;
        }
        await window.foxreader.updatePaperMetadata(paper.id, {
          pageCount: meta.pageCount,
          ...(meta.title ? { title: meta.title } : {}),
          ...(meta.authors ? { authors: meta.authors } : {}),
          ...(meta.affiliations ? { affiliations: meta.affiliations } : {}),
          ...(meta.year ? { year: meta.year } : {}),
          ...(meta.doi ? { doi: meta.doi } : {}),
          ...(meta.arxivId ? { arxivId: meta.arxivId } : {}),
        });
        await refreshPapers();
        pushToast('success', '已重新识别论文标题、作者与机构');
      } finally {
        setReextractingMeta(false);
      }
    },
    [pushToast, refreshPapers],
  );

  const handleEnrichOnline = useCallback(
    async (paper: Paper) => {
      setEnrichingOnline(true);
      try {
        const localMeta = paper.fileType === 'pdf' ? await extractPdfMetadata(paper.sha256) : null;
        const res = await window.foxreader.enrichPaperOnline({
          titleHint: localMeta?.title || paper.title,
          doiHint: paper.doi || localMeta?.doi,
          arxivIdHint: paper.arxivId || localMeta?.arxivId,
        });
        if (!res.matched) {
          pushToast('warning', res.error || '未能联网匹配到该论文信息');
          return;
        }
        await window.foxreader.updatePaperMetadata(paper.id, {
          ...(res.title ? { title: res.title } : {}),
          ...(res.authors ? { authors: res.authors } : {}),
          ...(res.affiliations ? { affiliations: res.affiliations } : {}),
          ...(res.year !== undefined ? { year: res.year } : {}),
          ...(res.doi ? { doi: res.doi } : {}),
          ...(res.arxivId ? { arxivId: res.arxivId } : {}),
          ...(res.venue ? { venue: res.venue } : {}),
          ...(res.bibtex ? { bibtex: res.bibtex } : {}),
        });
        await refreshPapers();
        pushToast('success', `已通过 ${res.source || 'OpenAlex'} 补全学术元数据与 BibTeX`);
      } catch (error) {
        pushToast('error', `联网补全失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setEnrichingOnline(false);
      }
    },
    [pushToast, refreshPapers],
  );

  const handleCopyPaperBibtex = useCallback(
    (paper: Paper) => {
      const bib = buildBibtexFromPaper(paper);
      void navigator.clipboard.writeText(bib).then(
        () => pushToast('success', '已复制 BibTeX 引用到剪贴板'),
        () => pushToast('error', '复制 BibTeX 失败'),
      );
    },
    [pushToast],
  );

  const handleExportBatchBibtex = useCallback(
    async (targets: Paper[], onDone: () => void) => {
      if (targets.length === 0) return;
      const res = await window.foxreader.exportBibtex(targets.map((p) => p.id));
      if (res.canceled) return;
      if (res.ok) {
        onDone();
        pushToast('success', `已导出 ${res.count ?? targets.length} 篇文献的 BibTeX 文件`);
      } else {
        pushToast('error', res.error || '导出 BibTeX 失败');
      }
    },
    [pushToast],
  );

  const handleJumpToPage = useCallback((pageNumber: number) => {
    setPageJumpRequest({ pageNumber, nonce: Date.now() });
  }, []);

  const handleConfirmDeletePaper = async () => {
    if (!confirmDeletePaper) return;
    const target = confirmDeletePaper;
    setConfirmDeletePaper(null);
    await window.foxreader.deletePaper(target.id);
    if (selectedPaperId === target.id) {
      setSelectedPaperId(null);
    }
    await refreshAll();
    pushToast('info', `已删除论文「${target.title}」及其本地托管副本`);
  };

  const handleConfirmBatchDeletePapers = async () => {
    if (!confirmBatchDelete) return;
    const { papers: targets, onDone } = confirmBatchDelete;
    setConfirmBatchDelete(null);
    const ids = targets.map((p) => p.id);
    const { deletedCount } = await window.foxreader.deletePapers(ids);
    if (selectedPaperId && ids.includes(selectedPaperId)) {
      setSelectedPaperId(null);
    }
    onDone();
    await refreshAll();
    pushToast('info', `已批量删除 ${deletedCount} 篇论文及其本地托管副本`);
  };

  const handleSaveProgress = useCallback((paperId: string, lastPage: number, lastZoom: number) => {
    void window.foxreader.updatePaperProgress(paperId, lastPage, lastZoom);
  }, []);

  const handleSyncPageCount = useCallback(
    (paperId: string, pageCount: number) => {
      void window.foxreader.updatePaperMetadata(paperId, { pageCount }).then(() => refreshPapers());
    },
    [refreshPapers],
  );

  const handleSelectDataDir = useCallback(async () => {
    const updated = await window.foxreader.selectDataDir();
    if (!updated) return;
    setDataDir(updated.dataDir);
    setLockWarning(updated.lockWarning ?? null);
    setSelectedPaperId(null);
    setActiveView('all');
    setActiveFolderId(null);
    setActiveTagId(null);
    await refreshAll();
    pushToast('success', `数据目录已切换至：${updated.dataDir}`);
  }, [refreshAll, pushToast]);

  const menuHandlersRef = useRef({
    openSettings: () => setSettingsOpen(true),
    checkUpdates: () => {
      setSettingsOpen(true);
      setSettingsAutoCheckNonce((n) => n + 1);
    },
    selectDataDir: () => void handleSelectDataDir(),
    importFiles: () => void handlePickAndImport(activeView === 'folder' ? activeFolderId : null),
  });
  menuHandlersRef.current = {
    openSettings: () => setSettingsOpen(true),
    checkUpdates: () => {
      setSettingsOpen(true);
      setSettingsAutoCheckNonce((n) => n + 1);
    },
    selectDataDir: () => void handleSelectDataDir(),
    importFiles: () => void handlePickAndImport(activeView === 'folder' ? activeFolderId : null),
  };

  useEffect(() => {
    return window.foxreader.onMenuAction((action) => {
      if (action === 'open-settings') menuHandlersRef.current.openSettings();
      else if (action === 'check-updates') menuHandlersRef.current.checkUpdates();
      else if (action === 'select-data-dir') menuHandlersRef.current.selectDataDir();
      else if (action === 'import-files') menuHandlersRef.current.importFiles();
    });
  }, []);

  const handleAcknowledgeLockWarning = async () => {
    await window.foxreader.acknowledgeLockWarning();
    setLockWarning(null);
  };

  const handleQuitApp = async () => {
    await window.foxreader.quitApp();
  };

  // M2 Annotation Handlers
  const handleCreateTextAnnotation = useCallback(
    async (payload: {
      pageNumber: number;
      rects: NormalizedRect[];
      quoteText: string;
      color: AnnotationColor;
      focusComment: boolean;
      comment?: string;
    }) => {
      if (!selectedPaperId) return;
      const created = await window.foxreader.createAnnotation({
        paperId: selectedPaperId,
        type: 'text',
        pageNumber: payload.pageNumber,
        rects: payload.rects,
        color: payload.color,
        quoteText: payload.quoteText,
        ...(payload.comment ? { comment: payload.comment } : {}),
      });
      setActiveColor(payload.color);
      setAnnotations((prev) => sortAnnotations([...prev, created]));
      setSelectedAnnotationId(created.id);
      if (payload.focusComment) {
        setRightCollapsed(false);
        setRightTab('annotations');
        setCardRevealRequest({ id: created.id, focusComment: true, nonce: Date.now() });
      }
    },
    [selectedPaperId],
  );

  const handleCreateAreaAnnotation = useCallback(
    async (payload: {
      pageNumber: number;
      rects: NormalizedRect[];
      snapshotPngBase64: string;
    }) => {
      if (!selectedPaperId) return;
      const created = await window.foxreader.createAnnotation({
        paperId: selectedPaperId,
        type: 'area',
        pageNumber: payload.pageNumber,
        rects: payload.rects,
        color: activeColor,
        snapshotPngBase64: payload.snapshotPngBase64,
      });
      setAnnotations((prev) => sortAnnotations([...prev, created]));
      setSelectedAnnotationId(created.id);
      setRightCollapsed(false);
      setRightTab('annotations');
      setCardRevealRequest({ id: created.id, focusComment: true, nonce: Date.now() });
      pushToast('success', `已截取第 ${payload.pageNumber} 页区域截图`);
    },
    [selectedPaperId, activeColor, pushToast],
  );

  const handleUpdateAnnotation = useCallback(async (id: string, input: UpdateAnnotationInput) => {
    const updated = await window.foxreader.updateAnnotation(id, input);
    if (input.color) setActiveColor(input.color);
    setAnnotations((prev) => sortAnnotations(prev.map((a) => (a.id === id ? updated : a))));
  }, []);

  const handleUpdateAnnotationColor = useCallback(
    async (id: string, color: AnnotationColor) => {
      await handleUpdateAnnotation(id, { color });
    },
    [handleUpdateAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    async (id: string) => {
      await window.foxreader.deleteAnnotation(id);
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      setSelectedAnnotationId((curr) => (curr === id ? null : curr));
      pushToast('info', '已删除批注');
    },
    [pushToast],
  );

  const handleSaveNote = useCallback(
    async (paperId: string, contentMd: string) => {
      const saved = await window.foxreader.savePaperNote(paperId, contentMd);
      if (paperId === selectedPaperId) {
        setPaperNote(saved);
      }
      if (debouncedSearch.trim().length > 0) {
        await refreshPapers();
      }
    },
    [selectedPaperId, debouncedSearch, refreshPapers],
  );

  const handleSelectAnnotationFromPdf = useCallback((annotation: Annotation) => {
    setSelectedAnnotationId(annotation.id);
    setRightCollapsed(false);
    setRightTab('annotations');
    setCardRevealRequest({ id: annotation.id, focusComment: false, nonce: Date.now() });
  }, []);

  const handleJumpToAnnotation = useCallback((annotation: Annotation) => {
    setSelectedAnnotationId(annotation.id);
    setJumpRequest({ annotation, nonce: Date.now() });
  }, []);

  const handleCopyText = useCallback(
    (text: string) => {
      void navigator.clipboard.writeText(text).then(
        () => pushToast('success', '已复制摘录文本'),
        () => pushToast('error', '复制失败'),
      );
    },
    [pushToast],
  );

  // Window-wide external PDF drag-and-drop
  const handleWindowDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setWindowFileDragOver(true);
    }
  };

  const handleWindowDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setWindowFileDragOver(false);
    }
  };

  const handleWindowDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setWindowFileDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      const targetFolder = activeView === 'folder' ? activeFolderId : null;
      void handleImportFiles(Array.from(e.dataTransfer.files), targetFolder);
    }
  };

  return (
    <div
      onDragOver={handleWindowDragOver}
      onDragLeave={handleWindowDragLeave}
      onDrop={handleWindowDrop}
      className="h-screen w-screen overflow-hidden flex bg-slate-100 text-slate-900 relative"
    >
      {!leftCollapsed && (
        <LeftSidebar
          folders={overview.folders}
          folderCounts={overview.folderCounts}
          tags={overview.tags}
          tagCounts={overview.tagCounts}
          totalCount={overview.totalCount}
          unclassifiedCount={overview.unclassifiedCount}
          papers={papers}
          activeView={activeView}
          activeFolderId={activeFolderId}
          activeTagId={activeTagId}
          statusFilter={statusFilter}
          searchQuery={searchQuery}
          selectedPaperId={selectedPaperId}
          onSelectView={(view, folderId = null) => {
            setActiveView(view);
            setActiveFolderId(folderId);
          }}
          onSelectTag={setActiveTagId}
          onDeleteTag={setConfirmDeleteTag}
          onChangeStatusFilter={setStatusFilter}
          onChangeSearch={setSearchQuery}
          onSelectPaper={setSelectedPaperId}
          onPickAndImport={(folderId) => void handlePickAndImport(folderId)}
          onImportFiles={(files, folderId) => void handleImportFiles(files, folderId)}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onMoveFolder={handleMoveFolder}
          onRequestDeleteFolder={setConfirmDeleteFolder}
          onMovePaperToFolder={handleMovePaperToFolder}
          onEditPaper={setEditingPaper}
          onCopyPaperBibtex={handleCopyPaperBibtex}
          onRequestDeletePaper={setConfirmDeletePaper}
          onExportBatchBibtex={(items, onDone) => void handleExportBatchBibtex(items, onDone)}
          onRequestBatchDeletePapers={(items, onDone) =>
            setConfirmBatchDelete({ papers: items, onDone })
          }
          onChangePaperStatus={handleChangePaperStatus}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {selectedPaper?.fileType === 'md' ? (
        <MarkdownReader
          paper={selectedPaper}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          onToggleLeft={() => setLeftCollapsed((p) => !p)}
          onToggleRight={() => setRightCollapsed((p) => !p)}
          onCopyText={handleCopyText}
          onChangePaperStatus={handleChangePaperStatus}
          reloadNonce={readerReloadNonce}
          onOpenDocsDir={() => void window.foxreader.openDataDir('docs')}
          onRelinkPaperFile={handleRelinkPaperFile}
        />
      ) : (
        <PdfReader
          paper={selectedPaper}
          annotations={annotations}
          activeColor={activeColor}
          selectedAnnotationId={selectedAnnotationId}
          jumpRequest={jumpRequest}
          pageJumpRequest={pageJumpRequest}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          onToggleLeft={() => setLeftCollapsed((p) => !p)}
          onToggleRight={() => setRightCollapsed((p) => !p)}
          onSaveProgress={handleSaveProgress}
          onSyncPageCount={handleSyncPageCount}
          onCurrentPageChange={setCurrentPdfPage}
          onPickAndImport={() => void handlePickAndImport(activeView === 'folder' ? activeFolderId : null)}
          onCreateTextAnnotation={handleCreateTextAnnotation}
          onCreateAreaAnnotation={handleCreateAreaAnnotation}
          onUpdateAnnotationColor={handleUpdateAnnotationColor}
          onDeleteAnnotation={handleDeleteAnnotation}
          onSelectAnnotationFromPdf={handleSelectAnnotationFromPdf}
          onCopyText={handleCopyText}
          onChangePaperStatus={handleChangePaperStatus}
          reloadNonce={readerReloadNonce}
          onOpenPdfsDir={() => void window.foxreader.openDataDir('pdfs')}
          onRelinkPaperFile={handleRelinkPaperFile}
        />
      )}

      {!rightCollapsed && (
        <RightSidebar
          selectedPaper={selectedPaper}
          annotations={annotations}
          note={paperNote}
          activeTab={rightTab}
          selectedAnnotationId={selectedAnnotationId}
          cardRevealRequest={cardRevealRequest}
          reextractingMeta={reextractingMeta}
          enrichingOnline={enrichingOnline}
          currentPdfPage={currentPdfPage}
          onChangeTab={setRightTab}
          onJumpToAnnotation={handleJumpToAnnotation}
          onJumpToPage={handleJumpToPage}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onSaveNote={handleSaveNote}
          onCopyText={handleCopyText}
          onCopyBibtex={handleCopyPaperBibtex}
          onSearchTerm={handleSearchByTerm}
          onEditPaperMetadata={setEditingPaper}
          onReextractMetadata={handleReextractMetadata}
          onEnrichOnline={handleEnrichOnline}
        />
      )}

      {windowFileDragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-violet-500/10 border-4 border-dashed border-violet-500 flex items-center justify-center">
          <div className="rounded-xl bg-white px-6 py-4 shadow-xl border border-violet-200 text-sm font-semibold text-violet-900">
            松开鼠标即可导入 PDF / Markdown 文档
          </div>
        </div>
      )}

      <MetadataModal
        paper={editingPaper}
        folders={overview.folders}
        availableTags={overview.tags}
        onClose={() => setEditingPaper(null)}
        onSave={handleSaveMetadata}
        onEnrichOnlineWithHints={(input) => window.foxreader.enrichPaperOnline(input)}
        onCopyText={(text) =>
          void navigator.clipboard.writeText(text).then(
            () => pushToast('success', '已复制到剪贴板'),
            () => pushToast('error', '复制失败'),
          )
        }
      />

      <ConfirmModal
        open={confirmDeleteFolder !== null}
        title="确认删除文件夹"
        danger
        confirmLabel="删除文件夹"
        message={
          confirmDeleteFolder
            ? `确定要删除文件夹「${confirmDeleteFolder.name}」及其子文件夹吗？\n\n注意：文件夹删除绝不会删除论文文件本身，其下所有论文将自动移回「未分类」。`
            : ''
        }
        onCancel={() => setConfirmDeleteFolder(null)}
        onConfirm={() => void handleConfirmDeleteFolder()}
      />

      <ConfirmModal
        open={confirmDeleteTag !== null}
        title="确认删除标签"
        danger
        confirmLabel="删除标签"
        message={
          confirmDeleteTag
            ? `确定要删除标签「#${confirmDeleteTag.name}」吗？\n\n仅会移除论文与该标签的关联，不会影响论文文件与批注。`
            : ''
        }
        onCancel={() => setConfirmDeleteTag(null)}
        onConfirm={() => void handleConfirmDeleteTag()}
      />

      <ConfirmModal
        open={confirmDeletePaper !== null}
        title="确认删除论文"
        danger
        confirmLabel="彻底删除"
        message={
          confirmDeletePaper
            ? `确定要从 FoxReader 库中删除「${confirmDeletePaper.title}」吗？\n\n此操作会清理数据库记录、FoxReaderData/pdfs/ 中的托管 PDF 副本以及关联截图（不会影响你磁盘上的原始外部文件）。`
            : ''
        }
        onCancel={() => setConfirmDeletePaper(null)}
        onConfirm={() => void handleConfirmDeletePaper()}
      />

      <ConfirmModal
        open={confirmBatchDelete !== null}
        title="确认批量删除论文"
        danger
        confirmLabel={`彻底删除 (${confirmBatchDelete?.papers.length ?? 0})`}
        message={
          confirmBatchDelete
            ? `确定要从 FoxReader 库中批量删除选中的 ${confirmBatchDelete.papers.length} 篇论文吗？\n\n${confirmBatchDelete.papers
                .slice(0, 3)
                .map((p) => `· ${p.title}`)
                .join('\n')}${
                confirmBatchDelete.papers.length > 3
                  ? `\n· ...等共 ${confirmBatchDelete.papers.length} 篇`
                  : ''
              }\n\n此操作会清理数据库记录、托管 PDF 副本与关联截图（不会影响磁盘上的原始外部文件）。`
            : ''
        }
        onCancel={() => setConfirmBatchDelete(null)}
        onConfirm={() => void handleConfirmBatchDeletePapers()}
      />

      <SettingsModal
        open={settingsOpen}
        dataDir={dataDir}
        appVersion={appVersion}
        autoCheckNonce={settingsAutoCheckNonce}
        onClose={() => setSettingsOpen(false)}
        onSelectDataDir={handleSelectDataDir}
        onOpenDataDir={(subDir) => window.foxreader.openDataDir(subDir)}
        onCheckForUpdates={() => window.foxreader.checkForUpdates()}
        onDownloadUpdate={(input) => window.foxreader.downloadUpdate(input)}
        onCancelUpdateDownload={() => window.foxreader.cancelUpdateDownload()}
        onApplyDownloadedUpdate={(filePath) => window.foxreader.applyDownloadedUpdate(filePath)}
        onSubscribeUpdateState={(listener) => window.foxreader.onUpdateDownloadState(listener)}
        onOpenExternalUrl={(url) => window.foxreader.openExternalUrl(url)}
      />

      <LockWarningModal
        lockInfo={lockWarning}
        onAcknowledge={handleAcknowledgeLockWarning}
        onQuit={handleQuitApp}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

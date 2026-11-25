import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Annotation,
  AnnotationColor,
  Folder,
  ImportPdfItemResult,
  LibraryOverview,
  LibraryView,
  NormalizedRect,
  Paper,
  PaperStatus,
  UpdateAnnotationInput,
  UpdatePaperMetadataInput,
} from '../shared/types';
import { extractPdfMetadata } from './lib/pdf';
import { LeftSidebar } from './components/LeftSidebar';
import { PdfReader } from './components/PdfReader';
import { RightSidebar } from './components/RightSidebar';
import {
  ConfirmModal,
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
  const [overview, setOverview] = useState<LibraryOverview>({
    folders: [],
    totalCount: 0,
    unclassifiedCount: 0,
    folderCounts: {},
    tags: [],
  });
  const [papers, setPapers] = useState<Paper[]>([]);

  const [activeView, setActiveView] = useState<LibraryView>('all');
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PaperStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  // M2 Annotation state
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [windowFileDragOver, setWindowFileDragOver] = useState(false);
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
      status: statusFilter,
      search: debouncedSearch,
    });
    setPapers(next);
  }, [activeView, activeFolderId, statusFilter, debouncedSearch]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshOverview(), refreshPapers()]);
  }, [refreshOverview, refreshPapers]);

  useEffect(() => {
    void window.foxreader.getSettings().then((s) => setDataDir(s.dataDir));
    void refreshOverview();
  }, [refreshOverview]);

  useEffect(() => {
    void refreshPapers();
  }, [refreshPapers]);

  const selectedPaper = useMemo(
    () => papers.find((p) => p.id === selectedPaperId) ?? null,
    [papers, selectedPaperId],
  );

  // Load annotations whenever selectedPaperId changes
  useEffect(() => {
    setSelectedAnnotationId(null);
    setCardRevealRequest(null);
    setJumpRequest(null);
    if (!selectedPaperId) {
      setAnnotations([]);
      return;
    }
    let cancelled = false;
    void window.foxreader.listAnnotations(selectedPaperId).then((items) => {
      if (!cancelled) setAnnotations(items);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPaperId]);

  const handleImportResults = useCallback(
    async (results: ImportPdfItemResult[]) => {
      if (results.length === 0) return;

      let importedCount = 0;
      let duplicatePaper: Paper | null = null;
      let firstImportedPaper: Paper | null = null;
      let errorCount = 0;

      for (const item of results) {
        if (item.status === 'imported' && item.paper) {
          importedCount += 1;
          if (!firstImportedPaper) firstImportedPaper = item.paper;
          const targetId = item.paper.id;
          const targetSha = item.paper.sha256;
          void extractPdfMetadata(targetSha).then(async (meta) => {
            if (!meta) return;
            await window.foxreader.updatePaperMetadata(targetId, {
              pageCount: meta.pageCount,
              ...(meta.title ? { title: meta.title } : {}),
              ...(meta.authors ? { authors: meta.authors } : {}),
            });
            await refreshPapers();
          });
        } else if (item.status === 'duplicate' && item.paper) {
          duplicatePaper = item.paper;
        } else if (item.status === 'error') {
          errorCount += 1;
        }
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

      if (importedCount > 0) {
        pushToast('success', `成功导入 ${importedCount} 篇 PDF 论文`);
      }
      if (duplicatePaper && importedCount === 0) {
        pushToast('info', `检测到重复论文（SHA-256 相同），已定位打开：${duplicatePaper.title}`);
      } else if (duplicatePaper) {
        pushToast('info', `部分文件已存在于论文库中（SHA-256 去重跳过）`);
      }
      if (errorCount > 0) {
        pushToast('warning', `${errorCount} 个文件未导入（仅支持有效的 .pdf 文件）`);
      }
    },
    [pushToast, refreshAll, refreshPapers],
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
      const pdfPaths = files
        .filter((f) => f.name.toLowerCase().endsWith('.pdf'))
        .map((f) => window.foxreader.getPathForFile(f))
        .filter((p) => p.length > 0);
      if (pdfPaths.length === 0) {
        pushToast('warning', '请拖入 .pdf 格式的论文文件');
        return;
      }
      const results = await window.foxreader.importPaths(pdfPaths, folderId);
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

  const handleMovePaperToFolder = async (paperId: string, folderId: string | null) => {
    await window.foxreader.movePaperToFolder(paperId, folderId);
    await refreshAll();
    pushToast('success', folderId ? '已移动论文到目标文件夹' : '已移至「未分类」');
  };

  const handleSaveMetadata = async (paperId: string, input: UpdatePaperMetadataInput) => {
    await window.foxreader.updatePaperMetadata(paperId, input);
    await refreshAll();
    pushToast('success', '论文元数据已更新');
  };

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

  const handleSaveProgress = useCallback((paperId: string, lastPage: number, lastZoom: number) => {
    void window.foxreader.updatePaperProgress(paperId, lastPage, lastZoom);
  }, []);

  const handleSyncPageCount = useCallback(
    (paperId: string, pageCount: number) => {
      void window.foxreader.updatePaperMetadata(paperId, { pageCount }).then(() => refreshPapers());
    },
    [refreshPapers],
  );

  const handleSelectDataDir = async () => {
    const updated = await window.foxreader.selectDataDir();
    if (!updated) return;
    setDataDir(updated.dataDir);
    setSelectedPaperId(null);
    setActiveView('all');
    setActiveFolderId(null);
    await refreshAll();
    pushToast('success', `数据目录已切换至：${updated.dataDir}`);
  };

  // M2 Annotation Handlers
  const handleCreateTextAnnotation = useCallback(
    async (payload: {
      pageNumber: number;
      rects: NormalizedRect[];
      quoteText: string;
      color: AnnotationColor;
      focusComment: boolean;
    }) => {
      if (!selectedPaperId) return;
      const created = await window.foxreader.createAnnotation({
        paperId: selectedPaperId,
        type: 'text',
        pageNumber: payload.pageNumber,
        rects: payload.rects,
        color: payload.color,
        quoteText: payload.quoteText,
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
          totalCount={overview.totalCount}
          unclassifiedCount={overview.unclassifiedCount}
          papers={papers}
          activeView={activeView}
          activeFolderId={activeFolderId}
          statusFilter={statusFilter}
          searchQuery={searchQuery}
          selectedPaperId={selectedPaperId}
          onSelectView={(view, folderId = null) => {
            setActiveView(view);
            setActiveFolderId(folderId);
          }}
          onChangeStatusFilter={setStatusFilter}
          onChangeSearch={setSearchQuery}
          onSelectPaper={setSelectedPaperId}
          onPickAndImport={(folderId) => void handlePickAndImport(folderId)}
          onImportFiles={(files, folderId) => void handleImportFiles(files, folderId)}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onRequestDeleteFolder={setConfirmDeleteFolder}
          onMovePaperToFolder={handleMovePaperToFolder}
          onEditPaper={setEditingPaper}
          onRequestDeletePaper={setConfirmDeletePaper}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      <PdfReader
        paper={selectedPaper}
        annotations={annotations}
        activeColor={activeColor}
        selectedAnnotationId={selectedAnnotationId}
        jumpRequest={jumpRequest}
        leftCollapsed={leftCollapsed}
        rightCollapsed={rightCollapsed}
        onToggleLeft={() => setLeftCollapsed((p) => !p)}
        onToggleRight={() => setRightCollapsed((p) => !p)}
        onSaveProgress={handleSaveProgress}
        onSyncPageCount={handleSyncPageCount}
        onPickAndImport={() => void handlePickAndImport(activeView === 'folder' ? activeFolderId : null)}
        onCreateTextAnnotation={handleCreateTextAnnotation}
        onCreateAreaAnnotation={handleCreateAreaAnnotation}
        onUpdateAnnotationColor={handleUpdateAnnotationColor}
        onDeleteAnnotation={handleDeleteAnnotation}
        onSelectAnnotationFromPdf={handleSelectAnnotationFromPdf}
        onCopyText={handleCopyText}
      />

      {!rightCollapsed && (
        <RightSidebar
          selectedPaper={selectedPaper}
          annotations={annotations}
          activeTab={rightTab}
          selectedAnnotationId={selectedAnnotationId}
          cardRevealRequest={cardRevealRequest}
          onChangeTab={setRightTab}
          onJumpToAnnotation={handleJumpToAnnotation}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onCopyText={handleCopyText}
        />
      )}

      {windowFileDragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-violet-500/10 border-4 border-dashed border-violet-500 flex items-center justify-center">
          <div className="rounded-xl bg-white px-6 py-4 shadow-xl border border-violet-200 text-sm font-semibold text-violet-900">
            松开鼠标即可导入 PDF 论文
          </div>
        </div>
      )}

      <MetadataModal
        paper={editingPaper}
        folders={overview.folders}
        onClose={() => setEditingPaper(null)}
        onSave={handleSaveMetadata}
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

      <SettingsModal
        open={settingsOpen}
        dataDir={dataDir}
        onClose={() => setSettingsOpen(false)}
        onSelectDataDir={handleSelectDataDir}
        onOpenDataDir={() => window.foxreader.openDataDir()}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

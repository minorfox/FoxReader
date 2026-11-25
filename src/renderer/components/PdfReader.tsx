import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileUp,
  Highlighter,
  Maximize2,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SquareDashedMousePointer,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ANNOTATION_COLORS,
  type Annotation,
  type AnnotationColor,
  type NormalizedRect,
  type Paper,
} from '../../shared/types';
import { getPdfDocumentOptions, pdfjsLib } from '../lib/pdf';
import { extractSelectionForPage } from '../lib/selection';
import { PdfPageCanvas } from './PdfPageCanvas';

interface PageSize {
  width: number;
  height: number;
}

interface TextSelectionPrompt {
  pageNumber: number;
  rects: NormalizedRect[];
  quoteText: string;
  anchor: { clientX: number; clientY: number };
}

interface AnnotationPopoverState {
  annotationId: string;
  anchor: { clientX: number; clientY: number };
}

const ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

interface PdfReaderProps {
  paper: Paper | null;
  annotations: Annotation[];
  activeColor: AnnotationColor;
  selectedAnnotationId: string | null;
  jumpRequest: { annotation: Annotation; nonce: number } | null;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onSaveProgress: (paperId: string, lastPage: number, lastZoom: number) => void;
  onSyncPageCount: (paperId: string, pageCount: number) => void;
  onPickAndImport: () => void;
  onCreateTextAnnotation: (payload: {
    pageNumber: number;
    rects: NormalizedRect[];
    quoteText: string;
    color: AnnotationColor;
    focusComment: boolean;
  }) => Promise<void>;
  onCreateAreaAnnotation: (payload: {
    pageNumber: number;
    rects: NormalizedRect[];
    snapshotPngBase64: string;
  }) => Promise<void>;
  onUpdateAnnotationColor: (id: string, color: AnnotationColor) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onSelectAnnotationFromPdf: (annotation: Annotation) => void;
  onCopyText: (text: string) => void;
}

export function PdfReader({
  paper,
  annotations,
  activeColor,
  selectedAnnotationId,
  jumpRequest,
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
  onSaveProgress,
  onSyncPageCount,
  onPickAndImport,
  onCreateTextAnnotation,
  onCreateAreaAnnotation,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onSelectAnnotationFromPdf,
  onCopyText,
}: PdfReaderProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(false);
  const [containerWidth, setContainerWidth] = useState(800);
  const [annotationMode, setAnnotationMode] = useState<'text' | 'area'>('text');

  const [selectionBar, setSelectionBar] = useState<TextSelectionPrompt | null>(null);
  const [popover, setPopover] = useState<AnnotationPopoverState | null>(null);
  const [pulsingAnnotationId, setPulsingAnnotationId] = useState<string | null>(null);

  const visibleRatiosRef = useRef<Map<number, number>>(new Map());
  const pendingInitialJumpRef = useRef<number | null>(null);

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const ann of annotations) {
      const list = map.get(ann.pageNumber);
      if (list) list.push(ann);
      else map.set(ann.pageNumber, [ann]);
    }
    return map;
  }, [annotations]);

  const popoverAnnotation = useMemo(() => {
    if (!popover) return null;
    return annotations.find((a) => a.id === popover.annotationId) ?? null;
  }, [popover, annotations]);

  const registerElement = useCallback((pageNumber: number, el: HTMLDivElement | null) => {
    if (el) pageElementsRef.current.set(pageNumber, el);
    else pageElementsRef.current.delete(pageNumber);
  }, []);

  // Track viewport width for Fit-to-Width
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateWidth = () => {
      setContainerWidth(Math.max(320, el.clientWidth - 48));
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dismiss popovers on Escape or outside click
  useEffect(() => {
    if (!selectionBar && !popover) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectionBar(null);
        setPopover(null);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-fox-popover]')) return;
      setSelectionBar(null);
      setPopover(null);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [selectionBar, popover]);

  // Load PDF document when selected paper changes
  useEffect(() => {
    setSelectionBar(null);
    setPopover(null);
    setPulsingAnnotationId(null);

    if (!paper) {
      setPdfDoc(null);
      setPageSizes([]);
      setLoadError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const sha = paper.sha256;
    const paperId = paper.id;
    const initialPage = Math.max(1, paper.lastPage || 1);
    const initialZoom = paper.lastZoom || 1.0;

    setLoading(true);
    setLoadError(null);
    setPdfDoc(null);
    setPageSizes([]);
    setFitWidth(false);
    setZoom(initialZoom);
    setCurrentPage(initialPage);
    setPageInput(String(initialPage));
    pendingInitialJumpRef.current = initialPage;
    visibleRatiosRef.current.clear();

    const loadingTask = pdfjsLib.getDocument(getPdfDocumentOptions(sha));

    let loadedDoc: PDFDocumentProxy | null = null;

    async function load() {
      try {
        const doc = await loadingTask.promise;
        if (cancelled) {
          await doc.destroy();
          return;
        }
        loadedDoc = doc;
        const numPages = doc.numPages;

        if (paper && paper.pageCount !== numPages) {
          onSyncPageCount(paperId, numPages);
        }

        // Prime all page placeholders using page 1 dimensions immediately
        const firstPage = await doc.getPage(1);
        if (cancelled) return;
        const firstVp = firstPage.getViewport({ scale: 1.0 });
        const initialSizes: PageSize[] = Array.from({ length: numPages }, () => ({
          width: firstVp.width,
          height: firstVp.height,
        }));

        setPageSizes(initialSizes);
        setPdfDoc(doc);
        setLoading(false);

        // Measure remaining pages lazily in small batches so mixed page orientations stay exact
        if (numPages > 1) {
          const updatedSizes = [...initialSizes];
          for (let p = 2; p <= numPages; p++) {
            if (cancelled) return;
            const pg = await doc.getPage(p);
            const vp = pg.getViewport({ scale: 1.0 });
            updatedSizes[p - 1] = { width: vp.width, height: vp.height };
            if (p % 10 === 0 || p === numPages) {
              if (!cancelled) setPageSizes([...updatedSizes]);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setLoadError(err instanceof Error ? err.message : 'PDF 加载失败');
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      void loadingTask.destroy().catch(() => undefined);
      if (loadedDoc) {
        void loadedDoc.destroy().catch(() => undefined);
      }
    };
  }, [paper?.id, paper?.sha256]);

  // Compute effective zoom when Fit-to-Width is enabled
  const effectiveZoom = useMemo(() => {
    if (!fitWidth || pageSizes.length === 0) return zoom;
    const baseW = pageSizes[0].width || 595;
    return Math.min(3.0, Math.max(0.35, Number((containerWidth / baseW).toFixed(3))));
  }, [fitWidth, pageSizes, containerWidth, zoom]);

  const scrollToPage = useCallback(
    (targetPage: number, behavior: ScrollBehavior = 'smooth') => {
      if (pageSizes.length === 0) return;
      const clamped = Math.min(pageSizes.length, Math.max(1, targetPage));
      const el = pageElementsRef.current.get(clamped);
      if (el) {
        el.scrollIntoView({ behavior, block: 'start' });
      }
      setCurrentPage(clamped);
      setPageInput(String(clamped));
    },
    [pageSizes.length],
  );

  // Restore saved page scroll position after page placeholders mount
  useEffect(() => {
    if (!pdfDoc || pageSizes.length === 0 || pendingInitialJumpRef.current === null) return;
    const target = Math.min(pageSizes.length, Math.max(1, pendingInitialJumpRef.current));
    pendingInitialJumpRef.current = null;
    if (target > 1) {
      requestAnimationFrame(() => {
        scrollToPage(target, 'auto');
      });
    }
  }, [pdfDoc, pageSizes.length, scrollToPage]);

  // Handle bidirectional jump from right sidebar annotation card -> PDF position
  useEffect(() => {
    if (!jumpRequest || !pdfDoc || pageSizes.length === 0) return;
    const { annotation } = jumpRequest;
    const scrollEl = scrollContainerRef.current;
    const pageEl = pageElementsRef.current.get(annotation.pageNumber);

    setCurrentPage(annotation.pageNumber);
    setPageInput(String(annotation.pageNumber));
    setPopover(null);
    setSelectionBar(null);

    if (scrollEl && pageEl) {
      const containerRect = scrollEl.getBoundingClientRect();
      const pageRect = pageEl.getBoundingClientRect();
      const relativePageTop = pageRect.top - containerRect.top + scrollEl.scrollTop;
      const firstY = annotation.rects[0]?.y ?? 0;
      const targetTop = Math.max(
        0,
        relativePageTop + firstY * pageEl.offsetHeight - scrollEl.clientHeight * 0.28,
      );
      scrollEl.scrollTo({ top: targetTop, behavior: 'smooth' });
    }

    setPulsingAnnotationId(annotation.id);
    const timer = setTimeout(() => {
      setPulsingAnnotationId((curr) => (curr === annotation.id ? null : curr));
    }, 1600);
    return () => clearTimeout(timer);
  }, [jumpRequest, pdfDoc, pageSizes.length]);

  // IntersectionObserver to track visible page for lazy rendering window
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !pdfDoc || pageSizes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const pageAttr = (entry.target as HTMLElement).dataset.pageNumber;
          const pageNum = pageAttr ? Number.parseInt(pageAttr, 10) : NaN;
          if (!Number.isFinite(pageNum)) continue;
          if (entry.isIntersecting) {
            visibleRatiosRef.current.set(pageNum, entry.intersectionRatio);
          } else {
            visibleRatiosRef.current.delete(pageNum);
          }
        }

        let bestPage: number | null = null;
        let bestRatio = -1;
        for (const [p, ratio] of visibleRatiosRef.current.entries()) {
          if (ratio > bestRatio || (ratio === bestRatio && (bestPage === null || p < bestPage))) {
            bestRatio = ratio;
            bestPage = p;
          }
        }
        if (bestPage !== null) {
          setCurrentPage(bestPage);
          setPageInput(String(bestPage));
        }
      },
      {
        root,
        rootMargin: '250px 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1.0],
      },
    );

    for (const el of pageElementsRef.current.values()) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [pdfDoc, pageSizes.length]);

  // Debounced reading progress persistence
  useEffect(() => {
    if (!paper || !pdfDoc) return;
    const paperId = paper.id;
    const timer = setTimeout(() => {
      onSaveProgress(paperId, currentPage, effectiveZoom);
    }, 500);
    return () => clearTimeout(timer);
  }, [paper?.id, pdfDoc, currentPage, effectiveZoom, onSaveProgress]);

  const adjustZoom = (delta: number) => {
    setFitWidth(false);
    setZoom((prev) => {
      const base = fitWidth ? effectiveZoom : prev;
      return Math.min(3.0, Math.max(0.25, Number((base + delta).toFixed(2))));
    });
  };

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseInt(pageInput.trim(), 10);
    if (Number.isFinite(parsed)) {
      scrollToPage(parsed);
    } else {
      setPageInput(String(currentPage));
    }
  };

  const handleTextSelection = useCallback((payload: TextSelectionPrompt) => {
    setPopover(null);
    setSelectionBar(payload);
  }, []);

  const handleClickAnnotation = useCallback(
    (annotation: Annotation, anchor: { clientX: number; clientY: number }) => {
      setSelectionBar(null);
      setPopover({ annotationId: annotation.id, anchor });
      onSelectAnnotationFromPdf(annotation);
    },
    [onSelectAnnotationFromPdf],
  );

  const handleCommitTextHighlight = async (color: AnnotationColor, focusComment: boolean) => {
    if (!selectionBar) return;
    const payload = selectionBar;
    setSelectionBar(null);
    window.getSelection()?.removeAllRanges();
    await onCreateTextAnnotation({
      pageNumber: payload.pageNumber,
      rects: payload.rects,
      quoteText: payload.quoteText,
      color,
      focusComment,
    });
  };

  const totalPages = pdfDoc?.numPages ?? 0;

  return (
    <main className="flex-1 min-w-0 bg-slate-100 flex flex-col h-full relative">
      {/* Top Toolbar */}
      <header className="h-12 bg-white border-b border-slate-200 px-3 flex items-center justify-between gap-2 shrink-0 select-none">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggleLeft}
            title={leftCollapsed ? '展开左侧论文库' : '折叠左侧论文库'}
            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition shrink-0"
          >
            {leftCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>

          <div className="truncate text-xs font-medium text-slate-700">
            {paper ? paper.title : 'FoxReader 阅读工作台'}
          </div>
        </div>

        {/* Center Controls: Page Jump + Zoom */}
        {paper && totalPages > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-0.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => scrollToPage(currentPage - 1)}
                className="p-1 rounded text-slate-600 hover:bg-white disabled:opacity-35 transition"
                title="上一页"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1 text-xs">
                <input
                  type="text"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => setPageInput(String(currentPage))}
                  className="w-9 text-center rounded border border-transparent hover:border-slate-200 focus:border-violet-500 focus:bg-white focus:outline-none py-0.5 tabular-nums text-slate-800"
                />
                <span className="text-slate-400 tabular-nums">/ {totalPages}</span>
              </form>
              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => scrollToPage(currentPage + 1)}
                className="p-1 rounded text-slate-600 hover:bg-white disabled:opacity-35 transition"
                title="下一页"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 px-1 py-0.5">
              <button
                type="button"
                onClick={() => adjustZoom(-0.15)}
                className="p-1 rounded text-slate-600 hover:bg-white transition"
                title="缩小"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <select
                value={fitWidth ? 'fit' : String(Math.round(effectiveZoom * 100))}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'fit') {
                    setFitWidth(true);
                  } else {
                    setFitWidth(false);
                    setZoom(Number(v) / 100);
                  }
                }}
                className="bg-transparent text-xs font-medium text-slate-700 px-1 py-0.5 focus:outline-none cursor-pointer tabular-nums"
              >
                {fitWidth && <option value="fit">{Math.round(effectiveZoom * 100)}% (适宽)</option>}
                {!fitWidth && !ZOOM_PRESETS.some((p) => Math.round(p * 100) === Math.round(effectiveZoom * 100)) && (
                  <option value={String(Math.round(effectiveZoom * 100))}>
                    {Math.round(effectiveZoom * 100)}%
                  </option>
                )}
                {ZOOM_PRESETS.map((preset) => (
                  <option key={preset} value={String(Math.round(preset * 100))}>
                    {Math.round(preset * 100)}%
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => adjustZoom(0.15)}
                className="p-1 rounded text-slate-600 hover:bg-white transition"
                title="放大"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFitWidth((prev) => !prev)}
                title="适应宽度"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  fitWidth ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-white'
                }`}
              >
                <Maximize2 className="w-3 h-3" />
                适宽
              </button>
            </div>
          </div>
        )}

        {/* Right Controls: Annotation Mode + Right Sidebar Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {paper && (
            <div className="hidden md:flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setAnnotationMode('text')}
                title="文本划选模式（按住 Alt + 拖拽可快速区域框选）"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition ${
                  annotationMode === 'text'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Highlighter className="w-3 h-3" />
                划选
              </button>
              <button
                type="button"
                onClick={() => setAnnotationMode('area')}
                title="区域框选模式：拖拽框选公式或图表并截取 PNG 缩略图"
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition ${
                  annotationMode === 'area'
                    ? 'bg-white text-violet-700 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <SquareDashedMousePointer className="w-3 h-3" />
                框选
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onToggleRight}
            title={rightCollapsed ? '展开右侧批注与笔记' : '折叠右侧批注与笔记'}
            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
          >
            {rightCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Scrollable PDF Canvas Viewport */}
      <div
        ref={scrollContainerRef}
        onMouseUp={(e) => {
          if (annotationMode !== 'text' || e.altKey) return;
          requestAnimationFrame(() => {
            const sel = window.getSelection();
            if (!sel || sel.isCollapsed) return;
            for (const [pageNum, pageEl] of pageElementsRef.current.entries()) {
              const extracted = extractSelectionForPage(sel, pageEl);
              if (extracted) {
                handleTextSelection({
                  pageNumber: pageNum,
                  rects: extracted.rects,
                  quoteText: extracted.quoteText,
                  anchor: extracted.anchor,
                });
                break;
              }
            }
          });
        }}
        onScroll={() => {
          if (selectionBar) setSelectionBar(null);
          if (popover) setPopover(null);
        }}
        className="flex-1 overflow-auto p-6"
      >
        {!paper ? (
          <div className="h-full flex items-center justify-center">
            <div className="max-w-md w-full rounded-2xl border border-dashed border-slate-300 bg-white/80 p-8 text-center shadow-xs space-y-4">
              <div className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center mx-auto">
                <BookOpenCheck className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold text-slate-900">开始阅读你的本地论文库</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  直接将 PDF 文件拖入窗口，或点击下方按钮导入。FoxReader 会以 SHA-256 自动去重并只读托管副本，绝不修改原始 PDF。
                </p>
              </div>
              <button
                type="button"
                onClick={onPickAndImport}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition shadow-xs"
              >
                <FileUp className="w-4 h-4" />
                选择 PDF 导入
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="h-full flex items-center justify-center text-sm text-slate-500">
            正在解析 PDF 页面...
          </div>
        ) : loadError ? (
          <div className="h-full flex items-center justify-center">
            <div className="rounded-xl bg-red-50 border border-red-200 px-5 py-4 text-xs text-red-700 max-w-md">
              无法渲染该 PDF：{loadError}
            </div>
          </div>
        ) : pdfDoc ? (
          <div className="flex flex-col items-center gap-4 pb-12">
            {pageSizes.map((size, idx) => {
              const pageNum = idx + 1;
              const shouldRender = Math.abs(pageNum - currentPage) <= 2;
              return (
                <PdfPageCanvas
                  key={`${paper.id}-${pageNum}`}
                  pdfDoc={pdfDoc}
                  pageNumber={pageNum}
                  baseWidth={size.width}
                  baseHeight={size.height}
                  zoom={effectiveZoom}
                  shouldRender={shouldRender}
                  annotationMode={annotationMode}
                  annotations={annotationsByPage.get(pageNum) ?? []}
                  selectedAnnotationId={selectedAnnotationId}
                  pulsingAnnotationId={pulsingAnnotationId}
                  registerElement={registerElement}
                  onTextSelection={handleTextSelection}
                  onCreateAreaAnnotation={onCreateAreaAnnotation}
                  onClickAnnotation={handleClickAnnotation}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Floating Selection Toolbar */}
      {selectionBar && (
        <div
          data-fox-popover
          style={{
            left: `${Math.min(window.innerWidth - 320, Math.max(12, selectionBar.anchor.clientX - 140))}px`,
            top: `${Math.max(56, selectionBar.anchor.clientY - 48)}px`,
          }}
          className="fixed z-50 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-xl"
        >
          <div className="flex items-center gap-1 pr-1.5 border-r border-slate-200">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={`高亮（${c.label}）`}
                onClick={() => void handleCommitTextHighlight(c.id, false)}
                style={{ backgroundColor: c.swatch }}
                className="w-5 h-5 rounded-full ring-1 ring-black/10 hover:scale-110 transition flex items-center justify-center"
              >
                {activeColor === c.id && <Check className="w-3 h-3 text-slate-900/80 stroke-[2.5]" />}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleCommitTextHighlight(activeColor, true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-violet-700 hover:bg-violet-50 transition"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            高亮并写备注
          </button>

          <button
            type="button"
            onClick={() => {
              onCopyText(selectionBar.quoteText);
              setSelectionBar(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100 transition"
          >
            <Copy className="w-3.5 h-3.5" />
            复制
          </button>
        </div>
      )}

      {/* Existing Annotation Click Popover */}
      {popover && popoverAnnotation && (
        <div
          data-fox-popover
          style={{
            left: `${Math.min(window.innerWidth - 240, Math.max(12, popover.anchor.clientX - 100))}px`,
            top: `${Math.max(56, popover.anchor.clientY - 46)}px`,
          }}
          className="fixed z-50 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-xl"
        >
          <div className="flex items-center gap-1 pr-1.5 border-r border-slate-200">
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={`改为${c.label}色`}
                onClick={() => void onUpdateAnnotationColor(popoverAnnotation.id, c.id)}
                style={{ backgroundColor: c.swatch }}
                className="w-5 h-5 rounded-full ring-1 ring-black/10 hover:scale-110 transition flex items-center justify-center"
              >
                {popoverAnnotation.color === c.id && (
                  <Check className="w-3 h-3 text-slate-900/80 stroke-[2.5]" />
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const id = popoverAnnotation.id;
              setPopover(null);
              void onDeleteAnnotation(id);
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-600 hover:bg-red-50 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            删除
          </button>
        </div>
      )}
    </main>
  );
}

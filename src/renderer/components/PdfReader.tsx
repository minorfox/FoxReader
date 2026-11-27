import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  ArrowUpDown,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  FileUp,
  Highlighter,
  ListTree,
  Loader2,
  Maximize,
  Maximize2,
  MessageSquarePlus,
  Minimize,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  SquareDashedMousePointer,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ANNOTATION_COLORS,
  type Annotation,
  type AnnotationColor,
  type NormalizedRect,
  type Paper,
  type PaperFileStatus,
  type PaperStatus,
  type TranslateTextResult,
} from '../../shared/types';
import { DocumentLoadErrorCard } from './DocumentLoadErrorCard';

const STATUS_LABEL: Record<PaperStatus, string> = {
  unread: '未读',
  reading: '在读',
  read: '已读',
};

const STATUS_STYLE: Record<PaperStatus, string> = {
  unread: 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
  reading: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100',
  read: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
};

const NEXT_STATUS: Record<PaperStatus, PaperStatus> = {
  unread: 'reading',
  reading: 'read',
  read: 'unread',
};
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

interface TranslationCardState {
  selection: TextSelectionPrompt;
  loading: boolean;
  result: TranslateTextResult | null;
}

interface AnnotationPopoverState {
  annotationId: string;
  anchor: { clientX: number; clientY: number };
}

const ZOOM_PRESETS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

function buildSearchRegex(query: string): RegExp | null {
  const parts = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (parts.length === 0) return null;
  return new RegExp(parts.join('\\s*'), 'gi');
}

interface PdfOutlineNode {
  id: string;
  title: string;
  dest: string | unknown[] | null;
  items: PdfOutlineNode[];
}

function normalizeOutlineItems(raw: unknown[], prefix = 'o'): PdfOutlineNode[] {
  const result: PdfOutlineNode[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i] as { title?: unknown; dest?: unknown; items?: unknown } | null;
    if (!item || typeof item !== 'object') continue;
    const id = `${prefix}-${i}`;
    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : '无标题章节';
    const dest =
      typeof item.dest === 'string' || Array.isArray(item.dest) ? item.dest : null;
    const children = Array.isArray(item.items) ? normalizeOutlineItems(item.items, id) : [];
    result.push({ id, title, dest, items: children });
  }
  return result;
}

function filterOutlineTree(nodes: PdfOutlineNode[], query: string): PdfOutlineNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;
  const filtered: PdfOutlineNode[] = [];
  for (const node of nodes) {
    const matchedChildren = filterOutlineTree(node.items, needle);
    if (node.title.toLowerCase().includes(needle) || matchedChildren.length > 0) {
      filtered.push({ ...node, items: matchedChildren });
    }
  }
  return filtered;
}

async function resolveOutlinePageNumber(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null,
): Promise<number | null> {
  if (!dest) return null;
  const explicitDest =
    typeof dest === 'string' ? await doc.getDestination(dest).catch(() => null) : dest;
  if (!Array.isArray(explicitDest) || explicitDest.length === 0) return null;
  const pageRef = explicitDest[0];
  if (typeof pageRef === 'number' && Number.isFinite(pageRef)) {
    return pageRef + 1;
  }
  if (pageRef && typeof pageRef === 'object') {
    try {
      const idx = await doc.getPageIndex(pageRef as Parameters<PDFDocumentProxy['getPageIndex']>[0]);
      return idx + 1;
    } catch {
      return null;
    }
  }
  return null;
}

interface PdfReaderProps {
  paper: Paper | null;
  annotations: Annotation[];
  activeColor: AnnotationColor;
  selectedAnnotationId: string | null;
  jumpRequest: { annotation: Annotation; nonce: number } | null;
  pageJumpRequest?: { pageNumber: number; nonce: number } | null;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  isFullscreen?: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleFullscreen?: () => void;
  onOpenSettings?: () => void;
  onSaveProgress: (paperId: string, lastPage: number, lastZoom: number, lastScrollRatio?: number) => void;
  onSyncPageCount: (paperId: string, pageCount: number) => void;
  onCurrentPageChange?: (page: number) => void;
  onPickAndImport: () => void;
  onCreateTextAnnotation: (payload: {
    pageNumber: number;
    rects: NormalizedRect[];
    quoteText: string;
    color: AnnotationColor;
    focusComment: boolean;
    comment?: string;
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
  onChangePaperStatus: (paperId: string, status: PaperStatus) => Promise<void>;
  reloadNonce?: number;
  onOpenPdfsDir: () => void;
  onRelinkPaperFile: (paperId: string) => Promise<void>;
}

export function PdfReader({
  paper,
  annotations,
  activeColor,
  selectedAnnotationId,
  jumpRequest,
  pageJumpRequest,
  leftCollapsed,
  rightCollapsed,
  isFullscreen = false,
  onToggleLeft,
  onToggleRight,
  onToggleFullscreen,
  onOpenSettings,
  onSaveProgress,
  onSyncPageCount,
  onCurrentPageChange,
  onPickAndImport,
  onCreateTextAnnotation,
  onCreateAreaAnnotation,
  onUpdateAnnotationColor,
  onDeleteAnnotation,
  onSelectAnnotationFromPdf,
  onCopyText,
  onChangePaperStatus,
  reloadNonce = 0,
  onOpenPdfsDir,
  onRelinkPaperFile,
}: PdfReaderProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [fileStatus, setFileStatus] = useState<PaperFileStatus | null>(null);
  const [relinking, setRelinking] = useState(false);

  const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineFilter, setOutlineFilter] = useState('');
  const [expandedOutlineIds, setExpandedOutlineIds] = useState<Set<string>>(() => new Set());
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const outlinePageCacheRef = useRef<Map<string, number>>(new Map());

  const [currentPage, setCurrentPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [zoom, setZoom] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(false);
  const [containerWidth, setContainerWidth] = useState(800);
  const [annotationMode, setAnnotationMode] = useState<'text' | 'area'>('text');

  const [selectionBar, setSelectionBar] = useState<TextSelectionPrompt | null>(null);
  const [translationCard, setTranslationCard] = useState<TranslationCardState | null>(null);
  const [popover, setPopover] = useState<AnnotationPopoverState | null>(null);
  const [pulsingAnnotationId, setPulsingAnnotationId] = useState<string | null>(null);
  const translateReqIdRef = useRef(0);

  // In-page Ctrl+F search state
  const [findOpen, setFindOpen] = useState(false);
  const [findInput, setFindInput] = useState('');
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState<Array<{ pageNumber: number; matchIndexInPage: number }>>([]);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [findSearching, setFindSearching] = useState(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());

  const visibleRatiosRef = useRef<Map<number, number>>(new Map());
  const pendingInitialRestoreRef = useRef<{ page: number; scrollRatio: number } | null>(null);
  const autoMarkedReadPaperIdRef = useRef<string | null>(null);
  const onSaveProgressRef = useRef(onSaveProgress);
  onSaveProgressRef.current = onSaveProgress;
  const isRestoringRef = useRef(false);
  const currentPageRef = useRef(1);
  const effectiveZoomRef = useRef(1.0);
  const pendingProgressRef = useRef<{
    paperId: string;
    page: number;
    zoom: number;
    scrollRatio: number;
    dirty: boolean;
  } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPendingProgress = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingProgressRef.current;
    if (!pending || !pending.dirty) return;
    pending.dirty = false;
    onSaveProgressRef.current(pending.paperId, pending.page, pending.zoom, pending.scrollRatio);
  }, []);

  const scheduleProgressSave = useCallback(
    (paperId: string, page: number, zoomValue: number, scrollRatio: number) => {
      pendingProgressRef.current = {
        paperId,
        page,
        zoom: zoomValue,
        scrollRatio,
        dirty: true,
      };
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        flushPendingProgress();
      }, 400);
    },
    [flushPendingProgress],
  );

  useEffect(() => {
    const handleUnload = () => {
      flushPendingProgress();
    };
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
      flushPendingProgress();
    };
  }, [flushPendingProgress]);

  const handlePageSizeMeasured = useCallback((pageNumber: number, width: number, height: number) => {
    setPageSizes((prev) => {
      const idx = pageNumber - 1;
      const existing = prev[idx];
      if (!existing) return prev;
      if (Math.abs(existing.width - width) <= 1 && Math.abs(existing.height - height) <= 1) {
        return prev;
      }
      const next = [...prev];
      next[idx] = { width, height };
      return next;
    });
  }, []);

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
    if (!selectionBar && !translationCard && !popover) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        translateReqIdRef.current += 1;
        setSelectionBar(null);
        setTranslationCard(null);
        setPopover(null);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-fox-popover]')) return;
      translateReqIdRef.current += 1;
      setSelectionBar(null);
      setTranslationCard(null);
      setPopover(null);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [selectionBar, translationCard, popover]);

  // Load PDF document when selected paper changes
  useEffect(() => {
    flushPendingProgress();
    translateReqIdRef.current += 1;
    autoMarkedReadPaperIdRef.current = null;
    setSelectionBar(null);
    setTranslationCard(null);
    setPopover(null);
    setPulsingAnnotationId(null);
    setFindOpen(false);
    setFindInput('');
    setFindQuery('');
    setFindMatches([]);
    setActiveMatchIdx(0);
    pageTextCacheRef.current.clear();
    outlinePageCacheRef.current.clear();
    setOutline([]);
    setOutlineFilter('');
    setActiveOutlineId(null);

    if (!paper) {
      isRestoringRef.current = false;
      pendingInitialRestoreRef.current = null;
      pendingProgressRef.current = null;
      setPdfDoc(null);
      setPageSizes([]);
      setLoadError(null);
      setFileStatus(null);
      setOutlineOpen(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const sha = paper.sha256;
    const paperId = paper.id;
    const initialPage = Math.max(1, paper.lastPage || 1);
    const initialZoom = paper.lastZoom || 1.0;
    const initialScrollRatio = Math.min(1, Math.max(0, paper.lastScrollRatio || 0));

    isRestoringRef.current = true;
    setLoading(true);
    setLoadError(null);
    setFileStatus(null);
    setPdfDoc(null);
    setPageSizes([]);
    setFitWidth(false);
    setZoom(initialZoom);
    setCurrentPage(initialPage);
    setPageInput(String(initialPage));
    pendingInitialRestoreRef.current = { page: initialPage, scrollRatio: initialScrollRatio };
    pendingProgressRef.current = {
      paperId,
      page: initialPage,
      zoom: initialZoom,
      scrollRatio: initialScrollRatio,
      dirty: false,
    };
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

        // Prime all page placeholders from page 1 dimensions immediately;
        // mixed-orientation pages self-correct lazily when rendered.
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

        const rawOutline = await doc.getOutline().catch(() => null);
        if (!cancelled) {
          const normalized = Array.isArray(rawOutline) ? normalizeOutlineItems(rawOutline) : [];
          setOutline(normalized);
          setExpandedOutlineIds(new Set(normalized.map((n) => n.id)));
          if (normalized.length === 0) {
            setOutlineOpen(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setLoadError(err instanceof Error ? err.message : 'PDF 加载失败');
          void window.foxreader
            .checkPaperFileStatus(paperId)
            .then((status) => {
              if (!cancelled) {
                setFileStatus(status);
              }
            })
            .catch(() => undefined);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      flushPendingProgress();
      void loadingTask.destroy().catch(() => undefined);
      if (loadedDoc) {
        void loadedDoc.destroy().catch(() => undefined);
      }
    };
  }, [paper?.id, paper?.sha256, reloadNonce, retryNonce, flushPendingProgress]);

  // Compute effective zoom when Fit-to-Width is enabled
  const effectiveZoom = useMemo(() => {
    if (!fitWidth || pageSizes.length === 0) return zoom;
    const baseW = pageSizes[0].width || 595;
    return Math.min(3.0, Math.max(0.35, Number((containerWidth / baseW).toFixed(3))));
  }, [fitWidth, pageSizes, containerWidth, zoom]);

  currentPageRef.current = currentPage;
  effectiveZoomRef.current = effectiveZoom;

  const getScrollRatio = useCallback((): number => {
    const el = scrollContainerRef.current;
    if (!el) return 0;
    const maxScroll = el.scrollHeight - el.clientHeight;
    return maxScroll > 1 ? Math.min(1, Math.max(0, el.scrollTop / maxScroll)) : 0;
  }, []);

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

  // Restore saved page/scroll position after page placeholders mount
  useEffect(() => {
    if (!pdfDoc || pageSizes.length === 0 || pendingInitialRestoreRef.current === null) return;
    const restore = pendingInitialRestoreRef.current;
    pendingInitialRestoreRef.current = null;

    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const targetPage = Math.min(pageSizes.length, Math.max(1, restore.page));
        const el = scrollContainerRef.current;
        if (restore.scrollRatio > 0 && el) {
          const maxScroll = el.scrollHeight - el.clientHeight;
          if (maxScroll > 0) {
            el.scrollTop = Math.round(restore.scrollRatio * maxScroll);
            setCurrentPage(targetPage);
            setPageInput(String(targetPage));
          } else if (targetPage > 1) {
            scrollToPage(targetPage, 'auto');
          }
        } else if (targetPage > 1) {
          scrollToPage(targetPage, 'auto');
        }
        settleTimer = setTimeout(() => {
          if (!cancelled) {
            isRestoringRef.current = false;
          }
        }, 120);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [pdfDoc, pageSizes.length, scrollToPage]);

  useEffect(() => {
    onCurrentPageChange?.(currentPage);
  }, [currentPage, onCurrentPageChange]);

  useEffect(() => {
    if (!pageJumpRequest || !pdfDoc || pageSizes.length === 0) return;
    scrollToPage(pageJumpRequest.pageNumber, 'smooth');
  }, [pageJumpRequest, pdfDoc, pageSizes.length, scrollToPage]);

  const filteredOutline = useMemo(
    () => filterOutlineTree(outline, outlineFilter),
    [outline, outlineFilter],
  );

  const handleSelectOutlineNode = useCallback(
    async (node: PdfOutlineNode) => {
      if (!pdfDoc) return;
      setActiveOutlineId(node.id);
      let targetPage = outlinePageCacheRef.current.get(node.id);
      if (!targetPage) {
        const resolved = await resolveOutlinePageNumber(pdfDoc, node.dest);
        if (resolved && resolved >= 1) {
          targetPage = resolved;
          outlinePageCacheRef.current.set(node.id, resolved);
        }
      }
      if (targetPage) {
        scrollToPage(targetPage, 'smooth');
      }
    },
    [pdfDoc, scrollToPage],
  );

  const toggleOutlineNodeExpand = useCallback((id: string) => {
    setExpandedOutlineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const renderOutlineNodes = (nodes: PdfOutlineNode[], depth: number): React.ReactNode => {
    const filterActive = outlineFilter.trim().length > 0;
    return nodes.map((node) => {
      const hasChildren = node.items.length > 0;
      const isExpanded = filterActive || expandedOutlineIds.has(node.id);
      const isActive = activeOutlineId === node.id;
      return (
        <div key={node.id}>
          <div
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            className={`flex items-center gap-1 pr-2 py-1 rounded-md text-xs cursor-pointer transition ${
              isActive
                ? 'bg-violet-50 text-violet-900 font-medium'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
            onClick={() => void handleSelectOutlineNode(node)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleOutlineNodeExpand(node.id);
              }}
              className={`p-0.5 rounded hover:bg-slate-200/70 shrink-0 ${
                hasChildren ? 'text-slate-400 hover:text-slate-700' : 'opacity-0 pointer-events-none'
              }`}
            >
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <span className="truncate flex-1" title={node.title}>
              {node.title}
            </span>
          </div>
          {hasChildren && isExpanded && renderOutlineNodes(node.items, depth + 1)}
        </div>
      );
    });
  };

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
        if (bestPage !== null && !isRestoringRef.current) {
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

  // Debounced reading progress persistence on page/zoom change
  useEffect(() => {
    if (!paper || !pdfDoc || isRestoringRef.current) return;
    scheduleProgressSave(paper.id, currentPage, effectiveZoom, getScrollRatio());
  }, [paper?.id, pdfDoc, currentPage, effectiveZoom, getScrollRatio, scheduleProgressSave]);

  // Automatically promote status to 'read' once user reaches the final page
  useEffect(() => {
    const numPages = pdfDoc?.numPages ?? 0;
    if (
      !paper ||
      !pdfDoc ||
      numPages < 2 ||
      currentPage < numPages ||
      paper.status === 'read' ||
      autoMarkedReadPaperIdRef.current === paper.id
    ) {
      return;
    }
    autoMarkedReadPaperIdRef.current = paper.id;
    void onChangePaperStatus(paper.id, 'read');
  }, [paper?.id, paper?.status, pdfDoc, currentPage, onChangePaperStatus]);

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
    translateReqIdRef.current += 1;
    setPopover(null);
    setTranslationCard(null);
    setSelectionBar(payload);
  }, []);

  const handleClickAnnotation = useCallback(
    (annotation: Annotation, anchor: { clientX: number; clientY: number }) => {
      translateReqIdRef.current += 1;
      setSelectionBar(null);
      setTranslationCard(null);
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

  const handleTranslateSelection = async (selection: TextSelectionPrompt) => {
    const reqId = ++translateReqIdRef.current;
    setSelectionBar(null);
    setTranslationCard({ selection, loading: true, result: null });
    try {
      const result = await window.foxreader.translateText(selection.quoteText);
      if (translateReqIdRef.current !== reqId) return;
      setTranslationCard({ selection, loading: false, result });
    } catch (error) {
      if (translateReqIdRef.current !== reqId) return;
      setTranslationCard({
        selection,
        loading: false,
        result: {
          ok: false,
          originalText: selection.quoteText,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  };

  const handleSaveTranslationAsAnnotation = async () => {
    if (!translationCard?.result?.ok || !translationCard.result.translatedText) return;
    const { selection, result } = translationCard;
    setTranslationCard(null);
    window.getSelection()?.removeAllRanges();
    await onCreateTextAnnotation({
      pageNumber: selection.pageNumber,
      rects: selection.rects,
      quoteText: selection.quoteText,
      color: activeColor,
      focusComment: false,
      comment: result.translatedText,
    });
  };

  const totalPages = pdfDoc?.numPages ?? 0;

  // Global Ctrl+F shortcut to open in-page PDF search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (!paper || !pdfDoc) return;
        e.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        });
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
        setFindQuery('');
        setFindMatches([]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paper, pdfDoc, findOpen]);

  // Debounce findInput -> findQuery
  useEffect(() => {
    if (!findOpen) return;
    const timer = setTimeout(() => {
      setFindQuery(findInput.trim());
    }, 180);
    return () => clearTimeout(timer);
  }, [findInput, findOpen]);

  // Scan all pages in the active PDF document for matches
  useEffect(() => {
    if (!pdfDoc || !findOpen || !findQuery) {
      setFindMatches([]);
      setActiveMatchIdx(0);
      setFindSearching(false);
      return;
    }

    let cancelled = false;
    setFindSearching(true);

    async function runSearch() {
      if (!pdfDoc) return;
      const regex = buildSearchRegex(findQuery);
      if (!regex) {
        setFindMatches([]);
        setFindSearching(false);
        return;
      }

      const matches: Array<{ pageNumber: number; matchIndexInPage: number }> = [];
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        if (cancelled) return;
        let text = pageTextCacheRef.current.get(p);
        if (text === undefined) {
          const page = await pdfDoc.getPage(p);
          if (cancelled) return;
          const tc = await page.getTextContent();
          text = tc.items.map((item) => ('str' in item ? item.str : '')).join('');
          pageTextCacheRef.current.set(p, text);
        }
        regex.lastIndex = 0;
        let pageMatchIdx = 0;
        let m = regex.exec(text);
        while (m !== null) {
          if (m[0].length === 0) {
            regex.lastIndex += 1;
          } else {
            matches.push({ pageNumber: p, matchIndexInPage: pageMatchIdx });
            pageMatchIdx += 1;
          }
          m = regex.exec(text);
        }
      }

      if (cancelled) return;
      setFindMatches(matches);
      setActiveMatchIdx(0);
      setFindSearching(false);
      if (matches.length > 0) {
        scrollToPage(matches[0].pageNumber, 'smooth');
      }
    }

    void runSearch();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, findOpen, findQuery, scrollToPage]);

  const stepSearchMatch = (delta: number) => {
    if (findMatches.length === 0) return;
    const nextIdx = (activeMatchIdx + delta + findMatches.length) % findMatches.length;
    setActiveMatchIdx(nextIdx);
    const match = findMatches[nextIdx];
    scrollToPage(match.pageNumber, 'smooth');
  };

  const activeMatch = findMatches[activeMatchIdx] ?? null;

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

          {leftCollapsed && onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              title="应用设置 (Ctrl+,)"
              className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition shrink-0"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}

          {paper && totalPages > 0 && (
            <button
              type="button"
              disabled={outline.length === 0}
              onClick={() => setOutlineOpen((p) => !p)}
              title={
                outline.length > 0
                  ? outlineOpen
                    ? '收起 PDF 目录大纲'
                    : '展开 PDF 目录大纲'
                  : '该 PDF 未包含内置目录大纲'
              }
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition shrink-0 ${
                outline.length === 0
                  ? 'text-slate-300 cursor-not-allowed'
                  : outlineOpen
                    ? 'bg-violet-50 text-violet-700 border border-violet-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <ListTree className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">目录</span>
            </button>
          )}

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

        {/* Right Controls: Status + Annotation Mode + Search + Right Sidebar Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          {paper && (
            <>
              <button
                type="button"
                title="点击切换阅读状态（到达末页自动标为已读）"
                onClick={() => void onChangePaperStatus(paper.id, NEXT_STATUS[paper.status])}
                className={`px-2 py-1 rounded-md border text-[11px] font-medium transition ${STATUS_STYLE[paper.status]}`}
              >
                {STATUS_LABEL[paper.status]}
              </button>

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

              <button
                type="button"
                onClick={() => {
                  setFindOpen(true);
                  requestAnimationFrame(() => {
                    findInputRef.current?.focus();
                    findInputRef.current?.select();
                  });
                }}
                title="页内查找 (Ctrl+F)"
                className={`p-1.5 rounded-md transition ${
                  findOpen
                    ? 'bg-violet-50 text-violet-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Search className="w-4 h-4" />
              </button>
            </>
          )}

          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              title={isFullscreen ? '退出全屏 (F11)' : '进入全屏 (F11)'}
              className={`p-1.5 rounded-md transition ${
                isFullscreen
                  ? 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
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

      {/* Main Body: Optional Outline Drawer + Scrollable PDF Canvas Viewport */}
      <div className="flex-1 min-h-0 flex relative overflow-hidden">
        {paper && outlineOpen && outline.length > 0 && (
          <aside className="w-64 shrink-0 border-r border-slate-200 bg-white flex flex-col h-full select-none">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
              <span className="text-xs font-semibold text-slate-800">目录大纲</span>
              <button
                type="button"
                onClick={() => setOutlineOpen(false)}
                title="关闭目录大纲"
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-2 border-b border-slate-100 shrink-0">
              <div className="relative">
                <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={outlineFilter}
                  onChange={(e) => setOutlineFilter(e.target.value)}
                  placeholder="过滤章节..."
                  className="w-full rounded-md border border-slate-200 bg-slate-50/70 pl-7 pr-6 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition"
                />
                {outlineFilter && (
                  <button
                    type="button"
                    onClick={() => setOutlineFilter('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {filteredOutline.length > 0 ? (
                renderOutlineNodes(filteredOutline, 0)
              ) : (
                <div className="text-xs text-slate-400 text-center py-6">未找到匹配章节</div>
              )}
            </div>
          </aside>
        )}

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
          if (!isRestoringRef.current && paper && pdfDoc) {
            scheduleProgressSave(paper.id, currentPageRef.current, effectiveZoomRef.current, getScrollRatio());
          }
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
            <DocumentLoadErrorCard
              fileType="pdf"
              loadError={loadError}
              fileStatus={fileStatus}
              relinking={relinking}
              onRetry={() => setRetryNonce((n) => n + 1)}
              onOpenDir={onOpenPdfsDir}
              onRelink={() => {
                setRelinking(true);
                void onRelinkPaperFile(paper.id).finally(() => setRelinking(false));
              }}
            />
          </div>
        ) : pdfDoc ? (
          <div className="flex flex-col items-center gap-4 pb-12">
            {pageSizes.map((size, idx) => {
              const pageNum = idx + 1;
              const shouldRender = Math.abs(pageNum - currentPage) <= 1;
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
                  searchQuery={findOpen ? findQuery : ''}
                  activeSearchMatchIndex={
                    findOpen && activeMatch && activeMatch.pageNumber === pageNum
                      ? activeMatch.matchIndexInPage
                      : -1
                  }
                  registerElement={registerElement}
                  onPageSizeMeasured={handlePageSizeMeasured}
                  onTextSelection={handleTextSelection}
                  onCreateAreaAnnotation={onCreateAreaAnnotation}
                  onClickAnnotation={handleClickAnnotation}
                />
              );
            })}
          </div>
        ) : null}
        </div>
      </div>

      {/* Floating Ctrl+F Search Bar */}
      {paper && findOpen && (
        <div className="absolute top-14 right-6 z-40 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-lg">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            ref={findInputRef}
            type="text"
            value={findInput}
            onChange={(e) => setFindInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                stepSearchMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                setFindOpen(false);
                setFindQuery('');
                setFindMatches([]);
              }
            }}
            placeholder="页内查找..."
            className="w-44 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          <span className="text-[11px] text-slate-400 tabular-nums min-w-[44px] text-right">
            {findSearching
              ? '查找中'
              : findQuery
                ? findMatches.length > 0
                  ? `${activeMatchIdx + 1}/${findMatches.length}`
                  : '0/0'
                : ''}
          </span>
          <button
            type="button"
            disabled={findMatches.length === 0}
            onClick={() => stepSearchMatch(-1)}
            title="上一个 (Shift+Enter)"
            className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-35 transition"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={findMatches.length === 0}
            onClick={() => stepSearchMatch(1)}
            title="下一个 (Enter)"
            className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-35 transition"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setFindOpen(false);
              setFindQuery('');
              setFindMatches([]);
            }}
            title="关闭 (Esc)"
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating Selection Toolbar */}
      {selectionBar && (
        <div
          data-fox-popover
          style={{
            left: `${Math.min(window.innerWidth - 400, Math.max(12, selectionBar.anchor.clientX - 180))}px`,
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
            title="划词翻译（有道）"
            onClick={() => void handleTranslateSelection(selectionBar)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            翻译
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

      {/* Selection Translation Popover Card */}
      {translationCard && (
        <div
          data-fox-popover
          style={{
            left: `${Math.min(window.innerWidth - 336, Math.max(12, translationCard.selection.anchor.clientX - 160))}px`,
            top: `${Math.min(window.innerHeight - 260, Math.max(56, translationCard.selection.anchor.clientY + 12))}px`,
          }}
          className="fixed z-50 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <ArrowUpDown className="w-3.5 h-3.5 text-violet-600" />
              <span>划词翻译</span>
              {translationCard.result?.provider && (
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                  {translationCard.result.provider}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                translateReqIdRef.current += 1;
                setTranslationCard(null);
              }}
              className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="p-3 space-y-2.5 max-h-64 overflow-y-auto">
            <div className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed border-l-2 border-slate-200 pl-2">
              {translationCard.result?.originalText || translationCard.selection.quoteText}
            </div>

            {translationCard.loading ? (
              <div className="py-4 flex items-center justify-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
                <span>正在翻译...</span>
              </div>
            ) : translationCard.result?.ok && translationCard.result.translatedText ? (
              <div className="space-y-1.5">
                {translationCard.result.phonetic && (
                  <div className="text-[11px] font-mono text-slate-500">
                    /{translationCard.result.phonetic}/
                  </div>
                )}
                <div className="text-xs text-slate-800 leading-relaxed whitespace-pre-wrap select-text">
                  {translationCard.result.translatedText}
                </div>
                {translationCard.result.explains && translationCard.result.explains.length > 0 && (
                  <ul className="pt-1 border-t border-slate-100 space-y-0.5 text-[11px] text-slate-600 select-text">
                    {translationCard.result.explains.slice(0, 4).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2 flex items-center justify-between gap-2 text-xs text-amber-800">
                <span>{translationCard.result?.error || '翻译失败'}</span>
                <button
                  type="button"
                  onClick={() => void handleTranslateSelection(translationCard.selection)}
                  className="px-2 py-0.5 rounded bg-white border border-amber-300 text-[11px] font-medium hover:bg-amber-100 shrink-0 transition"
                >
                  重试
                </button>
              </div>
            )}
          </div>

          {translationCard.result?.ok && translationCard.result.translatedText && (
            <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  onCopyText(translationCard.result?.translatedText ?? '');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-100 transition"
              >
                <Copy className="w-3 h-3" />
                复制译文
              </button>
              <button
                type="button"
                onClick={() => void handleSaveTranslationAsAnnotation()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600 text-[11px] font-medium text-white hover:bg-violet-700 transition"
              >
                <Highlighter className="w-3 h-3" />
                高亮并存为备注
              </button>
            </div>
          )}
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

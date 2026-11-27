import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Loader2,
  Maximize,
  Minimize,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Paper, PaperFileStatus, PaperStatus, TranslateTextResult } from '../../shared/types';
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

interface MarkdownSelectionPrompt {
  quoteText: string;
  anchor: { clientX: number; clientY: number };
}

interface MarkdownTranslationCardState {
  selection: MarkdownSelectionPrompt;
  loading: boolean;
  result: TranslateTextResult | null;
}

interface MarkdownReaderProps {
  paper: Paper;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  isFullscreen?: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleFullscreen?: () => void;
  onOpenSettings?: () => void;
  onCopyText: (text: string) => void;
  onChangePaperStatus: (paperId: string, status: PaperStatus) => Promise<void>;
  onSaveProgress: (paperId: string, lastPage: number, lastZoom: number, lastScrollRatio?: number) => void;
  reloadNonce?: number;
  onOpenDocsDir?: () => void;
  onRelinkPaperFile?: (paperId: string) => Promise<void>;
}

function stripYamlFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function clearSearchMarks(root: HTMLElement): void {
  const marks = root.querySelectorAll('mark[data-fox-md-mark]');
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
}

function applySearchMarks(root: HTMLElement, query: string): HTMLElement[] {
  clearSearchMarks(root);
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const parentEl = node.parentElement;
    if (
      node.textContent &&
      node.textContent.trim().length > 0 &&
      parentEl &&
      parentEl.tagName !== 'SCRIPT' &&
      parentEl.tagName !== 'STYLE'
    ) {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }

  const createdMarks: HTMLElement[] = [];
  for (const textNode of textNodes) {
    const text = textNode.textContent ?? '';
    const lower = text.toLowerCase();
    let idx = lower.indexOf(needle);
    if (idx === -1) continue;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    while (idx !== -1) {
      if (idx > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
      }
      const mark = document.createElement('mark');
      mark.setAttribute('data-fox-md-mark', 'true');
      mark.className = 'fox-md-mark';
      mark.textContent = text.slice(idx, idx + needle.length);
      frag.appendChild(mark);
      createdMarks.push(mark);
      cursor = idx + needle.length;
      idx = lower.indexOf(needle, cursor);
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return createdMarks;
}

export function MarkdownReader({
  paper,
  leftCollapsed,
  rightCollapsed,
  isFullscreen = false,
  onToggleLeft,
  onToggleRight,
  onToggleFullscreen,
  onOpenSettings,
  onCopyText,
  onChangePaperStatus,
  onSaveProgress,
  reloadNonce = 0,
  onOpenDocsDir,
  onRelinkPaperFile,
}: MarkdownReaderProps) {
  const articleRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const searchMarksRef = useRef<HTMLElement[]>([]);
  const translateReqIdRef = useRef(0);
  const autoMarkedReadPaperIdRef = useRef<string | null>(null);
  const onSaveProgressRef = useRef(onSaveProgress);
  onSaveProgressRef.current = onSaveProgress;
  const isRestoringRef = useRef(true);
  const pendingInitialRatioRef = useRef<number | null>(null);
  const pendingProgressRef = useRef<{
    paperId: string;
    zoom: number;
    scrollRatio: number;
    dirty: boolean;
  } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [rawContent, setRawContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [fileStatus, setFileStatus] = useState<PaperFileStatus | null>(null);
  const [relinking, setRelinking] = useState(false);
  const [fontScale, setFontScale] = useState(100);

  // In-document Ctrl+F search state
  const [findOpen, setFindOpen] = useState(false);
  const [findInput, setFindInput] = useState('');
  const [findQuery, setFindQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);

  // Selection Copy / Translate state
  const [selectionBar, setSelectionBar] = useState<MarkdownSelectionPrompt | null>(null);
  const [translationCard, setTranslationCard] = useState<MarkdownTranslationCardState | null>(null);

  const flushPendingProgress = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingProgressRef.current;
    if (!pending || !pending.dirty) return;
    pending.dirty = false;
    onSaveProgressRef.current(pending.paperId, 1, pending.zoom, pending.scrollRatio);
  }, []);

  const scheduleProgressSave = useCallback(
    (paperId: string, zoomValue: number, scrollRatio: number) => {
      pendingProgressRef.current = {
        paperId,
        zoom: zoomValue,
        scrollRatio,
        dirty: true,
      };
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        flushPendingProgress();
      }, 350);
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

  useEffect(() => {
    let cancelled = false;
    flushPendingProgress();
    isRestoringRef.current = true;
    translateReqIdRef.current += 1;
    autoMarkedReadPaperIdRef.current = null;

    const initialZoom = Math.min(1.6, Math.max(0.75, paper.lastZoom || 1.0));
    const initialScale = Math.round(initialZoom * 100);
    const initialRatio = Math.min(1, Math.max(0, paper.lastScrollRatio || 0));

    setFontScale(initialScale);
    pendingInitialRatioRef.current = initialRatio;
    pendingProgressRef.current = {
      paperId: paper.id,
      zoom: initialZoom,
      scrollRatio: initialRatio,
      dirty: false,
    };

    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    setLoading(true);
    setLoadError(null);
    setFileStatus(null);
    setSelectionBar(null);
    setTranslationCard(null);
    setFindOpen(false);
    setFindInput('');
    setFindQuery('');
    setMatchCount(0);
    setActiveMatchIdx(0);

    void window.foxreader
      .readMarkdownContent(paper.sha256)
      .then((content) => {
        if (!cancelled) {
          setRawContent(content);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
          void window.foxreader
            .checkPaperFileStatus(paper.id)
            .then((status) => {
              if (!cancelled) {
                setFileStatus(status);
              }
            })
            .catch(() => undefined);
        }
      });

    return () => {
      cancelled = true;
      flushPendingProgress();
    };
  }, [paper.id, paper.sha256, reloadNonce, retryNonce, flushPendingProgress]);

  // Restore saved scroll position after Markdown & KaTeX content renders
  useEffect(() => {
    if (loading || loadError || pendingInitialRatioRef.current === null) return;
    const targetRatio = pendingInitialRatioRef.current;
    pendingInitialRatioRef.current = null;

    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const el = scrollContainerRef.current;
        if (el) {
          const maxScroll = el.scrollHeight - el.clientHeight;
          el.scrollTop = maxScroll > 0 && targetRatio > 0 ? Math.round(targetRatio * maxScroll) : 0;
        }
        settleTimer = setTimeout(() => {
          if (!cancelled) {
            isRestoringRef.current = false;
          }
        }, 80);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      if (settleTimer !== null) clearTimeout(settleTimer);
    };
  }, [paper.id, loading, loadError, rawContent]);

  const bodyMarkdown = useMemo(() => stripYamlFrontmatter(rawContent), [rawContent]);

  const markReadIfAtBottom = useCallback(() => {
    if (
      loading ||
      loadError ||
      paper.status !== 'reading' ||
      autoMarkedReadPaperIdRef.current === paper.id
    ) {
      return;
    }
    const el = scrollContainerRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
      autoMarkedReadPaperIdRef.current = paper.id;
      void onChangePaperStatus(paper.id, 'read');
    }
  }, [paper.id, paper.status, loading, loadError, onChangePaperStatus]);

  useEffect(() => {
    if (
      loading ||
      loadError ||
      paper.status !== 'reading' ||
      autoMarkedReadPaperIdRef.current === paper.id
    ) {
      return;
    }
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const rafId = requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      if (el.scrollHeight <= el.clientHeight + 48) {
        timerId = setTimeout(() => {
          markReadIfAtBottom();
        }, 1500);
      } else if (el.scrollTop > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 48) {
        markReadIfAtBottom();
      }
    });
    return () => {
      cancelAnimationFrame(rafId);
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [paper.id, paper.status, loading, loadError, rawContent, fontScale, markReadIfAtBottom]);

  const handleContainerScroll = useCallback(() => {
    markReadIfAtBottom();
    if (loading || loadError || isRestoringRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const ratio = maxScroll > 1 ? Math.min(1, Math.max(0, el.scrollTop / maxScroll)) : 0;
    scheduleProgressSave(paper.id, Number((fontScale / 100).toFixed(2)), ratio);
  }, [markReadIfAtBottom, loading, loadError, paper.id, fontScale, scheduleProgressSave]);

  const applyFontScale = useCallback(
    (nextScale: number) => {
      const clamped = Math.min(160, Math.max(75, nextScale));
      setFontScale(clamped);
      if (loading || loadError || isRestoringRef.current) return;
      const el = scrollContainerRef.current;
      const maxScroll = el ? el.scrollHeight - el.clientHeight : 0;
      const ratio = el && maxScroll > 1 ? Math.min(1, Math.max(0, el.scrollTop / maxScroll)) : 0;
      scheduleProgressSave(paper.id, Number((clamped / 100).toFixed(2)), ratio);
    },
    [loading, loadError, paper.id, scheduleProgressSave],
  );

  const renderedArticle = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {bodyMarkdown}
      </ReactMarkdown>
    ),
    [bodyMarkdown],
  );

  // Dismiss popovers on Escape or outside click
  useEffect(() => {
    if (!selectionBar && !translationCard) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        translateReqIdRef.current += 1;
        setSelectionBar(null);
        setTranslationCard(null);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-fox-popover]')) return;
      translateReqIdRef.current += 1;
      setSelectionBar(null);
      setTranslationCard(null);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [selectionBar, translationCard]);

  // Global Ctrl+F shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => {
          findInputRef.current?.focus();
          findInputRef.current?.select();
        });
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
        setFindInput('');
        setFindQuery('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [findOpen]);

  // Debounce findInput -> findQuery
  useEffect(() => {
    const t = setTimeout(() => setFindQuery(findInput.trim()), 180);
    return () => clearTimeout(t);
  }, [findInput]);

  // Highlight DOM text matches when findQuery or content changes
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    if (!findOpen || !findQuery) {
      clearSearchMarks(root);
      searchMarksRef.current = [];
      setMatchCount(0);
      setActiveMatchIdx(0);
      return;
    }

    const marks = applySearchMarks(root, findQuery);
    searchMarksRef.current = marks;
    setMatchCount(marks.length);
    setActiveMatchIdx(0);

    return () => {
      clearSearchMarks(root);
      searchMarksRef.current = [];
    };
  }, [bodyMarkdown, loading, findOpen, findQuery]);

  // Scroll active match into view
  useEffect(() => {
    const marks = searchMarksRef.current;
    if (marks.length === 0) return;
    for (let i = 0; i < marks.length; i += 1) {
      if (i === activeMatchIdx) {
        marks[i].classList.add('fox-md-mark-active');
        marks[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        marks[i].classList.remove('fox-md-mark-active');
      }
    }
  }, [activeMatchIdx, matchCount]);

  const stepSearchMatch = useCallback(
    (delta: number) => {
      if (matchCount === 0) return;
      setActiveMatchIdx((prev) => (prev + delta + matchCount) % matchCount);
    },
    [matchCount],
  );

  const handleMouseUp = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      return;
    }
    const range = sel.getRangeAt(0);
    const root = articleRef.current;
    if (!root || !root.contains(range.commonAncestorContainer)) {
      return;
    }
    const quoteText = sel.toString().trim();
    if (!quoteText) return;

    const rect = range.getBoundingClientRect();
    translateReqIdRef.current += 1;
    setTranslationCard(null);
    setSelectionBar({
      quoteText,
      anchor: {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top,
      },
    });
  };

  const handleTranslateSelection = async (selection: MarkdownSelectionPrompt) => {
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
          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
            <FileText className="w-3 h-3" />
            MD
          </span>
          <div className="truncate text-xs font-medium text-slate-700" title={paper.title}>
            {paper.title}
          </div>
        </div>

        {/* Status + Font Zoom & Find */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            title="点击切换阅读状态（滚至文末自动标为已读）"
            onClick={() => void onChangePaperStatus(paper.id, NEXT_STATUS[paper.status])}
            className={`px-2 py-1 rounded-md border text-[11px] font-medium transition ${STATUS_STYLE[paper.status]}`}
          >
            {STATUS_LABEL[paper.status]}
          </button>

          <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => applyFontScale(fontScale - 10)}
              title="缩小字号"
              className="p-1 rounded text-slate-600 hover:bg-white transition"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFontScale(100)}
              title="重置字号为 100%"
              className="px-1.5 py-0.5 rounded text-xs tabular-nums text-slate-700 hover:bg-white transition min-w-[44px]"
            >
              {fontScale}%
            </button>
            <button
              type="button"
              onClick={() => applyFontScale(fontScale + 10)}
              title="放大字号"
              className="p-1 rounded text-slate-600 hover:bg-white transition"
            >
              <ZoomIn className="w-3.5 h-3.5" />
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
            title="文档内查找 (Ctrl+F)"
            className={`p-1.5 rounded-md border transition ${
              findOpen
                ? 'border-violet-300 bg-violet-50 text-violet-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
          </button>

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
            title={rightCollapsed ? '展开右侧栏' : '折叠右侧栏'}
            className="p-1.5 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
          >
            {rightCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Scrollable Document Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleContainerScroll}
        className="flex-1 overflow-y-auto px-6 py-6"
      >
        {loading ? (
          <div className="h-full flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
            <span>正在加载 Markdown 文档...</span>
          </div>
        ) : loadError ? (
          <div className="h-full flex items-center justify-center">
            <DocumentLoadErrorCard
              fileType="md"
              loadError={loadError}
              fileStatus={fileStatus}
              relinking={relinking}
              onRetry={() => setRetryNonce((n) => n + 1)}
              onOpenDir={onOpenDocsDir}
              onRelink={
                onRelinkPaperFile
                  ? () => {
                      setRelinking(true);
                      void onRelinkPaperFile(paper.id).finally(() => setRelinking(false));
                    }
                  : undefined
              }
            />
          </div>
        ) : (
          <article
            ref={articleRef}
            onMouseUp={handleMouseUp}
            style={{ fontSize: `${fontScale}%` }}
            className="max-w-3xl mx-auto rounded-xl border border-slate-200 bg-white shadow-xs px-9 py-8"
          >
            <div className="fox-markdown-doc">
              {bodyMarkdown.trim().length > 0 ? (
                renderedArticle
              ) : (
                <div className="text-sm text-slate-400 text-center py-10">该 Markdown 文档内容为空。</div>
              )}
            </div>
          </article>
        )}
      </div>

      {/* In-Document Ctrl+F Search Bar */}
      {findOpen && (
        <div
          data-fox-popover
          className="absolute top-14 right-5 z-40 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-xl"
        >
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
                setFindInput('');
                setFindQuery('');
              }
            }}
            placeholder="文档内查找..."
            className="w-44 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          <span className="text-[11px] text-slate-400 tabular-nums min-w-[44px] text-right">
            {findQuery ? (matchCount > 0 ? `${activeMatchIdx + 1}/${matchCount}` : '0/0') : ''}
          </span>
          <button
            type="button"
            disabled={matchCount === 0}
            onClick={() => stepSearchMatch(-1)}
            title="上一个 (Shift+Enter)"
            className="p-1 rounded text-slate-500 hover:bg-slate-100 disabled:opacity-35 transition"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={matchCount === 0}
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
              setFindInput('');
              setFindQuery('');
            }}
            title="关闭 (Esc)"
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Selection Floating Toolbar (Translate & Copy only, no highlights) */}
      {selectionBar && (
        <div
          data-fox-popover
          style={{
            left: `${Math.min(window.innerWidth - 180, Math.max(12, selectionBar.anchor.clientX - 70))}px`,
            top: `${Math.max(56, selectionBar.anchor.clientY - 46)}px`,
          }}
          className="fixed z-50 flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-1 shadow-xl"
        >
          <button
            type="button"
            title="划词翻译（有道）"
            onClick={() => void handleTranslateSelection(selectionBar)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-violet-700 hover:bg-violet-50 transition"
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

      {/* Selection Translation Card */}
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
                onClick={() => onCopyText(translationCard.result?.translatedText ?? '')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-[11px] font-medium text-slate-700 hover:bg-slate-100 transition"
              >
                <Copy className="w-3 h-3" />
                复制译文
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

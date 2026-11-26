import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  BookMarked,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  Highlighter,
  Image as ImageIcon,
  MessageSquare,
  Pencil,
  Quote,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import {
  ANNOTATION_COLORS,
  getAnnotationColorMeta,
  type Annotation,
  type AnnotationColor,
  type Paper,
  type PaperNote,
  type UpdateAnnotationInput,
} from '../../shared/types';
import { parseFoxPageHref, transformNotePageLinks } from '../lib/notePageLinks';
import { getSnapshotUrl } from '../lib/pdf';

type KindFilter = 'all' | 'commented' | 'area';

interface RightSidebarProps {
  selectedPaper: Paper | null;
  annotations: Annotation[];
  note: PaperNote | null;
  activeTab: 'annotations' | 'notes';
  selectedAnnotationId: string | null;
  cardRevealRequest: { id: string; focusComment: boolean; nonce: number } | null;
  reextractingMeta?: boolean;
  enrichingOnline?: boolean;
  currentPdfPage?: number;
  onChangeTab: (tab: 'annotations' | 'notes') => void;
  onJumpToAnnotation: (annotation: Annotation) => void;
  onJumpToPage: (pageNumber: number) => void;
  onUpdateAnnotation: (id: string, input: UpdateAnnotationInput) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onSaveNote: (paperId: string, contentMd: string) => Promise<void>;
  onCopyText: (text: string) => void;
  onCopyBibtex: (paper: Paper) => void;
  onSearchTerm: (term: string) => void;
  onEditPaperMetadata: (paper: Paper) => void;
  onReextractMetadata: (paper: Paper) => Promise<void>;
  onEnrichOnline: (paper: Paper) => Promise<void>;
}

function splitMetadataItems(raw: string, separator: RegExp): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(separator)) {
    const clean = part.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

interface AnnotationCardProps {
  annotation: Annotation;
  isSelected: boolean;
  revealRequest: { id: string; focusComment: boolean; nonce: number } | null;
  onJump: (annotation: Annotation) => void;
  onUpdate: (id: string, input: UpdateAnnotationInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCopyText: (text: string) => void;
}

function AnnotationCard({
  annotation,
  isSelected,
  revealRequest,
  onJump,
  onUpdate,
  onDelete,
  onCopyText,
}: AnnotationCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [commentDraft, setCommentDraft] = useState(annotation.comment);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const latestSavedRef = useRef(annotation.comment);
  const draftRef = useRef(annotation.comment);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestSavedRef.current = annotation.comment;
    if (annotation.comment !== draftRef.current) {
      setCommentDraft(annotation.comment);
      draftRef.current = annotation.comment;
    }
  }, [annotation.comment]);

  useEffect(() => {
    if (!revealRequest || revealRequest.id !== annotation.id) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (revealRequest.focusComment) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [revealRequest, annotation.id]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const flushComment = async (nextText: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (nextText === latestSavedRef.current) return;
    setSaveState('saving');
    try {
      await onUpdate(annotation.id, { comment: nextText });
      latestSavedRef.current = nextText;
      setSaveState('saved');
      setTimeout(() => {
        setSaveState((s) => (s === 'saved' ? 'idle' : s));
      }, 1500);
    } catch {
      setSaveState('idle');
    }
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setCommentDraft(val);
    draftRef.current = val;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void flushComment(val);
    }, 500);
  };

  const colorMeta = getAnnotationColorMeta(annotation.color);

  return (
    <div
      ref={cardRef}
      onClick={() => onJump(annotation)}
      className={`rounded-xl border bg-white p-3 space-y-2.5 cursor-pointer transition ${
        isSelected
          ? 'border-violet-400 ring-2 ring-violet-500/25 shadow-xs'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Card Header */}
      <div className="flex items-center justify-between gap-2 relative">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="修改高亮颜色"
            onClick={(e) => {
              e.stopPropagation();
              setColorPickerOpen((p) => !p);
            }}
            style={{ backgroundColor: colorMeta.swatch }}
            className="w-3.5 h-3.5 rounded-full ring-1 ring-black/15 hover:scale-110 transition shrink-0"
          />
          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-700 tabular-nums">
            P.{annotation.pageNumber}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400">
            {annotation.type === 'area' ? (
              <>
                <ImageIcon className="w-3 h-3" />
                框选
              </>
            ) : (
              '文本'
            )}
          </span>
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {saveState === 'saving' && <span className="text-[10px] text-slate-400">保存中...</span>}
          {saveState === 'saved' && <span className="text-[10px] text-emerald-600">已保存</span>}

          {annotation.type === 'text' && annotation.quoteText && (
            <button
              type="button"
              title="复制摘录"
              onClick={() => onCopyText(annotation.quoteText)}
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            title="删除批注"
            onClick={() => void onDelete(annotation.id)}
            className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {colorPickerOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-6 z-20 flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 shadow-lg"
          >
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                onClick={() => {
                  setColorPickerOpen(false);
                  void onUpdate(annotation.id, { color: c.id });
                }}
                style={{ backgroundColor: c.swatch }}
                className="w-4 h-4 rounded-full ring-1 ring-black/15 hover:scale-110 transition flex items-center justify-center"
              >
                {annotation.color === c.id && (
                  <Check className="w-2.5 h-2.5 text-slate-900/80 stroke-[2.5]" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quote or Snapshot */}
      {annotation.type === 'text' ? (
        <blockquote
          style={{ borderLeftColor: colorMeta.border }}
          className="border-l-[3px] pl-2.5 text-xs text-slate-700 leading-relaxed line-clamp-4 select-text"
        >
          {annotation.quoteText}
        </blockquote>
      ) : annotation.snapshotPath ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
          <img
            src={getSnapshotUrl(annotation.snapshotPath)}
            alt={`第 ${annotation.pageNumber} 页区域截图`}
            className="w-full max-h-44 object-contain bg-white"
          />
        </div>
      ) : null}

      {/* Inline Comment */}
      <div onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          rows={2}
          value={commentDraft}
          onChange={handleCommentChange}
          onBlur={() => void flushComment(commentDraft)}
          placeholder="写下你的批注想法或笔记..."
          className="w-full resize-y rounded-lg border border-slate-200 bg-slate-50/70 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/25 focus:border-violet-500 transition"
        />
      </div>
    </div>
  );
}

function PaperNoteEditor({
  paperId,
  note,
  isPdf,
  currentPdfPage,
  onJumpToPage,
  onSaveNote,
}: {
  paperId: string;
  note: PaperNote | null;
  isPdf: boolean;
  currentPdfPage?: number;
  onJumpToPage: (pageNumber: number) => void;
  onSaveNote: (paperId: string, contentMd: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [draft, setDraft] = useState(note?.contentMd ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activePaperIdRef = useRef(paperId);
  const savedContentRef = useRef(note?.contentMd ?? '');
  const draftRef = useRef(note?.contentMd ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previewMarkdown = useMemo(() => transformNotePageLinks(draft), [draft]);

  useEffect(() => {
    const incoming = note?.contentMd ?? '';
    if (activePaperIdRef.current !== paperId) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (draftRef.current !== savedContentRef.current) {
        void onSaveNote(activePaperIdRef.current, draftRef.current);
      }
      activePaperIdRef.current = paperId;
      savedContentRef.current = incoming;
      draftRef.current = incoming;
      setDraft(incoming);
      setSaveState('idle');
      return;
    }

    savedContentRef.current = incoming;
    if (incoming !== draftRef.current && saveState !== 'saving') {
      draftRef.current = incoming;
      setDraft(incoming);
    }
  }, [paperId, note?.contentMd, onSaveNote, saveState]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const flush = async (targetPaperId: string, text: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (text === savedContentRef.current) return;
    setSaveState('saving');
    try {
      await onSaveNote(targetPaperId, text);
      if (activePaperIdRef.current === targetPaperId) {
        savedContentRef.current = text;
        setSaveState('saved');
        setTimeout(() => {
          setSaveState((s) => (s === 'saved' ? 'idle' : s));
        }, 1600);
      }
    } catch {
      if (activePaperIdRef.current === targetPaperId) setSaveState('idle');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setDraft(val);
    draftRef.current = val;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const currentId = paperId;
    debounceRef.current = setTimeout(() => {
      void flush(currentId, val);
    }, 500);
  };

  const insertCurrentPageLink = () => {
    if (!currentPdfPage || currentPdfPage < 1) return;
    const token = `[P.${currentPdfPage}]`;
    const el = textareaRef.current;
    const start = el ? el.selectionStart : draft.length;
    const end = el ? el.selectionEnd : draft.length;
    const nextVal = `${draft.slice(0, start)}${token}${draft.slice(end)}`;
    setDraft(nextVal);
    draftRef.current = nextVal;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const currentId = paperId;
    debounceRef.current = setTimeout(() => {
      void flush(currentId, nextVal);
    }, 500);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const pos = start + token.length;
        textareaRef.current.setSelectionRange(pos, pos);
      }
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/50 shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setMode('edit')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                mode === 'edit' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Pencil className="w-3 h-3" />
              编辑
            </button>
            <button
              type="button"
              onClick={() => setMode('preview')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                mode === 'preview' ? 'bg-violet-600 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Eye className="w-3 h-3" />
              预览
            </button>
          </div>

          {mode === 'edit' && isPdf && currentPdfPage && currentPdfPage >= 1 && (
            <button
              type="button"
              onClick={insertCurrentPageLink}
              title={`在光标处插入第 ${currentPdfPage} 页跳转链接 [P.${currentPdfPage}]`}
              className="px-2 py-1 rounded-md border border-violet-200 bg-violet-50 text-[11px] font-medium text-violet-700 hover:bg-violet-100 tabular-nums transition"
            >
              + P.{currentPdfPage}
            </button>
          )}
        </div>

        <span className="text-[11px] text-slate-400 truncate">
          {saveState === 'saving'
            ? '保存中...'
            : saveState === 'saved'
              ? '已自动保存'
              : note?.updatedAt
                ? `更新于 ${new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : '支持 Markdown'}
        </span>
      </div>

      {mode === 'edit' ? (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleChange}
          onBlur={() => void flush(paperId, draft)}
          placeholder={`# 论文总结笔记\n\n支持 Markdown 与 [P.12] / [第12页] 页码跳转链接：\n- **核心问题**：[P.1]\n- **方法亮点**：\n- **实验结论**：`}
          className="flex-1 w-full resize-none p-3.5 text-xs leading-relaxed font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none select-text"
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 select-text">
          {draft.trim() ? (
            <div className="fox-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...rest }) => {
                    const pageNum = parseFoxPageHref(href);
                    if (pageNum !== null && isPdf) {
                      return (
                        <button
                          type="button"
                          onClick={() => onJumpToPage(pageNum)}
                          title={`跳转到 PDF 第 ${pageNum} 页`}
                          className="inline-flex items-center px-1.5 py-0.2 mx-0.5 rounded bg-violet-100 text-violet-800 hover:bg-violet-200 font-medium text-[11px] tabular-nums align-baseline transition cursor-pointer"
                        >
                          {children}
                        </button>
                      );
                    }
                    return (
                      <a href={href} {...rest}>
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {previewMarkdown}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="text-xs text-slate-400 text-center py-8">暂无笔记内容，切换至「编辑」开始记录。</div>
          )}
        </div>
      )}
    </div>
  );
}

export function RightSidebar({
  selectedPaper,
  annotations,
  note,
  activeTab,
  selectedAnnotationId,
  cardRevealRequest,
  reextractingMeta = false,
  enrichingOnline = false,
  currentPdfPage,
  onChangeTab,
  onJumpToAnnotation,
  onJumpToPage,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onSaveNote,
  onCopyText,
  onCopyBibtex,
  onSearchTerm,
  onEditPaperMetadata,
  onReextractMetadata,
  onEnrichOnline,
}: RightSidebarProps) {
  const [colorFilter, setColorFilter] = useState<AnnotationColor | 'all'>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [infoExpanded, setInfoExpanded] = useState(true);

  const authorItems = useMemo(
    () => (selectedPaper ? splitMetadataItems(selectedPaper.authors, /[,，;；]+/) : []),
    [selectedPaper],
  );
  const affiliationItems = useMemo(
    () => (selectedPaper ? splitMetadataItems(selectedPaper.affiliations, /[;；]+/) : []),
    [selectedPaper],
  );

  const filteredAnnotations = useMemo(() => {
    return annotations.filter((ann) => {
      if (colorFilter !== 'all' && ann.color !== colorFilter) return false;
      if (kindFilter === 'commented' && ann.comment.trim().length === 0) return false;
      if (kindFilter === 'area' && ann.type !== 'area') return false;
      return true;
    });
  }, [annotations, colorFilter, kindFilter]);

  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 bg-white flex flex-col h-full select-none">
      {/* Tabs */}
      <div className="h-12 border-b border-slate-200 px-2 flex items-center gap-1 shrink-0">
        {selectedPaper?.fileType !== 'md' && (
          <button
            type="button"
            onClick={() => onChangeTab('annotations')}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium transition ${
              activeTab === 'annotations'
                ? 'bg-violet-50 text-violet-800 border border-violet-200/80'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Highlighter className="w-3.5 h-3.5" />
            批注与备注
            {selectedPaper && annotations.length > 0 && (
              <span className="text-[10px] px-1.5 rounded-full bg-violet-100 text-violet-700 tabular-nums">
                {annotations.length}
              </span>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => onChangeTab('notes')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium transition ${
            activeTab === 'notes' || selectedPaper?.fileType === 'md'
              ? 'bg-violet-50 text-violet-800 border border-violet-200/80'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          整篇笔记
        </button>
      </div>

      {/* Paper Authors & Affiliations Card */}
      {selectedPaper && (
        <div className="border-b border-slate-200 bg-slate-50/70 shrink-0">
          <div className="px-3 py-2 flex items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={() => setInfoExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-violet-700 transition min-w-0"
            >
              {infoExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              )}
              <span className="truncate">作者与机构</span>
              {selectedPaper.year && (
                <span className="text-[10px] font-normal px-1.5 py-0.2 rounded bg-slate-200/70 text-slate-600 tabular-nums">
                  {selectedPaper.year}
                </span>
              )}
            </button>
            <div className="flex items-center gap-1 shrink-0">
              {selectedPaper.fileType !== 'md' && (
                <button
                  type="button"
                  disabled={reextractingMeta}
                  title="离线重新识别 PDF 首页标题、作者与机构"
                  onClick={() => void onReextractMetadata(selectedPaper)}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-medium text-slate-600 hover:border-violet-300 hover:text-violet-700 disabled:opacity-50 transition"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${reextractingMeta ? 'animate-spin' : ''}`} />
                  重识别
                </button>
              )}
              <button
                type="button"
                disabled={enrichingOnline}
                title="联网查询 OpenAlex / arXiv / Crossref 补全元数据与 BibTeX"
                onClick={() => void onEnrichOnline(selectedPaper)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-violet-200 bg-violet-50 text-[10px] font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition"
              >
                <Sparkles className={`w-2.5 h-2.5 ${enrichingOnline ? 'animate-pulse' : ''}`} />
                {enrichingOnline ? '补全中' : '联网补全'}
              </button>
              <button
                type="button"
                title="一键复制 BibTeX 引用"
                onClick={() => onCopyBibtex(selectedPaper)}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[10px] font-medium text-slate-600 hover:border-violet-300 hover:text-violet-700 transition"
              >
                <Quote className="w-2.5 h-2.5" />
                BibTeX
              </button>
              <button
                type="button"
                title="手动编辑标题、作者与 BibTeX"
                onClick={() => onEditPaperMetadata(selectedPaper)}
                className="p-1 rounded border border-slate-200 bg-white text-slate-500 hover:text-violet-700 hover:border-violet-300 transition"
              >
                <Pencil className="w-2.5 h-2.5" />
              </button>
            </div>
          </div>

          {infoExpanded && (
            <div className="px-3 pb-2.5 space-y-2 max-h-48 overflow-y-auto">
              {authorItems.length === 0 &&
              affiliationItems.length === 0 &&
              !selectedPaper.venue &&
              !selectedPaper.doi &&
              !selectedPaper.arxivId ? (
                <div className="text-[11px] text-slate-400 leading-relaxed">
                  暂未识别到作者、期刊或标识信息，可点击上方「重识别」或「联网补全」。
                </div>
              ) : (
                <>
                  {(selectedPaper.venue || selectedPaper.doi || selectedPaper.arxivId) && (
                    <div className="flex flex-wrap gap-1">
                      {selectedPaper.venue && (
                        <button
                          type="button"
                          title={`按期刊/会议「${selectedPaper.venue}」搜索论文库`}
                          onClick={() => onSearchTerm(selectedPaper.venue)}
                          className="inline-flex items-center gap-1 max-w-full rounded-md bg-emerald-50/80 border border-emerald-200/80 px-2 py-0.5 text-[11px] text-emerald-900 hover:border-emerald-400 hover:bg-emerald-100 transition text-left"
                        >
                          <BookMarked className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                          <span className="truncate">{selectedPaper.venue}</span>
                        </button>
                      )}
                      {selectedPaper.doi && (
                        <button
                          type="button"
                          title="点击复制 DOI"
                          onClick={() => onCopyText(selectedPaper.doi)}
                          className="inline-flex items-center gap-1 max-w-full rounded-md bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-mono text-slate-600 hover:border-violet-300 hover:text-violet-700 transition"
                        >
                          <span className="truncate">DOI: {selectedPaper.doi}</span>
                        </button>
                      )}
                      {selectedPaper.arxivId && (
                        <button
                          type="button"
                          title="点击复制 arXiv ID"
                          onClick={() => onCopyText(selectedPaper.arxivId)}
                          className="inline-flex items-center gap-1 max-w-full rounded-md bg-white border border-slate-200 px-2 py-0.5 text-[10px] font-mono text-slate-600 hover:border-violet-300 hover:text-violet-700 transition"
                        >
                          <span className="truncate">arXiv: {selectedPaper.arxivId}</span>
                        </button>
                      )}
                    </div>
                  )}
                  {authorItems.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                        <Users className="w-3 h-3" />
                        <span>作者（点击搜索）</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {authorItems.map((author) => (
                          <button
                            key={author}
                            type="button"
                            title={`按作者「${author}」搜索论文库`}
                            onClick={() => onSearchTerm(author)}
                            className="inline-flex items-center gap-1 max-w-full rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px] text-slate-700 hover:border-violet-400 hover:bg-violet-50 hover:text-violet-800 transition"
                          >
                            <Search className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                            <span className="truncate">{author}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {affiliationItems.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                        <Building2 className="w-3 h-3" />
                        <span>机构（点击搜索）</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {affiliationItems.map((aff) => (
                          <button
                            key={aff}
                            type="button"
                            title={`按机构「${aff}」搜索论文库`}
                            onClick={() => onSearchTerm(aff)}
                            className="inline-flex items-center gap-1 max-w-full rounded-md bg-violet-50/70 border border-violet-200/80 px-2 py-0.5 text-[11px] text-violet-900 hover:border-violet-400 hover:bg-violet-100 transition text-left"
                          >
                            <Search className="w-2.5 h-2.5 text-violet-500 shrink-0" />
                            <span className="truncate">{aff}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filter Bar for Annotations Tab */}
      {selectedPaper && selectedPaper.fileType !== 'md' && activeTab === 'annotations' && (
        <div className="px-3 py-2 border-b border-slate-100 space-y-2 shrink-0 bg-slate-50/50">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setColorFilter('all')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                  colorFilter === 'all'
                    ? 'bg-slate-800 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                全色
              </button>
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={`筛选${c.label}色`}
                  onClick={() => setColorFilter((prev) => (prev === c.id ? 'all' : c.id))}
                  style={{ backgroundColor: c.swatch }}
                  className={`w-4 h-4 rounded-full transition ${
                    colorFilter === c.id
                      ? 'ring-2 ring-offset-1 ring-violet-600 scale-110'
                      : 'ring-1 ring-black/15 opacity-80 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
            <span className="text-[10px] text-slate-400 tabular-nums">
              {filteredAnnotations.length}/{annotations.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {(
              [
                ['all', '全部'],
                ['commented', '有备注'],
                ['area', '区域框选'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setKindFilter(id)}
                className={`flex-1 py-1 rounded text-[11px] font-medium transition ${
                  kindFilter === id
                    ? 'bg-violet-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div
        className={`flex-1 ${
          selectedPaper && (activeTab === 'notes' || selectedPaper.fileType === 'md')
            ? 'overflow-hidden'
            : 'overflow-y-auto p-3'
        }`}
      >
        {!selectedPaper ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-slate-400">
            <BookOpen className="w-8 h-8 mb-2 opacity-60" />
            <p className="text-xs leading-relaxed">在左侧选择或导入一篇论文后，此处将显示该论文的批注与 Markdown 总结笔记。</p>
          </div>
        ) : activeTab === 'annotations' && selectedPaper.fileType !== 'md' ? (
          filteredAnnotations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center space-y-2 mt-2">
              <MessageSquare className="w-6 h-6 mx-auto text-violet-500/80" />
              <div className="text-xs font-medium text-slate-700">
                {annotations.length === 0 ? '暂无批注记录' : '没有符合当前筛选条件的批注'}
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                在中间 PDF 页面划选文字即可弹出多色高亮条；切换到「框选」或按住 <code className="text-violet-700">Alt + 拖拽</code> 可框选公式与图表并自动截图。
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredAnnotations.map((ann) => (
                <AnnotationCard
                  key={ann.id}
                  annotation={ann}
                  isSelected={ann.id === selectedAnnotationId}
                  revealRequest={cardRevealRequest}
                  onJump={onJumpToAnnotation}
                  onUpdate={onUpdateAnnotation}
                  onDelete={onDeleteAnnotation}
                  onCopyText={onCopyText}
                />
              ))}
            </div>
          )
        ) : (
          <PaperNoteEditor
            paperId={selectedPaper.id}
            note={note}
            isPdf={selectedPaper.fileType !== 'md'}
            currentPdfPage={currentPdfPage}
            onJumpToPage={onJumpToPage}
            onSaveNote={onSaveNote}
          />
        )}
      </div>
    </aside>
  );
}

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  Copy,
  FileText,
  Highlighter,
  Image as ImageIcon,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import {
  ANNOTATION_COLORS,
  getAnnotationColorMeta,
  type Annotation,
  type AnnotationColor,
  type Paper,
  type UpdateAnnotationInput,
} from '../../shared/types';
import { getSnapshotUrl } from '../lib/pdf';

type KindFilter = 'all' | 'commented' | 'area';

interface RightSidebarProps {
  selectedPaper: Paper | null;
  annotations: Annotation[];
  activeTab: 'annotations' | 'notes';
  selectedAnnotationId: string | null;
  cardRevealRequest: { id: string; focusComment: boolean; nonce: number } | null;
  onChangeTab: (tab: 'annotations' | 'notes') => void;
  onJumpToAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, input: UpdateAnnotationInput) => Promise<void>;
  onDeleteAnnotation: (id: string) => Promise<void>;
  onCopyText: (text: string) => void;
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

export function RightSidebar({
  selectedPaper,
  annotations,
  activeTab,
  selectedAnnotationId,
  cardRevealRequest,
  onChangeTab,
  onJumpToAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onCopyText,
}: RightSidebarProps) {
  const [colorFilter, setColorFilter] = useState<AnnotationColor | 'all'>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

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
        <button
          type="button"
          onClick={() => onChangeTab('notes')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium transition ${
            activeTab === 'notes'
              ? 'bg-violet-50 text-violet-800 border border-violet-200/80'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          整篇笔记
        </button>
      </div>

      {/* Filter Bar for Annotations Tab */}
      {selectedPaper && activeTab === 'annotations' && (
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
      <div className="flex-1 overflow-y-auto p-3">
        {!selectedPaper ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-slate-400">
            <BookOpen className="w-8 h-8 mb-2 opacity-60" />
            <p className="text-xs leading-relaxed">在左侧选择或导入一篇论文后，此处将显示该论文的批注与 Markdown 总结笔记。</p>
          </div>
        ) : activeTab === 'annotations' ? (
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
          <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center space-y-2 mt-2">
            <FileText className="w-6 h-6 mx-auto text-violet-500/80" />
            <div className="text-xs font-medium text-slate-700">整篇 Markdown 笔记（M3 规划）</div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              M3 里程碑将提供支持编辑/预览切换与 500ms 防抖自动保存的论文总结笔记编辑器，并纳入 FTS5 全局检索。
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

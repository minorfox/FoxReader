import { useState } from 'react';
import { Highlighter, FileText, BookOpen, Sparkles } from 'lucide-react';
import type { Paper } from '../../shared/types';

export function RightSidebar({ selectedPaper }: { selectedPaper: Paper | null }) {
  const [activeTab, setActiveTab] = useState<'annotations' | 'notes'>('annotations');

  return (
    <aside className="w-80 shrink-0 border-l border-slate-200 bg-white flex flex-col h-full select-none">
      <div className="h-12 border-b border-slate-200 px-2 flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('annotations')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium transition ${
            activeTab === 'annotations'
              ? 'bg-amber-50 text-amber-800 border border-amber-200/80'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Highlighter className="w-3.5 h-3.5" />
          批注与备注
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('notes')}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-md text-xs font-medium transition ${
            activeTab === 'notes'
              ? 'bg-amber-50 text-amber-800 border border-amber-200/80'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          整篇笔记
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!selectedPaper ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-slate-400">
            <BookOpen className="w-8 h-8 mb-2 opacity-60" />
            <p className="text-xs leading-relaxed">在左侧选择或导入一篇论文后，此处将显示该论文的批注与 Markdown 总结笔记。</p>
          </div>
        ) : activeTab === 'annotations' ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
              <div className="text-xs font-semibold text-slate-800 line-clamp-2">{selectedPaper.title}</div>
              <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2 gap-y-0.5">
                {selectedPaper.authors && <span>{selectedPaper.authors}</span>}
                {selectedPaper.year && <span>({selectedPaper.year})</span>}
                <span>共 {selectedPaper.pageCount || '?'} 页</span>
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center space-y-2">
              <Sparkles className="w-6 h-6 mx-auto text-amber-500/80" />
              <div className="text-xs font-medium text-slate-700">M1 基础阅读版已就绪</div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                当前版本已完成论文库、懒渲染阅读器与阅读进度记忆。M2 里程碑将在此接入多色文本划选高亮、图表/公式区域框选截图与 PDF ↔ 批注双向跳转。
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center space-y-2">
            <FileText className="w-6 h-6 mx-auto text-amber-500/80" />
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

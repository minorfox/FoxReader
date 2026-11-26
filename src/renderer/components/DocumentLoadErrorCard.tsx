import { AlertTriangle, FolderOpen, Link2, Loader2, RefreshCw } from 'lucide-react';
import type { PaperFileStatus } from '../../shared/types';

interface DocumentLoadErrorCardProps {
  fileType: 'pdf' | 'md';
  loadError: string;
  fileStatus: PaperFileStatus | null;
  relinking: boolean;
  onRetry: () => void;
  onRelink?: () => void;
  onOpenDir?: () => void;
}

export function DocumentLoadErrorCard({
  fileType,
  loadError,
  fileStatus,
  relinking,
  onRetry,
  onRelink,
  onOpenDir,
}: DocumentLoadErrorCardProps) {
  const docLabel = fileType === 'md' ? 'Markdown' : 'PDF';
  const dirLabel = fileType === 'md' ? 'docs/' : 'pdfs/';
  const status = fileStatus?.status;

  let heading = fileType === 'md' ? '加载 Markdown 文档失败' : '无法渲染该 PDF';
  let detail = loadError;
  let hint: string | null = null;
  let showRelink = false;
  let showOpenDir = false;

  if (status === 'missing') {
    heading = `找不到本地 ${docLabel} 文件`;
    detail = `数据库中存在该文献记录，但数据目录 ${dirLabel} 下缺少托管文件${
      fileStatus?.fileName ? `（${fileStatus.fileName}）` : ''
    }。常见于多端云盘尚未将文件上传或同步到位，或文件被移除。`;
    hint = `可等待云盘同步完成后点击重试，或重新选择同一份原始 ${docLabel} 进行关联（会完整保留已有批注与笔记）。`;
    showRelink = true;
    showOpenDir = true;
  } else if (status === 'icloud-placeholder') {
    heading = `${docLabel} 仍在云端，尚未下载到本地`;
    detail = '检测到云盘占位文件（.icloud）。当前文件仅保留在云端，尚未下载到本地磁盘。';
    hint = '请在系统文件管理器中将数据目录设为「始终保留在此设备上 / 立即下载」，完成后点击重试加载。';
    showOpenDir = true;
  } else if (status === 'empty') {
    heading = `本地 ${docLabel} 文件为空（0 字节）`;
    detail = '托管文件可能尚未同步完成或写入中断。';
    hint = `请等待云盘同步完成后重试，或重新选择同一份原始 ${docLabel} 进行关联。`;
    showRelink = true;
    showOpenDir = true;
  }

  return (
    <div className="max-w-lg w-full rounded-2xl border border-amber-200 bg-white p-6 shadow-xs space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="space-y-1.5 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{heading}</h3>
          <p className="text-xs text-slate-600 leading-relaxed break-all">{detail}</p>
          {hint && <p className="text-xs text-slate-500 leading-relaxed">{hint}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition shadow-2xs"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          重试加载
        </button>

        {showRelink && onRelink && (
          <button
            type="button"
            disabled={relinking}
            onClick={onRelink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition disabled:opacity-50"
          >
            {relinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            重新关联原 {docLabel}
          </button>
        )}

        {showOpenDir && onOpenDir && (
          <button
            type="button"
            onClick={onOpenDir}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            打开 {dirLabel} 目录
          </button>
        )}
      </div>
    </div>
  );
}

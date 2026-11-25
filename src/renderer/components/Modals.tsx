import React, { useEffect, useState } from 'react';
import { X, FolderOpen, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { Folder, Paper, PaperStatus, UpdatePaperMetadataInput } from '../../shared/types';

export interface ToastMessage {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

export function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => {
        const tone =
          toast.kind === 'error'
            ? 'bg-red-50 border-red-200 text-red-900'
            : toast.kind === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : toast.kind === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-white border-slate-200 text-slate-800';
        const Icon =
          toast.kind === 'error' || toast.kind === 'warning'
            ? AlertTriangle
            : toast.kind === 'success'
              ? CheckCircle2
              : Info;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-lg text-sm ${tone}`}
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 leading-snug">{toast.text}</span>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="opacity-60 hover:opacity-100 p-0.5"
              aria-label="关闭通知"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = '确认',
  danger = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 text-sm text-slate-600 leading-relaxed whitespace-pre-line">
          {message}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/70 transition"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium text-white transition ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-violet-600 hover:bg-violet-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function MetadataModal({
  paper,
  folders,
  onClose,
  onSave,
}: {
  paper: Paper | null;
  folders: Folder[];
  onClose: () => void;
  onSave: (paperId: string, input: UpdatePaperMetadataInput) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<PaperStatus>('unread');
  const [folderId, setFolderId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!paper) return;
    setTitle(paper.title);
    setAuthors(paper.authors);
    setYear(paper.year !== null ? String(paper.year) : '');
    setStatus(paper.status);
    setFolderId(paper.folderId ?? '');
  }, [paper]);

  if (!paper) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const parsedYear = year.trim() === '' ? null : Number.parseInt(year.trim(), 10);
      await onSave(paper.id, {
        title: title.trim() || paper.title,
        authors: authors.trim(),
        year: parsedYear !== null && Number.isFinite(parsedYear) ? parsedYear : null,
        status,
        folderId: folderId === '' ? null : folderId,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900 text-sm">编辑论文元数据</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">论文标题</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">作者</label>
              <input
                type="text"
                placeholder="例如：Vaswani et al."
                value={authors}
                onChange={(e) => setAuthors(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">年份</label>
              <input
                type="number"
                min={1900}
                max={2100}
                placeholder="2024"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">阅读状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as PaperStatus)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
              >
                <option value="unread">未读</option>
                <option value="reading">在读</option>
                <option value="read">已读</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">所属文件夹</label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
              >
                <option value="">未分类</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200/80 px-3 py-2 text-[11px] text-slate-500 space-y-0.5">
            <div className="truncate">原始文件名：{paper.fileName}</div>
            <div className="font-mono truncate">SHA-256：{paper.sha256}</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/70 transition"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 transition"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SettingsModal({
  open,
  dataDir,
  onClose,
  onSelectDataDir,
  onOpenDataDir,
}: {
  open: boolean;
  dataDir: string;
  onClose: () => void;
  onSelectDataDir: () => Promise<void>;
  onOpenDataDir: () => Promise<void>;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900 text-sm">本地数据目录设置</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-xs text-slate-600 leading-relaxed">
            FoxReader 将数据库（<code className="text-violet-700">library.db</code>）、只读 PDF 副本（
            <code className="text-violet-700">pdfs/</code>）与区域截图（
            <code className="text-violet-700">snapshots/</code>）集中保存在下方目录中，可随时放入网盘或 Git 仓库备份同步。
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">当前数据目录</label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 break-all">
              {dataDir}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onOpenDataDir()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              在文件管理器中打开
            </button>
            <button
              type="button"
              onClick={() => void onSelectDataDir()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-xs font-medium text-white hover:bg-violet-700 transition"
            >
              切换 / 指向已有 FoxReaderData 目录
            </button>
          </div>
        </div>
        <div className="flex justify-end px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/70 transition"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

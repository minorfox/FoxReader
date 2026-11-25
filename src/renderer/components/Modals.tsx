import React, { useEffect, useState } from 'react';
import { X, FolderOpen, AlertTriangle, CheckCircle2, Info, Plus, ShieldAlert } from 'lucide-react';
import type {
  DataDirLockInfo,
  Folder,
  Paper,
  PaperStatus,
  Tag,
  UpdatePaperMetadataInput,
} from '../../shared/types';

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
  availableTags,
  onClose,
  onSave,
}: {
  paper: Paper | null;
  folders: Folder[];
  availableTags: Tag[];
  onClose: () => void;
  onSave: (paperId: string, input: UpdatePaperMetadataInput, tagNames: string[]) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [status, setStatus] = useState<PaperStatus>('unread');
  const [folderId, setFolderId] = useState<string>('');
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!paper) return;
    setTitle(paper.title);
    setAuthors(paper.authors);
    setYear(paper.year !== null ? String(paper.year) : '');
    setStatus(paper.status);
    setFolderId(paper.folderId ?? '');
    setTagNames(paper.tags.map((t) => t.name));
    setTagInput('');
  }, [paper]);

  if (!paper) return null;

  const addTagName = (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    if (!tagNames.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setTagNames((prev) => [...prev, clean]);
    }
    setTagInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const pendingTag = tagInput.trim();
      const finalTags =
        pendingTag && !tagNames.some((t) => t.toLowerCase() === pendingTag.toLowerCase())
          ? [...tagNames, pendingTag]
          : tagNames;
      const parsedYear = year.trim() === '' ? null : Number.parseInt(year.trim(), 10);
      await onSave(
        paper.id,
        {
          title: title.trim() || paper.title,
          authors: authors.trim(),
          year: parsedYear !== null && Number.isFinite(parsedYear) ? parsedYear : null,
          status,
          folderId: folderId === '' ? null : folderId,
        },
        finalTags,
      );
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

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-600">标签</label>
            <div className="flex flex-wrap gap-1.5">
              {tagNames.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2.5 py-0.5 text-xs text-violet-700"
                >
                  #{name}
                  <button
                    type="button"
                    onClick={() => setTagNames((prev) => prev.filter((t) => t !== name))}
                    className="hover:text-violet-950"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="输入新标签后回车或点击添加..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTagName(tagInput);
                  }
                }}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
              />
              <button
                type="button"
                onClick={() => addTagName(tagInput)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <Plus className="w-3.5 h-3.5" />
                添加
              </button>
            </div>
            {availableTags.some((t) => !tagNames.some((n) => n.toLowerCase() === t.name.toLowerCase())) && (
              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                <span className="text-[11px] text-slate-400">已有标签：</span>
                {availableTags
                  .filter((t) => !tagNames.some((n) => n.toLowerCase() === t.name.toLowerCase()))
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => addTagName(t.name)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600 hover:border-violet-300 hover:text-violet-700 transition"
                    >
                      + {t.name}
                    </button>
                  ))}
              </div>
            )}
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
            <code className="text-violet-700">snapshots/</code>）集中保存在下方目录中。若需多机通过 OneDrive / 坚果云同步，仅需将此目录放入网盘，并确保单台设备退出且同步完成后再在另一台设备打开。
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

export function LockWarningModal({
  lockInfo,
  onAcknowledge,
  onQuit,
}: {
  lockInfo: DataDirLockInfo | null;
  onAcknowledge: () => Promise<void>;
  onQuit: () => Promise<void>;
}) {
  if (!lockInfo) return null;
  const startedText = new Date(lockInfo.startedAt).toLocaleString();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-md rounded-xl bg-white border border-amber-200 shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-amber-100 bg-amber-50/70">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
          <h3 className="font-semibold text-slate-900 text-sm">检测到数据目录占用锁</h3>
        </div>
        <div className="p-5 space-y-3 text-xs text-slate-600 leading-relaxed">
          <p>
            当前数据目录中存在未释放的占用锁，可能另一台设备尚未退出 FoxReader 或 OneDrive 尚未完成同步：
          </p>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 font-mono text-[11px] text-slate-700 space-y-1">
            <div>设备主机：{lockInfo.hostname}</div>
            <div>进程 PID：{lockInfo.pid}</div>
            <div>打开时间：{startedText}</div>
          </div>
          <p className="text-amber-800">
            为避免网盘产生数据库冲突副本（如 <code>library-冲突.db</code>），建议确认另一台设备已关闭且网盘同步完成后再继续。
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={() => void onQuit()}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200/70 transition"
          >
            退出应用
          </button>
          <button
            type="button"
            onClick={() => void onAcknowledge()}
            className="px-4 py-1.5 rounded-lg text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 transition"
          >
            我已确认同步完成，继续使用
          </button>
        </div>
      </div>
    </div>
  );
}

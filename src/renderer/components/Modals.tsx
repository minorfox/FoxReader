import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
  Info,
  Plus,
  ShieldAlert,
  RefreshCw,
  ExternalLink,
  Loader2,
  Mail,
  Copy,
  Check,
  Download,
  Sparkles,
  Quote,
} from 'lucide-react';
import type {
  DataDirLockInfo,
  DownloadUpdateInput,
  EnrichPaperOnlineInput,
  EnrichPaperOnlineResult,
  Folder,
  Paper,
  PaperStatus,
  Tag,
  UpdateCheckResult,
  UpdateDownloadState,
  UpdateInstallMode,
  UpdatePaperMetadataInput,
} from '../../shared/types';
import { buildBibtexFromPaper } from '../../shared/bibtex';

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
  onEnrichOnlineWithHints,
  onCopyText,
}: {
  paper: Paper | null;
  folders: Folder[];
  availableTags: Tag[];
  onClose: () => void;
  onSave: (paperId: string, input: UpdatePaperMetadataInput, tagNames: string[]) => Promise<void>;
  onEnrichOnlineWithHints?: (input: EnrichPaperOnlineInput) => Promise<EnrichPaperOnlineResult>;
  onCopyText?: (text: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [affiliations, setAffiliations] = useState('');
  const [year, setYear] = useState('');
  const [venue, setVenue] = useState('');
  const [doi, setDoi] = useState('');
  const [arxivId, setArxivId] = useState('');
  const [bibtex, setBibtex] = useState('');
  const [status, setStatus] = useState<PaperStatus>('unread');
  const [folderId, setFolderId] = useState<string>('');
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [fetchingOnline, setFetchingOnline] = useState(false);
  const [enrichHintMsg, setEnrichHintMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!paper) return;
    setTitle(paper.title);
    setAuthors(paper.authors);
    setAffiliations(paper.affiliations ?? '');
    setYear(paper.year !== null ? String(paper.year) : '');
    setVenue(paper.venue ?? '');
    setDoi(paper.doi ?? '');
    setArxivId(paper.arxivId ?? '');
    setBibtex(paper.bibtex ?? '');
    setStatus(paper.status);
    setFolderId(paper.folderId ?? '');
    setTagNames(paper.tags.map((t) => t.name));
    setTagInput('');
    setEnrichHintMsg(null);
  }, [paper]);

  if (!paper) return null;

  const parseFormYear = (): number | null => {
    const parsedYear = year.trim() === '' ? null : Number.parseInt(year.trim(), 10);
    return parsedYear !== null && Number.isFinite(parsedYear) ? parsedYear : null;
  };

  const handleEnrichInModal = async () => {
    if (!onEnrichOnlineWithHints) return;
    setFetchingOnline(true);
    setEnrichHintMsg(null);
    try {
      const res = await onEnrichOnlineWithHints({
        titleHint: title.trim() || paper.title,
        doiHint: doi.trim() || undefined,
        arxivIdHint: arxivId.trim() || undefined,
      });
      if (!res.matched) {
        setEnrichHintMsg(res.error || '未能联网匹配到文献，请检查标题、DOI 或 arXiv ID。');
        return;
      }
      if (res.title) setTitle(res.title);
      if (res.authors) setAuthors(res.authors);
      if (res.affiliations) setAffiliations(res.affiliations);
      if (res.year !== undefined && res.year !== null) setYear(String(res.year));
      if (res.venue) setVenue(res.venue);
      if (res.doi) setDoi(res.doi);
      if (res.arxivId) setArxivId(res.arxivId);
      if (res.bibtex) setBibtex(res.bibtex);
      setEnrichHintMsg(`已从 ${res.source || 'OpenAlex'} 填入元数据与 BibTeX（记得点击下方保存）`);
    } catch (err) {
      setEnrichHintMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingOnline(false);
    }
  };

  const handleRegenerateBibtex = () => {
    const generated = buildBibtexFromPaper({
      title: title.trim() || paper.title,
      authors: authors.trim(),
      year: parseFormYear(),
      venue: venue.trim(),
      doi: doi.trim(),
      arxivId: arxivId.trim(),
    });
    setBibtex(generated);
  };

  const handleCopyModalBibtex = () => {
    const content =
      bibtex.trim() ||
      buildBibtexFromPaper({
        title: title.trim() || paper.title,
        authors: authors.trim(),
        year: parseFormYear(),
        venue: venue.trim(),
        doi: doi.trim(),
        arxivId: arxivId.trim(),
      });
    if (onCopyText) {
      onCopyText(content);
    } else {
      void navigator.clipboard.writeText(content);
    }
  };

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
      await onSave(
        paper.id,
        {
          title: title.trim() || paper.title,
          authors: authors.trim(),
          affiliations: affiliations.trim(),
          year: parseFormYear(),
          venue: venue.trim(),
          doi: doi.trim(),
          arxivId: arxivId.trim(),
          bibtex: bibtex.trim(),
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
        className="w-full max-w-xl max-h-[88vh] flex flex-col rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 shrink-0">
          <h3 className="font-semibold text-slate-900 text-sm">编辑论文元数据与引用</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm overflow-y-auto">
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
                placeholder="例如：Vaswani, Shazeer"
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

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">作者机构 / 单位</label>
            <input
              type="text"
              placeholder="多个机构请用分号 ; 分隔，例如：Tsinghua University; Peking University"
              value={affiliations}
              onChange={(e) => setAffiliations(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">期刊 / 会议（Venue）</label>
            <input
              type="text"
              placeholder="例如：NeurIPS / IEEE Transactions on Pattern Analysis..."
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
            />
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">DOI</label>
                <input
                  type="text"
                  placeholder="例如：10.18653/v1/2024.emnlp-main.12"
                  value={doi}
                  onChange={(e) => setDoi(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">arXiv ID</label>
                <input
                  type="text"
                  placeholder="例如：2405.12345"
                  value={arxivId}
                  onChange={(e) => setArxivId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                />
              </div>
            </div>
            {onEnrichOnlineWithHints && (
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={fetchingOnline}
                  onClick={() => void handleEnrichInModal()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-xs font-medium text-violet-700 disabled:opacity-50 transition"
                >
                  {fetchingOnline ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  {fetchingOnline ? '查询中...' : '按 DOI / arXiv / 标题联网补全'}
                </button>
                {enrichHintMsg && (
                  <span className="text-[11px] text-slate-500 truncate">{enrichHintMsg}</span>
                )}
              </div>
            )}
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-600">BibTeX 引用条目</label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleRegenerateBibtex}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[11px] text-slate-600 transition"
                >
                  <RefreshCw className="w-3 h-3" />
                  按当前字段生成
                </button>
                <button
                  type="button"
                  onClick={handleCopyModalBibtex}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[11px] text-slate-600 transition"
                >
                  <Quote className="w-3 h-3" />
                  复制
                </button>
              </div>
            </div>
            <textarea
              rows={5}
              value={bibtex}
              onChange={(e) => setBibtex(e.target.value)}
              placeholder="@article{...}（留空将在复制或批量导出时自动按当前元数据生成）"
              className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-[11px] font-mono text-slate-700 leading-relaxed focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
            />
          </div>

          <div className="rounded-lg bg-slate-50 border border-slate-200/80 px-3 py-2 text-[11px] text-slate-500 space-y-0.5">
            <div className="truncate">原始文件名：{paper.fileName}</div>
            <div className="font-mono truncate">SHA-256：{paper.sha256}</div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100 shrink-0">
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

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getUpdateModeCopy(mode: UpdateInstallMode | undefined): {
  hint: string;
  downloadLabel: string;
  applyLabel: string;
} {
  if (mode === 'win-nsis') {
    return {
      hint: 'Windows 安装版支持应用内下载、SHA-256 校验并静默覆盖更新后自动重启。',
      downloadLabel: '下载并静默更新',
      applyLabel: '立即退出并静默安装',
    };
  }
  if (mode === 'win-portable') {
    return {
      hint: '当前为免安装便携版：需先关闭本程序后再用新版 .exe 替换旧文件（下载后可一键定位文件并退出）。',
      downloadLabel: '下载新版便携包',
      applyLabel: '定位新版并关闭当前程序',
    };
  }
  if (mode === 'mac-arm64' || mode === 'mac-x64') {
    return {
      hint: 'macOS 将按当前芯片架构下载 DMG 并校验 SHA-256，打开后拖入「应用程序」替换即可。',
      downloadLabel: '下载 DMG 安装包',
      applyLabel: '打开 DMG 安装镜像',
    };
  }
  return {
    hint: '当前为开发运行模式：可演练下载与 SHA-256 校验，不会覆盖本地开发环境。',
    downloadLabel: '下载更新包（演练）',
    applyLabel: '在文件夹中查看下载包',
  };
}

export function SettingsModal({
  open,
  dataDir,
  appVersion,
  autoCheckNonce = 0,
  onClose,
  onSelectDataDir,
  onOpenDataDir,
  onCheckForUpdates,
  onDownloadUpdate,
  onCancelUpdateDownload,
  onApplyDownloadedUpdate,
  onSubscribeUpdateState,
  onOpenExternalUrl,
}: {
  open: boolean;
  dataDir: string;
  appVersion: string;
  autoCheckNonce?: number;
  onClose: () => void;
  onSelectDataDir: () => Promise<void>;
  onOpenDataDir: (subDir?: 'pdfs' | 'docs' | 'snapshots') => Promise<void>;
  onCheckForUpdates: () => Promise<UpdateCheckResult>;
  onDownloadUpdate: (input: DownloadUpdateInput) => Promise<UpdateDownloadState>;
  onCancelUpdateDownload: () => Promise<void>;
  onApplyDownloadedUpdate: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  onSubscribeUpdateState: (listener: (state: UpdateDownloadState) => void) => () => void;
  onOpenExternalUrl: (url: string) => Promise<void>;
}) {
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [downloadState, setDownloadState] = useState<UpdateDownloadState | null>(null);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const lastAutoCheckNonceRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setUpdateResult(null);
      setCheckingUpdate(false);
      setDownloadState(null);
      setApplyingUpdate(false);
      setCopiedEmail(false);
      return;
    }
    const unsub = onSubscribeUpdateState((next) => {
      setDownloadState(next);
    });
    return unsub;
  }, [open, onSubscribeUpdateState]);

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    setDownloadState(null);
    try {
      const res = await onCheckForUpdates();
      setUpdateResult(res);
    } finally {
      setCheckingUpdate(false);
    }
  }, [onCheckForUpdates]);

  useEffect(() => {
    if (open && autoCheckNonce > 0 && autoCheckNonce !== lastAutoCheckNonceRef.current) {
      lastAutoCheckNonceRef.current = autoCheckNonce;
      void handleCheckUpdate();
    }
  }, [open, autoCheckNonce, handleCheckUpdate]);

  if (!open) return null;

  const handleCopyEmail = async () => {
    await navigator.clipboard.writeText('lihuang@swufe.edu.cn');
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 1800);
  };

  const handleStartDownload = async () => {
    if (!updateResult?.assetName || !updateResult.assetUrl) return;
    const finalState = await onDownloadUpdate({
      assetName: updateResult.assetName,
      assetUrl: updateResult.assetUrl,
      checksumUrl: updateResult.checksumUrl,
    });
    setDownloadState(finalState);
  };

  const handleApplyUpdate = async () => {
    if (!downloadState?.filePath) return;
    setApplyingUpdate(true);
    try {
      const res = await onApplyDownloadedUpdate(downloadState.filePath);
      if (!res.ok) {
        setDownloadState((prev) => ({
          phase: 'error',
          assetName: prev?.assetName,
          downloadedBytes: prev?.downloadedBytes ?? 0,
          totalBytes: prev?.totalBytes ?? 0,
          percent: 0,
          error: res.error || '启动安装失败，请前往发布页手动下载。',
        }));
      }
    } finally {
      setApplyingUpdate(false);
    }
  };

  const modeCopy = getUpdateModeCopy(updateResult?.installMode);
  const isBusyDownloading =
    downloadState?.phase === 'downloading' || downloadState?.phase === 'verifying';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
      <div className="w-full max-w-lg rounded-xl bg-white border border-slate-200 shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900 text-sm">应用设置</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-5 text-sm">
          <div className="space-y-3">
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
                打开数据目录
              </button>
              <button
                type="button"
                onClick={() => void onOpenDataDir('pdfs')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                打开 pdfs/
              </button>
              <button
                type="button"
                onClick={() => void onSelectDataDir()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-xs font-medium text-white hover:bg-violet-700 transition"
              >
                切换目录
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-700">版本与更新</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                  v{appVersion}
                </span>
              </div>
              <button
                type="button"
                disabled={checkingUpdate}
                onClick={() => void handleCheckUpdate()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:border-violet-300 hover:text-violet-700 disabled:opacity-60 transition"
              >
                {checkingUpdate ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {checkingUpdate ? '正在检查...' : '检查更新'}
              </button>
            </div>

            {updateResult && (
              <div
                className={`rounded-lg border px-3 py-2.5 text-xs ${
                  updateResult.error
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : updateResult.hasUpdate
                      ? 'bg-violet-50 border-violet-200 text-violet-900'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
              >
                {updateResult.error ? (
                  <div className="flex items-center justify-between gap-2">
                    <span>{updateResult.error}</span>
                    <button
                      type="button"
                      onClick={() => void onOpenExternalUrl(updateResult.releaseUrl)}
                      className="inline-flex items-center gap-1 underline shrink-0"
                    >
                      打开发布页
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                ) : updateResult.hasUpdate ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        发现新版本 <strong>v{updateResult.latestVersion}</strong>（当前 v{updateResult.currentVersion}）
                        {updateResult.assetSize ? (
                          <span className="ml-1.5 text-[11px] text-violet-700/80">
                            · {formatMb(updateResult.assetSize)}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void onOpenExternalUrl(updateResult.releaseUrl)}
                        className="inline-flex items-center gap-1 text-[11px] text-violet-700 hover:underline shrink-0"
                      >
                        去 GitHub 下载
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>

                    <div className="text-[11px] text-violet-800/85 leading-relaxed">
                      {modeCopy.hint}
                    </div>

                    {isBusyDownloading && downloadState ? (
                      <div className="space-y-1.5 rounded-md bg-white/80 border border-violet-200 p-2.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-700">
                          <span>
                            {downloadState.phase === 'verifying'
                              ? '正在校验 SHA-256 完整性...'
                              : `正在下载 ${downloadState.assetName ?? ''}...`}
                          </span>
                          <span className="tabular-nums font-medium">
                            {downloadState.totalBytes > 0
                              ? `${formatMb(downloadState.downloadedBytes)} / ${formatMb(downloadState.totalBytes)} (${downloadState.percent}%)`
                              : formatMb(downloadState.downloadedBytes)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-violet-100 overflow-hidden">
                          <div
                            style={{
                              width: `${
                                downloadState.phase === 'verifying'
                                  ? 100
                                  : Math.max(4, downloadState.percent)
                              }%`,
                            }}
                            className="h-full bg-violet-600 transition-all duration-150"
                          />
                        </div>
                        {downloadState.phase === 'downloading' && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => void onCancelUpdateDownload()}
                              className="px-2 py-0.5 rounded border border-slate-200 text-[11px] text-slate-600 hover:bg-slate-100 transition"
                            >
                              取消下载
                            </button>
                          </div>
                        )}
                      </div>
                    ) : downloadState?.phase === 'ready' && downloadState.filePath ? (
                      <div className="rounded-md bg-emerald-50 border border-emerald-200 p-2.5 flex items-center justify-between gap-2 text-emerald-900">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>安装包已下载并校验通过</span>
                        </div>
                        <button
                          type="button"
                          disabled={applyingUpdate}
                          onClick={() => void handleApplyUpdate()}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-60 shrink-0 transition"
                        >
                          {applyingUpdate ? '正在启动...' : modeCopy.applyLabel}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {downloadState?.phase === 'error' && downloadState.error && (
                          <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[11px] text-amber-800">
                            {downloadState.error}
                          </div>
                        )}
                        {downloadState?.phase === 'cancelled' && (
                          <div className="text-[11px] text-slate-500">已取消下载。</div>
                        )}
                        {updateResult.assetUrl && updateResult.assetName ? (
                          <button
                            type="button"
                            onClick={() => void handleStartDownload()}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 transition"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {downloadState?.phase === 'error' ? `重试${modeCopy.downloadLabel}` : modeCopy.downloadLabel}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void onOpenExternalUrl(updateResult.releaseUrl)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600 text-white font-medium hover:bg-violet-700 transition"
                          >
                            前往下载
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>当前已是最新版本 v{updateResult.currentVersion}。</div>
                )}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 min-w-0">
              <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700 shrink-0">联系与反馈</span>
              <span className="font-mono text-slate-600 truncate select-text">lihuang@swufe.edu.cn</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => void handleCopyEmail()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:border-violet-300 hover:text-violet-700 transition"
              >
                {copiedEmail ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700">已复制</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>复制邮箱</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void onOpenExternalUrl('https://github.com/minorfox/FoxReader')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:border-violet-300 hover:text-violet-700 transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>GitHub</span>
              </button>
            </div>
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

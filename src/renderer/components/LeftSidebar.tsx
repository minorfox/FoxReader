import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderPlus,
  FileUp,
  Inbox,
  Library,
  Pencil,
  Plus,
  Search,
  Settings,
  Square,
  Tag as TagIcon,
  Trash2,
  X,
} from 'lucide-react';
import type { Folder, LibraryView, Paper, PaperStatus, Tag } from '../../shared/types';
import appIcon from '../assets/icon.png';

const TAG_CHIP_STYLES: Record<string, string> = {
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
};

function getTagChipClass(color: string): string {
  return TAG_CHIP_STYLES[color] ?? TAG_CHIP_STYLES.violet;
}

const STATUS_LABEL: Record<PaperStatus, string> = {
  unread: '未读',
  reading: '在读',
  read: '已读',
};

const STATUS_BADGE: Record<PaperStatus, string> = {
  unread: 'bg-slate-100 text-slate-600',
  reading: 'bg-violet-100 text-violet-800',
  read: 'bg-emerald-100 text-emerald-800',
};

interface FolderNode extends Folder {
  children: FolderNode[];
}

function buildFolderTree(folders: Folder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  for (const folder of folders) {
    map.set(folder.id, { ...folder, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

interface LeftSidebarProps {
  folders: Folder[];
  folderCounts: Record<string, number>;
  tags: Tag[];
  tagCounts: Record<string, number>;
  totalCount: number;
  unclassifiedCount: number;
  papers: Paper[];
  activeView: LibraryView;
  activeFolderId: string | null;
  activeTagId: string | null;
  statusFilter: PaperStatus | 'all';
  searchQuery: string;
  selectedPaperId: string | null;
  onSelectView: (view: LibraryView, folderId?: string | null) => void;
  onSelectTag: (tagId: string | null) => void;
  onDeleteTag: (tag: Tag) => void;
  onChangeStatusFilter: (status: PaperStatus | 'all') => void;
  onChangeSearch: (query: string) => void;
  onSelectPaper: (paperId: string) => void;
  onPickAndImport: (folderId: string | null) => void;
  onImportFiles: (files: File[], folderId: string | null) => void;
  onCreateFolder: (name: string, parentId: string | null) => Promise<void>;
  onRenameFolder: (id: string, name: string) => Promise<void>;
  onRequestDeleteFolder: (folder: Folder) => void;
  onMovePaperToFolder: (paperId: string, folderId: string | null) => Promise<void>;
  onEditPaper: (paper: Paper) => void;
  onRequestDeletePaper: (paper: Paper) => void;
  onRequestBatchDeletePapers: (papers: Paper[], onDone: () => void) => void;
  onOpenSettings: () => void;
}

export function LeftSidebar({
  folders,
  folderCounts,
  tags,
  tagCounts,
  totalCount,
  unclassifiedCount,
  papers,
  activeView,
  activeFolderId,
  activeTagId,
  statusFilter,
  searchQuery,
  selectedPaperId,
  onSelectView,
  onSelectTag,
  onDeleteTag,
  onChangeStatusFilter,
  onChangeSearch,
  onSelectPaper,
  onPickAndImport,
  onImportFiles,
  onCreateFolder,
  onRenameFolder,
  onRequestDeleteFolder,
  onMovePaperToFolder,
  onEditPaper,
  onRequestDeletePaper,
  onRequestBatchDeletePapers,
  onOpenSettings,
}: LeftSidebarProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const [batchMode, setBatchMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(() => new Set());
  const lastBatchIdxRef = useRef<number | null>(null);

  useEffect(() => {
    const visibleIds = new Set(papers.map((p) => p.id));
    setBatchSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    if (papers.length === 0 && batchMode) {
      setBatchMode(false);
    }
  }, [papers, batchMode]);

  const exitBatchMode = () => {
    setBatchMode(false);
    setBatchSelectedIds(new Set());
    lastBatchIdxRef.current = null;
  };

  const toggleBatchSelect = (paperId: string, idx: number, shiftKey: boolean) => {
    setBatchSelectedIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastBatchIdxRef.current !== null) {
        const start = Math.min(lastBatchIdxRef.current, idx);
        const end = Math.max(lastBatchIdxRef.current, idx);
        for (let i = start; i <= end; i++) {
          if (papers[i]) next.add(papers[i].id);
        }
      } else if (next.has(paperId)) {
        next.delete(paperId);
      } else {
        next.add(paperId);
      }
      return next;
    });
    lastBatchIdxRef.current = idx;
  };

  const allSelected = papers.length > 0 && papers.every((p) => batchSelectedIds.has(p.id));
  const selectedBatchPapers = useMemo(
    () => papers.filter((p) => batchSelectedIds.has(p.id)),
    [papers, batchSelectedIds],
  );

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStartCreate = (parentId: string | null) => {
    setCreatingParentId(parentId);
    setNewFolderName('');
    if (parentId) {
      setExpandedIds((prev) => new Set(prev).add(parentId));
    }
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name || creatingParentId === undefined) {
      setCreatingParentId(undefined);
      return;
    }
    await onCreateFolder(name, creatingParentId);
    setCreatingParentId(undefined);
    setNewFolderName('');
  };

  const handleSubmitRename = async (e: React.FormEvent, id: string) => {
    e.preventDefault();
    const name = renameValue.trim();
    if (name) {
      await onRenameFolder(id, name);
    }
    setRenamingId(null);
  };

  const handleDropOnFolder = async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);

    const paperId = e.dataTransfer.getData('application/x-foxreader-paper-id');
    if (paperId) {
      await onMovePaperToFolder(paperId, targetFolderId);
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImportFiles(Array.from(e.dataTransfer.files), targetFolderId);
    }
  };

  const renderFolderNode = (node: FolderNode, depth: number) => {
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = node.children.length > 0;
    const isSelected = activeView === 'folder' && activeFolderId === node.id;
    const isDragOver = dragOverTarget === node.id;
    const count = folderCounts[node.id] ?? 0;

    return (
      <div key={node.id}>
        <div
          onClick={() => onSelectView('folder', node.id)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dragOverTarget !== node.id) setDragOverTarget(node.id);
          }}
          onDragLeave={() => {
            if (dragOverTarget === node.id) setDragOverTarget(null);
          }}
          onDrop={(e) => void handleDropOnFolder(e, node.id)}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          className={`group flex items-center gap-1 pr-1.5 py-1 rounded-md text-xs cursor-pointer transition ${
            isDragOver
              ? 'bg-violet-100 ring-1 ring-violet-400 text-violet-900'
              : isSelected
                ? 'bg-violet-50 text-violet-900 font-medium'
                : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(node.id);
            }}
            className={`p-0.5 rounded hover:bg-slate-200/60 ${hasChildren ? 'opacity-80' : 'opacity-0 pointer-events-none'}`}
          >
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>

          <FolderIcon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-violet-600' : 'text-slate-400'}`} />

          {renamingId === node.id ? (
            <form
              onSubmit={(e) => void handleSubmitRename(e, node.id)}
              className="flex-1 min-w-0"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => setRenamingId(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                className="w-full rounded border border-violet-400 bg-white px-1.5 py-0.5 text-xs focus:outline-none"
              />
            </form>
          ) : (
            <span className="flex-1 truncate">{node.name}</span>
          )}

          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              title="新建子文件夹"
              onClick={(e) => {
                e.stopPropagation();
                handleStartCreate(node.id);
              }}
              className="p-0.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              type="button"
              title="重命名"
              onClick={(e) => {
                e.stopPropagation();
                setRenamingId(node.id);
                setRenameValue(node.name);
              }}
              className="p-0.5 rounded hover:bg-slate-200 text-slate-500 hover:text-slate-800"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              type="button"
              title="删除文件夹"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDeleteFolder(node);
              }}
              className="p-0.5 rounded hover:bg-red-100 text-slate-500 hover:text-red-600"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>

          <span className="text-[10px] text-slate-400 tabular-nums shrink-0 group-hover:hidden">
            {count}
          </span>
        </div>

        {creatingParentId === node.id && (
          <form
            onSubmit={(e) => void handleSubmitCreate(e)}
            style={{ paddingLeft: `${24 + (depth + 1) * 14}px` }}
            className="pr-2 py-1"
          >
            <input
              autoFocus
              placeholder="子文件夹名称..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={() => setCreatingParentId(undefined)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setCreatingParentId(undefined);
              }}
              className="w-full rounded border border-violet-400 bg-white px-2 py-1 text-xs focus:outline-none"
            />
          </form>
        )}

        {isExpanded && node.children.map((child) => renderFolderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="w-80 shrink-0 border-r border-slate-200 bg-white flex flex-col h-full select-none">
      {/* Header */}
      <div className="h-12 px-3 border-b border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <img
            src={appIcon}
            alt="FoxReader"
            className="w-6 h-6 rounded-md shadow-xs object-cover"
          />
          <span className="font-semibold text-sm tracking-tight text-slate-900">FoxReader</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPickAndImport(activeView === 'folder' ? activeFolderId : null)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium transition shadow-2xs"
          >
            <FileUp className="w-3.5 h-3.5" />
            导入 PDF
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            title="数据目录设置"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Global Search */}
      <div className="p-2.5 border-b border-slate-100 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="搜索标题、作者、批注或笔记..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 pl-8 pr-7 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/25 focus:border-violet-500 transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onChangeSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Views + Folder Tree */}
      <div className="px-2 py-2 border-b border-slate-200 max-h-[38%] overflow-y-auto shrink-0 space-y-0.5">
        <button
          type="button"
          onClick={() => onSelectView('all', null)}
          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition ${
            activeView === 'all'
              ? 'bg-violet-50 text-violet-900 font-medium'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Library className={`w-3.5 h-3.5 ${activeView === 'all' ? 'text-violet-600' : 'text-slate-400'}`} />
          <span className="flex-1 text-left">全部论文</span>
          <span className="text-[10px] text-slate-400 tabular-nums">{totalCount}</span>
        </button>

        <div
          onClick={() => onSelectView('unclassified', null)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dragOverTarget !== '__unclassified__') setDragOverTarget('__unclassified__');
          }}
          onDragLeave={() => {
            if (dragOverTarget === '__unclassified__') setDragOverTarget(null);
          }}
          onDrop={(e) => void handleDropOnFolder(e, null)}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition ${
            dragOverTarget === '__unclassified__'
              ? 'bg-violet-100 ring-1 ring-violet-400 text-violet-900'
              : activeView === 'unclassified'
                ? 'bg-violet-50 text-violet-900 font-medium'
                : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Inbox
            className={`w-3.5 h-3.5 ${activeView === 'unclassified' ? 'text-violet-600' : 'text-slate-400'}`}
          />
          <span className="flex-1 text-left">未分类</span>
          <span className="text-[10px] text-slate-400 tabular-nums">{unclassifiedCount}</span>
        </div>

        <div className="pt-2 pb-1 px-2 flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">文件夹</span>
          <button
            type="button"
            title="新建根文件夹"
            onClick={() => handleStartCreate(null)}
            className="inline-flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-violet-700 px-1 py-0.5 rounded hover:bg-slate-100 transition"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>

        {creatingParentId === null && (
          <form onSubmit={(e) => void handleSubmitCreate(e)} className="px-2 py-1">
            <input
              autoFocus
              placeholder="输入文件夹名称后回车..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onBlur={() => setCreatingParentId(undefined)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setCreatingParentId(undefined);
              }}
              className="w-full rounded border border-violet-400 bg-white px-2 py-1 text-xs focus:outline-none"
            />
          </form>
        )}

        {folderTree.length === 0 && creatingParentId === undefined ? (
          <div className="px-2.5 py-1.5 text-[11px] text-slate-400">暂无文件夹，点击右上角创建</div>
        ) : (
          folderTree.map((node) => renderFolderNode(node, 0))
        )}

        {tags.length > 0 && (
          <div className="pt-2.5 px-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                <TagIcon className="w-3 h-3" />
                标签筛选
              </span>
              {activeTagId && (
                <button
                  type="button"
                  onClick={() => onSelectTag(null)}
                  className="text-[10px] text-violet-600 hover:underline"
                >
                  清除
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 pb-1">
              {tags.map((tag) => {
                const isSelected = activeTagId === tag.id;
                const count = tagCounts[tag.id] ?? 0;
                return (
                  <div
                    key={tag.id}
                    className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] cursor-pointer transition ${
                      isSelected
                        ? 'bg-violet-600 text-white border-violet-600'
                        : `${getTagChipClass(tag.color)} hover:brightness-95`
                    }`}
                    onClick={() => onSelectTag(isSelected ? null : tag.id)}
                  >
                    <span>#{tag.name}</span>
                    <span className={`text-[10px] tabular-nums ${isSelected ? 'text-violet-100' : 'opacity-65'}`}>
                      {count}
                    </span>
                    <button
                      type="button"
                      title="删除标签"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTag(tag);
                      }}
                      className="hidden group-hover:inline-flex items-center justify-center rounded-full hover:bg-black/15 p-0.5"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Status Filter & Batch Toggle */}
      <div className="px-2.5 py-2 border-b border-slate-100 flex items-center gap-1 shrink-0">
        {(['all', 'unread', 'reading', 'read'] as const).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => onChangeStatusFilter(st)}
            className={`flex-1 py-1 rounded text-[11px] font-medium transition ${
              statusFilter === st
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {st === 'all' ? '全部' : STATUS_LABEL[st]}
          </button>
        ))}
        {papers.length > 0 && (
          <button
            type="button"
            title={batchMode ? '退出批量管理' : '批量选择并删除论文'}
            onClick={() => (batchMode ? exitBatchMode() : setBatchMode(true))}
            className={`px-2 py-1 rounded text-[11px] font-medium transition shrink-0 ${
              batchMode
                ? 'bg-violet-600 text-white'
                : 'text-slate-500 hover:text-violet-700 hover:bg-violet-50'
            }`}
          >
            批量
          </button>
        )}
      </div>

      {/* Batch Action Bar */}
      {batchMode && papers.length > 0 && (
        <div className="px-2.5 py-1.5 border-b border-violet-200 bg-violet-50/80 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (allSelected) {
                setBatchSelectedIds(new Set());
              } else {
                setBatchSelectedIds(new Set(papers.map((p) => p.id)));
              }
            }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-900 hover:text-violet-700"
          >
            {allSelected ? (
              <CheckSquare className="w-3.5 h-3.5 text-violet-600" />
            ) : (
              <Square className="w-3.5 h-3.5 text-violet-500" />
            )}
            <span>全选 ({selectedBatchPapers.length}/{papers.length})</span>
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={selectedBatchPapers.length === 0}
              onClick={() => onRequestBatchDeletePapers(selectedBatchPapers, exitBatchMode)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-[11px] font-medium transition"
            >
              <Trash2 className="w-3 h-3" />
              删除 ({selectedBatchPapers.length})
            </button>
            <button
              type="button"
              onClick={exitBatchMode}
              className="px-2 py-1 rounded text-[11px] font-medium text-slate-600 hover:bg-white transition"
            >
              完成
            </button>
          </div>
        </div>
      )}

      {/* Paper List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {papers.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-8 text-slate-400">
            <p className="text-xs leading-relaxed">
              {searchQuery
                ? '未找到匹配的论文。'
                : '当前列表暂无论文，可点击「导入 PDF」或直接将 PDF 文件拖入窗口。'}
            </p>
          </div>
        ) : (
          papers.map((paper, idx) => {
            const isSelected = paper.id === selectedPaperId;
            const isChecked = batchSelectedIds.has(paper.id);
            return (
              <div
                key={paper.id}
                draggable={!batchMode}
                onDragStart={(e) => {
                  if (batchMode) return;
                  e.dataTransfer.setData('application/x-foxreader-paper-id', paper.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={(e) => {
                  if (batchMode) {
                    toggleBatchSelect(paper.id, idx, e.shiftKey);
                  } else {
                    onSelectPaper(paper.id);
                  }
                }}
                className={`group rounded-lg border px-2.5 py-2 cursor-pointer transition ${
                  batchMode
                    ? isChecked
                      ? 'border-violet-300 bg-violet-50/70'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                    : isSelected
                      ? 'border-violet-300 bg-violet-50/70 shadow-2xs'
                      : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0 flex-1">
                    {batchMode && (
                      <span className="mt-0.5 shrink-0">
                        {isChecked ? (
                          <CheckSquare className="w-3.5 h-3.5 text-violet-600" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </span>
                    )}
                    <h4
                      className={`text-xs leading-snug line-clamp-2 ${
                        isSelected && !batchMode ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'
                      }`}
                      title={paper.title}
                    >
                      {paper.title}
                    </h4>
                  </div>
                  {!batchMode && (
                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        title="编辑元数据"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditPaper(paper);
                        }}
                        className="p-1 rounded hover:bg-slate-200/80 text-slate-500 hover:text-slate-800"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        title="删除论文"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDeletePaper(paper);
                        }}
                        className="p-1 rounded hover:bg-red-100 text-slate-500 hover:text-red-600"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span className="truncate">
                    {paper.authors || paper.fileName}
                    {paper.year ? ` · ${paper.year}` : ''}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {paper.fileType === 'md' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        MD
                      </span>
                    )}
                    {paper.pageCount > 0 && (
                      <span className="text-[10px] text-slate-400 tabular-nums">{paper.pageCount}p</span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_BADGE[paper.status]}`}>
                      {STATUS_LABEL[paper.status]}
                    </span>
                  </div>
                </div>

                {paper.tags.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {paper.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className={`inline-flex items-center rounded border px-1.5 py-0 text-[10px] ${getTagChipClass(tag.color)}`}
                      >
                        #{tag.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

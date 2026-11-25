import React, { useMemo, useState } from 'react';
import {
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
  Trash2,
  X,
} from 'lucide-react';
import type { Folder, LibraryView, Paper, PaperStatus } from '../../shared/types';

const STATUS_LABEL: Record<PaperStatus, string> = {
  unread: '未读',
  reading: '在读',
  read: '已读',
};

const STATUS_BADGE: Record<PaperStatus, string> = {
  unread: 'bg-slate-100 text-slate-600',
  reading: 'bg-amber-100 text-amber-800',
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
  totalCount: number;
  unclassifiedCount: number;
  papers: Paper[];
  activeView: LibraryView;
  activeFolderId: string | null;
  statusFilter: PaperStatus | 'all';
  searchQuery: string;
  selectedPaperId: string | null;
  onSelectView: (view: LibraryView, folderId?: string | null) => void;
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
  onOpenSettings: () => void;
}

export function LeftSidebar({
  folders,
  folderCounts,
  totalCount,
  unclassifiedCount,
  papers,
  activeView,
  activeFolderId,
  statusFilter,
  searchQuery,
  selectedPaperId,
  onSelectView,
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
  onOpenSettings,
}: LeftSidebarProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [creatingParentId, setCreatingParentId] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

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
              ? 'bg-amber-100 ring-1 ring-amber-400 text-amber-900'
              : isSelected
                ? 'bg-amber-50 text-amber-900 font-medium'
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

          <FolderIcon className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-amber-600' : 'text-slate-400'}`} />

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
                className="w-full rounded border border-amber-400 bg-white px-1.5 py-0.5 text-xs focus:outline-none"
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
              className="w-full rounded border border-amber-400 bg-white px-2 py-1 text-xs focus:outline-none"
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
          <div className="w-6 h-6 rounded-md bg-amber-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
            F
          </div>
          <span className="font-semibold text-sm tracking-tight text-slate-900">FoxReader</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPickAndImport(activeView === 'folder' ? activeFolderId : null)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium transition shadow-2xs"
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
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 pl-8 pr-7 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/25 focus:border-amber-500 transition"
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
              ? 'bg-amber-50 text-amber-900 font-medium'
              : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Library className={`w-3.5 h-3.5 ${activeView === 'all' ? 'text-amber-600' : 'text-slate-400'}`} />
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
              ? 'bg-amber-100 ring-1 ring-amber-400 text-amber-900'
              : activeView === 'unclassified'
                ? 'bg-amber-50 text-amber-900 font-medium'
                : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Inbox
            className={`w-3.5 h-3.5 ${activeView === 'unclassified' ? 'text-amber-600' : 'text-slate-400'}`}
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
            className="inline-flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-amber-700 px-1 py-0.5 rounded hover:bg-slate-100 transition"
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
              className="w-full rounded border border-amber-400 bg-white px-2 py-1 text-xs focus:outline-none"
            />
          </form>
        )}

        {folderTree.length === 0 && creatingParentId === undefined ? (
          <div className="px-2.5 py-1.5 text-[11px] text-slate-400">暂无文件夹，点击右上角创建</div>
        ) : (
          folderTree.map((node) => renderFolderNode(node, 0))
        )}
      </div>

      {/* Status Filter */}
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
      </div>

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
          papers.map((paper) => {
            const isSelected = paper.id === selectedPaperId;
            return (
              <div
                key={paper.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-foxreader-paper-id', paper.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => onSelectPaper(paper.id)}
                className={`group rounded-lg border px-2.5 py-2 cursor-pointer transition ${
                  isSelected
                    ? 'border-amber-300 bg-amber-50/70 shadow-2xs'
                    : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4
                    className={`text-xs leading-snug line-clamp-2 ${
                      isSelected ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'
                    }`}
                    title={paper.title}
                  >
                    {paper.title}
                  </h4>
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
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span className="truncate">
                    {paper.authors || paper.fileName}
                    {paper.year ? ` · ${paper.year}` : ''}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {paper.pageCount > 0 && (
                      <span className="text-[10px] text-slate-400 tabular-nums">{paper.pageCount}p</span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_BADGE[paper.status]}`}>
                      {STATUS_LABEL[paper.status]}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

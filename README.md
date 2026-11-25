# FoxReader

**FoxReader** 是一款纯本地运行的开源桌面端 PDF 论文管理与阅读批注工具，聚焦轻量、离线可控与数据零锁定体验。

> Pure-local offline desktop PDF paper manager and reader with out-of-band annotations.

## 核心特性

- **纯本地离线运行**：无需账号、不依赖任何云端服务，启动即用。
- **原文件只读不改写**：托管原始 PDF 副本，所有批注、高亮归一化坐标、备注与 Markdown 笔记均外置存储在结构化本地目录中，避免破坏加密或非标准编码的学术 PDF。
- **单目录可迁移（支持 OneDrive 多机接力同步）**：所有数据集中于可自定义路径的 `FoxReaderData/` 目录（仅需同步该目录，无需同步程序源码）；内置 SQLite 单文件 `DELETE` 日志模式与 `.foxreader.lock` 占用锁提示，避免网盘冲突副本。
- **统一三栏工作台**：左栏论文库与多级文件夹树、中栏连续纵向懒渲染 PDF 阅读视口、右栏批注与笔记面板（左右栏均支持一键折叠）。

## 数据目录结构

```text
FoxReaderData/
├── library.db                # SQLite 数据库（元数据、目录树、批注、笔记、FTS5 索引）
├── pdfs/
│   └── <sha256>.pdf          # 托管原始 PDF，只读不改写
└── snapshots/
    └── <annotation_id>.png   # 图表/公式区域框选截取的 PNG 缩略图
```

## 路线图（Milestones）

- **M1（工程骨架与论文库/基础阅读闭环）**：Electron + React + TS + Vite + Tailwind 工程搭建、SQLite 建表与 IPC、三栏可折叠布局、多级文件夹树、SHA-256 去重导入、拖拽归档、元数据编辑、基于 `pdfjs-dist` 的连续滚动与视口懒渲染阅读器。
- **M2（核心批注与双向定位闭环）**：双栏选区矩形清洗、多色文本高亮、公式/图表区域框选截图、右栏批注列表与 PDF ↔ 批注双向定位。
- **M3（笔记、全文检索与收尾打磨）**：整篇 Markdown 总结笔记（编辑/预览与防抖保存）、标签体系、FTS5 全局检索、页内 `Ctrl+F` 搜索与打包自检。
- **P1（延后增强）**：多标签对比阅读、PDF 内置目录大纲、导出带批注 PDF / 批量 Markdown、DOI / arXiv 元数据自动抓取。

详细产品规格与表结构设计请参阅 [docs/PRD.md](./docs/PRD.md)。

## 技术栈

- **桌面端框架**：Electron
- **前端界面**：React + TypeScript + Vite + Tailwind CSS
- **PDF 渲染**：`pdfjs-dist`
- **本地数据库**：SQLite（基于 Electron 主进程内置 `node:sqlite`，支持 FTS5 与单文件 `DELETE` 模式，免原生 C++ 编译依赖）

## 本地开发与构建

前置环境：Node.js 22+（推荐 v24+）。Windows PowerShell 若限制 `.ps1` 执行策略，请使用 `npm.cmd`。

```bash
# 安装依赖
npm.cmd install

# 启动开发环境（Vite + Electron）
npm.cmd run dev

# 运行自动化测试与类型检查
npm.cmd run test:selection
npm.cmd run test:db
npm.cmd run typecheck

# 生产构建与 Windows 安装包 / 绿色便携版打包（输出至 release/）
npm.cmd run build
npm.cmd run dist:win
```

### 多机网盘同步建议（OneDrive / 坚果云）

1. 在各台电脑安装/运行 FoxReader 后，点击左栏右上角设置图标，将「数据目录」均指向网盘内的同一个 `FoxReaderData/` 文件夹。
2. 遵循「单设备使用完退出并等待网盘同步完成 → 另一台设备再打开」的接力原则；若存在未释放的 `.foxreader.lock`，启动时会自动弹窗提醒。

## 分支策略

- `main`：稳定发布基线分支，不直接提交未验证的开发代码。
- `dev`：主开发集成分支，里程碑功能在 `dev`（或基于 `dev` 切出的特性分支）推进并验证后合入 `main`。

更多协作规范请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，版本变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。

<p align="center">
  <img src="./build/icon.png" alt="FoxReader Logo" width="96" height="96" />
</p>

<h1 align="center">FoxReader</h1>

<p align="center">
  纯本地离线运行的桌面端 PDF 论文管理与阅读批注工具（MIT 开源）
</p>

<p align="center">
  <a href="https://github.com/minorfox/FoxReader/releases"><img src="https://img.shields.io/badge/Release-v0.1.0-7c3aed" alt="Release v0.1.0" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" /></a>
</p>

---

**FoxReader** 对标早期轻量版 ReadPaper 的核心体验，专为反感云端账号绑定与订阅制、又觉得重型文献插件繁琐的研究者打造：**纯本地离线、原 PDF 只读不改写、单目录即可完成备份与多机同步**。

## 核心特性

- **纯本地离线运行**：无需账号、不依赖任何云端服务，开箱即用。
- **原文件只读不改写**：托管原始 PDF 副本，所有批注、高亮归一化坐标、备注、区域截图与 Markdown 笔记均外置存储在结构化本地目录中，避免破坏加密或非标准编码的学术 PDF。
- **完整中文 / 双栏学术 PDF 支持**：内置 `pdfjs-dist` CMap 与标准字体资源，支持双栏选区清洗（不跨栏错乱）、五色文本高亮、公式/图表区域框选截图（`Alt + 拖拽`）、PDF ↔ 批注双向定位与页内 `Ctrl+F` 搜索。
- **整篇笔记与全局全文检索**：每篇论文独立配备支持编辑/预览的 Markdown 笔记（500ms 防抖自动保存），并通过 SQLite FTS5 + 中文子串检索同时检索标题、作者、标签、高亮摘录、单条备注与整篇笔记。
- **单目录可迁移（支持 OneDrive 多机接力同步）**：所有数据集中于可自定义路径的 `FoxReaderData/` 目录（仅需同步该目录，无需同步程序源码）；内置 SQLite 单文件 `DELETE` 日志模式与 `.foxreader.lock` 占用锁提醒，避免网盘冲突副本。

## 下载与安装（开箱即用）

前往 [GitHub Releases](https://github.com/minorfox/FoxReader/releases) 下载对应平台安装包（由 [GitHub Actions](./.github/workflows/release.yml) 基于公开源码自动构建，并附带 `SHA256SUMS-*.txt` 校验文件）：

- **Windows（x64）**：
  - 安装版：`FoxReader Setup 0.1.0.exe`
  - 绿色免安装版：`FoxReader 0.1.0.exe`
  - > **Windows SmartScreen 提示说明**：个人开源项目未购买商业代码签名证书，首次运行若弹出「Windows 已保护你的电脑」，点击 **「更多信息 → 仍要运行」** 即可（也可在 Release 页核对 SHA-256 校验值）。
- **macOS（Apple Silicon / Intel）**：
  - 安装镜像：`FoxReader-0.1.0-arm64.dmg` / `FoxReader-0.1.0.dmg`
  - > 若 macOS 提示未签名应用无法打开，可执行：`xattr -cr /Applications/FoxReader.app` 后再打开。

## 数据目录结构

```text
FoxReaderData/
├── library.db                # SQLite 数据库（元数据、目录树、批注、笔记、FTS5 索引）
├── pdfs/
│   └── <sha256>.pdf          # 托管原始 PDF，只读不改写
└── snapshots/
    └── <annotation_id>.png   # 图表/公式区域框选截取的 PNG 缩略图
```

### 多机网盘同步建议（OneDrive / 坚果云）

1. 在各台电脑安装/运行 FoxReader 后，点击左栏右上角设置图标，将「数据目录」均指向网盘内的同一个 `FoxReaderData/` 文件夹。
2. 遵循「单设备使用完退出并等待网盘同步完成 → 另一台设备再打开」的接力原则；若存在未释放的 `.foxreader.lock`，启动时会自动弹窗提醒。

## 路线图（Milestones）

- [x] **M1（工程骨架与论文库/基础阅读闭环）**：Electron + React + TS + Vite + Tailwind 工程搭建、SQLite 建表与 IPC、三栏可折叠布局、多级文件夹树、SHA-256 去重导入、拖拽归档、元数据编辑、连续滚动与视口懒渲染阅读器。
- [x] **M2（核心批注与双向定位闭环）**：双栏选区矩形清洗、五色文本高亮、公式/图表区域框选截图、右栏批注列表与 PDF ↔ 批注双向定位。
- [x] **M3（笔记、全文检索与收尾打磨）**：整篇 Markdown 总结笔记、标签体系、FTS5 全局检索、页内 `Ctrl+F` 搜索、OneDrive 单文件安全模式与 Windows/macOS 自动打包。
- [ ] **P1（后续增强）**：多标签对比阅读、PDF 内置目录大纲（Outline）、导出带批注 PDF / 批量 Markdown、DOI / arXiv 元数据自动抓取。

详细产品规格与表结构设计请参阅 [docs/PRD.md](./docs/PRD.md)。

## 技术栈

- **桌面端框架**：Electron
- **前端界面**：React + TypeScript + Vite + Tailwind CSS
- **PDF 渲染**：`pdfjs-dist`（legacy 构建 + CMap/标准字体离线资源）
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

# 生产构建与本地打包（输出至 release/）
npm.cmd run build
npm.cmd run dist:win
```

## 分支策略

- `main`：稳定发布分支，仅保留经过完整验证的发布版本（如 `v0.1.0`）。
- `dev`：主开发集成分支，新功能与修复在 `dev` 推进并验证后合入 `main`。

更多协作规范请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，版本变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 开源协议

本项目基于 [MIT License](./LICENSE) 开源。

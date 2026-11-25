# FoxReader — 产品需求与架构设计文档（MVP v0.1）

## 1. 产品定位与范围边界

### 1.1 产品定位
**FoxReader** 是一款纯本地运行的桌面端 PDF 论文管理与阅读批注工具，对标早期轻量版 ReadPaper 的核心体验：
- **纯本地离线运行**：无需账号、不依赖云端服务。
- **原文件只读不改写**：托管原始 PDF 副本，所有批注、高亮坐标、备注与笔记均外置存储在结构化的本地目录中，避免破坏加密或非标准编码的学术 PDF。
- **单目录可迁移**：所有数据集中在一个可自定义位置的 `FoxReaderData/` 目录中，直接放入 OneDrive / 坚果云 / Git 即可完成备份与多机同步。

### 1.2 范围边界（MVP v0.1 vs P1 延后）

| 优先级 | 模块 | 包含内容 |
| :--- | :--- | :--- |
| **MVP (v0.1)** | 桌面工作台 | 统一三栏工作台（左右两栏均支持一键折叠） |
| **MVP (v0.1)** | 论文库与文件夹 | 多级嵌套文件夹树（单归属）、标签筛选、阅读状态、全局全文检索、SHA-256 去重导入、拖拽归档、元数据编辑 |
| **MVP (v0.1)** | PDF 阅读与批注 | 连续纵向滚动、视口懒渲染、缩放与适应宽度、阅读进度记忆、页内查找（`Ctrl+F`）、多色文本划线高亮、图表/公式区域框选与截图 |
| **MVP (v0.1)** | 批注与笔记 | 批注列表（颜色/类型筛选、内联备注自动保存、PDF ↔ 批注双向定位）、单篇独立 Markdown 总结笔记（编辑/预览、自动保存） |
| **P1（延后）** | 进阶效率 | 多标签页同时对比阅读、PDF 内置目录大纲（Outline）侧栏、导出带批注 PDF、批量导出 Markdown、笔记内页码跳转链接、DOI / arXiv 元数据自动抓取 |

---

## 2. 界面与交互规格（统一三栏工作台）

主窗口采用「左—中—右」三栏布局，左栏与右栏均支持一键折叠，以便专注阅读时最大化 PDF 视口。

### 2.1 左栏：论文库与文件夹管理
- **全局搜索框**：位于顶部，一个输入框同时检索论文标题、作者、标签、高亮摘录文本、单条备注以及整篇 Markdown 笔记。
- **固定视图与筛选**：
  - `全部论文`、`未分类`（无文件夹归属的论文）。
  - 阅读状态筛选：`未读` / `在读` / `已读`。
  - 标签筛选：按标签过滤当前视图下的论文。
- **多级文件夹树（单归属模型）**：
  - 1 篇论文最多归属 1 个文件夹（未归类则属于 `未分类`）；交叉分类通过标签实现。
  - 支持新建根文件夹、新建子文件夹、重命名、删除文件夹。
  - **删除文件夹保护规则**：删除文件夹绝不删除论文文件本身；该文件夹及其子文件夹下的论文自动移回 `未分类`（删除前弹窗提示确认）。
  - 支持在列表内拖拽论文到目标文件夹完成归档。
- **论文导入、去重与管理**：
  - 支持文件选择按钮或直接拖拽单个/多个 PDF 到窗口导入（拖放到指定文件夹节点上时直接归入该文件夹）。
  - **SHA-256 去重**：导入前计算文件哈希，若库中已存在则提示并直接定位打开，不重复存储副本。
  - **元数据与状态**：导入时尝试提取 PDF 内置标题（缺失则回退为文件名），支持编辑标题、作者、年份、阅读状态与多标签。
  - **删除论文**：需二次确认，确认后同步清理数据库记录、托管 PDF 文件及关联的区域截图。

### 2.2 中栏：PDF 阅读主视口与双模式批注
- **顶部轻量工具条**：
  - 左栏折叠开关
  - 页码跳转（`当前页 / 总页数`，支持直接输入页码回车跳转）
  - 缩放控制（`-` / 百分比显示与预设 / `+` / `适应宽度`）
  - **批注模式切换**：`文本划选` / `区域框选`（支持按住 `Alt + 拖拽` 快速触发区域框选）
  - 页内文本查找（`Ctrl+F`）
  - 右栏折叠开关
- **阅读与性能**：
  - 连续纵向滚动，自动记忆每篇论文上次关闭时的 `last_page` 与 `last_zoom`。
  - 使用 `IntersectionObserver` 进行视口窗口化渲染，仅渲染可见区域 ±2 页的 Canvas，离屏释放画布但保留准确占位高度，防止长论文内存膨胀与滚动跳动。
- **文本多色划线高亮**：
  - 在文本模式下划选文字，松开鼠标后弹出轻量悬浮条：
    - 5 种固定高亮色（黄 / 绿 / 蓝 / 粉 / 紫）
    - 「高亮并写备注」（生成高亮并自动聚焦右侧对应备注框）
    - 「复制」
  - 坐标以相对单页容器宽高的归一化比例 `[x, y, w, h] ∈ [0, 1]` 存储，确保缩放或切换高分屏时不偏移。
- **图表 / 公式区域框选高亮**：
  - 切换至「区域框选」模式或按住 `Alt + 拖拽`，可在公式、图表等非文本区域拉出矩形高亮框。
  - 松开后自动从当前页渲染 Canvas 中裁剪出对应区域 PNG 缩略图保存至 `snapshots/`，同时右侧批注栏自动聚焦到新生成卡片的备注输入框。
- **点击 PDF 批注与双向定位**：
  - 点击 PDF 页面上已有的文本高亮或区域框选 → 弹出轻量浮窗（支持修改颜色、删除批注），同时右侧自动切换至「批注与备注」Tab，滚动并高亮对应的批注卡片。

### 2.3 右栏：批注列表与整篇笔记
右栏包含两个 Tab：

- **Tab 1：批注与备注**
  - 按 `page_number` 升序排列，同页按纵向坐标 `y` 升序排列。
  - 支持按高亮颜色筛选、按「仅看有备注 / 区域框选」过滤。
  - 每条卡片包含：色标、页码徽章（如 `P.4`）、摘录文本（或区域框选 PNG 缩略图）、内联备注输入框（防抖自动保存）、一键复制摘录、删除按钮。
  - **双向定位**：点击任意批注卡片，中栏 PDF 自动平滑滚动至对应页码与位置，并触发短暂的脉冲高亮动画提示。

- **Tab 2：整篇笔记**
  - 当前论文专属的 Markdown 笔记编辑器。
  - 支持「编辑 / 预览」切换，以及 500ms 防抖自动保存。

---

## 3. 本地数据存储与表结构设计

### 3.1 数据目录结构
默认位于系统用户数据目录下，支持配置切换数据目录路径：

```text
FoxReaderData/
├── library.db                # SQLite 数据库（元数据、目录树、批注、笔记、FTS5 索引）
├── pdfs/
│   └── <sha256>.pdf          # 托管原始 PDF，只读不改写
└── snapshots/
    └── <annotation_id>.png   # 图表/公式区域框选截取的 PNG 缩略图
```

### 3.2 SQLite 数据库表结构

1. **`folders`（文件夹树）**
   - `id` (TEXT / INTEGER PK)
   - `name` (TEXT NOT NULL)
   - `parent_id` (TEXT / INTEGER NULL, FK -> `folders.id`)
   - `sort_order` (INTEGER NOT NULL DEFAULT 0)
   - `created_at` (INTEGER NOT NULL)

2. **`papers`（论文主表）**
   - `id` (TEXT / INTEGER PK)
   - `sha256` (TEXT UNIQUE NOT NULL)
   - `title` (TEXT NOT NULL)
   - `authors` (TEXT DEFAULT '')
   - `year` (INTEGER NULL)
   - `folder_id` (TEXT / INTEGER NULL, FK -> `folders.id` ON DELETE SET NULL)
   - `status` (TEXT NOT NULL DEFAULT 'unread' — `'unread' | 'reading' | 'read'`)
   - `page_count` (INTEGER NOT NULL DEFAULT 0)
   - `last_page` (INTEGER NOT NULL DEFAULT 1)
   - `last_zoom` (REAL NOT NULL DEFAULT 1.0)
   - `file_name` (TEXT NOT NULL)
   - `created_at` (INTEGER NOT NULL)
   - `updated_at` (INTEGER NOT NULL)

3. **`tags` & `paper_tags`（标签与多对多关联）**
   - `tags`: `id` (PK), `name` (TEXT UNIQUE NOT NULL), `color` (TEXT DEFAULT '')
   - `paper_tags`: `paper_id` (FK -> `papers.id` ON DELETE CASCADE), `tag_id` (FK -> `tags.id` ON DELETE CASCADE), `PRIMARY KEY (paper_id, tag_id)`

4. **`annotations`（文本高亮与区域框选）**
   - `id` (TEXT PK)
   - `paper_id` (FK -> `papers.id` ON DELETE CASCADE)
   - `type` (TEXT NOT NULL — `'text' | 'area'`)
   - `page_number` (INTEGER NOT NULL)
   - `rects_json` (TEXT NOT NULL — 归一化坐标数组 `[{ x, y, w, h }]`，取值范围 `[0, 1]`)
   - `color` (TEXT NOT NULL)
   - `quote_text` (TEXT DEFAULT '')
   - `snapshot_path` (TEXT DEFAULT '')
   - `comment` (TEXT DEFAULT '')
   - `created_at` (INTEGER NOT NULL)
   - `updated_at` (INTEGER NOT NULL)

5. **`paper_notes`（整篇论文 Markdown 笔记）**
   - `paper_id` (PK, FK -> `papers.id` ON DELETE CASCADE)
   - `content_md` (TEXT NOT NULL DEFAULT '')
   - `updated_at` (INTEGER NOT NULL)

6. **`search_fts`（FTS5 全文搜索虚拟表）**
   - 索引论文与批注/笔记文本内容，覆盖：`title`、`authors`、`tags`、`quote_text`、`comment`、`content_md`，支持在左栏全局搜索框快速定位命中论文与匹配片段。

---

## 4. 技术栈与工程风险规避

### 4.1 技术选型
- **桌面框架**：Electron（当前主机已具备 Node.js v24，零额外原生工具链前置依赖；Chromium 内核下 PDF 字体与文本层渲染稳定性最佳）
- **前端栈**：React + TypeScript + Vite + Tailwind CSS
- **PDF 引擎**：`pdfjs-dist`
- **本地存储**：SQLite（主进程管理读写与文件系统操作，通过 IPC 暴露类型安全 API 给渲染进程）

### 4.2 必须提前规避的 3 个工程风险

1. **Windows 下 SQLite 原生模块编译风险**
   - 目标开发机未安装 Rust，且可能缺少 Visual Studio C++ Build Tools，`better-sqlite3` 若无匹配当前 Electron ABI 的预编译二进制容易导致构建失败。
   - **规避方案**：初始化工程时优先验证 `better-sqlite3` 预编译二进制是否与选定 Electron 版本直接兼容；若需要本地 C++ 编译且环境不具备，则直接切换为零编译方案（如 `sql.js` + 原子写盘持久化或免编译 SQLite 驱动），不在环境排障上空耗时间。

2. **双栏学术 PDF 的 `getClientRects()` 选区噪点**
   - 浏览器原生的 `Range.getClientRects()` 在双栏排版和数学符号密集的 PDF 文本层中，常返回大量碎片重叠框甚至跨栏幽灵矩形。
   - **规避方案**：在生成高亮前，对选区矩形执行三步清洗：
     1. 按单页文本层容器边界裁剪并过滤面积异常的噪点矩形；
     2. 仅对同一文本行内（垂直中心与高度相近）且水平相邻/重叠的矩形做合并；
     3. 将最终矩形换算为相对单页容器的 `[0, 1]` 归一化坐标后落库。

3. **长论文渲染内存膨胀**
   - 数十页乃至上百页论文若一次性渲染全部 Canvas，会快速耗尽渲染进程内存并导致卡顿。
   - **规避方案**：每页容器根据 PDF 页面原始宽高比与当前缩放比例预先算出精确占位尺寸；通过 `IntersectionObserver` 仅对当前视口上下 ±2 页执行 `pdf.js` 渲染与文本层挂载，离开缓冲区的页面销毁 Canvas 释放显存但保持占位高度不变。

---

## 5. 分阶段实现里程碑

- **M1：工程骨架与论文库/基础阅读闭环**
  - Electron + React + TS + Vite + Tailwind 工程搭建与数据目录初始化
  - SQLite 数据库建表与 IPC 通信封装
  - 统一三栏可折叠框架、文件夹树 CRUD、拖拽导入 PDF（SHA-256 去重）、论文列表与基础元数据管理
  - 基于 `pdfjs-dist` 的连续滚动、视口懒渲染、缩放与页码跳转
- **M2：核心批注与双向定位闭环**
  - 双栏选区清洗算法 + 多色文本高亮 + 悬浮操作条（选色 / 高亮并备注 / 复制）
  - 公式/图表区域框选（模式切换 + `Alt + 拖拽`）及 Canvas 裁剪 PNG 缩略图落盘
  - 右栏「批注与备注」Tab（筛选、内联备注防抖保存、删除、修改颜色）
  - PDF 高亮 ↔ 右侧批注卡片双向点击跳转与脉冲提示动画
- **M3：笔记、全文检索与收尾打磨**
  - 右栏「整篇笔记」Markdown 编辑器（编辑/预览切换、500ms 防抖保存）
  - 标签体系与阅读状态筛选
  - FTS5 全局检索 + PDF 页内 `Ctrl+F` 搜索
  - 阅读进度（`last_page` / `last_zoom`）记忆与端到端打包自检

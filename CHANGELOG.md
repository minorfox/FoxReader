# Changelog

All notable changes to **FoxReader** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Normalized Windows NSIS and portable `artifactName` in `package.json` (`FoxReader.Setup.${version}.${ext}` / `FoxReader.${version}.${ext}`) so `SHA256SUMS.txt` matches GitHub Release asset filenames, and added space-to-dot fallback normalization in `parseSha256Sums`.

## [0.3.0] - 2026-11-26

### Added

- PDF built-in Outline (TOC) drawer with search filtering and lazy page resolution + caching in `PdfReader`.
- Academic metadata enrichment across arXiv API, OpenAlex, and Crossref (persisting `doi`, `arxivId`, `venue`, and official/synthesized `bibtex`), plus 1-click BibTeX copy on paper cards/right sidebar/metadata modal and batch `.bib` export with automatic citation key deduplication.
- Clickable `[P.12]` / `[第12页]` / `[label](#page=12)` page-jump links in Paper Notes preview and a 1-click `+ P.{page}` insert button while editing.
- Folder tree movement via drag-and-drop (drop onto target folders or onto the `文件夹` header to promote to top level) and a 1-click `移到上一级` hover button on nested folders, with cycle prevention.

### Improved

- Added fullscreen toggle (`Maximize` / `Minimize`, synced live with `F11` and OS fullscreen events) and fallback Settings gear access when the left sidebar is collapsed in `PdfReader`/`MarkdownReader`, decluttered the right-sidebar `文献信息` card header, and added a subtle top window border line.
- Removed duplicate `FoxReader` branding from the left sidebar and merged the header and global search into a single unified `导入 + 搜索 + 设置` top bar, while syncing the native window title bar dynamically to the active paper title.
- Removed the native window menu bar on Windows/Linux (`win.removeMenu()` + `Menu.setApplicationMenu(null)`), preventing `Alt+drag` PDF area selection from triggering menu focus while preserving `F11` fullscreen, `Ctrl+,` settings, and `Ctrl+O` import shortcuts; unified data-directory shortcuts (`pdfs/`), update checks, and GitHub link in the sidebar Settings button and `SettingsModal`, while keeping a localized Chinese system menu on macOS.
- Added atomic temporary-file copy during document import to prevent cloud sync clients from picking up half-written files, automatic managed-file repair when re-importing a duplicate paper whose local file is missing/empty, main-process file health diagnostics (`missing`, `.icloud` placeholder, `0`-byte), and 1-click SHA-256-verified original file relinking with retry/open-directory actions in the PDF and Markdown readers.

### Fixed

- Markdown documents in `MarkdownReader` now automatically transition from `在读` to `已读` when scrolled to the bottom (or after a brief dwell for single-screen documents).
- Parent folders now aggregate recursive paper counts from all descendant subfolders and list descendant papers when selected.

## [0.2.3] - 2026-11-26

### Added

- In-app update download with progress tracking and SHA-256 verification against `SHA256SUMS.txt`: Windows NSIS installer supports 1-click silent update (`/S`) and automatic relaunch after closing SQLite/lock; Windows portable `.exe` prompts close-before-replace and locates the verified update before quitting; macOS selects and opens the architecture-matched `.dmg`.

## [0.2.2] - 2026-11-25

### Added

- Automatic reading status progression (`未读` -> `在读` on open, `在读` -> `已读` when reaching the final PDF page) plus 1-click status cycling on left sidebar cards and reader top toolbars.

### Performance

- Added HTTP byte-range (`206 Partial Content`) streaming for `foxpdf://paper/` and in-memory `foxpdf://assets/` caching in the main process.
- Removed eager full-document page scanning on load, tightened lazy render window to `currentPage ± 1` with `page.cleanup()`, capped Retina canvas DPR scaling (`<= 2x` / `<= 1.5x` above 150% zoom), and serialized background metadata extraction after initial page render.
- Hardened `foxpdf://` protocol handle lifecycle for Windows and macOS: short byte-range PDF slices close file handles immediately before returning `206`, full stream responses destroy cleanly on request abort (preventing Windows `EBUSY` locks), and `foxpdf://snapshot/` reads directly without `net.fetch(file://)`.

### Fixed

- Kept `pdfjs-dist/legacy/build/pdf.mjs` for Electron 39 (Chromium 142) compatibility where `Map.prototype.getOrInsertComputed` is unavailable, and added an Electron 39 runtime PDF rendering smoke test in `scripts/test-db.mjs`.

## [0.2.1] - 2026-11-25

### Added

- Read-only **Markdown** (`.md` / `.markdown`) document support: import/drag-drop alongside PDFs with automatic frontmatter/H1 metadata extraction, FTS5 full-text indexing, dedicated `MarkdownReader` (`remark-gfm` + `remark-math` / KaTeX math rendering, font zoom, `Ctrl+F` search, and selection copy/translation without PDF highlight overlays).

## [0.2.0] - 2026-11-25

### Added

- Batch paper selection (including `Shift + Click` range selection and Select All) and batch deletion in the left library sidebar.
- Automatic 3-tier PDF Page-1 title, author, affiliation, year, and DOI extraction on import (with offline re-extraction), replacing raw filenames with real paper titles while filtering publisher chrome and dirty metadata.
- Right-sidebar collapsible **「作者与机构」** card displaying clickable author and institution search chips (`affiliations` stored in SQLite + FTS5/CJK search with automatic schema migration) and an optional **「联网补全」** OpenAlex lookup button.
- Manual **「检查更新」** check in Settings (`SettingsModal`) querying GitHub Releases without auto-downloading binaries or breaking offline-first defaults.
- On-demand **selection translation** (`翻译` button with `ArrowUpDown` icon in the text selection bar), cleaning hyphenated PDF line breaks and translating via Youdao (with MyMemory fallback), supporting phonetic/explains preview, copy, and one-click save into highlight comments.

### Fixed

- Fixed opaque white outer background on Windows `.ico` (`build/icon.ico`) and renderer PNG (`src/renderer/assets/icon.png`) caused by non-premultiplied zero-alpha RGB bytes during icon downscaling in `scripts/generate-icons.mjs`, and tightened icon outer padding to ~3.5% per side.

## [0.1.0] - 2026-11-25

### Added (Release & Polish)

- Custom stylized fox-reading-paper desktop app icon (`build/icon.png`, `build/icon.ico`, `src/renderer/assets/icon.png`) embedded in Windows/macOS builds and UI header.
- GitHub Actions automated release workflow (`.github/workflows/release.yml`) building Windows (`.exe`) and macOS (`.dmg`/`.zip`) artifacts with SHA-256 checksums on version tags, plus GitHub Issue templates.

### Added (M3)

- Per-paper **Markdown summary notes** editor in the right sidebar (`整篇笔记` tab) with Edit/Preview toggle (`react-markdown` + `remark-gfm`) and 500ms debounced auto-save indexed by FTS5.
- **Tags system** (`tags`, `paper_tags`) with tag assignment in Metadata Modal, left sidebar tag pills with counts, tag filtering, deletion, and FTS5 indexing.
- **In-PDF `Ctrl+F` search** floating bar with full-document text scanning, match count (`i / N`), Prev/Next (`Shift+Enter` / `Enter`), and non-destructive highlight overlays.
- **Scenario B OneDrive sync hardening**: switched SQLite to `DELETE` journal mode (`PRAGMA wal_checkpoint(TRUNCATE)` + `PRAGMA journal_mode = DELETE`) to avoid lingering `-wal`/`-shm` files, and added `.foxreader.lock` multi-device occupancy warning modal.
- **Windows desktop packaging**: configured `electron-builder` (`npm.cmd run dist:win`) bundling `pdfjs-dist` CMaps/fonts/WASM/ICC via `extraResources` into NSIS installer and Portable `.exe`.

### Added (M2)

- Two-column PDF `Range.getClientRects()` cleaning & normalization (`[0, 1]`) for accurate text highlights (`src/renderer/lib/selection.ts`).
- 5-color text highlight floating bar (`yellow`, `green`, `blue`, `pink`, `purple`), "Highlight & Comment", and copy actions.
- Area box selection mode & `Alt + Drag` shortcut cropping rendered HiDPI canvas regions into `FoxReaderData/snapshots/<id>.png`.
- Right sidebar "批注与备注" tab with page/y-sorted cards, color/content filters, inline 500ms debounced comments, and color editing.
- Bidirectional navigation: click PDF highlight/area to open popover & highlight right card; click right card to smoothly scroll & pulse PDF highlight.
- Switched UI brand and interactive theme accents from amber to purple (`violet-*`).
- Added `foxpdf://assets/` protocol serving `pdfjs-dist` CMaps, standard fonts, WASM decoders, and ICC profiles for full CJK/Chinese PDF rendering and text extraction.

### Added (M1)

- Electron + React + TypeScript + Vite + Tailwind CSS desktop application scaffold with zero-native-build SQLite persistence (`node:sqlite` + WAL + FTS5).
- Configurable `FoxReaderData/` storage layout (`library.db`, read-only `pdfs/<sha256>.pdf`, `snapshots/`).
- Unified collapsible 3-pane workbench (`LeftSidebar`, `PdfReader`, `RightSidebar`).
- Multi-level folder tree CRUD (with safe deletion moving descendant papers to `未分类`), drag-and-drop paper archiving, and file/drag-drop PDF import with SHA-256 deduplication.
- Paper metadata editor, reading status filter, global search (FTS5 + CJK substring fallback), and `last_page` / `last_zoom` progress persistence.
- `pdfjs-dist` continuous vertical PDF reader with `IntersectionObserver` ±2-page lazy canvas & text-layer rendering, zoom presets, fit-to-width, and page jump.

## [0.0.1] - 2026-11-25

### Added

- Initialized open-source project baseline under MIT License (`LICENSE`, `README.md`, `CONTRIBUTING.md`, `.gitignore`, `CHANGELOG.md`).
- Added product requirements and architecture specification in `docs/PRD.md`.

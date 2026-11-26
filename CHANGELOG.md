# Changelog

All notable changes to **FoxReader** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

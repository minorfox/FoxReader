# Changelog

All notable changes to **FoxReader** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

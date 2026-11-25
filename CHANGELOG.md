# Changelog

All notable changes to **FoxReader** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

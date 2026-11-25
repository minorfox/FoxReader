import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  Annotation,
  AnnotationColor,
  CreateAnnotationInput,
  DeleteFolderResult,
  Folder,
  ImportPdfItemResult,
  LibraryOverview,
  NormalizedRect,
  Paper,
  PaperListQuery,
  PaperNote,
  PaperStatus,
  Tag,
  UpdateAnnotationInput,
  UpdatePaperMetadataInput,
} from '../shared/types.js';

const TAG_PALETTE = ['violet', 'blue', 'emerald', 'rose', 'amber', 'cyan'] as const;

const VALID_ANNOTATION_COLORS = new Set<AnnotationColor>([
  'yellow',
  'green',
  'blue',
  'pink',
  'purple',
]);

interface AnnotationRow {
  id: string;
  paper_id: string;
  type: 'text' | 'area';
  page_number: number;
  rects_json: string;
  color: string;
  quote_text: string;
  snapshot_path: string;
  comment: string;
  created_at: number;
  updated_at: number;
}

interface FolderRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

interface PaperRow {
  id: string;
  sha256: string;
  title: string;
  authors: string;
  year: number | null;
  folder_id: string | null;
  status: PaperStatus;
  page_count: number;
  last_page: number;
  last_zoom: number;
  file_name: string;
  created_at: number;
  updated_at: number;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
}

function mapFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function normalizeAnnotationColor(raw: string): AnnotationColor {
  return VALID_ANNOTATION_COLORS.has(raw as AnnotationColor)
    ? (raw as AnnotationColor)
    : 'yellow';
}

function parseRectsJson(raw: string): NormalizedRect[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is NormalizedRect =>
        r &&
        typeof r.x === 'number' &&
        typeof r.y === 'number' &&
        typeof r.w === 'number' &&
        typeof r.h === 'number',
    );
  } catch {
    return [];
  }
}

function mapAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    paperId: row.paper_id,
    type: row.type,
    pageNumber: row.page_number,
    rects: parseRectsJson(row.rects_json),
    color: normalizeAnnotationColor(row.color),
    quoteText: row.quote_text,
    snapshotPath: row.snapshot_path,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildFtsQuery(raw: string): string | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["'()*^:{}[\]\\]/g, '').trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(' AND ');
}

function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export class FoxReaderDatabase {
  private readonly db: DatabaseSync;
  public readonly dbPath: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'pdfs'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'snapshots'), { recursive: true });

    this.dbPath = path.join(dataDir, 'library.db');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    // Flush any prior WAL journal from earlier versions and stick to single-file DELETE mode for safe OneDrive sync
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    this.db.exec('PRAGMA journal_mode = DELETE;');
    this.initSchema();
  }

  public getJournalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    return row.journal_mode;
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore double-close during app shutdown
    }
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT NULL REFERENCES folders(id),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        sha256 TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        authors TEXT NOT NULL DEFAULT '',
        year INTEGER NULL,
        folder_id TEXT NULL REFERENCES folders(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread', 'reading', 'read')),
        page_count INTEGER NOT NULL DEFAULT 0,
        last_page INTEGER NOT NULL DEFAULT 1,
        last_zoom REAL NOT NULL DEFAULT 1.0,
        file_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        color TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS paper_tags (
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (paper_id, tag_id)
      );

      CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY,
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('text', 'area')),
        page_number INTEGER NOT NULL,
        rects_json TEXT NOT NULL,
        color TEXT NOT NULL,
        quote_text TEXT NOT NULL DEFAULT '',
        snapshot_path TEXT NOT NULL DEFAULT '',
        comment TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS paper_notes (
        paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
        content_md TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        paper_id UNINDEXED,
        title,
        authors,
        tags,
        quote_text,
        comment,
        content_md
      );

      CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_papers_folder ON papers(folder_id);
      CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);
      CREATE INDEX IF NOT EXISTS idx_annotations_paper ON annotations(paper_id, page_number);
    `);
  }

  private runInTransaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private getTagsForPaper(paperId: string): Tag[] {
    const rows = this.db
      .prepare(
        `SELECT t.id, t.name, t.color
         FROM tags t
         JOIN paper_tags pt ON pt.tag_id = t.id
         WHERE pt.paper_id = ?
         ORDER BY t.name COLLATE NOCASE ASC`,
      )
      .all(paperId) as unknown as TagRow[];
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color }));
  }

  private mapPaper(row: PaperRow): Paper {
    return {
      id: row.id,
      sha256: row.sha256,
      title: row.title,
      authors: row.authors,
      year: row.year,
      folderId: row.folder_id,
      status: row.status,
      pageCount: row.page_count,
      lastPage: row.last_page,
      lastZoom: row.last_zoom,
      fileName: row.file_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tags: this.getTagsForPaper(row.id),
    };
  }

  public syncPaperSearchIndex(paperId: string): void {
    const paper = this.db
      .prepare('SELECT id, title, authors FROM papers WHERE id = ?')
      .get(paperId) as { id: string; title: string; authors: string } | undefined;

    this.db.prepare('DELETE FROM search_fts WHERE paper_id = ?').run(paperId);
    if (!paper) return;

    const tagRows = this.db
      .prepare(
        `SELECT t.name FROM tags t
         JOIN paper_tags pt ON pt.tag_id = t.id
         WHERE pt.paper_id = ?`,
      )
      .all(paperId) as { name: string }[];
    const tagsText = tagRows.map((r) => r.name).join(' ');

    const annRows = this.db
      .prepare('SELECT quote_text, comment FROM annotations WHERE paper_id = ?')
      .all(paperId) as { quote_text: string; comment: string }[];
    const quoteText = annRows.map((r) => r.quote_text).filter(Boolean).join('\n');
    const commentText = annRows.map((r) => r.comment).filter(Boolean).join('\n');

    const noteRow = this.db
      .prepare('SELECT content_md FROM paper_notes WHERE paper_id = ?')
      .get(paperId) as { content_md: string } | undefined;

    this.db
      .prepare(
        `INSERT INTO search_fts (paper_id, title, authors, tags, quote_text, comment, content_md)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        paperId,
        paper.title,
        paper.authors,
        tagsText,
        quoteText,
        commentText,
        noteRow?.content_md ?? '',
      );
  }

  public listFolders(): Folder[] {
    const rows = this.db
      .prepare('SELECT id, name, parent_id, sort_order, created_at FROM folders ORDER BY sort_order ASC, created_at ASC')
      .all() as unknown as FolderRow[];
    return rows.map(mapFolder);
  }

  public getLibraryOverview(): LibraryOverview {
    const folders = this.listFolders();
    const totalRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM papers').get() as { cnt: number };
    const unclassifiedRow = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM papers WHERE folder_id IS NULL')
      .get() as { cnt: number };
    const folderCountRows = this.db
      .prepare('SELECT folder_id, COUNT(*) AS cnt FROM papers WHERE folder_id IS NOT NULL GROUP BY folder_id')
      .all() as { folder_id: string; cnt: number }[];
    const folderCounts: Record<string, number> = {};
    for (const row of folderCountRows) {
      folderCounts[row.folder_id] = row.cnt;
    }

    const tags = this.db
      .prepare('SELECT id, name, color FROM tags ORDER BY name COLLATE NOCASE ASC')
      .all() as unknown as TagRow[];
    const tagCountRows = this.db
      .prepare('SELECT tag_id, COUNT(*) AS cnt FROM paper_tags GROUP BY tag_id')
      .all() as { tag_id: string; cnt: number }[];
    const tagCounts: Record<string, number> = {};
    for (const row of tagCountRows) {
      tagCounts[row.tag_id] = row.cnt;
    }

    return {
      folders,
      totalCount: totalRow.cnt,
      unclassifiedCount: unclassifiedRow.cnt,
      folderCounts,
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      tagCounts,
    };
  }

  public createFolder(name: string, parentId: string | null): Folder {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Folder name cannot be empty.');
    }
    if (parentId !== null) {
      const parent = this.db.prepare('SELECT id FROM folders WHERE id = ?').get(parentId);
      if (!parent) {
        throw new Error('Parent folder does not exist.');
      }
    }

    const maxOrderRow = this.db
      .prepare(
        parentId === null
          ? 'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM folders WHERE parent_id IS NULL'
          : 'SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM folders WHERE parent_id = ?',
      )
      .get(...(parentId === null ? [] : [parentId])) as { max_order: number };

    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const sortOrder = maxOrderRow.max_order + 1;

    this.db
      .prepare('INSERT INTO folders (id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, trimmed, parentId, sortOrder, createdAt);

    return {
      id,
      name: trimmed,
      parentId,
      sortOrder,
      createdAt,
    };
  }

  public renameFolder(id: string, name: string): Folder {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Folder name cannot be empty.');
    }
    const existing = this.db
      .prepare('SELECT id, name, parent_id, sort_order, created_at FROM folders WHERE id = ?')
      .get(id) as unknown as FolderRow | undefined;
    if (!existing) {
      throw new Error('Folder not found.');
    }
    this.db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(trimmed, id);
    return mapFolder({ ...existing, name: trimmed });
  }

  public deleteFolder(id: string): DeleteFolderResult {
    return this.runInTransaction(() => {
      const descendants = this.db
        .prepare(
          `WITH RECURSIVE tree(fid) AS (
             SELECT id FROM folders WHERE id = ?
             UNION ALL
             SELECT f.id FROM folders f JOIN tree t ON f.parent_id = t.fid
           )
           SELECT fid FROM tree`,
        )
        .all(id) as { fid: string }[];

      if (descendants.length === 0) {
        return { movedPaperCount: 0 };
      }

      const ids = descendants.map((d) => d.fid);
      const placeholders = ids.map(() => '?').join(',');
      const countRow = this.db
        .prepare(`SELECT COUNT(*) AS cnt FROM papers WHERE folder_id IN (${placeholders})`)
        .get(...ids) as { cnt: number };

      const now = Date.now();
      this.db
        .prepare(`UPDATE papers SET folder_id = NULL, updated_at = ? WHERE folder_id IN (${placeholders})`)
        .run(now, ...ids);

      // Clear self-referential parent links inside the subtree before deleting so FK never fails.
      this.db
        .prepare(`UPDATE folders SET parent_id = NULL WHERE id IN (${placeholders})`)
        .run(...ids);
      this.db
        .prepare(`DELETE FROM folders WHERE id IN (${placeholders})`)
        .run(...ids);

      return { movedPaperCount: countRow.cnt };
    });
  }

  public getPaperById(id: string): Paper | null {
    const row = this.db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as unknown as PaperRow | undefined;
    return row ? this.mapPaper(row) : null;
  }

  public getPaperBySha256(sha256: string): Paper | null {
    const row = this.db.prepare('SELECT * FROM papers WHERE sha256 = ?').get(sha256) as unknown as PaperRow | undefined;
    return row ? this.mapPaper(row) : null;
  }

  public listPapers(query: PaperListQuery): Paper[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (query.view === 'unclassified') {
      conditions.push('p.folder_id IS NULL');
    } else if (query.view === 'folder') {
      if (query.folderId) {
        conditions.push('p.folder_id = ?');
        params.push(query.folderId);
      } else {
        conditions.push('p.folder_id IS NULL');
      }
    }

    if (query.status && query.status !== 'all') {
      conditions.push('p.status = ?');
      params.push(query.status);
    }

    if (query.tagId) {
      conditions.push('EXISTS (SELECT 1 FROM paper_tags pt WHERE pt.paper_id = p.id AND pt.tag_id = ?)');
      params.push(query.tagId);
    }

    const searchText = query.search?.trim() ?? '';
    if (searchText.length > 0) {
      const ftsExpr = buildFtsQuery(searchText);
      const likeTerm = `%${searchText}%`;
      const likeClause = `(
        p.title LIKE ? COLLATE NOCASE
        OR p.authors LIKE ? COLLATE NOCASE
        OR p.file_name LIKE ? COLLATE NOCASE
        OR EXISTS (SELECT 1 FROM paper_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.paper_id = p.id AND t.name LIKE ? COLLATE NOCASE)
        OR EXISTS (SELECT 1 FROM annotations a WHERE a.paper_id = p.id AND (a.quote_text LIKE ? COLLATE NOCASE OR a.comment LIKE ? COLLATE NOCASE))
        OR EXISTS (SELECT 1 FROM paper_notes pn WHERE pn.paper_id = p.id AND pn.content_md LIKE ? COLLATE NOCASE)
      )`;

      if (ftsExpr) {
        conditions.push(
          `(p.id IN (SELECT paper_id FROM search_fts WHERE search_fts MATCH ?) OR ${likeClause})`,
        );
        params.push(ftsExpr, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
      } else {
        conditions.push(likeClause);
        params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
      }
    }

    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT p.* FROM papers p ${whereSql} ORDER BY p.updated_at DESC, p.created_at DESC`)
      .all(...params) as unknown as PaperRow[];
    return rows.map((row) => this.mapPaper(row));
  }

  public async importPdfFile(
    sourcePath: string,
    folderId: string | null,
    dataDir: string,
  ): Promise<ImportPdfItemResult> {
    try {
      const stat = await fs.promises.stat(sourcePath);
      if (!stat.isFile()) {
        return { sourcePath, status: 'error', error: 'Selected path is not a file.' };
      }
      if (path.extname(sourcePath).toLowerCase() !== '.pdf') {
        return { sourcePath, status: 'error', error: 'Only .pdf files can be imported.' };
      }

      const sha256 = await computeFileSha256(sourcePath);
      const existing = this.getPaperBySha256(sha256);
      if (existing) {
        return { sourcePath, status: 'duplicate', paper: existing };
      }

      let validFolderId: string | null = null;
      if (folderId) {
        const folderExists = this.db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId);
        validFolderId = folderExists ? folderId : null;
      }

      const pdfsDir = path.join(dataDir, 'pdfs');
      await fs.promises.mkdir(pdfsDir, { recursive: true });
      const destPath = path.join(pdfsDir, `${sha256}.pdf`);
      if (!fs.existsSync(destPath)) {
        await fs.promises.copyFile(sourcePath, destPath);
      }

      const id = crypto.randomUUID();
      const fileName = path.basename(sourcePath);
      const fallbackTitle = path.basename(sourcePath, path.extname(sourcePath)) || fileName;
      const now = Date.now();

      this.runInTransaction(() => {
        this.db
          .prepare(
            `INSERT INTO papers (
              id, sha256, title, authors, year, folder_id, status,
              page_count, last_page, last_zoom, file_name, created_at, updated_at
            ) VALUES (?, ?, ?, '', NULL, ?, 'unread', 0, 1, 1.0, ?, ?, ?)`,
          )
          .run(id, sha256, fallbackTitle, validFolderId, fileName, now, now);
        this.syncPaperSearchIndex(id);
      });

      const created = this.getPaperById(id);
      if (!created) {
        throw new Error('Failed to load newly inserted paper.');
      }
      return { sourcePath, status: 'imported', paper: created };
    } catch (error) {
      return {
        sourcePath,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public updatePaperMetadata(paperId: string, input: UpdatePaperMetadataInput): Paper {
    const existing = this.db.prepare('SELECT * FROM papers WHERE id = ?').get(paperId) as unknown as PaperRow | undefined;
    if (!existing) {
      throw new Error('Paper not found.');
    }

    const nextTitle =
      input.title !== undefined ? input.title.trim() || existing.title : existing.title;
    const nextAuthors = input.authors !== undefined ? input.authors.trim() : existing.authors;
    const nextYear = input.year !== undefined ? input.year : existing.year;
    const nextStatus = input.status !== undefined ? input.status : existing.status;
    const nextFolderId = input.folderId !== undefined ? input.folderId : existing.folder_id;
    const nextPageCount = input.pageCount !== undefined ? input.pageCount : existing.page_count;

    if (nextFolderId !== null) {
      const folder = this.db.prepare('SELECT id FROM folders WHERE id = ?').get(nextFolderId);
      if (!folder) {
        throw new Error('Target folder does not exist.');
      }
    }

    const now = Date.now();
    this.runInTransaction(() => {
      this.db
        .prepare(
          `UPDATE papers
           SET title = ?, authors = ?, year = ?, status = ?, folder_id = ?, page_count = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(nextTitle, nextAuthors, nextYear, nextStatus, nextFolderId, nextPageCount, now, paperId);
      this.syncPaperSearchIndex(paperId);
    });

    const updated = this.getPaperById(paperId);
    if (!updated) {
      throw new Error('Failed to load updated paper.');
    }
    return updated;
  }

  public movePaperToFolder(paperId: string, folderId: string | null): Paper {
    return this.updatePaperMetadata(paperId, { folderId });
  }

  public updatePaperProgress(paperId: string, lastPage: number, lastZoom: number): void {
    const safePage = Math.max(1, Math.floor(lastPage));
    const safeZoom = Math.min(4.0, Math.max(0.25, lastZoom));
    this.db
      .prepare('UPDATE papers SET last_page = ?, last_zoom = ? WHERE id = ?')
      .run(safePage, safeZoom, paperId);
  }

  public async deletePaper(paperId: string, dataDir: string): Promise<void> {
    const paper = this.db
      .prepare('SELECT id, sha256 FROM papers WHERE id = ?')
      .get(paperId) as { id: string; sha256: string } | undefined;
    if (!paper) return;

    const snapshots = this.db
      .prepare("SELECT snapshot_path FROM annotations WHERE paper_id = ? AND snapshot_path != ''")
      .all(paperId) as { snapshot_path: string }[];

    this.runInTransaction(() => {
      this.db.prepare('DELETE FROM search_fts WHERE paper_id = ?').run(paperId);
      this.db.prepare('DELETE FROM papers WHERE id = ?').run(paperId);
    });

    const pdfPath = path.join(dataDir, 'pdfs', `${paper.sha256}.pdf`);
    await fs.promises.rm(pdfPath, { force: true });

    for (const snap of snapshots) {
      const snapFullPath = path.isAbsolute(snap.snapshot_path)
        ? snap.snapshot_path
        : path.join(dataDir, 'snapshots', snap.snapshot_path);
      await fs.promises.rm(snapFullPath, { force: true });
    }
  }

  public listAnnotations(paperId: string): Annotation[] {
    const rows = this.db
      .prepare('SELECT * FROM annotations WHERE paper_id = ?')
      .all(paperId) as unknown as AnnotationRow[];
    const mapped = rows.map(mapAnnotation);
    mapped.sort((a, b) => {
      if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
      const ay = a.rects[0]?.y ?? 0;
      const by = b.rects[0]?.y ?? 0;
      if (ay !== by) return ay - by;
      return a.createdAt - b.createdAt;
    });
    return mapped;
  }

  public async createAnnotation(input: CreateAnnotationInput, dataDir: string): Promise<Annotation> {
    const paper = this.db.prepare('SELECT id FROM papers WHERE id = ?').get(input.paperId);
    if (!paper) {
      throw new Error('Paper not found.');
    }
    if (!Number.isInteger(input.pageNumber) || input.pageNumber < 1) {
      throw new Error('Invalid page number.');
    }
    if (!Array.isArray(input.rects) || input.rects.length === 0) {
      throw new Error('Annotation rects cannot be empty.');
    }

    const id = crypto.randomUUID();
    const color = normalizeAnnotationColor(input.color);
    const quoteText = (input.quoteText ?? '').trim();
    const comment = input.comment ?? '';
    const now = Date.now();
    let snapshotPath = '';

    if (input.type === 'area' && input.snapshotPngBase64) {
      const base64Body = input.snapshotPngBase64.replace(/^data:image\/png;base64,/, '');
      const snapshotsDir = path.join(dataDir, 'snapshots');
      await fs.promises.mkdir(snapshotsDir, { recursive: true });
      snapshotPath = `${id}.png`;
      await fs.promises.writeFile(path.join(snapshotsDir, snapshotPath), Buffer.from(base64Body, 'base64'));
    }

    this.runInTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO annotations (
            id, paper_id, type, page_number, rects_json, color,
            quote_text, snapshot_path, comment, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.paperId,
          input.type,
          input.pageNumber,
          JSON.stringify(input.rects),
          color,
          quoteText,
          snapshotPath,
          comment,
          now,
          now,
        );
      this.syncPaperSearchIndex(input.paperId);
    });

    const created = this.db
      .prepare('SELECT * FROM annotations WHERE id = ?')
      .get(id) as unknown as AnnotationRow | undefined;
    if (!created) {
      throw new Error('Failed to load created annotation.');
    }
    return mapAnnotation(created);
  }

  public updateAnnotation(id: string, input: UpdateAnnotationInput): Annotation {
    const existing = this.db
      .prepare('SELECT * FROM annotations WHERE id = ?')
      .get(id) as unknown as AnnotationRow | undefined;
    if (!existing) {
      throw new Error('Annotation not found.');
    }

    const nextColor =
      input.color !== undefined ? normalizeAnnotationColor(input.color) : normalizeAnnotationColor(existing.color);
    const nextComment = input.comment !== undefined ? input.comment : existing.comment;
    const now = Date.now();

    this.runInTransaction(() => {
      this.db
        .prepare('UPDATE annotations SET color = ?, comment = ?, updated_at = ? WHERE id = ?')
        .run(nextColor, nextComment, now, id);
      this.syncPaperSearchIndex(existing.paper_id);
    });

    const updated = this.db
      .prepare('SELECT * FROM annotations WHERE id = ?')
      .get(id) as unknown as AnnotationRow | undefined;
    if (!updated) {
      throw new Error('Failed to load updated annotation.');
    }
    return mapAnnotation(updated);
  }

  public async deleteAnnotation(id: string, dataDir: string): Promise<void> {
    const existing = this.db
      .prepare('SELECT id, paper_id, snapshot_path FROM annotations WHERE id = ?')
      .get(id) as { id: string; paper_id: string; snapshot_path: string } | undefined;
    if (!existing) return;

    this.runInTransaction(() => {
      this.db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
      this.syncPaperSearchIndex(existing.paper_id);
    });

    if (existing.snapshot_path) {
      const snapFullPath = path.isAbsolute(existing.snapshot_path)
        ? existing.snapshot_path
        : path.join(dataDir, 'snapshots', existing.snapshot_path);
      await fs.promises.rm(snapFullPath, { force: true });
    }
  }

  public setPaperTags(paperId: string, tagNames: string[]): Paper {
    const paperExists = this.db.prepare('SELECT id FROM papers WHERE id = ?').get(paperId);
    if (!paperExists) {
      throw new Error('Paper not found.');
    }

    const dedupedNames: string[] = [];
    const seenLower = new Set<string>();
    for (const raw of tagNames) {
      const clean = raw.trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seenLower.has(key)) continue;
      seenLower.add(key);
      dedupedNames.push(clean);
    }

    this.runInTransaction(() => {
      this.db.prepare('DELETE FROM paper_tags WHERE paper_id = ?').run(paperId);

      const countRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM tags').get() as { cnt: number };
      let colorCursor = countRow.cnt;

      for (const name of dedupedNames) {
        let tag = this.db
          .prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE')
          .get(name) as { id: string } | undefined;
        if (!tag) {
          const newId = crypto.randomUUID();
          const color = TAG_PALETTE[colorCursor % TAG_PALETTE.length];
          colorCursor += 1;
          this.db
            .prepare('INSERT INTO tags (id, name, color) VALUES (?, ?, ?)')
            .run(newId, name, color);
          tag = { id: newId };
        }
        this.db
          .prepare('INSERT OR IGNORE INTO paper_tags (paper_id, tag_id) VALUES (?, ?)')
          .run(paperId, tag.id);
      }

      this.db.prepare('UPDATE papers SET updated_at = ? WHERE id = ?').run(Date.now(), paperId);
      this.syncPaperSearchIndex(paperId);
    });

    const updated = this.getPaperById(paperId);
    if (!updated) {
      throw new Error('Failed to load paper after updating tags.');
    }
    return updated;
  }

  public deleteTag(tagId: string): void {
    this.runInTransaction(() => {
      const affected = this.db
        .prepare('SELECT paper_id FROM paper_tags WHERE tag_id = ?')
        .all(tagId) as { paper_id: string }[];
      this.db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
      for (const row of affected) {
        this.syncPaperSearchIndex(row.paper_id);
      }
    });
  }

  public getPaperNote(paperId: string): PaperNote {
    const row = this.db
      .prepare('SELECT paper_id, content_md, updated_at FROM paper_notes WHERE paper_id = ?')
      .get(paperId) as { paper_id: string; content_md: string; updated_at: number } | undefined;
    if (!row) {
      return { paperId, contentMd: '', updatedAt: 0 };
    }
    return {
      paperId: row.paper_id,
      contentMd: row.content_md,
      updatedAt: row.updated_at,
    };
  }

  public savePaperNote(paperId: string, contentMd: string): PaperNote {
    const paperExists = this.db.prepare('SELECT id FROM papers WHERE id = ?').get(paperId);
    if (!paperExists) {
      throw new Error('Paper not found.');
    }
    const updatedAt = Date.now();
    this.runInTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO paper_notes (paper_id, content_md, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(paper_id) DO UPDATE SET
             content_md = excluded.content_md,
             updated_at = excluded.updated_at`,
        )
        .run(paperId, contentMd, updatedAt);
      this.syncPaperSearchIndex(paperId);
    });

    return { paperId, contentMd, updatedAt };
  }
}

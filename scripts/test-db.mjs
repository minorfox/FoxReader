import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foxreader-db-test-'));
  const bundlePath = path.join(tempRoot, 'database.mjs');
  const lockBundlePath = path.join(tempRoot, 'dataLock.mjs');
  const dataDir = path.join(tempRoot, 'FoxReaderData');

  try {
    await Promise.all([
      esbuild.build({
        entryPoints: [path.resolve('src/main/database.ts')],
        outfile: bundlePath,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        external: ['node:sqlite'],
      }),
      esbuild.build({
        entryPoints: [path.resolve('src/main/dataLock.ts')],
        outfile: lockBundlePath,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
      }),
    ]);

    const { FoxReaderDatabase } = await import(pathToFileURL(bundlePath).toString());
    const { DataDirLock } = await import(pathToFileURL(lockBundlePath).toString());
    const db = new FoxReaderDatabase(dataDir);
    assert.equal(db.getJournalMode().toLowerCase(), 'delete', 'Scenario B requires DELETE journal mode');
    assert.equal(fs.existsSync(path.join(dataDir, 'library.db-wal')), false, 'No lingering WAL file');

    // DataDirLock test: foreign hostname lock triggers warning; own lock cleans up on release
    const lockDir = path.join(tempRoot, 'LockTestDir');
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(
      path.join(lockDir, '.foxreader.lock'),
      JSON.stringify({ hostname: 'OTHER-PC-999', pid: 12345, startedAt: Date.now() }),
    );
    const lock = new DataDirLock();
    const warning = lock.acquire(lockDir);
    assert.ok(warning && warning.hostname === 'OTHER-PC-999', 'Should warn on foreign hostname lock');
    lock.forceAcquire(lockDir);
    assert.equal(fs.existsSync(path.join(lockDir, '.foxreader.lock')), true);
    lock.release();
    assert.equal(fs.existsSync(path.join(lockDir, '.foxreader.lock')), false, 'Own lock removed on release');

    // 1. Nested folder CRUD: root -> child -> grandchild
    const root = db.createFolder('Computer Science', null);
    const child = db.createFolder('AI & ML', root.id);
    const grandchild = db.createFolder('LLM Agents', child.id);
    const renamed = db.renameFolder(grandchild.id, 'Autonomous Agents');
    assert.equal(renamed.name, 'Autonomous Agents');

    // 2. Import PDF & SHA-256 deduplication
    const samplePdfPath = path.join(tempRoot, 'Attention Is All You Need.pdf');
    fs.writeFileSync(samplePdfPath, '%PDF-1.4\n% Sample test PDF content\n%%EOF\n', 'utf-8');

    const firstImport = await db.importPdfFile(samplePdfPath, grandchild.id, dataDir);
    assert.equal(firstImport.status, 'imported');
    assert.ok(firstImport.paper);
    assert.equal(firstImport.paper.folderId, grandchild.id);

    const managedPdfPath = path.join(dataDir, 'pdfs', `${firstImport.paper.sha256}.pdf`);
    assert.equal(fs.existsSync(managedPdfPath), true, 'Managed PDF file should exist');

    const overviewWithHierarchy = db.getLibraryOverview();
    assert.equal(overviewWithHierarchy.folderCounts[grandchild.id], 1);
    assert.equal(overviewWithHierarchy.folderCounts[child.id], 1);
    assert.equal(overviewWithHierarchy.folderCounts[root.id], 1);
    assert.equal(db.listPapers({ view: 'folder', folderId: root.id }).length, 1);

    const duplicateCopyPath = path.join(tempRoot, 'duplicate-copy.pdf');
    fs.copyFileSync(samplePdfPath, duplicateCopyPath);
    const secondImport = await db.importPdfFile(duplicateCopyPath, null, dataDir);
    assert.equal(secondImport.status, 'duplicate');
    assert.equal(secondImport.paper.id, firstImport.paper.id);

    // 3. Delete root folder -> papers in descendants move to unclassified (folderId = null), PDF preserved
    const deleteFolderRes = db.deleteFolder(root.id);
    assert.equal(deleteFolderRes.movedPaperCount, 1);
    assert.equal(db.listFolders().length, 0);

    const reloadedPaper = db.getPaperById(firstImport.paper.id);
    assert.ok(reloadedPaper);
    assert.equal(reloadedPaper.folderId, null);
    assert.equal(fs.existsSync(managedPdfPath), true, 'Managed PDF must NOT be deleted when folder is deleted');

    // 4. Update metadata & search (English FTS5 + Chinese substring LIKE)
    const updated = db.updatePaperMetadata(reloadedPaper.id, {
      title: 'Attention Is All You Need 中文注释版',
      authors: 'Ashish Vaswani et al.',
      year: 2017,
      status: 'reading',
      pageCount: 15,
    });
    assert.equal(updated.status, 'reading');
    assert.equal(updated.pageCount, 15);

    const enHits = db.listPapers({ view: 'all', search: 'Vaswani' });
    assert.equal(enHits.length, 1);
    const zhHits = db.listPapers({ view: 'unclassified', status: 'reading', search: '中文注释' });
    assert.equal(zhHits.length, 1);

    // 5. Reading progress update
    db.updatePaperProgress(reloadedPaper.id, 7, 1.25);
    const withProgress = db.getPaperById(reloadedPaper.id);
    assert.equal(withProgress.lastPage, 7);
    assert.equal(withProgress.lastZoom, 1.25);

    // 6. Annotations CRUD (text + area snapshot, sorting, FTS5 search, cleanup)
    const samplePngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    const annPage3 = await db.createAnnotation(
      {
        paperId: reloadedPaper.id,
        type: 'text',
        pageNumber: 3,
        rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.03 }],
        color: 'yellow',
        quoteText: 'Scaled Dot-Product Attention',
      },
      dataDir,
    );

    const annArea1 = await db.createAnnotation(
      {
        paperId: reloadedPaper.id,
        type: 'area',
        pageNumber: 1,
        rects: [{ x: 0.15, y: 0.45, w: 0.4, h: 0.2 }],
        color: 'blue',
        snapshotPngBase64: samplePngBase64,
      },
      dataDir,
    );

    const annText1Top = await db.createAnnotation(
      {
        paperId: reloadedPaper.id,
        type: 'text',
        pageNumber: 1,
        rects: [{ x: 0.1, y: 0.12, w: 0.3, h: 0.025 }],
        color: 'purple',
        quoteText: 'Transformer architecture',
      },
      dataDir,
    );

    const annArea2 = await db.createAnnotation(
      {
        paperId: reloadedPaper.id,
        type: 'area',
        pageNumber: 2,
        rects: [{ x: 0.2, y: 0.3, w: 0.5, h: 0.25 }],
        color: 'pink',
        snapshotPngBase64: samplePngBase64,
      },
      dataDir,
    );

    const snap1Path = path.join(dataDir, 'snapshots', annArea1.snapshotPath);
    const snap2Path = path.join(dataDir, 'snapshots', annArea2.snapshotPath);
    assert.equal(fs.existsSync(snap1Path), true, 'Area snapshot 1 PNG should be written');
    assert.equal(fs.existsSync(snap2Path), true, 'Area snapshot 2 PNG should be written');

    const sorted = db.listAnnotations(reloadedPaper.id);
    assert.deepEqual(
      sorted.map((a) => a.id),
      [annText1Top.id, annArea1.id, annArea2.id, annPage3.id],
      'Annotations should sort by pageNumber ASC, then y ASC',
    );

    const updatedAnn = db.updateAnnotation(annPage3.id, {
      color: 'green',
      comment: 'Bifocal prototype intuition',
    });
    assert.equal(updatedAnn.color, 'green');
    assert.equal(updatedAnn.comment, 'Bifocal prototype intuition');

    const commentSearchHits = db.listPapers({ view: 'all', search: 'Bifocal' });
    assert.equal(commentSearchHits.length, 1, 'Paper should match annotation comment via FTS5');

    await db.deleteAnnotation(annArea1.id, dataDir);
    assert.equal(fs.existsSync(snap1Path), false, 'Deleted annotation snapshot PNG should be removed');
    assert.equal(db.listAnnotations(reloadedPaper.id).length, 3);

    // 7. Tags CRUD, filtering & FTS5 search
    const withTags = db.setPaperTags(reloadedPaper.id, ['NLP', 'Few-Shot', 'nlp']);
    assert.equal(withTags.tags.length, 2, 'Duplicate case-insensitive tags should dedupe');
    const overviewAfterTags = db.getLibraryOverview();
    const nlpTag = overviewAfterTags.tags.find((t) => t.name === 'NLP');
    assert.ok(nlpTag);
    assert.equal(overviewAfterTags.tagCounts[nlpTag.id], 1);
    assert.equal(db.listPapers({ view: 'all', tagId: nlpTag.id }).length, 1);
    assert.equal(db.listPapers({ view: 'all', search: 'Few-Shot' }).length, 1);

    db.deleteTag(nlpTag.id);
    assert.equal(db.getPaperById(reloadedPaper.id).tags.length, 1);

    // 8. Paper Markdown Notes CRUD & FTS5/CJK search
    const emptyNote = db.getPaperNote(reloadedPaper.id);
    assert.equal(emptyNote.contentMd, '');
    const savedNote = db.savePaperNote(
      reloadedPaper.id,
      '# Summary\n\nThis paper introduces **Variational Prototype** 学习方法.',
    );
    assert.ok(savedNote.updatedAt > 0);
    assert.equal(db.listPapers({ view: 'all', search: 'Variational' }).length, 1);
    assert.equal(db.listPapers({ view: 'all', search: '学习方法' }).length, 1);

    // 9. Delete paper -> DB row + managed PDF + remaining annotation snapshots deleted
    await db.deletePaper(reloadedPaper.id, dataDir);
    assert.equal(db.getPaperById(reloadedPaper.id), null);
    assert.equal(fs.existsSync(managedPdfPath), false, 'Managed PDF should be deleted after deletePaper');
    assert.equal(fs.existsSync(snap2Path), false, 'Remaining annotation snapshot PNG should be deleted on deletePaper');

    // 10. Batch delete papers -> removes multiple DB rows & managed PDFs
    const batchPdfA = path.join(tempRoot, 'batch-a.pdf');
    const batchPdfB = path.join(tempRoot, 'batch-b.pdf');
    fs.writeFileSync(batchPdfA, '%PDF-1.4\n% Batch A\n%%EOF\n', 'utf-8');
    fs.writeFileSync(batchPdfB, '%PDF-1.4\n% Batch B\n%%EOF\n', 'utf-8');
    const resA = await db.importPdfFile(batchPdfA, null, dataDir);
    const resB = await db.importPdfFile(batchPdfB, null, dataDir);
    assert.equal(resA.status, 'imported');
    assert.equal(resB.status, 'imported');
    const pathA = path.join(dataDir, 'pdfs', `${resA.paper.sha256}.pdf`);
    const pathB = path.join(dataDir, 'pdfs', `${resB.paper.sha256}.pdf`);
    assert.equal(fs.existsSync(pathA), true);
    assert.equal(fs.existsSync(pathB), true);

    const batchDel = await db.deletePapers([resA.paper.id, resB.paper.id, 'non-existent-id'], dataDir);
    assert.equal(batchDel.deletedCount, 2);
    assert.equal(db.getPaperById(resA.paper.id), null);
    assert.equal(db.getPaperById(resB.paper.id), null);
    assert.equal(fs.existsSync(pathA), false);
    assert.equal(fs.existsSync(pathB), false);

    // 11. Affiliations metadata storage + FTS5/CJK search
    const affPdf = path.join(tempRoot, 'aff-paper.pdf');
    fs.writeFileSync(affPdf, '%PDF-1.4\n% Aff paper\n%%EOF\n', 'utf-8');
    const affImport = await db.importPdfFile(affPdf, null, dataDir);
    assert.equal(affImport.status, 'imported');
    const updatedAff = db.updatePaperMetadata(affImport.paper.id, {
      title: 'Federated Spatio-Temporal Graph Modeling',
      authors: 'Qiang Gao, Fan Zhou',
      affiliations: 'Southwestern University of Finance and Economics; 清华大学',
      year: 2025,
    });
    assert.equal(updatedAff.affiliations, 'Southwestern University of Finance and Economics; 清华大学');
    assert.equal(db.listPapers({ view: 'all', search: 'Southwestern' }).length, 1);
    assert.equal(db.listPapers({ view: 'all', search: '清华大学' }).length, 1);

    db.close();

    // 12. Legacy DB schema migration (pre-affiliations library.db -> auto ALTER + search_fts backfill)
    const { DatabaseSync } = await import('node:sqlite');
    const legacyDir = path.join(tempRoot, 'LegacyFoxReaderData');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyDb = new DatabaseSync(path.join(legacyDir, 'library.db'));
    legacyDb.exec(`
      CREATE TABLE folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE papers (
        id TEXT PRIMARY KEY,
        sha256 TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        authors TEXT NOT NULL DEFAULT '',
        year INTEGER NULL,
        folder_id TEXT NULL,
        status TEXT NOT NULL DEFAULT 'unread',
        page_count INTEGER NOT NULL DEFAULT 0,
        last_page INTEGER NOT NULL DEFAULT 1,
        last_zoom REAL NOT NULL DEFAULT 1.0,
        file_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT NOT NULL DEFAULT '');
      CREATE TABLE paper_tags (paper_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (paper_id, tag_id));
      CREATE TABLE annotations (
        id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, type TEXT NOT NULL, page_number INTEGER NOT NULL,
        rects_json TEXT NOT NULL, color TEXT NOT NULL, quote_text TEXT NOT NULL DEFAULT '',
        snapshot_path TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE paper_notes (paper_id TEXT PRIMARY KEY, content_md TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
      CREATE VIRTUAL TABLE search_fts USING fts5(paper_id UNINDEXED, title, authors, tags, quote_text, comment, content_md);
      INSERT INTO papers (id, sha256, title, authors, year, status, page_count, last_page, last_zoom, file_name, created_at, updated_at)
      VALUES ('legacy-1', 'deadbeef01', 'Legacy Quantum Paper', 'Ada Lovelace', 2022, 'unread', 8, 1, 1.0, 'legacy.pdf', 1000, 1000);
    `);
    legacyDb.close();

    const migratedDb = new FoxReaderDatabase(legacyDir);
    const migratedPaper = migratedDb.getPaperById('legacy-1');
    assert.ok(migratedPaper);
    assert.equal(migratedPaper.affiliations, '');
    assert.equal(migratedPaper.doi, '');
    assert.equal(migratedPaper.arxivId, '');
    assert.equal(migratedPaper.venue, '');
    assert.equal(migratedPaper.bibtex, '');
    assert.equal(migratedPaper.fileType, 'pdf');
    assert.equal(migratedDb.listPapers({ view: 'all', search: 'Quantum' }).length, 1);

    // 13. Markdown document import (YAML frontmatter + FTS5 body search + read + delete)
    const mdSourcePath = path.join(tempRoot, 'sample-note.md');
    fs.writeFileSync(
      mdSourcePath,
      `---
title: Attention Variants Survey
author: Alice Smith, Bob Jones
affiliation: Stanford University
year: 2025
---

# Ignored Heading

We investigate sparse attention mechanisms with KaTeX formula $E = mc^2$ and unique token MarkdownBodyXYZ.
`,
      'utf-8',
    );
    const mdImport = await migratedDb.importPdfFile(mdSourcePath, null, legacyDir);
    assert.equal(mdImport.status, 'imported');
    assert.equal(mdImport.paper.fileType, 'md');
    assert.equal(mdImport.paper.title, 'Attention Variants Survey');
    assert.equal(mdImport.paper.authors, 'Alice Smith, Bob Jones');
    assert.equal(mdImport.paper.affiliations, 'Stanford University');
    assert.equal(mdImport.paper.year, 2025);

    const storedMdPath = path.join(legacyDir, 'docs', `${mdImport.paper.sha256}.md`);
    assert.equal(fs.existsSync(storedMdPath), true);
    const loadedMd = await migratedDb.readMarkdownContent(mdImport.paper.sha256, legacyDir);
    assert.ok(loadedMd.includes('MarkdownBodyXYZ'));
    assert.equal(migratedDb.listPapers({ view: 'all', search: 'MarkdownBodyXYZ' }).length, 1);

    await migratedDb.deletePaper(mdImport.paper.id, legacyDir);
    assert.equal(fs.existsSync(storedMdPath), false, 'Managed .md file should be deleted on deletePaper');

    // 14. Windows file-handle safety: byte-range slice + aborted stream followed by immediate deletePaper
    const handlePdfSrc = path.join(tempRoot, 'range-handle.pdf');
    fs.writeFileSync(handlePdfSrc, '%PDF-1.4\n' + 'A'.repeat(4096) + '\n%%EOF\n', 'utf-8');
    const handleImport = await migratedDb.importPdfFile(handlePdfSrc, null, legacyDir);
    assert.equal(handleImport.status, 'imported');
    const managedHandlePdf = path.join(legacyDir, 'pdfs', `${handleImport.paper.sha256}.pdf`);

    const fh = await fs.promises.open(managedHandlePdf, 'r');
    try {
      const sliceBuf = Buffer.alloc(16);
      await fh.read(sliceBuf, 0, 16, 0);
      assert.equal(sliceBuf.subarray(0, 5).toString('utf-8'), '%PDF-');
    } finally {
      await fh.close();
    }

    const abortStream = fs.createReadStream(managedHandlePdf);
    await new Promise((resolve) => {
      abortStream.once('close', resolve);
      abortStream.destroy();
    });
    await migratedDb.deletePaper(handleImport.paper.id, legacyDir);
    assert.equal(fs.existsSync(managedHandlePdf), false, 'PDF should delete cleanly without EBUSY after range/abort');

    migratedDb.close();

    // 15. Electron 39 runtime compatibility check for configured pdfjs-dist build (catches missing Chrome 145+ APIs like getOrInsertComputed)
    const pdfLibSource = fs.readFileSync(path.resolve('src/renderer/lib/pdf.ts'), 'utf-8');
    const importMatch = pdfLibSource.match(/from\s+['"](pdfjs-dist[^'"]*)['"]/);
    assert.ok(importMatch?.[1], 'Could not locate pdfjs-dist import in src/renderer/lib/pdf.ts');
    const pdfSpec = importMatch[1] === 'pdfjs-dist' ? 'pdfjs-dist/build/pdf.mjs' : importMatch[1];
    const pdfWorkerSpec = pdfSpec.replace(/pdf\.mjs$/, 'pdf.worker.min.mjs');
    const pdfjsLib = await import(pathToFileURL(path.resolve('node_modules', pdfSpec)).toString());
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
      path.resolve('node_modules', pdfWorkerSpec),
    ).toString();

    const parts = ['%PDF-1.4\n'];
    const offsets = [0];
    const addObj = (id, body) => {
      offsets[id] = Buffer.byteLength(parts.join(''), 'utf-8');
      parts.push(`${id} 0 obj\n${body}\nendobj\n`);
    };
    addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    addObj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    addObj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>');
    addObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const streamBody = 'BT /F1 12 Tf 20 150 Td (Hello FoxReader) Tj ET';
    addObj(5, `<< /Length ${Buffer.byteLength(streamBody, 'utf-8')} >>\nstream\n${streamBody}\nendstream`);
    const xrefPos = Buffer.byteLength(parts.join(''), 'utf-8');
    parts.push('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i += 1) {
      parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
    }
    parts.push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

    const pdfBytes = new Uint8Array(Buffer.from(parts.join(''), 'utf-8'));
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes, verbosity: 0 }).promise;
    const pdfPage = await pdfDoc.getPage(1);
    const opList = await pdfPage.getOperatorList();
    const textContent = await pdfPage.getTextContent();
    assert.ok(Array.isArray(opList.fnArray) && opList.fnArray.length > 0);
    assert.ok(textContent.items.some((it) => 'str' in it && it.str.includes('Hello')));
    pdfPage.cleanup();
    await pdfDoc.destroy();

    // 16. Atomic import copy, file health diagnostics, duplicate-import auto-heal & relink recovery
    const recoveryDir = path.join(tempRoot, 'RecoveryFoxReaderData');
    const recoveryDb = new FoxReaderDatabase(recoveryDir);
    const recoverPdfSrc = path.join(tempRoot, 'recover-sample.pdf');
    fs.writeFileSync(recoverPdfSrc, '%PDF-1.4\n% Recoverable sample PDF\n%%EOF\n', 'utf-8');
    const recImport = await recoveryDb.importPdfFile(recoverPdfSrc, null, recoveryDir);
    assert.equal(recImport.status, 'imported');
    const recPaper = recImport.paper;
    assert.ok(recPaper);

    const recPdfsDir = path.join(recoveryDir, 'pdfs');
    assert.equal(
      fs.readdirSync(recPdfsDir).some((name) => name.endsWith('.tmp')),
      false,
      'Atomic copy should leave no temporary files',
    );
    assert.equal((await recoveryDb.checkPaperFileStatus(recPaper.id, recoveryDir)).status, 'ok');

    await recoveryDb.createAnnotation(
      {
        paperId: recPaper.id,
        type: 'text',
        pageNumber: 1,
        rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }],
        color: 'yellow',
        quoteText: 'Preserve me across recovery',
      },
      recoveryDir,
    );

    const recManagedPath = path.join(recPdfsDir, `${recPaper.sha256}.pdf`);
    fs.rmSync(recManagedPath, { force: true });
    assert.equal((await recoveryDb.checkPaperFileStatus(recPaper.id, recoveryDir)).status, 'missing');

    const icloudPlaceholderPath = path.join(recPdfsDir, `.${recPaper.sha256}.pdf.icloud`);
    fs.writeFileSync(icloudPlaceholderPath, 'placeholder', 'utf-8');
    assert.equal(
      (await recoveryDb.checkPaperFileStatus(recPaper.id, recoveryDir)).status,
      'icloud-placeholder',
    );
    fs.rmSync(icloudPlaceholderPath, { force: true });

    fs.writeFileSync(recManagedPath, '', 'utf-8');
    assert.equal((await recoveryDb.checkPaperFileStatus(recPaper.id, recoveryDir)).status, 'empty');

    const healedImport = await recoveryDb.importPdfFile(recoverPdfSrc, null, recoveryDir);
    assert.equal(healedImport.status, 'duplicate');
    assert.equal(healedImport.repaired, true);
    assert.equal(healedImport.paper.id, recPaper.id);
    assert.equal((await recoveryDb.checkPaperFileStatus(recPaper.id, recoveryDir)).status, 'ok');
    assert.equal(recoveryDb.listAnnotations(recPaper.id).length, 1);

    fs.rmSync(recManagedPath, { force: true });
    const wrongPdfSrc = path.join(tempRoot, 'wrong-sample.pdf');
    fs.writeFileSync(wrongPdfSrc, '%PDF-1.4\n% Different content\n%%EOF\n', 'utf-8');
    const wrongRelink = await recoveryDb.relinkPaperFile(recPaper.id, wrongPdfSrc, recoveryDir);
    assert.equal(wrongRelink.ok, false);
    assert.equal((await recoveryDb.checkPaperFileStatus(recPaper.id, recoveryDir)).status, 'missing');

    const okRelink = await recoveryDb.relinkPaperFile(recPaper.id, recoverPdfSrc, recoveryDir);
    assert.equal(okRelink.ok, true);
    assert.equal((await recoveryDb.checkPaperFileStatus(recPaper.id, recoveryDir)).status, 'ok');
    assert.equal(recoveryDb.listAnnotations(recPaper.id).length, 1);

    // 17. Academic metadata (DOI, arXiv ID, venue, bibtex) persistence, search & ordered getPapersByIds
    const enrichedPaper = recoveryDb.updatePaperMetadata(recPaper.id, {
      doi: '10.18653/v1/2024.emnlp-main.12',
      arxivId: '2405.12345v2',
      venue: 'EMNLP 2024',
      bibtex: '@inproceedings{smith2024sparse,\n  title={Sparse Routing}\n}',
    });
    assert.equal(enrichedPaper.doi, '10.18653/v1/2024.emnlp-main.12');
    assert.equal(enrichedPaper.arxivId, '2405.12345v2');
    assert.equal(enrichedPaper.venue, 'EMNLP 2024');
    assert.ok(enrichedPaper.bibtex.includes('smith2024sparse'));
    assert.equal(recoveryDb.listPapers({ view: 'all', search: 'EMNLP' }).length, 1);
    assert.equal(recoveryDb.listPapers({ view: 'all', search: '2405.12345v2' }).length, 1);
    assert.equal(recoveryDb.listPapers({ view: 'all', search: '2024.emnlp-main.12' }).length, 1);

    const secondPdfSrc = path.join(tempRoot, 'order-second.pdf');
    fs.writeFileSync(secondPdfSrc, '%PDF-1.4\n% Order second PDF\n%%EOF\n', 'utf-8');
    const secondImp = await recoveryDb.importPdfFile(secondPdfSrc, null, recoveryDir);
    assert.equal(secondImp.status, 'imported');
    const orderedBatch = recoveryDb.getPapersByIds([secondImp.paper.id, recPaper.id, 'missing-id']);
    assert.deepEqual(
      orderedBatch.map((p) => p.id),
      [secondImp.paper.id, recPaper.id],
    );

    // 18. Folder move (promote to top-level, reparent & cycle rejection)
    const topFolderA = recoveryDb.createFolder('Research', null);
    const subFolderB = recoveryDb.createFolder('QIR', topFolderA.id);
    recoveryDb.movePaperToFolder(secondImp.paper.id, subFolderB.id);
    const ovBeforeMove = recoveryDb.getLibraryOverview();
    assert.equal(ovBeforeMove.folderCounts[topFolderA.id], 1);
    assert.equal(ovBeforeMove.folderCounts[subFolderB.id], 1);
    assert.equal(recoveryDb.listPapers({ view: 'folder', folderId: topFolderA.id }).length, 1);

    assert.throws(() => recoveryDb.moveFolder(topFolderA.id, subFolderB.id));
    const promotedB = recoveryDb.moveFolder(subFolderB.id, null);
    assert.equal(promotedB.parentId, null);
    const ovAfterMove = recoveryDb.getLibraryOverview();
    assert.equal(ovAfterMove.folderCounts[topFolderA.id] ?? 0, 0);
    assert.equal(ovAfterMove.folderCounts[subFolderB.id], 1);

    // 19. Reading progress persistence (page, zoom, scrollRatio) + clamping + omitted ratio preservation
    recoveryDb.updatePaperProgress(secondImp.paper.id, 7, 1.35, 0.425);
    let progressed = recoveryDb.getPaperById(secondImp.paper.id);
    assert.equal(progressed.lastPage, 7);
    assert.equal(progressed.lastZoom, 1.35);
    assert.equal(progressed.lastScrollRatio, 0.425);

    recoveryDb.updatePaperProgress(secondImp.paper.id, 8, 1.5);
    progressed = recoveryDb.getPaperById(secondImp.paper.id);
    assert.equal(progressed.lastPage, 8);
    assert.equal(progressed.lastZoom, 1.5);
    assert.equal(progressed.lastScrollRatio, 0.425, 'Omitting lastScrollRatio should preserve previous ratio');

    recoveryDb.updatePaperProgress(secondImp.paper.id, 0, 9.9, 1.8);
    progressed = recoveryDb.getPaperById(secondImp.paper.id);
    assert.equal(progressed.lastPage, 1);
    assert.equal(progressed.lastZoom, 4.0);
    assert.equal(progressed.lastScrollRatio, 1.0);

    recoveryDb.close();

    // 20. Legacy schema migration adds last_scroll_ratio column cleanly
    const progressLegacyDir = path.join(tempRoot, 'progress-legacy-db-dir');
    fs.mkdirSync(progressLegacyDir, { recursive: true });
    const { DatabaseSync: SqliteDatabaseSync } = await import('node:sqlite');
    const progressLegacyRaw = new SqliteDatabaseSync(path.join(progressLegacyDir, 'library.db'));
    progressLegacyRaw.exec(`
      CREATE TABLE papers (
        id TEXT PRIMARY KEY,
        sha256 TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        authors TEXT NOT NULL DEFAULT '',
        year INTEGER NULL,
        folder_id TEXT NULL,
        status TEXT NOT NULL DEFAULT 'unread',
        page_count INTEGER NOT NULL DEFAULT 0,
        last_page INTEGER NOT NULL DEFAULT 1,
        last_zoom REAL NOT NULL DEFAULT 1.0,
        file_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE search_fts USING fts5(paper_id UNINDEXED, title, authors, affiliations, tags, quote_text, comment, content_md);
      INSERT INTO papers (id, sha256, title, file_name, created_at, updated_at)
      VALUES ('legacy-progress-1', '${'0'.repeat(64)}', 'Legacy Note', 'legacy.md', 1000, 1000);
    `);
    progressLegacyRaw.close();

    const progressMigratedDb = new FoxReaderDatabase(progressLegacyDir);
    const progressLegacyPaper = progressMigratedDb.getPaperById('legacy-progress-1');
    assert.equal(progressLegacyPaper.lastScrollRatio, 0);
    progressMigratedDb.updatePaperProgress('legacy-progress-1', 1, 1.2, 0.67);
    assert.equal(progressMigratedDb.getPaperById('legacy-progress-1').lastScrollRatio, 0.67);
    progressMigratedDb.close();

    console.log('ALL_DB_TESTS_PASSED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

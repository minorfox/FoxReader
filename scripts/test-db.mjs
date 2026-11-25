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

    db.close();
    console.log('ALL_DB_TESTS_PASSED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

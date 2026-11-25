import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foxreader-db-test-'));
  const bundlePath = path.join(tempRoot, 'database.mjs');
  const dataDir = path.join(tempRoot, 'FoxReaderData');

  try {
    await esbuild.build({
      entryPoints: [path.resolve('src/main/database.ts')],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      external: ['node:sqlite'],
    });

    const { FoxReaderDatabase } = await import(pathToFileURL(bundlePath).toString());
    const db = new FoxReaderDatabase(dataDir);

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

    // 6. Delete paper -> DB row + managed PDF deleted
    await db.deletePaper(reloadedPaper.id, dataDir);
    assert.equal(db.getPaperById(reloadedPaper.id), null);
    assert.equal(fs.existsSync(managedPdfPath), false, 'Managed PDF should be deleted after deletePaper');

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

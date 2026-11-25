import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import esbuild from 'esbuild';

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foxreader-meta-test-'));
  const bundlePath = path.join(tempRoot, 'pdfMetadata.mjs');

  try {
    await esbuild.build({
      entryPoints: [path.resolve('src/renderer/lib/pdfMetadata.ts')],
      outfile: bundlePath,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
    });

    const { parsePdfHeaderFromPage1 } = await import(pathToFileURL(bundlePath).toString());

    // 1. ACM-style layout: truncated Info.Author ("Qiang Gao"), 2-line wrapped affiliation, location & email lines
    const acmItems = [
      { str: 'Self-Supervised Trajectory Representation Learning', x: 70, y: 710, h: 16, w: 380 },
      { str: 'Qiang Gao', x: 90, y: 660, h: 12, w: 65 },
      { str: 'Southwestern University of Finance', x: 60, y: 642, h: 10, w: 170 },
      { str: 'and Economics', x: 105, y: 630, h: 10, w: 70 },
      { str: 'Chengdu, Sichuan, China', x: 90, y: 618, h: 9, w: 110 },
      { str: 'qianggao@swufe.edu.cn', x: 90, y: 606, h: 9, w: 110 },
      { str: 'Fan Zhou', x: 350, y: 660, h: 12, w: 55 },
      { str: 'University of Electronic Science', x: 310, y: 642, h: 10, w: 155 },
      { str: 'and Technology of China', x: 325, y: 630, h: 10, w: 120 },
      { str: 'fz@uestc.edu.cn', x: 335, y: 606, h: 9, w: 80 },
      { str: 'ABSTRACT', x: 70, y: 540, h: 11, w: 70 },
    ];
    const acm = parsePdfHeaderFromPage1(acmItems, 792, {
      title: 'Self-Supervised Trajectory Representation Learning',
      authors: 'Qiang Gao',
    });
    assert.equal(acm.title, 'Self-Supervised Trajectory Representation Learning');
    assert.ok(acm.authors?.includes('Qiang Gao'));
    assert.ok(acm.authors?.includes('Fan Zhou'));
    assert.ok(acm.affiliations?.includes('Southwestern University of Finance and Economics'));
    assert.ok(acm.affiliations?.includes('University of Electronic Science and Technology of China'));

    // 2. EMNLP-style layout: empty Info dict, superscripts offset in y, DOI & year
    const emnlpItems = [
      { str: 'Proceedings of the 2024 Conference on Empirical Methods in NLP', x: 70, y: 40, h: 9, w: 300 },
      { str: 'Reasoning with Structured Graphs in', x: 110, y: 755, h: 14.3, w: 280 },
      { str: 'Large Language Models', x: 175, y: 738, h: 14.3, w: 170 },
      { str: '1', x: 172, y: 724, h: 7.2, w: 5 },
      { str: 'Alice Smith', x: 115, y: 720, h: 12, w: 56 },
      { str: '2*', x: 256, y: 724, h: 7.2, w: 8 },
      { str: 'Bob Jones', x: 195, y: 720, h: 12, w: 60 },
      { str: '1 Stanford University  2 MIT CSAIL', x: 125, y: 700, h: 10, w: 220 },
      { str: 'doi:10.18653/v1/2024.emnlp-main.12', x: 70, y: 680, h: 9, w: 180 },
      { str: 'Abstract', x: 70, y: 640, h: 11, w: 50 },
    ];
    const emnlp = parsePdfHeaderFromPage1(emnlpItems, 792, { title: '', authors: '' });
    assert.equal(emnlp.title, 'Reasoning with Structured Graphs in Large Language Models');
    assert.ok(emnlp.authors?.includes('Alice Smith'));
    assert.ok(emnlp.authors?.includes('Bob Jones'));
    assert.ok(!emnlp.authors?.includes('1'));
    assert.ok(emnlp.affiliations?.includes('Stanford University'));
    assert.equal(emnlp.year, 2024);
    assert.equal(emnlp.doi, '10.18653/v1/2024.emnlp-main.12');

    // 3. Elsevier journal chrome ("Information Fusion" larger than article title)
    const elsevierItems = [
      { str: 'Contents lists available at ScienceDirect', x: 150, y: 725, h: 9, w: 190 },
      { str: 'Information Fusion', x: 200, y: 695, h: 13.9, w: 130 },
      { str: 'journal homepage: www.elsevier.com/locate/inffus', x: 145, y: 670, h: 8.5, w: 200 },
      { str: 'Multimodal Contrastive Fusion for Urban Sensing', x: 80, y: 615, h: 13.4, w: 340 },
      { str: 'Wei Chen, Li Wang', x: 80, y: 585, h: 10.5, w: 120 },
      { str: 'School of Computer Science, Tsinghua University', x: 80, y: 568, h: 9, w: 230 },
      { str: 'ARTICLE INFO', x: 80, y: 530, h: 9, w: 80 },
    ];
    const elsevier = parsePdfHeaderFromPage1(elsevierItems, 792, {
      title: 'Multimodal Contrastive Fusion for Urban Sensing',
      authors: 'Wei Chen',
    });
    assert.equal(elsevier.title, 'Multimodal Contrastive Fusion for Urban Sensing');
    assert.ok(elsevier.authors?.includes('Li Wang'));
    assert.ok(elsevier.affiliations?.includes('Tsinghua University'));

    // 4. Chinese journal layout with dirty Info.Author ("微软用户")
    const cnItems = [
      { str: '第 47 卷 第 3 期  计算机学报  Vol. 47 No. 3', x: 80, y: 760, h: 9.5, w: 300 },
      { str: '面向复杂图数据的表示学习综述', x: 130, y: 705, h: 16, w: 260 },
      { str: '张 三1)  李 四2)', x: 180, y: 675, h: 11, w: 120 },
      { str: '1)(清华大学计算机科学与技术系 北京 100084)', x: 120, y: 655, h: 9.5, w: 240 },
      { str: '2)(中国科学院计算技术研究所 北京 100190)', x: 120, y: 640, h: 9.5, w: 240 },
      { str: '摘 要 本文综述了面向复杂图数据的表示学习方法。', x: 80, y: 600, h: 10, w: 300 },
    ];
    const cn = parsePdfHeaderFromPage1(cnItems, 842, {
      title: 'untitled.pdf',
      authors: '微软用户',
    });
    assert.equal(cn.title, '面向复杂图数据的表示学习综述');
    assert.ok(!cn.authors?.includes('微软用户'));
    assert.ok(cn.affiliations?.includes('清华大学计算机科学与技术系'));
    assert.ok(cn.affiliations?.includes('中国科学院计算技术研究所'));

    console.log('ALL_METADATA_TESTS_PASSED');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

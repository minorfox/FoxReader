export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  h: number;
  w: number;
}

export interface PdfInfoMetadata {
  title?: string;
  authors?: string;
  creationDate?: string;
}

export interface ExtractedPdfHeader {
  title?: string;
  authors?: string;
  affiliations?: string;
  year?: number | null;
  doi?: string;
}

interface TextLine {
  y: number;
  maxH: number;
  avgH: number;
  minX: number;
  maxX: number;
  text: string;
  items: PdfTextItem[];
}

const DIRTY_METADATA_PATTERNS = [
  /^(untitled|document\d*|microsoft\s+word|powerpoint|wps|adobe\s+pdf|unknown|user|administrator)$/i,
  /^(微软用户|未命名|新建文本文档|管理员)$/i,
  /\.(pdf|docx?|pptx?|xlsx?|tex|wps|rtf)$/i,
  /^(arxiv|doi)\s*:/i,
  /^https?:\/\//i,
];

const PUBLISHER_CHROME_PATTERNS = [
  /contents\s+lists\s+available\s+at/i,
  /journal\s+homepage\s*:/i,
  /sciencedirect/i,
  /check\s+for\s+updates/i,
  /available\s+online\s+at/i,
  /open\s+access/i,
  /creative\s+commons/i,
  /preprint\s*\.\s*under\s+review/i,
  /^(vol\.|volume|issue|no\.|issn|isbn|doi)\b/i,
  /^(proceedings\s+of|published\s+in|accepted\s+manuscript|article\s+info)\b/i,
  /^(ieee\s+transactions|acm\s+transactions|chinese\s+journal\s+of|journal\s+of\s+[a-z\s]+)$/i,
  /^(information\s+fusion|pattern\s+recognition|neurocomputing|knowledge-based\s+systems|expert\s+systems\s+with\s+applications)$/i,
  /(计算机学报|软件学报|自动化学报|电子学报|通信学报|《中国科学》|中国科学\s*[：:])/,
  /(第\s*\d+\s*卷|第\s*\d+\s*期|收稿日期|修回日期|基金项目|作者简介|中图分类号|文献标志码|网络首发)/,
];

const HEADER_END_PATTERNS = [
  /^(abstract|a\s+b\s+s\s+t\s+r\s+a\s+c\s+t)\b[:.\-—]?/i,
  /^(keywords|index\s+terms|article\s+info)\b[:.\-—]?/i,
  /^(1\.?\s+introduction|i\.?\s+introduction)\b/i,
  /^(摘\s*要|关\s*键\s*词|引\s*言|1\s+引\s*言)\s*[:：]?/,
  /^(收稿日期|基金项目|作者简介|中图分类号)\s*[:：]/,
];

const AFFILIATION_REGEX =
  /\b(university|univ\.?|institute|institut|college|school|department|dept\.?|laboratory|lab\.?|center|centre|academy|faculty|hospital|research|corporation|corp\.?|google|microsoft|meta|amazon|baidu|tencent|alibaba|bytedance|huawei|nvidia|openai|deepmind)\b|(大学|学院|研究所|研究院|实验室|研究中心|重点实验室|中国科学院|中科院|社科院|医院|公司)/i;

const EMAIL_OR_URL_REGEX = /(@|e-?mail\s*:|orcid|https?:\/\/|www\.)/i;

const PURE_LOCATION_REGEX =
  /^[A-Z][A-Za-z.\-\s]+,\s*(?:[A-Z]{2,}|\d{4,6}|China|USA|U\.S\.A\.|UK|United\s+States|United\s+Kingdom|Germany|France|Japan|Canada|Australia|Singapore|Korea|Switzerland|Italy|Spain|Netherlands|India)(?:,\s*[A-Za-z0-9\s]+)*$/i;

const PERSON_LIST_SEPARATOR = /[,，;；、]|\band\b/i;

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isDirtyValue(raw?: string): boolean {
  if (!raw) return true;
  const clean = normalizeSpaces(raw);
  if (clean.length < 2) return true;
  if (/^\d+$/.test(clean)) return true;
  if (clean.includes('\ufffd')) return true;
  return DIRTY_METADATA_PATTERNS.some((re) => re.test(clean));
}

function isPublisherChrome(text: string): boolean {
  const clean = normalizeSpaces(text);
  if (!clean) return true;
  if (EMAIL_OR_URL_REGEX.test(clean)) return true;
  return PUBLISHER_CHROME_PATTERNS.some((re) => re.test(clean));
}

function isSuperscriptToken(item: PdfTextItem, baselineH: number): boolean {
  const s = item.str.trim();
  if (!s) return true;
  const h = item.h;
  if (h <= 0 || baselineH <= 0) return false;
  if (h >= Math.min(8.8, baselineH * 0.78)) return false;
  return /^[\d,\s*†‡§¶∗✉a-zA-Z]{1,6}$/.test(s);
}

function joinLineItems(items: PdfTextItem[], suppressInlineSuperscripts = false, baselineH = 10): string {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let out = '';
  let prev: PdfTextItem | null = null;

  for (const item of sorted) {
    const piece = item.str.replace(/\s+/g, ' ');
    if (!piece.trim()) continue;
    if (suppressInlineSuperscripts && isSuperscriptToken(item, baselineH)) {
      continue;
    }

    if (prev) {
      const gap = item.x - (prev.x + prev.w);
      const needsSpace =
        gap > Math.max(1.5, Math.min(prev.h, item.h) * 0.18) ||
        (/[A-Za-z0-9.,;:)\]]$/.test(out) && /^[A-Za-z0-9(]/.test(piece.trim()) && gap > 0.7);
      if (needsSpace && !out.endsWith(' ') && !piece.startsWith(' ')) {
        out += ' ';
      }
    }
    out += piece;
    prev = item;
  }

  return normalizeSpaces(out);
}

function groupPageItemsIntoLines(items: PdfTextItem[]): TextLine[] {
  const nonEmpty = items.filter((item) => item.str.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  // Sort top-to-bottom (y descending), then left-to-right (x ascending)
  const sorted = [...nonEmpty].sort((a, b) => {
    if (Math.abs(b.y - a.y) > 1.5) return b.y - a.y;
    return a.x - b.x;
  });

  const groups: Array<{ y: number; maxH: number; items: PdfTextItem[] }> = [];

  for (const item of sorted) {
    const tol = Math.max(3.2, item.h * 0.42);
    let targetGroup = groups.find((g) => Math.abs(g.y - item.y) <= Math.max(tol, g.maxH * 0.42));
    if (!targetGroup) {
      targetGroup = { y: item.y, maxH: item.h, items: [item] };
      groups.push(targetGroup);
    } else {
      targetGroup.items.push(item);
      if (item.h > targetGroup.maxH) targetGroup.maxH = item.h;
    }
  }

  const splitSegments: Array<{ y: number; items: PdfTextItem[] }> = [];
  for (const g of groups) {
    const byX = [...g.items].sort((a, b) => a.x - b.x);
    let currentItems: PdfTextItem[] = [];
    let prev: PdfTextItem | null = null;
    for (const item of byX) {
      if (prev) {
        const gap = item.x - (prev.x + prev.w);
        const colGapThreshold = Math.max(28, Math.max(prev.h, item.h) * 2.6);
        if (gap > colGapThreshold && currentItems.length > 0) {
          splitSegments.push({ y: g.y, items: currentItems });
          currentItems = [];
        }
      }
      currentItems.push(item);
      prev = item;
    }
    if (currentItems.length > 0) {
      splitSegments.push({ y: g.y, items: currentItems });
    }
  }

  return splitSegments
    .map((g) => {
      const text = joinLineItems(g.items);
      let weightedH = 0;
      let totalChars = 0;
      let maxH = 0;
      let minX = Infinity;
      let maxX = -Infinity;

      for (const it of g.items) {
        const len = it.str.trim().length;
        if (it.h > maxH) maxH = it.h;
        weightedH += it.h * len;
        totalChars += len;
        if (it.x < minX) minX = it.x;
        if (it.x + it.w > maxX) maxX = it.x + it.w;
      }

      return {
        y: g.y,
        maxH,
        avgH: totalChars > 0 ? weightedH / totalChars : maxH,
        minX,
        maxX,
        text,
        items: g.items,
      };
    })
    .filter((line) => line.text.length > 0 && !/^[\d,\s*†‡§¶∗✉]+$/.test(line.text))
    .sort((a, b) => (Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.minX - b.minX));
}

function extractDoi(fullText: string): string | undefined {
  const match = fullText.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/);
  if (!match?.[1]) return undefined;
  return match[1].replace(/[.,;)\]]+$/, '');
}

function extractYear(lines: TextLine[], creationDate?: string): number | null {
  const currentYear = new Date().getFullYear();
  const isValidYear = (y: number) => y >= 1950 && y <= currentYear + 1;

  for (const line of lines) {
    if (
      /(©|copyright|published|accepted|emnlp|acl|neurips|iclr|icml|cvpr|aaai|ijcai|kdd|sigir|ieee|acm|计算机|学报|年)/i.test(
        line.text,
      )
    ) {
      const matches = line.text.match(/\b(19[89]\d|20[0-3]\d)\b/g);
      if (matches) {
        for (const m of matches) {
          const yr = Number.parseInt(m, 10);
          if (isValidYear(yr)) return yr;
        }
      }
    }
  }

  for (const line of lines.slice(0, 12)) {
    const match = line.text.match(/\b(20[0-3]\d)\b/);
    if (match?.[1]) {
      const yr = Number.parseInt(match[1], 10);
      if (isValidYear(yr)) return yr;
    }
  }

  if (creationDate) {
    const m = creationDate.match(/(19[89]\d|20[0-3]\d)/);
    if (m?.[1]) {
      const yr = Number.parseInt(m[1], 10);
      if (isValidYear(yr)) return yr;
    }
  }

  return null;
}

const NON_NAME_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'from',
  'by',
  'via',
  'using',
  'based',
  'toward',
  'towards',
  'learning',
  'model',
  'models',
  'neural',
  'network',
  'networks',
  'system',
  'systems',
  'analysis',
  'survey',
  'review',
  'paper',
  'preprint',
  'submitted',
  'under',
]);

function cleanAuthorTokens(rawText: string, items?: PdfTextItem[], baselineH = 11): string[] {
  // If raw PDF items are provided, split groups separated by superscript tokens or medium horizontal gaps
  if (items && items.length > 1) {
    const sorted = [...items].sort((a, b) => a.x - b.x);
    const chunks: PdfTextItem[][] = [];
    let current: PdfTextItem[] = [];
    let prev: PdfTextItem | null = null;
    for (const item of sorted) {
      if (!item.str.trim()) continue;
      if (isSuperscriptToken(item, baselineH)) {
        if (current.length > 0) {
          chunks.push(current);
          current = [];
        }
        prev = item;
        continue;
      }
      if (prev) {
        const gap = item.x - (prev.x + prev.w);
        if (gap > Math.max(10, baselineH * 0.95) && current.length > 0) {
          chunks.push(current);
          current = [];
        }
      }
      current.push(item);
      prev = item;
    }
    if (current.length > 0) chunks.push(current);

    if (chunks.length > 1) {
      const fromChunks: string[] = [];
      for (const chunk of chunks) {
        const text = joinLineItems(chunk, false, baselineH);
        fromChunks.push(...cleanAuthorTokens(text));
      }
      if (fromChunks.length > 0) return fromChunks;
    }
  }

  const preSplitByWideSpaces = rawText.replace(/\s{2,}/g, ', ');
  const cleaned = preSplitByWideSpaces
    .replace(/[†‡§¶∗✉]/g, ' ')
    .replace(/\([^)]*@[^)]*\)/g, ' ')
    // Strip trailing superscript markers like "Qiang Gao1,2*", "张 三1)"
    .replace(/([A-Za-z\u4e00-\u9fff])[0-9,*†‡)\]]+(?=\s|,|;|$)/g, '$1')
    .replace(/^\s*by\s+/i, '');

  const parts = cleaned
    .split(/\s*(?:,|，|;|；|\band\b|\b&\b|、)\s*/i)
    .map((p) =>
      normalizeSpaces(p.replace(/^[*†‡0-9.\s()[\]]+/, '').replace(/[*†‡0-9\s()[\]]+$/, '')),
    )
    .filter((p) => {
      if (p.length < 2 || p.length > 60) return false;
      if (/\d/.test(p)) return false;
      if (EMAIL_OR_URL_REGEX.test(p)) return false;
      if (AFFILIATION_REGEX.test(p)) return false;
      if (isDirtyValue(p)) return false;
      const words = p.toLowerCase().split(/\s+/);
      if (words.some((w) => NON_NAME_STOPWORDS.has(w))) return false;
      return /[A-Za-z\u4e00-\u9fff]{2,}/.test(p);
    });

  return parts;
}

function looksLikeSingleAuthorLine(text: string): boolean {
  const clean = normalizeSpaces(text);
  if (clean.length < 2 || clean.length > 160) return false;
  if (AFFILIATION_REGEX.test(clean) || EMAIL_OR_URL_REGEX.test(clean) || PURE_LOCATION_REGEX.test(clean)) {
    return false;
  }
  if (isPublisherChrome(clean)) return false;
  if (/[.:：!?]/.test(clean) && !/\b[A-Z]\./.test(clean)) return false;
  if (PERSON_LIST_SEPARATOR.test(clean)) return true;

  const words = clean.split(/\s+/);
  if (words.some((w) => NON_NAME_STOPWORDS.has(w.toLowerCase()))) return false;
  if (words.length >= 2 && words.length <= 12 && words.every((w) => /^[A-Z\u4e00-\u9fff]/.test(w))) {
    return true;
  }
  const cjkCompact = clean.replace(/\s+/g, '');
  if (/^[\u4e00-\u9fff]{2,8}$/.test(cjkCompact)) return true;
  return false;
}

function cleanAffiliationSegment(raw: string): string {
  let cleaned = normalizeSpaces(
    raw
      .replace(/^(?:\(\d+\)|\d+[.)\]]+|\[\d+\]|[*,†‡§¶∗✉]+)+\s*/, '')
      .replace(/\s*[,;.]\s*$/, ''),
  );
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    cleaned = cleaned.slice(1, -1).trim();
  } else if (cleaned.startsWith('（') && cleaned.endsWith('）')) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

/**
 * Extracts paper title, authors, affiliations, year, and DOI from PDF Page 1 text layout + PDF Info dict.
 */
export function parsePdfHeaderFromPage1(
  items: PdfTextItem[],
  pageHeight: number,
  infoMeta?: PdfInfoMetadata,
): ExtractedPdfHeader {
  const lines = groupPageItemsIntoLines(items);
  const fullText = lines.map((l) => l.text).join('\n');
  const doi = extractDoi(fullText);
  const year = extractYear(lines, infoMeta?.creationDate);

  const infoTitle =
    infoMeta?.title && !isDirtyValue(infoMeta.title) && !isPublisherChrome(infoMeta.title)
      ? normalizeSpaces(infoMeta.title)
      : undefined;
  const infoAuthors =
    infoMeta?.authors && !isDirtyValue(infoMeta.authors)
      ? cleanAuthorTokens(infoMeta.authors)
      : [];

  if (lines.length === 0) {
    return {
      title: infoTitle,
      authors: infoAuthors.length > 0 ? infoAuthors.join(', ') : undefined,
      year,
      doi,
    };
  }

  // Locate Elsevier/publisher banner band y-coordinates to avoid picking journal name as title
  const chromeBannerYs = lines
    .filter((l) => /(contents\s+lists\s+available\s+at|journal\s+homepage|sciencedirect)/i.test(l.text))
    .map((l) => l.y);

  // Determine where header ends (Abstract / Intro / Keywords)
  let headerEndY = pageHeight * 0.2;
  for (const line of lines) {
    if (line.y < pageHeight * 0.85 && HEADER_END_PATTERNS.some((re) => re.test(line.text))) {
      headerEndY = line.y;
      break;
    }
  }

  // Candidate lines for Tier 1 title: top region above headerEndY
  const titleCandidates = lines.filter((line) => {
    if (line.y <= headerEndY || line.y < pageHeight * 0.4) return false;
    if (isPublisherChrome(line.text) || isDirtyValue(line.text)) return false;
    if (AFFILIATION_REGEX.test(line.text) && line.avgH < 13) return false;
    if (chromeBannerYs.some((by) => Math.abs(by - line.y) < 42 && line.text.split(/\s+/).length <= 4)) {
      return false;
    }
    return line.text.length >= 4 && line.text.length <= 240;
  });

  let titleLines: TextLine[] = [];
  if (titleCandidates.length > 0) {
    const maxTitleH = Math.max(...titleCandidates.map((l) => l.avgH));
    // Pick the topmost line close to maxTitleH
    const anchor = titleCandidates.find((l) => l.avgH >= maxTitleH - Math.max(1.2, maxTitleH * 0.08));
    if (anchor) {
      titleLines = [anchor];
      const anchorIdx = lines.indexOf(anchor);
      for (let i = anchorIdx + 1; i < lines.length; i += 1) {
        const next = lines[i];
        if (next.y <= headerEndY) break;
        const dy = titleLines[titleLines.length - 1].y - next.y;
        const heightClose = Math.abs(next.avgH - anchor.avgH) <= Math.max(1.6, anchor.avgH * 0.14);
        if (
          dy > 0 &&
          dy <= anchor.maxH * 2.5 &&
          heightClose &&
          !isPublisherChrome(next.text) &&
          !HEADER_END_PATTERNS.some((re) => re.test(next.text))
        ) {
          titleLines.push(next);
        } else {
          break;
        }
      }
    }
  }

  const page1TitleRaw = normalizeSpaces(titleLines.map((l) => l.text).join(' '));
  const page1Title =
    page1TitleRaw.length >= 6 && !isDirtyValue(page1TitleRaw) && !isPublisherChrome(page1TitleRaw)
      ? page1TitleRaw
      : undefined;

  // Choose best title between Tier 1 (Page 1 layout) and Tier 2 (PDF Info)
  let resolvedTitle: string | undefined;
  if (page1Title && infoTitle) {
    resolvedTitle = page1Title.length >= infoTitle.length * 0.85 ? page1Title : infoTitle;
  } else {
    resolvedTitle = page1Title ?? infoTitle;
  }

  // Extract Authors & Affiliations from lines between title block bottom and headerEndY
  const titleBottomY =
    titleLines.length > 0 ? titleLines[titleLines.length - 1].y - 1 : pageHeight * 0.92;
  const bodyLines = lines.filter((l) => l.y < titleBottomY && l.y > headerEndY);

  const authorList: string[] = [];
  const authorSeen = new Set<string>();
  const affiliationList: string[] = [];
  const affiliationSeen = new Set<string>();

  const pushAuthor = (name: string) => {
    const key = name.toLowerCase();
    if (!authorSeen.has(key)) {
      authorSeen.add(key);
      authorList.push(name);
    }
  };

  const pushAffiliation = (rawAff: string) => {
    const segments = rawAff.split(/\s*[;；]\s*/);
    for (const seg of segments) {
      const clean = cleanAffiliationSegment(seg);
      if (clean.length < 3 || !AFFILIATION_REGEX.test(clean)) continue;
      const key = clean.toLowerCase();
      if (!affiliationSeen.has(key)) {
        affiliationSeen.add(key);
        affiliationList.push(clean);
      }
    }
  };

  const consumedBodyIndices = new Set<number>();
  const horizontallyAligned = (a: TextLine, b: TextLine) =>
    Math.min(a.maxX, b.maxX) + 35 >= Math.max(a.minX, b.minX);

  for (let i = 0; i < bodyLines.length; i += 1) {
    if (consumedBodyIndices.has(i)) continue;
    const line = bodyLines[i];
    const clean = normalizeSpaces(line.text);
    if (!clean || isPublisherChrome(clean) || EMAIL_OR_URL_REGEX.test(clean) || PURE_LOCATION_REGEX.test(clean)) {
      continue;
    }

    if (AFFILIATION_REGEX.test(clean)) {
      let merged = clean;
      let tailLine = line;
      // Merge wrapped 2-line affiliation in the same horizontal column
      for (let j = i + 1; j < bodyLines.length; j += 1) {
        if (consumedBodyIndices.has(j)) continue;
        const next = bodyLines[j];
        const dy = tailLine.y - next.y;
        if (dy <= 1) continue;
        if (dy > Math.max(20, line.maxH * 2.4)) break;
        if (!horizontallyAligned(tailLine, next)) continue;

        const nextClean = normalizeSpaces(next.text);
        const heightSimilar = Math.abs(next.avgH - line.avgH) <= 1.2;
        const isContinuation =
          nextClean.length > 0 &&
          heightSimilar &&
          !EMAIL_OR_URL_REGEX.test(nextClean) &&
          !PURE_LOCATION_REGEX.test(nextClean) &&
          !HEADER_END_PATTERNS.some((re) => re.test(nextClean)) &&
          (/^(and|of|for|in|at|&|,)/i.test(nextClean) ||
            /^[a-z]/.test(nextClean) ||
            (!AFFILIATION_REGEX.test(nextClean) &&
              !looksLikeSingleAuthorLine(nextClean) &&
              nextClean.split(/\s+/).length <= 4));
        if (!isContinuation) break;
        merged = `${merged} ${nextClean}`;
        tailLine = next;
        consumedBodyIndices.add(j);
      }
      pushAffiliation(merged);
      continue;
    }

    const cleanAuthorText = joinLineItems(line.items, true, line.maxH);
    if (looksLikeSingleAuthorLine(cleanAuthorText)) {
      for (const name of cleanAuthorTokens(cleanAuthorText, line.items, line.maxH)) {
        pushAuthor(name);
      }
    }
  }

  // Prefer fuller Page 1 author list over single truncated Info.Author
  let resolvedAuthors: string | undefined;
  if (authorList.length >= 2 || (authorList.length >= 1 && infoAuthors.length <= 1)) {
    resolvedAuthors = authorList.join(', ');
  } else if (infoAuthors.length > 0) {
    resolvedAuthors = infoAuthors.join(', ');
  } else if (authorList.length > 0) {
    resolvedAuthors = authorList.join(', ');
  }

  return {
    title: resolvedTitle,
    authors: resolvedAuthors,
    affiliations: affiliationList.length > 0 ? affiliationList.join('; ') : undefined,
    year,
    doi,
  };
}

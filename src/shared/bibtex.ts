export function cleanDoi(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;)\]]+$/, '');
  return /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/.test(trimmed) ? trimmed : null;
}

export function cleanArxivId(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/^arxiv:\s*/i, '')
    .replace(/\.pdf$/i, '')
    .replace(/[.,;)\]]+$/, '');
  if (/^\d{4}\.\d{4,5}(?:v\d+)?$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

const TITLE_KEY_STOPWORDS = new Set([
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
  'and',
  'or',
]);

export function generateCitationKey(paper: {
  authors?: string;
  year?: number | null;
  title?: string;
}): string {
  let surname = 'paper';
  const rawAuthors = (paper.authors ?? '').trim();
  if (rawAuthors) {
    const firstAuthor = rawAuthors.split(/\s*(?:,|，|;|；|、|\band\b)\s*/i)[0]?.trim() ?? '';
    if (firstAuthor) {
      const asciiWords = firstAuthor.match(/[A-Za-z]+/g);
      if (asciiWords && asciiWords.length > 0) {
        surname = asciiWords[asciiWords.length - 1].toLowerCase();
      }
    }
  }

  const yearPart = paper.year && Number.isFinite(paper.year) ? String(paper.year) : 'nd';

  let titleWord = '';
  const rawTitle = (paper.title ?? '').trim();
  if (rawTitle) {
    const words = rawTitle.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const w of words) {
      if (w.length >= 3 && !TITLE_KEY_STOPWORDS.has(w) && /[a-z]/.test(w)) {
        titleWord = w;
        break;
      }
    }
  }

  return `${surname}${yearPart}${titleWord}`;
}

export function inferBibtexEntryType(opts: {
  venue?: string;
  arxivId?: string;
  rawType?: string;
}): 'inproceedings' | 'article' | 'book' | 'misc' {
  const rawType = (opts.rawType ?? '').toLowerCase();
  const venue = (opts.venue ?? '').trim();

  if (
    rawType.includes('proceedings') ||
    rawType.includes('conference') ||
    /\b(proceedings|conference|workshop|symposium|neurips|nips|icml|iclr|acl|emnlp|naacl|cvpr|iccv|eccv|aaai|ijcai|kdd|sigir|sigmod|vldb|www|chi|icse|fse|usenix|osdi|sosp|ndss|ccs)\b/i.test(
      venue,
    )
  ) {
    return 'inproceedings';
  }
  if (rawType.includes('book') || rawType.includes('monograph')) {
    return 'book';
  }
  if ((venue && !/^arxiv$/i.test(venue)) || rawType.includes('journal') || rawType.includes('article')) {
    return 'article';
  }
  return 'misc';
}

export function formatBibtexAuthors(rawAuthors?: string): string {
  const trimmed = (rawAuthors ?? '').trim();
  if (!trimmed) return '';
  if (/\s+and\s+/i.test(trimmed) && !/[,，;；、]/.test(trimmed)) {
    return trimmed.replace(/\s+and\s+/gi, ' and ').replace(/\s+/g, ' ').trim();
  }
  const parts = trimmed
    .split(/\s*(?:,|，|;|；|、|\band\b)\s*/i)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return parts.join(' and ');
}

export function escapeBibtexValue(val: string): string {
  return val
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?<!\\)%/g, '\\%')
    .replace(/(?<!\\)&/g, '\\&');
}

export interface BibtexPaperInput {
  title: string;
  authors?: string;
  year?: number | null;
  venue?: string;
  doi?: string;
  arxivId?: string;
  bibtex?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  rawType?: string;
  primaryClass?: string;
}

export function buildBibtexFromPaper(paper: BibtexPaperInput): string {
  if (paper.bibtex && paper.bibtex.trim().length > 0) {
    return paper.bibtex.trim();
  }

  const entryType = inferBibtexEntryType({
    venue: paper.venue,
    arxivId: paper.arxivId,
    rawType: paper.rawType,
  });
  const key = generateCitationKey(paper);
  const fields: Array<[string, string]> = [];

  const title = escapeBibtexValue(paper.title || 'Untitled');
  fields.push(['title', title]);

  const authors = formatBibtexAuthors(paper.authors);
  if (authors) {
    fields.push(['author', escapeBibtexValue(authors)]);
  }

  const venue = escapeBibtexValue(paper.venue ?? '');
  if (venue && !/^arxiv$/i.test(venue)) {
    fields.push([entryType === 'inproceedings' ? 'booktitle' : 'journal', venue]);
  }

  if (paper.year && Number.isFinite(paper.year)) {
    fields.push(['year', String(paper.year)]);
  }
  if (paper.volume?.trim()) {
    fields.push(['volume', escapeBibtexValue(paper.volume)]);
  }
  if (paper.issue?.trim()) {
    fields.push(['number', escapeBibtexValue(paper.issue)]);
  }
  if (paper.pages?.trim()) {
    fields.push(['pages', escapeBibtexValue(paper.pages)]);
  }

  const doi = cleanDoi(paper.doi);
  if (doi) {
    fields.push(['doi', doi]);
  }

  const arxivId = cleanArxivId(paper.arxivId);
  if (arxivId) {
    fields.push(['eprint', arxivId]);
    fields.push(['archivePrefix', 'arXiv']);
    if (paper.primaryClass?.trim()) {
      fields.push(['primaryClass', escapeBibtexValue(paper.primaryClass)]);
    }
  }

  const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
  return `@${entryType}{${key},\n${body}\n}`;
}

export function exportBibtexCollection(papers: BibtexPaperInput[]): string {
  if (papers.length === 0) return '';
  const usedKeys = new Set<string>();
  const entries: string[] = [];

  for (const paper of papers) {
    let entry = buildBibtexFromPaper(paper);
    const headerMatch = /^(@\w+\s*\{)([^,\s]+)(,)/.exec(entry);
    if (headerMatch) {
      const baseKey = headerMatch[2];
      let candidateKey = baseKey;
      if (usedKeys.has(candidateKey.toLowerCase())) {
        let assigned = false;
        for (let code = 98; code <= 122; code += 1) {
          const nextKey = `${baseKey}${String.fromCharCode(code)}`;
          if (!usedKeys.has(nextKey.toLowerCase())) {
            candidateKey = nextKey;
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          let num = 2;
          while (usedKeys.has(`${baseKey}${num}`.toLowerCase())) {
            num += 1;
          }
          candidateKey = `${baseKey}${num}`;
        }
        entry = `${headerMatch[1]}${candidateKey}${headerMatch[3]}${entry.slice(headerMatch[0].length)}`;
      }
      usedKeys.add(candidateKey.toLowerCase());
    }
    entries.push(entry);
  }

  return `${entries.join('\n\n')}\n`;
}

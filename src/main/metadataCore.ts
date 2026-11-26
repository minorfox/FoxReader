import { cleanArxivId, cleanDoi } from '../shared/bibtex.js';

export interface OpenAlexAuthorship {
  author?: { display_name?: string | null } | null;
  institutions?: Array<{ display_name?: string | null } | null> | null;
  raw_affiliation_strings?: Array<string | null> | null;
}

export interface OpenAlexWork {
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  doi?: string | null;
  type?: string | null;
  primary_location?: {
    source?: {
      display_name?: string | null;
      type?: string | null;
    } | null;
  } | null;
  biblio?: {
    volume?: string | null;
    issue?: string | null;
    first_page?: string | null;
    last_page?: string | null;
  } | null;
  authorships?: OpenAlexAuthorship[] | null;
}

export interface ParsedAcademicWork {
  title?: string;
  authors?: string;
  affiliations?: string;
  year: number | null;
  doi?: string;
  arxivId?: string;
  venue?: string;
  bibtex?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  rawType?: string;
  primaryClass?: string;
}

function tokenizeTitle(raw: string): string[] {
  const normalized = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[-‐‑–—:/\\()[\]{}.,;!?'"`~@#$%^&*+=|<>]/g, ' ');
  const tokens: string[] = [];
  const latinMatches = normalized.match(/[a-z0-9]+/g);
  if (latinMatches) {
    tokens.push(...latinMatches);
  }
  const cjkMatches = normalized.match(/[\u4e00-\u9fff]/g);
  if (cjkMatches) {
    tokens.push(...cjkMatches);
  }
  return tokens;
}

/**
 * Computes Dice token similarity in [0, 1] across both Latin words and CJK characters.
 */
export function computeTitleSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenizeTitle(a));
  const tokensB = new Set(tokenizeTitle(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  return (2 * overlap) / (tokensA.size + tokensB.size);
}

function isPreprintArchiveVenue(raw?: string | null): boolean {
  if (!raw) return true;
  const clean = raw.trim().toLowerCase();
  return !clean || clean === 'arxiv' || clean === 'arxiv (cornell university)' || clean === 'biorxiv' || clean === 'medrxiv';
}

export function extractOpenAlexWorkMetadata(work: OpenAlexWork): ParsedAcademicWork {
  const title = (work.title || work.display_name || '').trim() || undefined;
  const authorships = work.authorships ?? [];

  const authorSet = new Set<string>();
  const affiliationSet = new Set<string>();

  for (const item of authorships) {
    const authorName = item.author?.display_name?.trim();
    if (authorName) {
      authorSet.add(authorName);
    }

    const institutions = item.institutions ?? [];
    let foundStructuredInstitution = false;
    for (const inst of institutions) {
      const name = inst?.display_name?.trim();
      if (name) {
        affiliationSet.add(name);
        foundStructuredInstitution = true;
      }
    }

    if (!foundStructuredInstitution && item.raw_affiliation_strings) {
      for (const rawAff of item.raw_affiliation_strings) {
        const clean = rawAff?.trim();
        if (clean) {
          affiliationSet.add(clean);
        }
      }
    }
  }

  const authors = authorSet.size > 0 ? Array.from(authorSet).join(', ') : undefined;
  const affiliations = affiliationSet.size > 0 ? Array.from(affiliationSet).join('; ') : undefined;
  const year =
    typeof work.publication_year === 'number' && Number.isFinite(work.publication_year)
      ? work.publication_year
      : null;

  const doi = cleanDoi(work.doi ?? undefined) ?? undefined;
  const rawVenue = work.primary_location?.source?.display_name?.trim();
  const venue = rawVenue && !isPreprintArchiveVenue(rawVenue) ? rawVenue : undefined;

  const volume = work.biblio?.volume?.trim() || undefined;
  const issue = work.biblio?.issue?.trim() || undefined;
  const firstPage = work.biblio?.first_page?.trim() || '';
  const lastPage = work.biblio?.last_page?.trim() || '';
  const pages = firstPage && lastPage && firstPage !== lastPage ? `${firstPage}--${lastPage}` : firstPage || undefined;

  return {
    title,
    authors,
    affiliations,
    year,
    doi,
    venue,
    volume,
    issue,
    pages,
    rawType: work.type?.trim() || undefined,
  };
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractXmlTag(block: string, tagName: string): string | undefined {
  const escaped = tagName.replace(/[:]/g, '\\:');
  const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i').exec(block);
  if (!match?.[1]) return undefined;
  return decodeXmlEntities(match[1].replace(/\s+/g, ' ').trim()) || undefined;
}

export function parseArxivAtomXml(xml: string): ParsedAcademicWork | null {
  const entryMatch = /<entry>([\s\S]*?)<\/entry>/i.exec(xml);
  if (!entryMatch?.[1]) return null;
  const entry = entryMatch[1];

  const title = extractXmlTag(entry, 'title');
  if (!title || /^error$/i.test(title)) {
    return null;
  }

  const authorList: string[] = [];
  const authorMatches = entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi);
  for (const m of authorMatches) {
    const name = decodeXmlEntities(m[1].replace(/\s+/g, ' ').trim());
    if (name) authorList.push(name);
  }

  const published = extractXmlTag(entry, 'published');
  let year: number | null = null;
  if (published) {
    const ym = /^(\d{4})/.exec(published);
    if (ym?.[1]) {
      year = Number.parseInt(ym[1], 10);
    }
  }

  const rawId = extractXmlTag(entry, 'id');
  const arxivId = cleanArxivId(rawId) ?? undefined;
  const rawDoi = extractXmlTag(entry, 'arxiv:doi');
  const doi = cleanDoi(rawDoi) ?? undefined;
  const journalRef = extractXmlTag(entry, 'arxiv:journal_ref');
  const catMatch = /<arxiv:primary_category[^>]*\bterm="([^"]+)"/i.exec(entry);
  const primaryClass = catMatch?.[1]?.trim() || undefined;

  return {
    title,
    authors: authorList.length > 0 ? authorList.join(', ') : undefined,
    year,
    doi,
    arxivId,
    venue: journalRef || undefined,
    primaryClass,
  };
}

export function extractCrossrefWorkMetadata(message: Record<string, unknown>): ParsedAcademicWork {
  const titles = Array.isArray(message.title) ? (message.title as unknown[]) : [];
  const title = typeof titles[0] === 'string' ? titles[0].trim() || undefined : undefined;

  const rawAuthors = Array.isArray(message.author)
    ? (message.author as Array<{ given?: string; family?: string; name?: string }>)
    : [];
  const authors = rawAuthors
    .map((a) => {
      if (a.name?.trim()) return a.name.trim();
      return [a.given?.trim(), a.family?.trim()].filter(Boolean).join(' ').trim();
    })
    .filter(Boolean);

  let year: number | null = null;
  for (const dateKey of ['published-print', 'published-online', 'issued', 'created']) {
    const dateObj = message[dateKey] as { 'date-parts'?: number[][] } | undefined;
    const yr = dateObj?.['date-parts']?.[0]?.[0];
    if (typeof yr === 'number' && Number.isFinite(yr) && yr > 1900) {
      year = yr;
      break;
    }
  }

  const containers = Array.isArray(message['container-title']) ? (message['container-title'] as unknown[]) : [];
  const venue = typeof containers[0] === 'string' ? containers[0].trim() || undefined : undefined;
  const doi = typeof message.DOI === 'string' ? cleanDoi(message.DOI) ?? undefined : undefined;
  const volume = typeof message.volume === 'string' ? message.volume.trim() || undefined : undefined;
  const issue = typeof message.issue === 'string' ? message.issue.trim() || undefined : undefined;
  const pages = typeof message.page === 'string' ? message.page.trim().replace(/-/g, '--') || undefined : undefined;
  const rawType = typeof message.type === 'string' ? message.type.trim() || undefined : undefined;

  return {
    title,
    authors: authors.length > 0 ? authors.join(', ') : undefined,
    year,
    doi,
    venue,
    volume,
    issue,
    pages,
    rawType,
  };
}

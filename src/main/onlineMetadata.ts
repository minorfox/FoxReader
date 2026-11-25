import { net } from 'electron';
import {
  normalizeTextForTranslation,
  type EnrichPaperOnlineInput,
  type EnrichPaperOnlineResult,
  type TranslateTextResult,
  type UpdateCheckResult,
} from '../shared/types.js';

const RELEASES_FALLBACK_URL = 'https://github.com/minorfox/FoxReader/releases';
const GITHUB_LATEST_API = 'https://api.github.com/repos/minorfox/FoxReader/releases/latest';
const OPENALEX_API_BASE = 'https://api.openalex.org/works';
const YOUDAO_TRANSLATE_URL = 'https://aidemo.youdao.com/trans';
const MYMEMORY_TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
const REQUEST_TIMEOUT_MS = 10_000;

interface OpenAlexAuthorship {
  author?: { display_name?: string | null } | null;
  institutions?: Array<{ display_name?: string | null } | null> | null;
  raw_affiliation_strings?: Array<string | null> | null;
}

interface OpenAlexWork {
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: OpenAlexAuthorship[] | null;
}

interface OpenAlexSearchResponse {
  results?: OpenAlexWork[] | null;
}

interface GithubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  body?: string;
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

function cleanDoi(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;)\]]+$/, '');
  return /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/.test(trimmed) ? trimmed : null;
}

function extractWorkMetadata(work: OpenAlexWork): {
  title?: string;
  authors?: string;
  affiliations?: string;
  year: number | null;
} {
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

  return { title, authors, affiliations, year };
}

async function fetchJsonWithTimeout<T>(url: string, headers: Record<string, string>): Promise<{ status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await net.fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: response.status, data: null };
    }
    const data = (await response.json()) as T;
    return { status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Looks up paper metadata on OpenAlex using DOI (exact) or title search (similarity >= 0.72).
 */
export async function fetchOpenAlexMetadata(
  input: EnrichPaperOnlineInput,
): Promise<EnrichPaperOnlineResult> {
  const headers = {
    'User-Agent': 'FoxReader/0.2 (mailto:lihuang@swufe.edu.cn)',
    Accept: 'application/json',
  };

  try {
    const doi = cleanDoi(input.doiHint);
    if (doi) {
      const doiUrl = `${OPENALEX_API_BASE}/https://doi.org/${encodeURIComponent(doi)}`;
      const { data } = await fetchJsonWithTimeout<OpenAlexWork>(doiUrl, headers);
      if (data && (data.title || data.display_name)) {
        return {
          matched: true,
          ...extractWorkMetadata(data),
          source: 'OpenAlex (DOI)',
        };
      }
    }

    const titleHint = input.titleHint.trim();
    if (!titleHint) {
      return { matched: false, error: '缺少可用于联网检索的标题或 DOI。' };
    }

    const searchUrl = `${OPENALEX_API_BASE}?search=${encodeURIComponent(titleHint)}&per-page=5`;
    const { status, data } = await fetchJsonWithTimeout<OpenAlexSearchResponse>(searchUrl, headers);
    if (!data) {
      return { matched: false, error: `OpenAlex 请求失败 (HTTP ${status})` };
    }

    let bestWork: OpenAlexWork | null = null;
    let bestScore = 0;

    for (const candidate of data.results ?? []) {
      const candidateTitle = candidate.title || candidate.display_name || '';
      if (!candidateTitle) continue;
      const score = computeTitleSimilarity(titleHint, candidateTitle);
      if (score > bestScore) {
        bestScore = score;
        bestWork = candidate;
      }
    }

    if (!bestWork || bestScore < 0.72) {
      return {
        matched: false,
        error: 'OpenAlex 未找到高置信度匹配文献，请检查标题后重试。',
      };
    }

    return {
      matched: true,
      ...extractWorkMetadata(bestWork),
      source: 'OpenAlex',
    };
  } catch (error) {
    return {
      matched: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseSemverParts(raw: string): [number, number, number] {
  const clean = raw.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '0.0.0';
  const [maj = 0, min = 0, pat = 0] = clean.split('.').map((n) => {
    const parsed = Number.parseInt(n, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  });
  return [maj, min, pat];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const [lMaj, lMin, lPat] = parseSemverParts(latest);
  const [cMaj, cMin, cPat] = parseSemverParts(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/**
 * Checks GitHub releases/latest on user request; never downloads binaries automatically.
 */
export async function checkLatestGithubRelease(currentVersion: string): Promise<UpdateCheckResult> {
  try {
    const { status, data } = await fetchJsonWithTimeout<GithubReleaseResponse>(GITHUB_LATEST_API, {
      'User-Agent': `FoxReader/${currentVersion}`,
      Accept: 'application/vnd.github+json',
    });

    if (!data || !data.tag_name) {
      return {
        currentVersion,
        latestVersion: currentVersion,
        hasUpdate: false,
        releaseUrl: RELEASES_FALLBACK_URL,
        error: status === 404 ? '仓库尚未发布任何 Release。' : `检查更新失败 (HTTP ${status})`,
      };
    }

    const latestVersion = data.tag_name.trim().replace(/^v/i, '');
    const releaseUrl =
      data.html_url && data.html_url.startsWith('https://github.com/minorfox/FoxReader')
        ? data.html_url
        : RELEASES_FALLBACK_URL;

    return {
      currentVersion,
      latestVersion,
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      releaseUrl,
      releaseNotes: data.body?.trim() || undefined,
    };
  } catch (error) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      releaseUrl: RELEASES_FALLBACK_URL,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface YoudaoTranslateResponse {
  errorCode?: string | number;
  l?: string;
  translation?: string[];
  basic?: {
    phonetic?: string;
    explains?: string[];
  };
}

interface MyMemoryTranslateResponse {
  responseStatus?: number;
  responseData?: {
    translatedText?: string;
  };
}

/**
 * Translates PDF-selected text using Youdao (primary) with MyMemory fallback.
 */
export async function translateSelectionText(rawText: string): Promise<TranslateTextResult> {
  const cleaned = normalizeTextForTranslation(rawText);
  if (!cleaned) {
    return { ok: false, originalText: '', error: '请先划选需要翻译的文本。' };
  }
  if (cleaned.length > 2000) {
    return {
      ok: false,
      originalText: cleaned,
      error: '单次划词翻译最多支持 2000 字符，请缩短选区后重试。',
    };
  }

  // 1. Primary: Youdao
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await net.fetch(YOUDAO_TRANSLATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'FoxReader/0.2',
        },
        body: new URLSearchParams({ q: cleaned, from: 'Auto', to: 'Auto' }).toString(),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as YoudaoTranslateResponse;
        const translatedText = Array.isArray(data.translation)
          ? data.translation.join('\n').trim()
          : '';
        if (String(data.errorCode) === '0' && translatedText) {
          return {
            ok: true,
            originalText: cleaned,
            translatedText,
            phonetic: data.basic?.phonetic?.trim() || undefined,
            explains: Array.isArray(data.basic?.explains)
              ? data.basic.explains.map((s) => s.trim()).filter(Boolean)
              : undefined,
            direction: data.l?.trim() || undefined,
            provider: '有道翻译',
          };
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Fall through cleanly to secondary provider
  }

  // 2. Fallback: MyMemory
  try {
    const nonSpaceLen = cleaned.replace(/\s+/g, '').length || 1;
    const cjkLen = (cleaned.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const langpair = cjkLen / nonSpaceLen > 0.3 ? 'zh-CN|en' : 'en|zh-CN';
    const url = `${MYMEMORY_TRANSLATE_URL}?q=${encodeURIComponent(cleaned)}&langpair=${encodeURIComponent(langpair)}`;
    const { data } = await fetchJsonWithTimeout<MyMemoryTranslateResponse>(url, {
      'User-Agent': 'FoxReader/0.2',
      Accept: 'application/json',
    });
    const translatedText = data?.responseData?.translatedText?.trim() ?? '';
    if (data?.responseStatus === 200 && translatedText) {
      return {
        ok: true,
        originalText: cleaned,
        translatedText,
        direction: langpair,
        provider: 'MyMemory',
      };
    }
  } catch {
    // Handled by unified error below
  }

  return {
    ok: false,
    originalText: cleaned,
    error: '翻译服务暂时不可用，请检查网络后重试。',
  };
}

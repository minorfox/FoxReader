import { net } from 'electron';
import {
  buildBibtexFromPaper,
  cleanArxivId,
  cleanDoi,
} from '../shared/bibtex.js';
import {
  normalizeTextForTranslation,
  type EnrichPaperOnlineInput,
  type EnrichPaperOnlineResult,
  type TranslateTextResult,
  type UpdateCheckResult,
} from '../shared/types.js';
import {
  computeTitleSimilarity,
  extractCrossrefWorkMetadata,
  extractOpenAlexWorkMetadata,
  parseArxivAtomXml,
  type OpenAlexWork,
  type ParsedAcademicWork,
} from './metadataCore.js';
import { detectInstallMode } from './updater.js';
import { selectReleaseAsset, type ReleaseAsset } from './updaterCore.js';

export { computeTitleSimilarity };

const RELEASES_FALLBACK_URL = 'https://github.com/minorfox/FoxReader/releases';
const GITHUB_LATEST_API = 'https://api.github.com/repos/minorfox/FoxReader/releases/latest';
const OPENALEX_API_BASE = 'https://api.openalex.org/works';
const ARXIV_API_BASE = 'https://export.arxiv.org/api/query';
const CROSSREF_API_BASE = 'https://api.crossref.org/works';
const YOUDAO_TRANSLATE_URL = 'https://aidemo.youdao.com/trans';
const MYMEMORY_TRANSLATE_URL = 'https://api.mymemory.translated.net/get';
const REQUEST_TIMEOUT_MS = 10_000;

interface OpenAlexSearchResponse {
  results?: OpenAlexWork[] | null;
}

interface CrossrefWorkResponse {
  message?: Record<string, unknown>;
}

interface GithubReleaseResponse {
  tag_name?: string;
  html_url?: string;
  body?: string;
  assets?: ReleaseAsset[];
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

async function fetchTextWithTimeout(
  url: string,
  headers: Record<string, string>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ status: number; text: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await net.fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return { status: response.status, text: null };
    }
    return { status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCrossrefBibtex(doi: string, userAgent: string): Promise<string | undefined> {
  try {
    const bibUrl = `${CROSSREF_API_BASE}/${encodeURIComponent(doi)}/transform/application/x-bibtex`;
    const { text } = await fetchTextWithTimeout(
      bibUrl,
      {
        'User-Agent': userAgent,
        Accept: 'application/x-bibtex',
      },
      6_000,
    );
    const trimmed = text?.trim();
    if (trimmed && trimmed.startsWith('@') && trimmed.includes('{')) {
      return trimmed;
    }
  } catch {
    // Fallback cleanly to local BibTeX synthesis
  }
  return undefined;
}

async function lookupWorkByDoi(
  doi: string,
  headers: Record<string, string>,
): Promise<{ work: ParsedAcademicWork; source: string } | null> {
  try {
    const doiUrl = `${OPENALEX_API_BASE}/https://doi.org/${encodeURIComponent(doi)}`;
    const { data } = await fetchJsonWithTimeout<OpenAlexWork>(doiUrl, headers);
    if (data && (data.title || data.display_name)) {
      return { work: extractOpenAlexWorkMetadata(data), source: 'OpenAlex (DOI)' };
    }
  } catch {
    // Fall through to Crossref
  }

  try {
    const crUrl = `${CROSSREF_API_BASE}/${encodeURIComponent(doi)}`;
    const { data } = await fetchJsonWithTimeout<CrossrefWorkResponse>(crUrl, headers);
    if (data?.message) {
      const parsed = extractCrossrefWorkMetadata(data.message);
      if (parsed.title) {
        return { work: parsed, source: 'Crossref (DOI)' };
      }
    }
  } catch {
    // Ignore Crossref error
  }

  return null;
}

function mergeParsedWorks(primary: ParsedAcademicWork, secondary?: ParsedAcademicWork | null): ParsedAcademicWork {
  if (!secondary) return primary;
  return {
    title: primary.title || secondary.title,
    authors: primary.authors || secondary.authors,
    affiliations: primary.affiliations || secondary.affiliations,
    year: primary.year ?? secondary.year,
    doi: primary.doi || secondary.doi,
    arxivId: primary.arxivId || secondary.arxivId,
    venue: primary.venue || secondary.venue,
    bibtex: primary.bibtex || secondary.bibtex,
    volume: primary.volume || secondary.volume,
    issue: primary.issue || secondary.issue,
    pages: primary.pages || secondary.pages,
    rawType: primary.rawType || secondary.rawType,
    primaryClass: primary.primaryClass || secondary.primaryClass,
  };
}

/**
 * Enriches paper metadata from arXiv, OpenAlex, and Crossref using arXiv ID, DOI, or title similarity (>= 0.72).
 */
export async function fetchOpenAlexMetadata(
  input: EnrichPaperOnlineInput,
): Promise<EnrichPaperOnlineResult> {
  const userAgent = 'FoxReader/0.2 (mailto:lihuang@swufe.edu.cn)';
  const headers = {
    'User-Agent': userAgent,
    Accept: 'application/json',
  };

  try {
    const doi = cleanDoi(input.doiHint) ?? cleanDoi(input.titleHint);
    const arxivId = cleanArxivId(input.arxivIdHint) ?? cleanArxivId(input.titleHint);

    let matchedWork: ParsedAcademicWork | null = null;
    let sourceLabel = 'OpenAlex';

    // 1. arXiv API lookup (with optional DOI cross-enrichment for published venue & affiliations)
    if (arxivId) {
      try {
        const arxivUrl = `${ARXIV_API_BASE}?id_list=${encodeURIComponent(arxivId)}`;
        const { text } = await fetchTextWithTimeout(arxivUrl, { 'User-Agent': userAgent });
        if (text) {
          const arxivWork = parseArxivAtomXml(text);
          if (arxivWork) {
            matchedWork = arxivWork;
            sourceLabel = 'arXiv';
            const publishedDoi = doi ?? arxivWork.doi;
            if (publishedDoi) {
              const doiRes = await lookupWorkByDoi(publishedDoi, headers);
              if (doiRes) {
                matchedWork = mergeParsedWorks(doiRes.work, arxivWork);
                matchedWork.arxivId = arxivWork.arxivId ?? arxivId;
                sourceLabel = `arXiv + ${doiRes.source}`;
              }
            }
          }
        }
      } catch {
        // Fall through to DOI / OpenAlex title search
      }
    }

    // 2. Direct DOI lookup (OpenAlex -> Crossref fallback)
    if (!matchedWork && doi) {
      const doiRes = await lookupWorkByDoi(doi, headers);
      if (doiRes) {
        matchedWork = doiRes.work;
        sourceLabel = doiRes.source;
      }
    }

    // 3. Title search via OpenAlex
    if (!matchedWork) {
      const titleHint = input.titleHint.trim();
      if (!titleHint) {
        return { matched: false, error: '缺少可用于联网检索的标题、DOI 或 arXiv ID。' };
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
          error: '未在 OpenAlex / arXiv 找到高置信度匹配文献，请检查标题、DOI 或 arXiv ID 后重试。',
        };
      }

      matchedWork = extractOpenAlexWorkMetadata(bestWork);
      sourceLabel = 'OpenAlex';
    }

    const resolvedDoi = matchedWork.doi ?? doi ?? undefined;
    const resolvedArxivId = matchedWork.arxivId ?? arxivId ?? undefined;
    const officialBibtex = resolvedDoi ? await fetchCrossrefBibtex(resolvedDoi, userAgent) : undefined;
    const bibtex =
      officialBibtex ??
      buildBibtexFromPaper({
        title: matchedWork.title || input.titleHint || 'Untitled',
        authors: matchedWork.authors,
        year: matchedWork.year,
        venue: matchedWork.venue,
        doi: resolvedDoi,
        arxivId: resolvedArxivId,
        volume: matchedWork.volume,
        issue: matchedWork.issue,
        pages: matchedWork.pages,
        rawType: matchedWork.rawType,
        primaryClass: matchedWork.primaryClass,
      });

    return {
      matched: true,
      title: matchedWork.title,
      authors: matchedWork.authors,
      affiliations: matchedWork.affiliations,
      year: matchedWork.year,
      doi: resolvedDoi,
      arxivId: resolvedArxivId,
      venue: matchedWork.venue,
      bibtex,
      source: sourceLabel,
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

    const installMode = detectInstallMode();
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const { asset, checksumAsset } = selectReleaseAsset(assets, installMode);

    return {
      currentVersion,
      latestVersion,
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      releaseUrl,
      releaseNotes: data.body?.trim() || undefined,
      installMode,
      assetName: asset?.name,
      assetUrl: asset?.browser_download_url,
      assetSize: asset?.size,
      checksumUrl: checksumAsset?.browser_download_url,
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

export const PAGE_LINK_HASH_PREFIX = '#fox-page-';

export function parseFoxPageHref(href?: string): number | null {
  if (!href) return null;
  const match = /^#fox-page-(\d+)$/.exec(href.trim());
  if (!match?.[1]) return null;
  const page = Number.parseInt(match[1], 10);
  return Number.isFinite(page) && page >= 1 ? page : null;
}

function replacePageTokensOutsideCode(segment: string): string {
  // 1. Existing explicit markdown links [label](#page=12) or [label](foxpage://12)
  let out = segment.replace(
    /(\[[^\]\n]+\])\((?:#page=|foxpage:\/\/)(\d+)\)/gi,
    (_full, bracketPart: string, pageStr: string) => {
      const page = Number.parseInt(pageStr, 10);
      if (!Number.isFinite(page) || page < 1) return _full;
      return `${bracketPart}(${PAGE_LINK_HASH_PREFIX}${page})`;
    },
  );

  // 2. Bare page shorthand tokens: [P.12], [p. 12], [P12], [第12页], [第 12 页]
  // Skip images (![...]) and tokens already followed by a markdown link target (... or [...).
  out = out.replace(
    /(?<!!)\[((?:[Pp]\.?\s*(\d+))|(?:第\s*(\d+)\s*页))\](?!\s*[([\]])/g,
    (full, inner: string, enPage?: string, zhPage?: string) => {
      const rawNum = enPage ?? zhPage ?? '';
      const page = Number.parseInt(rawNum, 10);
      if (!Number.isFinite(page) || page < 1) return full;
      return `[${inner}](${PAGE_LINK_HASH_PREFIX}${page})`;
    },
  );

  return out;
}

/**
 * Converts [P.12], [第12页], and [label](#page=12) tokens in Markdown notes into internal page-jump links
 * while preserving fenced code blocks and inline code spans.
 */
export function transformNotePageLinks(markdown: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  const resultLines: string[] = [];
  let fenceChar: '`' | '~' | null = null;
  let fenceLen = 0;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fenceChar) {
        fenceChar = marker[0] as '`' | '~';
        fenceLen = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLen) {
        fenceChar = null;
        fenceLen = 0;
      }
      resultLines.push(line);
      continue;
    }

    if (fenceChar) {
      resultLines.push(line);
      continue;
    }

    // Preserve inline code spans (`...`)
    const parts = line.split(/(`+[^`]*`+)/g);
    const transformed = parts
      .map((part, idx) => (idx % 2 === 1 ? part : replacePageTokensOutsideCode(part)))
      .join('');
    resultLines.push(transformed);
  }

  return resultLines.join('\n');
}

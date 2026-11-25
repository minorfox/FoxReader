import type { NormalizedRect } from '../../shared/types';

export interface RawRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function round5(value: number): number {
  return Math.round(value * 100000) / 100000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function boxArea(box: PixelBox): number {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}

function intersectionArea(a: PixelBox, b: PixelBox): number {
  const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return xOverlap * yOverlap;
}

function canMergeSameLine(a: PixelBox, b: PixelBox): boolean {
  const h1 = a.bottom - a.top;
  const h2 = b.bottom - b.top;
  const minH = Math.min(h1, h2);
  const maxH = Math.max(h1, h2);
  if (minH <= 0 || maxH / minH > 1.85) return false;

  const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const centerY1 = (a.top + a.bottom) / 2;
  const centerY2 = (b.top + b.bottom) / 2;
  const sameLine = yOverlap / minH >= 0.5 || Math.abs(centerY1 - centerY2) <= minH * 0.45;
  if (!sameLine) return false;

  // Keep two-column gutters strictly separate by bounding the horizontal gap threshold
  const gapThreshold = Math.max(6, minH * 0.55);
  const horizontalGap = Math.max(a.left - b.right, b.left - a.right, 0);
  return horizontalGap <= gapThreshold;
}

/**
 * Clean noisy browser `Range.getClientRects()` output for two-column academic PDFs:
 * 1. Clip to page container bounds and discard tiny/giant ghost boxes.
 * 2. Deduplicate nearly contained overlapping boxes.
 * 3. Merge only same-line horizontally adjacent boxes without crossing column gutters.
 * 4. Normalize coordinates into [0, 1] relative to the page box.
 */
export function cleanAndNormalizeRects(rawRects: RawRect[], pageRect: PageBounds): NormalizedRect[] {
  if (pageRect.width <= 0 || pageRect.height <= 0 || rawRects.length === 0) {
    return [];
  }

  const pageRight = pageRect.left + pageRect.width;
  const pageBottom = pageRect.top + pageRect.height;

  const clipped: PixelBox[] = [];
  for (const r of rawRects) {
    const left = Math.max(pageRect.left, r.left);
    const right = Math.min(pageRight, r.right);
    const top = Math.max(pageRect.top, r.top);
    const bottom = Math.min(pageBottom, r.bottom);
    const w = right - left;
    const h = bottom - top;

    if (w < 2 || h < 3) continue;
    if (h > pageRect.height * 0.2) continue;
    if (w > pageRect.width * 0.92 && h > 48) continue;

    clipped.push({ left, top, right, bottom });
  }

  if (clipped.length === 0) return [];

  // Deduplicate rects >= 88% covered by a larger/equal rect
  const byAreaDesc = [...clipped].sort((a, b) => boxArea(b) - boxArea(a));
  const deduped: PixelBox[] = [];
  for (const candidate of byAreaDesc) {
    const area = boxArea(candidate);
    if (area <= 0) continue;
    const covered = deduped.some((existing) => intersectionArea(candidate, existing) / area >= 0.88);
    if (!covered) deduped.push(candidate);
  }

  // Sort top-to-bottom, left-to-right before line clustering
  deduped.sort((a, b) => (Math.abs(a.top - b.top) > 1 ? a.top - b.top : a.left - b.left));

  const merged: PixelBox[] = [];
  for (const box of deduped) {
    // Merge iteratively in case bridging boxes connect two fragments on the same line
    let current = { ...box };
    let didMerge = true;
    while (didMerge) {
      didMerge = false;
      for (let i = 0; i < merged.length; i++) {
        if (canMergeSameLine(current, merged[i])) {
          const other = merged[i];
          current = {
            left: Math.min(current.left, other.left),
            top: Math.min(current.top, other.top),
            right: Math.max(current.right, other.right),
            bottom: Math.max(current.bottom, other.bottom),
          };
          merged.splice(i, 1);
          didMerge = true;
          break;
        }
      }
    }
    merged.push(current);
  }

  merged.sort((a, b) => (Math.abs(a.top - b.top) > 2 ? a.top - b.top : a.left - b.left));

  return merged.map((b) => {
    const x = clamp01((b.left - pageRect.left) / pageRect.width);
    const y = clamp01((b.top - pageRect.top) / pageRect.height);
    const w = clamp01((b.right - b.left) / pageRect.width);
    const h = clamp01((b.bottom - b.top) / pageRect.height);
    return {
      x: round5(x),
      y: round5(y),
      w: round5(Math.min(1 - x, w)),
      h: round5(Math.min(1 - y, h)),
    };
  });
}

export interface ExtractedPageSelection {
  rects: NormalizedRect[];
  quoteText: string;
  anchor: { clientX: number; clientY: number };
}

export function extractSelectionForPage(
  selection: Selection,
  pageEl: HTMLElement,
): ExtractedPageSelection | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;

  const textLayer = pageEl.querySelector('.textLayer');
  if (!textLayer) return null;

  const pageBox = pageEl.getBoundingClientRect();
  if (pageBox.width <= 0 || pageBox.height <= 0) return null;

  const pageRange = document.createRange();
  pageRange.selectNodeContents(textLayer);

  const rawRects: RawRect[] = [];
  const quoteParts: string[] = [];

  for (let i = 0; i < selection.rangeCount; i++) {
    const selRange = selection.getRangeAt(i);
    if (!selRange.intersectsNode(textLayer)) continue;

    const clippedRange = selRange.cloneRange();
    if (clippedRange.compareBoundaryPoints(Range.START_TO_START, pageRange) < 0) {
      clippedRange.setStart(pageRange.startContainer, pageRange.startOffset);
    }
    if (clippedRange.compareBoundaryPoints(Range.END_TO_END, pageRange) > 0) {
      clippedRange.setEnd(pageRange.endContainer, pageRange.endOffset);
    }
    if (clippedRange.collapsed) continue;

    const partText = clippedRange.toString().replace(/\s+/g, ' ').trim();
    if (partText) quoteParts.push(partText);

    const clientRects = Array.from(clippedRange.getClientRects());
    for (const r of clientRects) {
      rawRects.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
  }

  const quoteText = quoteParts.join(' ').trim();
  if (!quoteText || rawRects.length === 0) return null;

  const rects = cleanAndNormalizeRects(rawRects, {
    left: pageBox.left,
    top: pageBox.top,
    width: pageBox.width,
    height: pageBox.height,
  });
  if (rects.length === 0) return null;

  const first = rects[0];
  const anchor = {
    clientX: pageBox.left + (first.x + first.w / 2) * pageBox.width,
    clientY: pageBox.top + first.y * pageBox.height,
  };

  return { rects, quoteText, anchor };
}

export function cropCanvasRegionToPngBase64(
  canvas: HTMLCanvasElement,
  rect: NormalizedRect,
  maxWidth = 1200,
): string {
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new Error('Page canvas is not rendered yet.');
  }

  const sx = Math.max(0, Math.floor(rect.x * canvas.width));
  const sy = Math.max(0, Math.floor(rect.y * canvas.height));
  const sw = Math.max(1, Math.min(canvas.width - sx, Math.ceil(rect.w * canvas.width)));
  const sh = Math.max(1, Math.min(canvas.height - sy, Math.ceil(rect.h * canvas.height)));

  const scale = sw > maxWidth ? maxWidth / sw : 1;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = dw;
  outCanvas.height = dh;

  const ctx = outCanvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create 2D canvas context for snapshot crop.');
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dw, dh);
  ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, dw, dh);

  return outCanvas.toDataURL('image/png');
}

import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import {
  getAnnotationColorMeta,
  type Annotation,
  type NormalizedRect,
} from '../../shared/types';
import { pdfjsLib } from '../lib/pdf';
import {
  cleanAndNormalizeRects,
  cropCanvasRegionToPngBase64,
  extractSelectionForPage,
  type RawRect,
} from '../lib/selection';

function buildSearchRegex(query: string): RegExp | null {
  const parts = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (parts.length === 0) return null;
  return new RegExp(parts.join('\\s*'), 'gi');
}

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
  zoom: number;
  shouldRender: boolean;
  annotationMode: 'text' | 'area';
  annotations: Annotation[];
  selectedAnnotationId: string | null;
  pulsingAnnotationId: string | null;
  searchQuery?: string;
  activeSearchMatchIndex?: number;
  registerElement: (pageNumber: number, el: HTMLDivElement | null) => void;
  onPageSizeMeasured?: (pageNumber: number, width: number, height: number) => void;
  onTextSelection: (payload: {
    pageNumber: number;
    rects: NormalizedRect[];
    quoteText: string;
    anchor: { clientX: number; clientY: number };
  }) => void;
  onCreateAreaAnnotation: (payload: {
    pageNumber: number;
    rects: NormalizedRect[];
    snapshotPngBase64: string;
  }) => void;
  onClickAnnotation: (annotation: Annotation, anchor: { clientX: number; clientY: number }) => void;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round5(value: number): number {
  return Math.round(value * 100000) / 100000;
}

export function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  baseWidth,
  baseHeight,
  zoom,
  shouldRender,
  annotationMode,
  annotations,
  selectedAnnotationId,
  pulsingAnnotationId,
  searchQuery = '',
  activeSearchMatchIndex = -1,
  registerElement,
  onPageSizeMeasured,
  onTextSelection,
  onCreateAreaAnnotation,
  onClickAnnotation,
}: PdfPageCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const activeSearchElRef = useRef<HTMLDivElement | null>(null);
  const renderedPageRef = useRef<PDFPageProxy | null>(null);
  const justDraggedRef = useRef(false);

  const [renderError, setRenderError] = useState<string | null>(null);
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);
  const [dragBox, setDragBox] = useState<NormalizedRect | null>(null);
  const [textLayerReadyTick, setTextLayerReadyTick] = useState(0);
  const [searchHighlights, setSearchHighlights] = useState<
    Array<{ rects: NormalizedRect[]; isActive: boolean }>
  >([]);

  const displayWidth = Math.max(1, Math.round(baseWidth * zoom));
  const displayHeight = Math.max(1, Math.round(baseHeight * zoom));

  useEffect(() => {
    registerElement(pageNumber, containerRef.current);
    return () => registerElement(pageNumber, null);
  }, [pageNumber, registerElement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const textLayerEl = textLayerRef.current;
    if (!canvas || !textLayerEl) return;

    if (!shouldRender) {
      // Release GPU/RAM and PDF.js page cache for off-screen pages while preserving exact container height
      renderedPageRef.current?.cleanup();
      renderedPageRef.current = null;
      canvas.width = 0;
      canvas.height = 0;
      textLayerEl.innerHTML = '';
      setRenderError(null);
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayerInstance: InstanceType<typeof pdfjsLib.TextLayer> | null = null;
    setRenderError(null);

    async function renderPage() {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || !canvas || !textLayerEl) return;
        renderedPageRef.current = page;

        const unitVp = page.getViewport({ scale: 1.0 });
        if (
          onPageSizeMeasured &&
          (Math.abs(unitVp.width - baseWidth) > 1 || Math.abs(unitVp.height - baseHeight) > 1)
        ) {
          onPageSizeMeasured(pageNumber, unitVp.width, unitVp.height);
        }

        const viewport = page.getViewport({ scale: zoom });
        const maxDpr = zoom > 1.5 ? 1.5 : 2;
        const outputScale = Math.min(window.devicePixelRatio || 1, maxDpr);

        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        renderTask = page.render({
          canvas,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
        });

        await renderTask.promise;
        if (cancelled || !textLayerEl) return;

        textLayerEl.innerHTML = '';
        textLayerEl.style.setProperty('--scale-factor', String(viewport.scale));
        textLayerEl.style.setProperty('--user-unit', '1');
        textLayerEl.style.setProperty('--total-scale-factor', String(viewport.scale));

        const textContent = await page.getTextContent();
        if (cancelled || !textLayerEl) return;

        textLayerInstance = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerEl,
          viewport,
        });
        await textLayerInstance.render();
        if (!cancelled) {
          setTextLayerReadyTick((t) => t + 1);
        }
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name !== 'RenderingCancelledException' && name !== 'AbortException') {
          console.error(`[FoxReader] Failed to render page ${pageNumber}:`, err);
          if (!cancelled) {
            setRenderError(err instanceof Error ? err.message : String(err));
          }
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayerInstance?.cancel();
      renderedPageRef.current?.cleanup();
      renderedPageRef.current = null;
    };
  }, [pdfDoc, pageNumber, zoom, shouldRender, baseWidth, baseHeight, onPageSizeMeasured]);

  // Compute in-page Ctrl+F search highlight rectangles without mutating TextLayer spans
  useEffect(() => {
    const pageEl = containerRef.current;
    const textLayerEl = textLayerRef.current;
    const regex = buildSearchRegex(searchQuery);
    if (!shouldRender || !pageEl || !textLayerEl || !regex) {
      setSearchHighlights([]);
      return;
    }

    const pageBox = pageEl.getBoundingClientRect();
    if (pageBox.width <= 0 || pageBox.height <= 0) {
      setSearchHighlights([]);
      return;
    }

    const segments: Array<{ node: Text; start: number; end: number }> = [];
    let fullText = '';
    const walker = document.createTreeWalker(textLayerEl, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    while (currentNode) {
      const textNode = currentNode as Text;
      const parentEl = textNode.parentElement;
      if (!parentEl?.closest('.endOfContent')) {
        const val = textNode.nodeValue ?? '';
        if (val.length > 0) {
          const start = fullText.length;
          fullText += val;
          segments.push({ node: textNode, start, end: fullText.length });
        }
      }
      currentNode = walker.nextNode();
    }

    if (!fullText) {
      setSearchHighlights([]);
      return;
    }

    const findPos = (offset: number): { node: Text; offset: number } | null => {
      for (const seg of segments) {
        if (offset >= seg.start && offset <= seg.end) {
          return { node: seg.node, offset: offset - seg.start };
        }
      }
      return null;
    };

    const nextHighlights: Array<{ rects: NormalizedRect[]; isActive: boolean }> = [];
    let matchIdx = 0;
    let m: RegExpExecArray | null = regex.exec(fullText);
    while (m !== null) {
      if (m[0].length === 0) {
        regex.lastIndex += 1;
        m = regex.exec(fullText);
        continue;
      }
      const startPos = findPos(m.index);
      const endPos = findPos(m.index + m[0].length);
      if (startPos && endPos) {
        const range = document.createRange();
        range.setStart(startPos.node, startPos.offset);
        range.setEnd(endPos.node, endPos.offset);
        const rawRects: RawRect[] = Array.from(range.getClientRects()).map((r) => ({
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        }));
        const normRects = cleanAndNormalizeRects(rawRects, {
          left: pageBox.left,
          top: pageBox.top,
          width: pageBox.width,
          height: pageBox.height,
        });
        if (normRects.length > 0) {
          nextHighlights.push({
            rects: normRects,
            isActive: matchIdx === activeSearchMatchIndex,
          });
          matchIdx += 1;
        }
      }
      m = regex.exec(fullText);
    }

    setSearchHighlights(nextHighlights);
  }, [searchQuery, activeSearchMatchIndex, textLayerReadyTick, shouldRender, zoom]);

  useEffect(() => {
    if (activeSearchMatchIndex >= 0 && activeSearchElRef.current) {
      activeSearchElRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeSearchMatchIndex, searchHighlights]);

  const findHitAnnotation = (clientX: number, clientY: number): Annotation | null => {
    const el = containerRef.current;
    if (!el || annotations.length === 0) return null;
    const box = el.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;

    const nx = (clientX - box.left) / box.width;
    const ny = (clientY - box.top) / box.height;
    const pad = 0.004;

    const hits: { ann: Annotation; area: number }[] = [];
    for (const ann of annotations) {
      const matched = ann.rects.some(
        (r) =>
          nx >= r.x - pad &&
          nx <= r.x + r.w + pad &&
          ny >= r.y - pad &&
          ny <= r.y + r.h + pad,
      );
      if (matched) {
        const area = ann.rects.reduce((sum, r) => sum + r.w * r.h, 0);
        hits.push({ ann, area });
      }
    }

    if (hits.length === 0) return null;
    hits.sort((a, b) => a.area - b.area);
    return hits[0].ann;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const isAreaGesture = annotationMode === 'area' || e.altKey;
    if (!isAreaGesture) return;

    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas || canvas.width === 0) return;

    e.preventDefault();
    window.getSelection()?.removeAllRanges();

    const pageBox = el.getBoundingClientRect();
    const startX = clamp01((e.clientX - pageBox.left) / pageBox.width);
    const startY = clamp01((e.clientY - pageBox.top) / pageBox.height);

    let latestRect: NormalizedRect = { x: startX, y: startY, w: 0, h: 0 };
    setDragBox(latestRect);

    const onMove = (moveEvt: MouseEvent) => {
      const curX = clamp01((moveEvt.clientX - pageBox.left) / pageBox.width);
      const curY = clamp01((moveEvt.clientY - pageBox.top) / pageBox.height);
      latestRect = {
        x: round5(Math.min(startX, curX)),
        y: round5(Math.min(startY, curY)),
        w: round5(Math.abs(curX - startX)),
        h: round5(Math.abs(curY - startY)),
      };
      setDragBox(latestRect);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDragBox(null);

      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 150);

      const pxW = latestRect.w * pageBox.width;
      const pxH = latestRect.h * pageBox.height;
      if (pxW < 10 || pxH < 10 || canvas.width <= 0) {
        return;
      }

      try {
        const snapshotPngBase64 = cropCanvasRegionToPngBase64(canvas, latestRect);
        onCreateAreaAnnotation({
          pageNumber,
          rects: [latestRect],
          snapshotPngBase64,
        });
      } catch (err) {
        console.error('[FoxReader] Area snapshot failed:', err);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (justDraggedRef.current || annotationMode !== 'text' || e.altKey) return;

    const el = containerRef.current;
    if (!el) return;

    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const extracted = extractSelectionForPage(sel, el);
      if (extracted) {
        onTextSelection({
          pageNumber,
          rects: extracted.rects,
          quoteText: extracted.quoteText,
          anchor: extracted.anchor,
        });
      }
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragBox || annotationMode === 'area' || e.altKey) {
      if (hoveredAnnotationId !== null) setHoveredAnnotationId(null);
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      if (hoveredAnnotationId !== null) setHoveredAnnotationId(null);
      return;
    }
    const hit = findHitAnnotation(e.clientX, e.clientY);
    const nextId = hit ? hit.id : null;
    if (nextId !== hoveredAnnotationId) {
      setHoveredAnnotationId(nextId);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (justDraggedRef.current) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    const hit = findHitAnnotation(e.clientX, e.clientY);
    if (hit) {
      onClickAnnotation(hit, { clientX: e.clientX, clientY: e.clientY });
    }
  };

  const selectionEnabled = annotationMode === 'text';

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredAnnotationId(null)}
      onClick={handleClick}
      style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
      className={`relative mx-auto bg-white shadow-md ring-1 ring-slate-900/5 shrink-0 ${
        selectionEnabled ? 'select-text' : 'select-none'
      } ${
        annotationMode === 'area'
          ? 'cursor-crosshair'
          : hoveredAnnotationId
            ? 'cursor-pointer'
            : ''
      }`}
    >
      <canvas ref={canvasRef} className="block" />

      {/* Annotation Overlay Layer (below TextLayer so text remains selectable) */}
      <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
        {annotations.map((ann) => {
          const colorMeta = getAnnotationColorMeta(ann.color);
          const isSelected = ann.id === selectedAnnotationId;
          const isHovered = ann.id === hoveredAnnotationId;
          const isPulsing = ann.id === pulsingAnnotationId;

          return ann.rects.map((rect, idx) => {
            const style: React.CSSProperties = {
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            };

            if (ann.type === 'text') {
              return (
                <div
                  key={`${ann.id}-${idx}`}
                  style={{
                    ...style,
                    backgroundColor: colorMeta.overlayBg,
                    mixBlendMode: 'multiply',
                    outline:
                      isSelected || isHovered
                        ? `1.5px solid ${colorMeta.border}`
                        : undefined,
                  }}
                  className={`absolute rounded-[2px] transition-shadow ${
                    isPulsing ? 'fox-annotation-pulse' : ''
                  }`}
                />
              );
            }

            return (
              <div
                key={`${ann.id}-${idx}`}
                style={{
                  ...style,
                  backgroundColor: colorMeta.areaBg,
                  border: `2px solid ${colorMeta.border}`,
                  boxShadow:
                    isSelected || isHovered
                      ? `0 0 0 2px ${colorMeta.overlayBg}`
                      : undefined,
                }}
                className={`absolute rounded ${isPulsing ? 'fox-annotation-pulse' : ''}`}
              />
            );
          });
        })}

        {searchHighlights.map((item, matchIdx) =>
          item.rects.map((rect, rIdx) => (
            <div
              key={`search-${matchIdx}-${rIdx}`}
              ref={item.isActive && rIdx === 0 ? activeSearchElRef : undefined}
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
                backgroundColor: item.isActive
                  ? 'rgba(139, 92, 246, 0.38)'
                  : 'rgba(251, 146, 60, 0.32)',
                outline: item.isActive ? '2px solid #7C3AED' : undefined,
              }}
              className={`absolute rounded-[2px] ${item.isActive ? 'fox-annotation-pulse' : ''}`}
            />
          )),
        )}

        {dragBox && (
          <div
            style={{
              left: `${dragBox.x * 100}%`,
              top: `${dragBox.y * 100}%`,
              width: `${dragBox.w * 100}%`,
              height: `${dragBox.h * 100}%`,
            }}
            className="absolute rounded border-2 border-dashed border-violet-600 bg-violet-500/15"
          />
        )}
      </div>

      <div
        ref={textLayerRef}
        className={`textLayer ${selectionEnabled ? 'select-text' : 'pointer-events-none select-none'}`}
      />

      {renderError && (
        <div className="absolute inset-x-4 top-4 z-10 rounded-lg border border-red-200 bg-red-50/95 px-3 py-2 text-xs text-red-700 shadow-sm">
          第 {pageNumber} 页渲染失败：{renderError}
        </div>
      )}
      {!shouldRender && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 pointer-events-none">
          第 {pageNumber} 页
        </div>
      )}
    </div>
  );
}

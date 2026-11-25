import { useEffect, useRef } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { pdfjsLib } from '../lib/pdf';

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  baseWidth: number;
  baseHeight: number;
  zoom: number;
  shouldRender: boolean;
  selectionEnabled: boolean;
  registerElement: (pageNumber: number, el: HTMLDivElement | null) => void;
}

export function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  baseWidth,
  baseHeight,
  zoom,
  shouldRender,
  selectionEnabled,
  registerElement,
}: PdfPageCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

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
      // Release GPU/RAM for off-screen pages while preserving exact container height
      canvas.width = 0;
      canvas.height = 0;
      textLayerEl.innerHTML = '';
      return;
    }

    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayerInstance: InstanceType<typeof pdfjsLib.TextLayer> | null = null;

    async function renderPage() {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || !canvas || !textLayerEl) return;

        const viewport = page.getViewport({ scale: zoom });
        const outputScale = window.devicePixelRatio || 1;

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
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name !== 'RenderingCancelledException' && name !== 'AbortException') {
          console.error(`[FoxReader] Failed to render page ${pageNumber}:`, err);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayerInstance?.cancel();
    };
  }, [pdfDoc, pageNumber, zoom, shouldRender]);

  return (
    <div
      ref={containerRef}
      data-page-number={pageNumber}
      style={{ width: `${displayWidth}px`, height: `${displayHeight}px` }}
      className="relative mx-auto bg-white shadow-md ring-1 ring-slate-900/5 shrink-0 select-none"
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={textLayerRef}
        className={`textLayer ${selectionEnabled ? '' : 'pointer-events-none'}`}
      />
      {!shouldRender && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-300 pointer-events-none">
          第 {pageNumber} 页
        </div>
      )}
    </div>
  );
}

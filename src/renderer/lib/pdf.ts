import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  parsePdfHeaderFromPage1,
  type PdfInfoMetadata,
  type PdfTextItem,
} from './pdfMetadata';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export { pdfjsLib };

export function getPaperPdfUrl(sha256: string): string {
  return `foxpdf://paper/${sha256}.pdf`;
}

export function getSnapshotUrl(snapshotPath: string): string {
  return `foxpdf://snapshot/${snapshotPath}`;
}

export function getPdfDocumentOptions(sha256: string) {
  return {
    url: getPaperPdfUrl(sha256),
    cMapUrl: 'foxpdf://assets/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'foxpdf://assets/standard_fonts/',
    wasmUrl: 'foxpdf://assets/wasm/',
    iccUrl: 'foxpdf://assets/iccs/',
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  };
}

export interface ExtractedPdfInfo {
  pageCount: number;
  title?: string;
  authors?: string;
  affiliations?: string;
  year?: number | null;
  doi?: string;
}

export async function extractPdfMetadata(sha256: string): Promise<ExtractedPdfInfo | null> {
  const loadingTask = pdfjsLib.getDocument(getPdfDocumentOptions(sha256));

  try {
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    const infoMeta: PdfInfoMetadata = {};

    try {
      const meta = await doc.getMetadata();
      const info = meta?.info as Record<string, unknown> | undefined;
      if (info) {
        if (typeof info.Title === 'string') infoMeta.title = info.Title;
        if (typeof info.Author === 'string') infoMeta.authors = info.Author;
        if (typeof info.CreationDate === 'string') infoMeta.creationDate = info.CreationDate;
      }
    } catch {
      // Ignore metadata dictionary errors on non-standard PDFs
    }

    let page1Items: PdfTextItem[] = [];
    let page1Height = 792;

    if (pageCount >= 1) {
      try {
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        page1Height = viewport.height;
        const textContent = await page.getTextContent();
        page1Items = (textContent.items as Array<Record<string, unknown>>)
          .filter((item) => typeof item.str === 'string' && item.str.length > 0 && Array.isArray(item.transform))
          .map((item) => {
            const tr = item.transform as number[];
            return {
              str: item.str as string,
              x: tr[4] ?? 0,
              y: tr[5] ?? 0,
              h: Math.abs((typeof item.height === 'number' ? item.height : tr[3]) ?? 0),
              w: Math.abs(typeof item.width === 'number' ? item.width : 0),
            };
          });
      } catch {
        // Fallback cleanly to PDF Info dictionary when Page 1 text extraction fails
      }
    }

    const parsed = parsePdfHeaderFromPage1(page1Items, page1Height, infoMeta);
    await doc.destroy();
    return {
      pageCount,
      ...parsed,
    };
  } catch {
    await loadingTask.destroy().catch(() => undefined);
    return null;
  }
}

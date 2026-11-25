import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export { pdfjsLib };

export function getPaperPdfUrl(sha256: string): string {
  return `foxpdf://paper/${sha256}.pdf`;
}

export interface ExtractedPdfInfo {
  pageCount: number;
  title?: string;
  authors?: string;
}

export async function extractPdfMetadata(sha256: string): Promise<ExtractedPdfInfo | null> {
  const loadingTask = pdfjsLib.getDocument({
    url: getPaperPdfUrl(sha256),
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });

  try {
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    let title: string | undefined;
    let authors: string | undefined;

    try {
      const meta = await doc.getMetadata();
      const info = meta?.info as Record<string, unknown> | undefined;
      if (info) {
        const rawTitle = typeof info.Title === 'string' ? info.Title.trim() : '';
        if (rawTitle && rawTitle.toLowerCase() !== 'untitled' && !rawTitle.endsWith('.pdf')) {
          title = rawTitle;
        }
        const rawAuthor = typeof info.Author === 'string' ? info.Author.trim() : '';
        if (rawAuthor) {
          authors = rawAuthor;
        }
      }
    } catch {
      // Ignore metadata parsing errors on non-standard academic PDFs
    }

    await doc.destroy();
    return { pageCount, title, authors };
  } catch {
    await loadingTask.destroy().catch(() => undefined);
    return null;
  }
}

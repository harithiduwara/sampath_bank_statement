import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export class PdfPasswordError extends Error {
  needsRetry: boolean;
  constructor(needsRetry: boolean) {
    super("PDF is password protected");
    this.name = "PdfPasswordError";
    this.needsRetry = needsRetry;
  }
}

export interface PdfLine {
  y: number;
  text: string;
  words: { x: number; text: string }[];
}

/**
 * Opens a PDF, trying `knownPassword` first (so one PIN can unlock several
 * files in a batch), then falling back to an interactive prompt supplied by
 * the caller. Nothing is uploaded anywhere — decryption happens fully
 * client-side in the browser's memory.
 */
export async function openPdf(
  data: ArrayBuffer,
  knownPassword: string | null,
  askForPassword: (attemptsSoFar: number) => Promise<string | null>
): Promise<{ doc: PDFDocumentProxy; passwordUsed: string | null }> {
  let attempt = 0;
  let passwordToTry = knownPassword ?? undefined;

  // First, try without prompting at all (covers unlocked PDFs and the
  // remembered PIN).
  while (true) {
    try {
      const task = pdfjsLib.getDocument({
        data: data.slice(0),
        password: passwordToTry,
      });
      const doc = await task.promise;
      return { doc, passwordUsed: passwordToTry ?? null };
    } catch (err: unknown) {
      const isPasswordIssue =
        err instanceof Error &&
        (err.name === "PasswordException" || /password/i.test(err.message));
      if (!isPasswordIssue) throw err;

      const next = await askForPassword(attempt);
      attempt += 1;
      if (next === null) {
        throw new PdfPasswordError(false);
      }
      passwordToTry = next;
    }
  }
}

/** Groups a page's text items into visual lines, ordered top-to-bottom. */
export async function extractLines(page: PDFPageProxy): Promise<PdfLine[]> {
  const content = await page.getTextContent();
  const rows = new Map<number, PdfLine>();
  for (const item of content.items as any[]) {
    if (typeof item.str !== "string" || item.str.trim() === "") continue;
    const y = Math.round(item.transform[5]);
    const x = item.transform[4];
    let row = rows.get(y);
    if (!row) {
      row = { y, text: "", words: [] };
      rows.set(y, row);
    }
    row.words.push({ x, text: item.str });
  }
  const lines = [...rows.values()].sort((a, b) => b.y - a.y);
  for (const line of lines) {
    line.words.sort((a, b) => a.x - b.x);
    line.text = line.words.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
  }
  return lines.filter((l) => l.text.length > 0);
}

/** Total non-whitespace character count of a page's text layer. */
export function totalChars(lines: PdfLine[]): number {
  return lines.reduce((sum, l) => sum + l.text.length, 0);
}

/** Rasterizes a page to a canvas at the given scale, for OCR fallback. */
export async function renderPageToCanvas(
  page: PDFPageProxy,
  scale = 2.2
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

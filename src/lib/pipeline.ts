import type { PDFPageProxy } from "pdfjs-dist";
import { extractLines, openPdf, PdfPasswordError, renderPageToCanvas, totalChars } from "./pdf";
import { browserOcr } from "./ocr";
import { toInkGray } from "./imagePrep";
import { scanStatementPage } from "./scanTable";
import { parseScannedStatement, type ScannedPage } from "./parseScanned";
import { parseStatementLines } from "./parseStatement";
import type { ProcessedFile, StatementMeta, Transaction } from "./types";

export interface PipelineResult {
  file: ProcessedFile;
  transactions: Transaction[];
  meta: StatementMeta | null;
}

export interface PipelineCallbacks {
  onUpdate: (patch: Partial<ProcessedFile>) => void;
  askForPassword: (attemptsSoFar: number) => Promise<string | null>;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function processFile(
  file: File,
  knownPassword: string | null,
  cb: PipelineCallbacks
): Promise<PipelineResult & { passwordUsed: string | null }> {
  const base: ProcessedFile = {
    id: `${file.name}_${file.size}_${file.lastModified}`,
    name: file.name,
    size: file.size,
    status: "queued",
    usedOcr: false,
  };

  if (IMAGE_TYPES.includes(file.type)) {
    return processImage(file, base, cb);
  }
  return processPdf(file, base, knownPassword, cb);
}

async function scanCanvas(canvas: HTMLCanvasElement, page: number, cb: PipelineCallbacks, pageLabel: string): Promise<ScannedPage> {
  const { data, width, height } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
  const gray = toInkGray(data, width, height);
  const scan = await scanStatementPage(gray, browserOcr, (step) =>
    cb.onUpdate({ status: "ocr", message: step === "layout" ? `${pageLabel}: finding the table` : `${pageLabel}: reading ${step}` })
  );
  return { page, ...scan };
}

async function processImage(
  file: File,
  base: ProcessedFile,
  cb: PipelineCallbacks
): Promise<PipelineResult & { passwordUsed: string | null }> {
  cb.onUpdate({ status: "ocr" });
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);

  const scanned = await scanCanvas(canvas, 1, cb, "Image");
  cb.onUpdate({ status: "parsing", message: "Reconciling balances" });
  const { transactions, meta, quality } = parseScannedStatement([scanned], file.name);

  const result: ProcessedFile = {
    ...base,
    status: "done",
    message: undefined,
    usedOcr: true,
    pagesTotal: 1,
    pagesOcr: 1,
    txnCount: transactions.length,
    meta,
    quality,
  };
  cb.onUpdate(result);
  return { file: result, transactions, meta, passwordUsed: null };
}

/** Renders a scanned page at roughly 2000px wide: enough for the table scanner to upscale from. */
function scanScale(page: PDFPageProxy): number {
  const { width } = page.getViewport({ scale: 1 });
  return Math.min(3, Math.max(1, 2000 / width));
}

async function processPdf(
  file: File,
  base: ProcessedFile,
  knownPassword: string | null,
  cb: PipelineCallbacks
): Promise<PipelineResult & { passwordUsed: string | null }> {
  cb.onUpdate({ status: "unlocking" });
  const buf = await file.arrayBuffer();

  let doc;
  let passwordUsed: string | null = null;
  try {
    const opened = await openPdf(buf, knownPassword, async (attempt) => {
      cb.onUpdate({ status: "needs-pin", message: attempt > 0 ? "Incorrect PIN, try again" : undefined });
      return cb.askForPassword(attempt);
    });
    doc = opened.doc;
    passwordUsed = opened.passwordUsed;
  } catch (err) {
    if (err instanceof PdfPasswordError) {
      const result: ProcessedFile = { ...base, status: "error", message: "Cancelled: PDF remains locked." };
      cb.onUpdate(result);
      return { file: result, transactions: [], meta: null, passwordUsed: null };
    }
    const result: ProcessedFile = { ...base, status: "error", message: (err as Error).message ?? "Failed to open PDF" };
    cb.onUpdate(result);
    return { file: result, transactions: [], meta: null, passwordUsed: null };
  }

  cb.onUpdate({ status: "reading", pagesTotal: doc.numPages });

  const allTransactions: Transaction[] = [];
  let meta: StatementMeta | null = null;
  const scannedPages: ScannedPage[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const lines = await extractLines(page);

    // Scanned / photographed page: no text layer, so read the table with OCR.
    if (totalChars(lines) < 20) {
      cb.onUpdate({ status: "ocr", pagesOcr: scannedPages.length + 1 });
      const canvas = await renderPageToCanvas(page, scanScale(page));
      scannedPages.push(await scanCanvas(canvas, pageNum, cb, `Page ${pageNum}/${doc.numPages}`));
      continue;
    }

    cb.onUpdate({ status: "parsing" });
    const parsed = parseStatementLines(lines, file.name, pageNum);
    allTransactions.push(...parsed.transactions);
    if (!meta || Object.keys(parsed.meta).length > Object.keys(meta).length) {
      meta = parsed.meta;
    }
  }

  let quality: ProcessedFile["quality"];
  if (scannedPages.length) {
    cb.onUpdate({ status: "parsing", message: "Reconciling balances" });
    const scanned = parseScannedStatement(scannedPages, file.name);
    allTransactions.push(...scanned.transactions);
    quality = scanned.quality;
    if (!meta || Object.keys(scanned.meta).length > Object.keys(meta).length) meta = scanned.meta;
  }

  const result: ProcessedFile = {
    ...base,
    status: "done",
    message: undefined,
    usedOcr: scannedPages.length > 0,
    pagesTotal: doc.numPages,
    pagesOcr: scannedPages.length,
    txnCount: allTransactions.length,
    meta: meta ?? undefined,
    quality,
  };
  cb.onUpdate(result);
  return { file: result, transactions: allTransactions, meta, passwordUsed };
}

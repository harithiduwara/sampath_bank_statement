import type { PDFPageProxy } from "pdfjs-dist";
import { extractLines, openPdf, PdfPasswordError, renderPageToCanvas, totalChars } from "./pdf";
import { browserOcr } from "./ocr";
import { toInkGray } from "./imagePrep";
import { scanStatementPage } from "./scanTable";
import { parseScannedStatement, type ScannedPage } from "./parseScanned";
import { parseStatementLines } from "./parseStatement";
import type { ProcessedFile, StatementMeta, Transaction } from "./types";
import { LIMITS } from "./limits";

export { LIMITS, ACCEPT } from "./limits";

export interface PipelineResult {
  file: ProcessedFile;
  transactions: Transaction[];
  meta: StatementMeta | null;
}

export interface PipelineCallbacks {
  onUpdate: (patch: Partial<ProcessedFile>) => void;
  askForPassword: (attemptsSoFar: number) => Promise<string | null>;
}

type FileKind = "pdf" | "image" | "unknown";

/** Identifies the file from its first bytes instead of trusting its name or reported type. */
async function sniffKind(file: File): Promise<FileKind> {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  // PDF headers may follow a few junk bytes; check the first 16.
  if (ascii(0, 16).includes("%PDF-")) return "pdf";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image";
  return "unknown";
}

function fail(base: ProcessedFile, message: string, cb: PipelineCallbacks) {
  const result: ProcessedFile = { ...base, status: "error", message };
  cb.onUpdate(result);
  return { file: result, transactions: [], meta: null, passwordUsed: null };
}

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

  if (file.size > LIMITS.maxFileBytes) {
    return fail(base, `File is larger than ${LIMITS.maxFileBytes / 1024 / 1024} MB`, cb);
  }
  const kind = await sniffKind(file);
  if (kind === "image") return processImage(file, base, cb);
  if (kind === "pdf") return processPdf(file, base, knownPassword, cb);
  return fail(base, "Not a PDF, PNG, JPEG or WEBP file", cb);
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
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return fail(base, "Could not decode this image", cb);
  }
  // Downscale very large photos so the canvas stays within budget.
  const shrink = Math.min(1, Math.sqrt(LIMITS.maxCanvasPixels / (bitmap.width * bitmap.height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(bitmap.width * shrink));
  canvas.height = Math.max(1, Math.floor(bitmap.height * shrink));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

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
  const { width, height } = page.getViewport({ scale: 1 });
  const wanted = Math.min(3, Math.max(1, 2000 / width));
  return Math.min(wanted, Math.sqrt(LIMITS.maxCanvasPixels / (width * height)));
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
      if (attempt >= LIMITS.maxPinAttempts) return null;
      cb.onUpdate({ status: "needs-pin", message: attempt > 0 ? "Incorrect PIN, try again" : undefined });
      return cb.askForPassword(attempt);
    });
    doc = opened.doc;
    passwordUsed = opened.passwordUsed;
  } catch (err) {
    if (err instanceof PdfPasswordError) {
      const result: ProcessedFile = { ...base, status: "error", message: "PDF remains locked (cancelled or too many wrong PINs)." };
      cb.onUpdate(result);
      return { file: result, transactions: [], meta: null, passwordUsed: null };
    }
    const result: ProcessedFile = { ...base, status: "error", message: (err as Error).message ?? "Failed to open PDF" };
    cb.onUpdate(result);
    return { file: result, transactions: [], meta: null, passwordUsed: null };
  }

  if (doc.numPages > LIMITS.maxPages) {
    await doc.destroy();
    return fail(base, `Too many pages (${doc.numPages}); the limit is ${LIMITS.maxPages}`, cb);
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

  const pagesTotal = doc.numPages;
  await doc.destroy(); // free the decrypted document from memory

  const result: ProcessedFile = {
    ...base,
    status: "done",
    message: undefined,
    usedOcr: scannedPages.length > 0,
    pagesTotal,
    pagesOcr: scannedPages.length,
    txnCount: allTransactions.length,
    meta: meta ?? undefined,
    quality,
  };
  cb.onUpdate(result);
  return { file: result, transactions: allTransactions, meta, passwordUsed };
}

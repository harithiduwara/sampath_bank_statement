import { extractLines, openPdf, PdfPasswordError, renderPageToCanvas, totalChars, type PdfLine } from "./pdf";
import { ocrCanvas } from "./ocr";
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

  const lines = await ocrCanvas(canvas);
  cb.onUpdate({ status: "parsing" });
  const { transactions, meta } = parseStatementLines(lines, file.name, 1);

  const result: ProcessedFile = {
    ...base,
    status: "done",
    usedOcr: true,
    pagesTotal: 1,
    pagesOcr: 1,
    txnCount: transactions.length,
    meta,
  };
  cb.onUpdate(result);
  return { file: result, transactions, meta, passwordUsed: null };
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
  let pagesOcr = 0;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    let lines: PdfLine[] = await extractLines(page);

    // Scanned / image-only page: fall back to OCR.
    if (totalChars(lines) < 20) {
      cb.onUpdate({ status: "ocr", pagesOcr: pagesOcr + 1 });
      const canvas = await renderPageToCanvas(page);
      lines = await ocrCanvas(canvas);
      pagesOcr += 1;
    }

    cb.onUpdate({ status: "parsing" });
    const parsed = parseStatementLines(lines, file.name, pageNum);
    allTransactions.push(...parsed.transactions);
    if (!meta || Object.keys(parsed.meta).length > Object.keys(meta).length) {
      meta = parsed.meta;
    }
  }

  const result: ProcessedFile = {
    ...base,
    status: "done",
    usedOcr: pagesOcr > 0,
    pagesTotal: doc.numPages,
    pagesOcr,
    txnCount: allTransactions.length,
    meta: meta ?? undefined,
  };
  cb.onUpdate(result);
  return { file: result, transactions: allTransactions, meta, passwordUsed };
}

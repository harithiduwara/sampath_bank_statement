import { createWorker, type Worker } from "tesseract.js";
import type { PdfLine } from "./pdf";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

/** Runs OCR on a canvas and reshapes the result into the same PdfLine shape
 *  used by the native text layer, so the parser can treat both uniformly. */
export async function ocrCanvas(canvas: HTMLCanvasElement): Promise<PdfLine[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const lines: PdfLine[] = [];
  const blocks = (data as any).blocks ?? [];
  for (const block of blocks) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        const text = (line.text as string).replace(/\s+/g, " ").trim();
        if (!text) continue;
        lines.push({
          y: -line.bbox.y0, // negate so sort order (descending y = top-first) matches pdf.js convention
          text,
          words: (line.words ?? []).map((w: any) => ({ x: w.bbox.x0, text: w.text })),
        });
      }
    }
  }
  return lines.sort((a, b) => b.y - a.y);
}

export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

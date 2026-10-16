import { createWorker, type Worker } from "tesseract.js";
import type { PdfLine } from "./pdf";

let workerPromise: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // Self-hosted worker/core/language assets (public/tesseract/) instead of
    // the jsdelivr CDN defaults, so OCR has no third-party runtime dependency
    // and keeps working if that CDN is unreachable or blocked.
    const base = import.meta.env.BASE_URL;
    workerPromise = createWorker("eng", 1, {
      workerPath: `${base}tesseract/worker.min.js`,
      corePath: `${base}tesseract/core/`,
      langPath: `${base}tesseract/lang`,
      gzip: true,
    });
  }
  return workerPromise;
}

/**
 * Binarizes a scanned page with Otsu's method so faint background patterns
 * (letterhead watermarks, coloured table shading) drop out while dark ink
 * strokes stay black — scanned/photographed statements OCR dramatically
 * better this way than on the raw colour image.
 */
function binarize(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const { data } = img;
  const n = width * height;

  const gray = new Uint8ClampedArray(n);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const g = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    gray[i] = g;
    histogram[g | 0]++;
  }

  // Otsu's method: find the threshold maximizing between-class variance.
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * histogram[t];
  let sumBack = 0;
  let weightBack = 0;
  let maxVariance = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    weightBack += histogram[t];
    if (weightBack === 0) continue;
    const weightFore = n - weightBack;
    if (weightFore === 0) break;
    sumBack += t * histogram[t];
    const meanBack = sumBack / weightBack;
    const meanFore = (sumAll - sumBack) / weightFore;
    const variance = weightBack * weightFore * (meanBack - meanFore) ** 2;
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = gray[i] > threshold ? 255 : 0;
    data[p] = data[p + 1] = data[p + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Runs OCR on a canvas and reshapes the result into the same PdfLine shape
 *  used by the native text layer, so the parser can treat both uniformly. */
export async function ocrCanvas(canvas: HTMLCanvasElement): Promise<PdfLine[]> {
  const worker = await getWorker();
  const prepared = binarize(canvas);
  const { data } = await worker.recognize(prepared, {}, { blocks: true });
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

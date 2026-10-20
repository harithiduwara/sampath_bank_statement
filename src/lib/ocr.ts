import { createWorker, type PSM, type Worker } from "tesseract.js";
import type { GrayImage } from "./imagePrep";
import type { OcrEngine, OcrLine } from "./scanTable";

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

function toCanvas(img: GrayImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  const rgba = ctx.createImageData(img.width, img.height);
  for (let i = 0, p = 0; i < img.data.length; i++, p += 4) {
    rgba.data[p] = rgba.data[p + 1] = rgba.data[p + 2] = img.data[i];
    rgba.data[p + 3] = 255;
  }
  ctx.putImageData(rgba, 0, 0);
  return canvas;
}

/** Tesseract in a web worker, adapted to the engine interface used by the table scanner. */
export const browserOcr: OcrEngine = async (img, psm) => {
  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: psm as unknown as PSM, preserve_interword_spaces: "1" });
  const { data } = await worker.recognize(toCanvas(img), {}, { blocks: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        lines.push({
          text: line.text.replace(/\n$/, ""),
          ...line.bbox,
          words: line.words.map((w) => ({ text: w.text, ...w.bbox })),
        });
      }
    }
  }
  return lines;
};

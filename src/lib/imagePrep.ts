export interface GrayImage {
  data: Uint8ClampedArray; // one byte per pixel, 0 = ink, 255 = paper
  width: number;
  height: number;
}

/**
 * Collapses RGBA to a single "ink darkness" channel using the brightest of
 * R/G/B, then stretches contrast. Coloured backgrounds (Sampath's peach row
 * bands, the orange letterhead watermark, blue certification stamps) are
 * bright in at least one channel and fade to near-white, while black/grey
 * dot-matrix print stays dark.
 */
export function toInkGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const n = width * height;
  const data = new Uint8ClampedArray(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    data[i] = r > g ? (r > b ? r : b) : g > b ? g : b;
  }
  flattenIllumination(data, width, height);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[data[i]]++;
  const percentile = (frac: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= n * frac) return v;
    }
    return 255;
  };
  const lo = percentile(0.01);
  const hi = Math.max(lo + 1, percentile(0.6)); // most of a statement page is paper
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / (hi - lo);
  for (let i = 0; i < n; i++) data[i] = lut[data[i]];
  return { data, width, height };
}

/**
 * Divides out the local paper brightness so photographed pages with a
 * lighting gradient (or a shadow toward the binding edge) end up with an
 * even white background. The paper level is the brightest pixel in each
 * block, spread to neighbouring blocks so text-dense blocks still see paper.
 */
function flattenIllumination(data: Uint8ClampedArray, width: number, height: number): void {
  const block = Math.max(16, Math.round(Math.max(width, height) / 80));
  const bw = Math.ceil(width / block), bh = Math.ceil(height / block);
  const peak = new Float32Array(bw * bh);
  for (let y = 0; y < height; y++) {
    const by = (y / block) | 0;
    for (let x = 0; x < width; x++) {
      const k = by * bw + ((x / block) | 0);
      const v = data[y * width + x];
      if (v > peak[k]) peak[k] = v;
    }
  }
  const bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = by + dy, xx = bx + dx;
          if (yy >= 0 && yy < bh && xx >= 0 && xx < bw && peak[yy * bw + xx] > m) m = peak[yy * bw + xx];
        }
      bg[by * bw + bx] = Math.max(m, 32);
    }
  }
  for (let y = 0; y < height; y++) {
    const fy = Math.min(bh - 1, Math.max(0, y / block - 0.5));
    const y0 = fy | 0, y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(bw - 1, Math.max(0, x / block - 0.5));
      const x0 = fx | 0, x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
      const top = bg[y0 * bw + x0] * (1 - tx) + bg[y0 * bw + x1] * tx;
      const bottom = bg[y1 * bw + x0] * (1 - tx) + bg[y1 * bw + x1] * tx;
      const paper = top * (1 - ty) + bottom * ty;
      const i = y * width + x;
      data[i] = Math.min(255, (data[i] * 255) / paper);
    }
  }
}

export function cropGray(img: GrayImage, x0: number, y0: number, x1: number, y1: number): GrayImage {
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(img.width, Math.ceil(x1));
  y1 = Math.min(img.height, Math.ceil(y1));
  const width = Math.max(1, x1 - x0), height = Math.max(1, y1 - y0);
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    data.set(img.data.subarray((y + y0) * img.width + x0, (y + y0) * img.width + x0 + width), y * width);
  }
  return { data, width, height };
}

/** Bilinear resample; upscaling small print helps Tesseract considerably. */
export function scaleGray(img: GrayImage, scale: number): GrayImage {
  if (scale === 1) return img;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(width * height);
  const src = img.data, sw = img.width, sh = img.height;
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1.001, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = sy | 0, fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1.001, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = sx | 0, fx = sx - x0;
      const i = y0 * sw + x0;
      const j = y0 + 1 < sh ? i + sw : i;
      const k = x0 + 1 < sw ? 1 : 0;
      const top = src[i] + (src[i + k] - src[i]) * fx;
      const bottom = src[j] + (src[j + k] - src[j]) * fx;
      out[y * width + x] = top + (bottom - top) * fy;
    }
  }
  return { data: out, width, height };
}

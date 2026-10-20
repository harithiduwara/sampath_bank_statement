import { cropGray, scaleGray, type GrayImage } from "./imagePrep";
import { levenshtein, parseFuzzyAmount, parseFuzzyDate } from "./ocrText";

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrWord extends OcrBox {
  text: string;
}
export interface OcrLine extends OcrBox {
  text: string;
  words: OcrWord[];
}
/** Runs OCR on a grayscale image; coordinates are in that image's pixels. */
export type OcrEngine = (img: GrayImage, psm: "3" | "6" | "7") => Promise<OcrLine[]>;

export type ColumnRole = "debit" | "credit" | "balance";

export const isTotalLabel = (lead: string) => {
  const word = (lead.split(/\s+/).find((t) => /[A-Za-z]/.test(t)) ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return levenshtein(word, "total") <= 1;
};

export interface TableRow {
  y: number;
  lead: string; // date + particulars
  /** Primary OCR text per cell. */
  cells: Partial<Record<ColumnRole, string>>;
  /** Every independent OCR reading per cell (including the primary one). */
  readings: Partial<Record<ColumnRole, string[]>>;
}
export interface ScannedTable {
  rows: TableRow[];
}
export interface PageScan {
  pageLines: OcrLine[];
  tables: ScannedTable[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
};

function mapLines(lines: OcrLine[], scale: number, dx: number, dy: number): OcrLine[] {
  const m = <T extends OcrBox>(b: T): T => ({
    ...b,
    x0: b.x0 / scale + dx,
    x1: b.x1 / scale + dx,
    y0: b.y0 / scale + dy,
    y1: b.y1 / scale + dy,
  });
  return lines.map((l) => ({ ...m(l), words: l.words.map(m) }));
}

interface Anchor extends OcrBox {
  text: string;
}

/** Shape of a date token even when OCR garbled it beyond parsing ("O8Junse", "Wlun2G"). */
function looksLikeDateToken(text: string): boolean {
  const t = text.replace(/[^A-Za-z0-9]/g, "");
  return t.length >= 5 && t.length <= 11 && /\d/.test(t) && /[A-Za-z]/.test(t) && (t.match(/[0-9OoIlJZSG]/g) ?? []).length >= 3;
}

/**
 * Date-like words at the left margin mark transaction rows. Cleanly parsed
 * dates locate the date column; then any line starting at that x with a
 * date-shaped token counts too, so heavily garbled dates still anchor rows.
 */
function findDateAnchors(lines: OcrLine[], pageWidth: number): Anchor[] {
  const strict: Anchor[] = [];
  for (const line of lines) {
    for (const w of line.words.slice(0, 4)) {
      if (w.x0 < pageWidth * 0.45 && parseFuzzyDate(w.text)) strict.push(w);
    }
  }
  if (strict.length < 2) return strict;
  const x = median(strict.map((c) => c.x0));
  const tol = pageWidth * 0.04;
  const anchors: Anchor[] = [];
  for (const line of lines) {
    const w = line.words.find((w) => Math.abs(w.x0 - x) < tol);
    if (w && (parseFuzzyDate(w.text) || looksLikeDateToken(w.text))) anchors.push(w);
  }
  return anchors.sort((a, b) => a.y0 - b.y0);
}

/** Splits anchors into separate tables wherever a big vertical gap appears. */
function groupTables(anchors: Anchor[], pitch: number): Anchor[][] {
  const groups: Anchor[][] = [];
  for (const a of anchors) {
    const g = groups[groups.length - 1];
    if (g && a.y0 - g[g.length - 1].y0 < pitch * 6) g.push(a);
    else groups.push([a]);
  }
  return groups.filter((g) => g.length >= 3);
}

function paperLevel(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let y = y0; y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      hist[img.data[y * img.width + x]]++;
      n++;
    }
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n / 2) return v;
  }
  return 255;
}

/**
 * Finds column x-ranges inside the table band from a vertical ink
 * projection, ignoring ruling lines (long horizontal/vertical runs).
 */
export function findColumns(img: GrayImage, x0: number, y0: number, y1: number, pitch: number): [number, number][] {
  const W = img.width;
  const top = Math.max(0, Math.floor(y0)), bottom = Math.min(img.height, Math.ceil(y1));
  const left = Math.max(0, Math.floor(x0));
  // Dot-matrix print is faint (often only ~30 levels darker than paper), so
  // treat anything clearly darker than the paper level as ink.
  const threshold = paperLevel(img, left, top, W, bottom) - 32;
  const ink = (x: number, y: number) => img.data[y * W + x] < threshold;
  const maxH = Math.round(pitch * 6);
  const maxV = Math.round(pitch * 2.5);

  // coverage[x] = how many text rows (pitch-high bands) have glyph ink at x.
  // Stamps, signatures and dashed separators touch only a couple of rows,
  // so they can't bridge the whitespace between real columns.
  const bands = Math.max(1, Math.ceil((bottom - top) / pitch));
  const coverage = new Uint16Array(W);
  const density = new Float64Array(W);
  const ruled = new Float64Array(W);
  // long horizontal runs (ruling / dashed separators) are excluded row by row
  const skip = new Uint8Array(W * (bottom - top));
  for (let y = top; y < bottom; y++) {
    let start = -1;
    for (let x = left; x <= W; x++) {
      const v = x < W && ink(x, y);
      if (v && start < 0) start = x;
      if (!v && start >= 0) {
        if (x - start > maxH) skip.fill(1, (y - top) * W + start, (y - top) * W + x);
        start = -1;
      }
    }
  }
  const hit = new Uint8Array(bands);
  for (let x = left; x < W; x++) {
    hit.fill(0);
    let start = -1;
    for (let y = top; y <= bottom; y++) {
      const v = y < bottom && ink(x, y) && !skip[(y - top) * W + x];
      if (v && start < 0) start = y;
      if (!v && start >= 0) {
        if (y - start <= maxV) {
          density[x] += y - start;
          const first = Math.floor((start - top) / pitch);
          const last = Math.min(bands - 1, Math.floor((y - 1 - top) / pitch));
          for (let b = first; b <= last; b++) hit[b] = 1;
        } else {
          ruled[x] += y - start;
        }
        start = -1;
      }
    }
    for (let b = 0; b < bands; b++) coverage[x] += hit[b];
  }

  // ...and faint watermark outlines cross many rows but carry little ink, so
  // a real column needs both enough rows and enough ink.
  const filled = [...density].filter((d) => d > 0).sort((a, b) => a - b);
  const typical = filled[Math.floor(filled.length * 0.75)] ?? 0;
  const floor = Math.max(4, bands * 0.15);
  const densityFloor = typical * 0.12;
  const minGap = pitch * 1.1;
  // Table borders (vertical rules spanning most of the band) are hard
  // column boundaries, so margins/binder holes never join a real column.
  // (summed over a few pixels: a slightly tilted rule spreads across columns)
  const isBorder = (x: number) => {
    let sum = 0;
    for (let k = Math.max(0, x - 3); k <= Math.min(W - 1, x + 3); k++) sum += ruled[k];
    return sum > (bottom - top) * 0.35;
  };
  const segments: [number, number][] = [];
  let segStart = -1, lastInk = -1, borderSince = false;
  for (let x = left; x < W; x++) {
    if (isBorder(x)) borderSince = true;
    if (coverage[x] >= floor && density[x] > densityFloor) {
      if (segStart < 0) segStart = x;
      else if (x - lastInk > minGap || borderSince) {
        segments.push([segStart, lastInk + 1]);
        segStart = x;
      }
      lastInk = x;
      borderSince = false;
    }
  }
  if (segStart >= 0) segments.push([segStart, lastInk + 1]);
  return segments.filter(([a, b]) => b - a > pitch * 0.6);
}

/** Whitens ruling lines so table borders don't confuse Tesseract's layout analysis. */
function eraseRules(img: GrayImage, pitch: number): GrayImage {
  const { width: W, height: H } = img;
  const data = new Uint8ClampedArray(img.data);
  const threshold = paperLevel(img, 0, 0, W, H) - 32;
  const maxH = Math.round(pitch * 6), maxV = Math.round(pitch * 2.5);
  for (let y = 0; y < H; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const v = x < W && img.data[y * W + x] < threshold;
      if (v && start < 0) start = x;
      if (!v && start >= 0) {
        if (x - start > maxH) data.fill(255, y * W + start, y * W + x);
        start = -1;
      }
    }
  }
  for (let x = 0; x < W; x++) {
    let start = -1;
    for (let y = 0; y <= H; y++) {
      const v = y < H && img.data[y * W + x] < threshold;
      if (v && start < 0) start = y;
      if (!v && start >= 0) {
        if (y - start > maxV) for (let k = start; k < y; k++) data[k * W + x] = 255;
        start = -1;
      }
    }
  }
  return { data, width: W, height: H };
}

async function ocrRegion(
  img: GrayImage,
  ocr: OcrEngine,
  box: OcrBox,
  scale: number,
  pitch: number,
  psm: "6" | "7" = "6"
): Promise<OcrLine[]> {
  const crop = eraseRules(cropGray(img, box.x0, box.y0, box.x1, box.y1), pitch);
  const lines = await ocr(scaleGray(crop, scale), psm);
  return mapLines(lines, scale, Math.max(0, Math.floor(box.x0)), Math.max(0, Math.floor(box.y0)));
}

/** Money cells always end in two decimals: "1,750.00", "900,000. 00", "152 588, 45Cr". */
const looksLikeMoney = (text: string) =>
  /[\d%#@*?][.,_ ]\s?\d\d(?!\d)/.test(text) && (text.match(/[\d%#@*?]/g) ?? []).length >= 4;

const yc = (b: OcrBox) => (b.y0 + b.y1) / 2;

/**
 * Reads a scanned statement page column by column. Photographed or
 * scanned continuous-form statements are often curled, so a printed row
 * bows by a large fraction of the line pitch across the page; OCRing the
 * full width makes Tesseract merge neighbouring rows into garbage. Within a
 * single column the bow is negligible, so each column is read separately
 * and the cells are re-joined by vertical position.
 */
export async function scanStatementPage(
  img: GrayImage,
  ocr: OcrEngine,
  onStep?: (step: string) => void
): Promise<PageScan> {
  onStep?.("layout");
  // 1. Overview of the left of the page: locates the date column and the row
  //    pitch. Dates here are often garbled by paper curl; that's fine, we
  //    only need a few of them.
  const leftWidth = Math.round(img.width * 0.55);
  const overviewScale = Math.min(4, Math.max(1, 2000 / leftWidth));
  const leftLines = mapLines(
    await ocr(scaleGray(cropGray(img, 0, 0, leftWidth, img.height), overviewScale), "6"),
    overviewScale,
    0,
    0
  );
  const rough = findDateAnchors(leftLines, img.width);

  // 2. The header (account number, statement period) sits above the table and
  //    spans the page; its lines are short and straight, so read it full width.
  const headerBottom = rough.length ? rough[0].y0 : img.height * 0.35;
  const headerScale = Math.min(3, Math.max(1, 2000 / img.width));
  const headerLines = mapLines(
    await ocr(scaleGray(cropGray(img, 0, 0, img.width, headerBottom), headerScale), "6"),
    headerScale,
    0,
    0
  );
  const pageLines = [...headerLines, ...leftLines];
  if (rough.length < 2) return { pageLines, tables: [] };

  // Row pitch from the spacing of every text line in the table band (anchors
  // alone can be sparse, which skews their gaps).
  const centers = leftLines
    .map(yc)
    .filter((y) => y >= rough[0].y0 && y <= rough[rough.length - 1].y1)
    .sort((a, b) => a - b);
  const lineHeight = median(leftLines.map((l) => l.y1 - l.y0));
  const lineGaps = centers.slice(1).map((y, i) => y - centers[i]).filter((d) => d > lineHeight * 0.6);
  const pitch = Math.max(8, median(lineGaps.filter((d) => d < median(lineGaps) * 1.8)));
  const stripScale = Math.min(4, Math.max(1.5, 64 / pitch));

  // 3. Re-read just the date column at reading resolution: narrow enough that
  //    curl can't merge rows, so nearly every row's date is found.
  const dateX = median(rough.map((a) => a.x0));
  const widths = rough.map((a) => a.x1 - a.x0).sort((a, b) => a - b);
  const dateWidth = widths[Math.floor(widths.length * 0.9)];
  const dateLines = await ocrRegion(
    img,
    ocr,
    { x0: dateX - pitch * 0.6, x1: dateX + dateWidth + pitch * 0.6, y0: 0, y1: img.height },
    stripScale,
    pitch
  );
  const dense = dateLines
    .map((l) => l.words[0])
    .filter((w): w is OcrWord => Boolean(w) && Math.abs(w.x0 - dateX) < pitch * 1.5 && (Boolean(parseFuzzyDate(w.text)) || looksLikeDateToken(w.text)));
  const anchors = dense.length >= rough.length ? dense.sort((a, b) => a.y0 - b.y0) : rough;

  const tables: ScannedTable[] = [];
  const groups = groupTables(anchors, pitch);
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    onStep?.(`table ${gi + 1}/${groups.length}`);
    const nextTop = groups[gi + 1]?.[0].y0 ?? img.height;
    const y0 = Math.max(0, group[0].y0 - pitch * 1.6);
    const y1 = Math.min(nextTop - pitch * 2, group[group.length - 1].y1 + pitch * 3.2, img.height);
    const x0 = Math.max(0, Math.min(...group.map((a) => a.x0)) - pitch * 0.6);

    const columns = findColumns(img, x0, y0, y1, pitch);
    if (columns.length < 2) continue;
    const pad = pitch * 0.4;

    const leadLines = (
      await ocrRegion(img, ocr, { x0: columns[0][0] - pad, x1: columns[0][1] + pad, y0, y1 }, stripScale, pitch)
    ).filter((l) => (l.text.match(/[A-Za-z0-9]/g) ?? []).length >= 2);
    if (!leadLines.length) continue;
    const rows: TableRow[] = leadLines.map((l) => ({ y: yc(l), lead: l.text.trim(), cells: {}, readings: {} }));

    // OCR numeric columns, keep those that actually contain amounts
    // Paper curl shifts a column up/down relative to the date column by an
    // amount that drifts slowly down the page: track that drift while walking
    // both lists top to bottom, never reusing or skipping back.
    const nearestIdx = (y: number) =>
      rows.reduce((best, r, i) => (Math.abs(r.y - y) < Math.abs(rows[best].y - y) ? i : best), 0);
    const assign = (lines: OcrLine[]) => {
      let offset = median(lines.map((l) => yc(l) - rows[nearestIdx(yc(l))].y));
      const cells = new Map<TableRow, string>();
      let lastIdx = -1;
      for (const l of [...lines].sort((a, b) => yc(a) - yc(b))) {
        let idx = nearestIdx(yc(l) - offset);
        if (idx <= lastIdx) idx = lastIdx + 1;
        if (idx >= rows.length) break;
        const dy = yc(l) - rows[idx].y;
        if (Math.abs(dy - offset) > pitch * 0.6) continue;
        cells.set(rows[idx], l.text.trim());
        lastIdx = idx;
        offset = offset * 0.6 + dy * 0.4;
      }
      return cells;
    };

    // Each amount column is read twice at different resolutions: OCR slips
    // on faint dot-matrix digits are largely independent between the two, so
    // the balance chain can pick whichever reading is consistent.
    const numeric: { x: number; x1: number; readings: Map<TableRow, string>[]; suffixes: number }[] = [];
    for (let ci = 1; ci < columns.length; ci++) {
      const [cx0, cx1] = columns[ci];
      // amounts are right-aligned, so a wide figure can start well left of
      // the column's typical edge: extend the strip across the whole gap
      const box = { x0: columns[ci - 1][1] + pitch * 0.2, x1: cx1 + pad, y0, y1 };
      const money = (lines: OcrLine[]) => lines.filter((l) => looksLikeMoney(l.text) && parseFuzzyAmount(l.text));
      const first = money(await ocrRegion(img, ocr, box, stripScale, pitch));
      if (first.length < Math.max(2, rows.length * 0.08)) continue;
      const second = money(await ocrRegion(img, ocr, box, Math.min(5, stripScale * 1.35), pitch));
      const readings = [assign(first), assign(second)];
      const suffixes = first.filter((l) => parseFuzzyAmount(l.text)?.suffix).length;
      numeric.push({ x: (cx0 + cx1) / 2, x1: cx1, readings, suffixes });
    }
    if (!numeric.length) continue;

    // Balance = the column printing Cr/Dr suffixes (else the rightmost);
    // the remaining amount columns are debits then credits, left to right.
    const balanceIdx = numeric.reduce(
      (best, c, i) => (c.suffixes > numeric[best].suffixes || (c.suffixes === numeric[best].suffixes && i > best) ? i : best),
      0
    );
    const others = numeric.filter((_, i) => i !== balanceIdx).slice(-2);
    const roles: [ColumnRole, (typeof numeric)[number]][] = [["balance", numeric[balanceIdx]]];
    if (others.length === 2) roles.push(["debit", others[0]], ["credit", others[1]]);
    else if (others.length === 1) roles.push(["debit", others[0]]); // direction resolved later from the balance chain
    for (const [role, col] of roles) {
      for (const reading of col.readings) {
        for (const [row, text] of reading) {
          row.cells[role] ??= text;
          (row.readings[role] ??= []).push(text);
        }
      }
    }

    // The printed Total line's figures don't sit under the columns, so the
    // strips cut them apart: re-read that row as one line and split it.
    const debitCol = roles.find(([r]) => r === "debit")?.[1];
    const creditCol = roles.find(([r]) => r === "credit")?.[1];
    const tableRight = Math.max(...numeric.map((c) => c.x1)) + pad;
    for (const row of rows.filter((r) => isTotalLabel(r.lead))) {
      // tight bands (dashed rules sit just above and below), a few heights to absorb curl
      let bestCells: TableRow["cells"] = {};
      for (const dy of [0, -0.3, 0.3]) {
        const band = { x0: columns[1][0] - pitch, x1: tableRight, y0: row.y + (dy - 0.6) * pitch, y1: row.y + (dy + 0.6) * pitch };
        const words = (await ocrRegion(img, ocr, band, stripScale, pitch, "7")).flatMap((l) => l.words);
        const groups: OcrWord[][] = [];
        for (const w of words) {
          const g = groups[groups.length - 1];
          if (g && w.x0 - g[g.length - 1].x1 < pitch * 0.7) g.push(w);
          else groups.push([w]);
        }
        const cells: TableRow["cells"] = {};
        for (const g of groups) {
          const text = g.map((w) => w.text).join(" ");
          if (!looksLikeMoney(text)) continue;
          const x = (g[0].x0 + g[g.length - 1].x1) / 2;
          const role = !creditCol || (debitCol && Math.abs(x - debitCol.x) < Math.abs(x - creditCol.x)) ? "debit" : "credit";
          if (!cells[role]) cells[role] = text;
        }
        if (Object.keys(cells).length > Object.keys(bestCells).length) bestCells = cells;
        if (Object.keys(bestCells).length >= (creditCol ? 2 : 1)) break;
      }
      row.cells = bestCells;
      row.readings = Object.fromEntries(Object.entries(bestCells).map(([k, v]) => [k, [v]]));
    }
    tables.push({ rows });
  }
  return { pageLines, tables };
}

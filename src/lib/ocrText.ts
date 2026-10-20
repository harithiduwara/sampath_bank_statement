const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Glyph confusions typical of OCR on dot-matrix / photocopied print.
const AS_DIGIT: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0", U: "0",
  l: "1", I: "1", i: "1", "|": "1", "!": "1", L: "1", ")": "1", "]": "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  G: "6", b: "6",
  T: "7",
  B: "8", "&": "8",
  g: "9", q: "9",
  e: "6", "é": "6",
};
const AS_LETTER: Record<string, string> = {
  "0": "o", "1": "l", "3": "s", "5": "s", "8": "s", $: "s", "6": "g", "¢": "c", "(": "c", "€": "c",
  "4": "a", q: "g", Q: "g", "9": "g",
};

/** Pattern glyph for a lone vertical stroke: almost always a "1" in dot-matrix print. */
export const LIKELY_ONE = "!";

/**
 * Edit distance where `wildcard` matches any character at a small cost
 * (an unreadable glyph is weak evidence, not a free pass).
 */
export function levenshtein(a: string, b: string, wildcard = "?", wildcardCost = 0): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const x = a[i - 1], y = b[j - 1];
      const sub =
        x === y
          ? 0
          : x === LIKELY_ONE || y === LIKELY_ONE
          ? x === "1" || y === "1"
            ? 0
            : 0.6
          : x === wildcard || y === wildcard
          ? wildcardCost
          : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
    }
    prev = cur;
  }
  return prev[n];
}

function toDigits(s: string): string | null {
  let out = "";
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (AS_DIGIT[ch]) out += AS_DIGIT[ch];
    else return null;
  }
  return out;
}

function matchMonth(raw: string): { month: number; distance: number } | null {
  const norm = [...raw].map((c) => AS_LETTER[c] ?? c.toLowerCase()).join("");
  let best: { month: number; distance: number } | null = null;
  let tie = false;
  for (let m = 0; m < 12; m++) {
    const d = levenshtein(norm, MONTHS[m]);
    if (!best || d < best.distance) {
      best = { month: m + 1, distance: d };
      tie = false;
    } else if (d === best.distance) {
      tie = true;
    }
  }
  if (!best || best.distance > 1 || (tie && best.distance > 0)) return null;
  return best;
}

export interface FuzzyDate {
  year: number;
  month: number;
  day: number;
  distance: number; // 0 = read cleanly
}

/**
 * Parses statement date tokens like "22Sep26" / "01JUL2026" even when OCR
 * has mangled them ("223ep26", "080¢:t26", "0&0ct26", "140¢:t2026").
 */
export function parseFuzzyDate(token: string): FuzzyDate | null {
  const t = token.replace(/[:.,'`"|_~?()[\]-]/g, "");
  if (t.length < 5 || t.length > 11) return null;
  let best: FuzzyDate | null = null;
  for (const dayLen of [2, 1]) {
    for (const yearLen of [4, 2]) {
      const monLen = t.length - dayLen - yearLen;
      if (monLen < 2 || monLen > 4) continue;
      const day = toDigits(t.slice(0, dayLen));
      const year = toDigits(t.slice(dayLen + monLen));
      if (day === null || year === null) continue;
      const mon = matchMonth(t.slice(dayLen, dayLen + monLen));
      if (!mon) continue;
      const d = parseInt(day, 10);
      const y = yearLen === 2 ? 2000 + parseInt(year, 10) : parseInt(year, 10);
      if (d < 1 || d > 31 || y < 1990 || y > 2100) continue;
      const distance = mon.distance + (dayLen === 1 ? 0.5 : 0) + (monLen === 3 ? 0 : 0.5);
      if (!best || distance < best.distance) best = { year: y, month: mon.month, day: d, distance };
    }
  }
  return best;
}

export interface FuzzyAmount {
  /** Digits of the value in cents, with "?" for unreadable glyphs. */
  pattern: string;
  /** Parsed value when every digit was readable. */
  value: number | null;
  suffix: "Cr" | "Dr" | null;
}

/**
 * Reads a money cell. Statement amounts always carry two decimals, so the
 * value is simply "all digits / 100" — which makes it immune to OCR mixing
 * up thousands separators and decimal points ("2.901.120.15", "474,584 15").
 */
export function parseFuzzyAmount(text: string): FuzzyAmount | null {
  // Pick the space-separated chunk that looks most like money.
  const chunks = text.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  let best = "";
  let bestDigits = 0;
  for (const c of chunks) {
    const digits = (c.match(/\d/g) ?? []).length;
    if (digits > bestDigits) [best, bestDigits] = [c, digits];
  }
  if (bestDigits < 3) return null;

  // Amounts always end in exactly two decimals: anchor on those, so whatever
  // follows (Cr / Dr / "CT" / "ur" / border marks) is treated as the suffix.
  let body = best;
  let tail = "";
  let cents: RegExpExecArray | null = null;
  const centsRe = /[.,_ ]\s?([0-9?%#@*]{2})(?![0-9])/g;
  for (let m = centsRe.exec(best); m; m = centsRe.exec(best)) cents = m;
  if (cents) {
    body = best.slice(0, cents.index) + "." + cents[1];
    tail = best.slice(cents.index + cents[0].length);
  } else {
    const suf = /\s*([CcGg¢(€0O][rtylRTYL)\]]|[Dd][rtRT])\W*$/.exec(best);
    if (suf) {
      body = best.slice(0, suf.index);
      tail = suf[1];
    }
  }
  const suffix: FuzzyAmount["suffix"] = /[Dd][rRtT]/.test(tail) ? "Dr" : /[A-Za-z¢(]/.test(tail) ? "Cr" : null;

  let pattern = "";
  const chars = [...body];
  const numLike = (c: string | undefined) => c !== undefined && (/[\d.,]/.test(c) || c in AS_DIGIT);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch >= "0" && ch <= "9") pattern += ch;
    else if (/[\s.,_'`-]/.test(ch)) continue;
    // "| 000.00": a lone leading stroke is usually a "1", but could be a rule
    else if (pattern.length === 0 && /[|Il!]/.test(ch) && chars[i + 1] === " " && /\d/.test(chars[i + 2] ?? "")) pattern += LIKELY_ONE;
    else if (AS_DIGIT[ch] && (pattern.length > 0 || numLike(chars[i + 1]))) pattern += AS_DIGIT[ch];
    else {
      // an unreadable glyph that runs into more of the number is a digit we
      // couldn't read; anything else (border marks, stray letters) is noise
      let j = i + 1;
      while (j < chars.length && !numLike(chars[j]) && !/\s/.test(chars[j])) j++;
      if (numLike(chars[j]) && j < chars.length) pattern += "?";
    }
  }
  if ((pattern.match(/\d/g) ?? []).length < 3) return null;
  const value = /[?!]/.test(pattern) ? null : parseInt(pattern, 10) / 100;
  return { pattern, value, suffix };
}

/** How far a candidate value is from what OCR read (0 = exact agreement). */
export function amountDistance(value: number, pattern: string): number {
  const digits = String(Math.round(Math.abs(value) * 100));
  return levenshtein(digits, pattern, "?", 0.2);
}

/**
 * Values one OCR slip away from a fully read pattern: any single digit
 * swapped, dropped, or a spurious digit removed.
 */
export function nearbyValues(pattern: string): number[] {
  if (/[?!]/.test(pattern) || pattern.length < 3) return [];
  const out = new Set<number>();
  for (let i = 0; i < pattern.length; i++) {
    out.add(parseInt(pattern.slice(0, i) + pattern.slice(i + 1), 10));
    for (const d of "0123456789") {
      if (d !== pattern[i]) out.add(parseInt(pattern.slice(0, i) + d + pattern.slice(i + 1), 10));
    }
  }
  return [...out];
}

/** Every value a digit pattern could stand for, if it has at most `maxHoles` unreadable digits. */
export function expandPattern(pattern: string, maxHoles = 2): number[] {
  const holes = (pattern.match(/[?!]/g) ?? []).length;
  if (holes > maxHoles) return [];
  let fills = [pattern];
  while (/[?!]/.test(fills[0])) fills = fills.flatMap((f) => [..."0123456789"].map((d) => f.replace(/[?!]/, d)));
  return fills.map((f) => parseInt(f, 10));
}

/** Number and date formatting shared by every view (one locale, one style). */

const LOCALE = "en-US";

const fixed2 = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 });

/** 1,234.56 — table cells. Negative values use a true minus sign. */
export function amount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = fixed2.format(Math.abs(n));
  return n < 0 ? `−${s}` : s;
}

/** (1,234.56) for negatives — accounting statements. */
export function accounting(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (Math.abs(n) < 0.005) return "–";
  const s = fixed2.format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
}

/** LKR 1,234,568 — KPI tiles (whole units). */
export function money(n: number | null | undefined, currency?: string): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const s = whole.format(Math.abs(Math.round(n)));
  return `${n < 0 ? "−" : ""}${currency ? `${currency} ` : ""}${s}`;
}

/** 1.2M — chart axes. */
export function compact(n: number): string {
  return compactFmt.format(n);
}

export function percent(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-09-28 -> 28 Sep 2026 */
export function date(iso: string | undefined | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m) return iso;
  return d ? `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`;
}

/** 2026-09 -> Sep 2026 */
export function month(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString(LOCALE)} ${n === 1 ? one : many}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Accounting model over the merged statement ledger: accounts, periods,
 * balances, cash-flow, reconciliation and analyst notes. Pure functions only,
 * so every number on screen is unit-testable.
 */
import { categorize } from "./categorize";
import type { Insight, ReadQuality, StatementMeta, Transaction } from "./types";

/* ------------------------------------------------------------------ dates */

const DAY = 86_400_000;
export const dayNum = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};
export const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoOf(dayNum(iso) + n);
const monthKey = (iso: string) => iso.slice(0, 7);
const lastDayOfMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return isoOf(Date.UTC(y, m, 0) / DAY);
};
const addMonths = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/* --------------------------------------------------------------- accounts */

export interface Account {
  key: string;
  accountNo?: string;
  bank?: string;
  currency: string;
  label: string;
  fileIds: string[];
  /** Files with no readable account number that were attached to this account. */
  inferredFileIds: string[];
}

export interface FileInfo {
  id: string;
  name: string;
  meta?: StatementMeta;
  usedOcr: boolean;
}

const digitsOnly = (s?: string) => (s ?? "").replace(/\D/g, "");
const oneDigitApart = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
  return true;
};

/**
 * Groups statements into accounts. An OCR'd account number one digit away
 * from a known one is treated as a misread of it (the e-statement's number
 * wins). A statement with no readable number joins the only account in the
 * same currency, if there is exactly one; otherwise it stands alone.
 */
export function resolveAccounts(files: FileInfo[]): { accounts: Account[]; fileAccount: Record<string, string> } {
  const accounts: Account[] = [];
  const fileAccount: Record<string, string> = {};
  const currencyOf = (f: FileInfo) => f.meta?.currency ?? "LKR";
  const numbered = files
    .filter((f) => digitsOnly(f.meta?.accountNo).length >= 6)
    .sort((a, b) => Number(a.usedOcr) - Number(b.usedOcr));

  for (const f of numbered) {
    const no = digitsOnly(f.meta!.accountNo);
    let acct = accounts.find((a) => a.currency === currencyOf(f) && (a.accountNo === no || oneDigitApart(a.accountNo!, no)));
    if (!acct) {
      acct = {
        key: `acct:${no}`,
        accountNo: no,
        bank: f.meta?.bank,
        currency: currencyOf(f),
        label: `${shortBank(f.meta?.bank)}•••• ${no.slice(-4)}`,
        fileIds: [],
        inferredFileIds: [],
      };
      accounts.push(acct);
    }
    acct.fileIds.push(f.id);
    fileAccount[f.id] = acct.key;
  }

  for (const f of files.filter((x) => !fileAccount[x.id])) {
    const sameCurrency = accounts.filter((a) => a.currency === currencyOf(f) && a.accountNo);
    if (sameCurrency.length === 1) {
      sameCurrency[0].fileIds.push(f.id);
      sameCurrency[0].inferredFileIds.push(f.id);
      fileAccount[f.id] = sameCurrency[0].key;
      continue;
    }
    const acct: Account = {
      key: `file:${f.id}`,
      bank: f.meta?.bank,
      currency: currencyOf(f),
      label: `Unidentified (${f.name})`,
      fileIds: [f.id],
      inferredFileIds: [],
    };
    accounts.push(acct);
    fileAccount[f.id] = acct.key;
  }
  return { accounts, fileAccount };
}

function shortBank(bank?: string) {
  if (!bank) return "";
  return `${bank.replace(/\s+(bank\s+)?plc$/i, "").replace(/\s+bank$/i, "")} `;
}

/* ----------------------------------------------------------------- ledger */

export type EditableFields = Pick<Transaction, "date" | "description" | "debit" | "credit" | "balance">;

/** What the user changed on a row. The read values stay untouched underneath. */
export interface Override {
  edits?: Partial<EditableFields>;
  category?: string;
  note?: string;
  reviewed?: boolean;
  updatedAt?: string;
}

export interface LedgerTxn extends Transaction {
  uid: string;
  fileId: string;
  accountKey: string;
  currency: string;
  /** Read values for fields the user edited. */
  original?: Partial<EditableFields>;
  edited: boolean;
  note?: string;
  reviewed: boolean;
  categorySource: "auto" | "rule" | "manual";
}

/** Narration reduced to its leading words, so "KIRULAPO CACHQ 19" and "KIRULAPO CACHQ 24" match. */
export function narrationKey(description: string): string {
  return description
    .toUpperCase()
    .replace(/[^A-Z/ ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 3)
    .join(" ");
}

export const uidOf = (fileId: string, order: number) => `${fileId}::${order}`;
export const fileIdOfUid = (uid: string) => uid.slice(0, uid.lastIndexOf("::"));

export function applyOverride(
  t: Transaction,
  ctx: { fileId: string; accountKey: string; currency: string },
  o: Override | undefined,
  rules: Record<string, string>
): LedgerTxn {
  // Only fields actually set count; an undefined edit means "use the statement's value".
  const edits: Partial<EditableFields> = {};
  const original: Partial<EditableFields> = {};
  for (const k of Object.keys(o?.edits ?? {}) as (keyof EditableFields)[]) {
    const v = o!.edits![k];
    if (v !== undefined && v !== t[k]) {
      (edits as Record<string, unknown>)[k] = v;
      (original as Record<string, unknown>)[k] = t[k];
    }
  }
  const edited = Object.keys(edits).length > 0;
  const merged = { ...t, ...edits };
  const ruleCategory = rules[narrationKey(merged.description)];
  const category = o?.category ?? ruleCategory ?? (edits.description !== undefined ? categorize(merged.description) : t.category);
  return {
    ...merged,
    uid: t.id,
    fileId: ctx.fileId,
    accountKey: ctx.accountKey,
    currency: ctx.currency,
    type: merged.credit !== null && merged.credit !== undefined ? "credit" : "debit",
    category,
    categorySource: o?.category ? "manual" : ruleCategory ? "rule" : "auto",
    original: edited ? original : undefined,
    edited,
    note: o?.note || undefined,
    reviewed: Boolean(o?.reviewed),
  };
}

export const needsReview = (t: LedgerTxn) => !t.reviewed && (t.confidence === "review" || t.confidence === "corrected");

/* ----------------------------------------------------------------- period */

export interface Period {
  from: string;
  to: string;
}

export type PresetId = "all" | "latest-month" | "previous-month" | "latest-quarter" | "ytd" | "last-12" | "custom";

export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "all", label: "All data" },
  { id: "latest-month", label: "Latest month" },
  { id: "previous-month", label: "Previous month" },
  { id: "latest-quarter", label: "Latest quarter" },
  { id: "ytd", label: "Year to date" },
  { id: "last-12", label: "Last 12 months" },
  { id: "custom", label: "Custom range" },
];

export function dataRange(txns: { date: string }[]): Period | null {
  if (txns.length === 0) return null;
  let from = txns[0].date, to = txns[0].date;
  for (const t of txns) {
    if (t.date < from) from = t.date;
    if (t.date > to) to = t.date;
  }
  return { from, to };
}

/**
 * Statements are historical, so relative presets are anchored on the latest
 * transaction date, not today's date.
 */
export function resolvePeriod(preset: PresetId, range: Period | null, custom?: Period): Period | null {
  if (!range) return null;
  const end = range.to;
  const m = monthKey(end);
  switch (preset) {
    case "all":
      return range;
    case "latest-month":
      return { from: `${m}-01`, to: lastDayOfMonth(m) };
    case "previous-month": {
      const p = addMonths(m, -1);
      return { from: `${p}-01`, to: lastDayOfMonth(p) };
    }
    case "latest-quarter": {
      const [y, mm] = m.split("-").map(Number);
      const q = Math.floor((mm - 1) / 3) * 3 + 1;
      const start = `${y}-${String(q).padStart(2, "0")}`;
      return { from: `${start}-01`, to: lastDayOfMonth(addMonths(start, 2)) };
    }
    case "ytd":
      return { from: `${end.slice(0, 4)}-01-01`, to: end };
    case "last-12":
      return { from: `${addMonths(m, -11)}-01`, to: lastDayOfMonth(m) };
    case "custom":
      if (custom && custom.from && custom.to) {
        return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
      }
      return range;
  }
}

/** The equal-length period immediately before, by calendar months when the period is whole months. */
export function previousPeriod(p: Period): Period {
  const wholeMonths = p.from.endsWith("-01") && p.to === lastDayOfMonth(monthKey(p.to));
  if (wholeMonths) {
    const [fy, fm] = p.from.split("-").map(Number);
    const [ty, tm] = p.to.split("-").map(Number);
    const n = (ty - fy) * 12 + (tm - fm) + 1;
    const start = addMonths(monthKey(p.from), -n);
    return { from: `${start}-01`, to: lastDayOfMonth(addMonths(start, n - 1)) };
  }
  const len = dayNum(p.to) - dayNum(p.from) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

export const inPeriod = <T extends { date: string }>(txns: T[], p: Period) => txns.filter((t) => t.date >= p.from && t.date <= p.to);

/* --------------------------------------------------------------- balances */

function byAccount<T extends { accountKey: string }>(txns: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of txns) m.set(t.accountKey, [...(m.get(t.accountKey) ?? []), t]);
  return m;
}

/** Balance of one account (rows in ledger order) at the start of `from`. */
function accountOpening(rows: LedgerTxn[], from: string): number | null {
  let before: number | null = null;
  for (const t of rows) {
    if (t.date >= from) break;
    if (t.balance !== null) before = t.balance;
  }
  if (before !== null) return before;
  const first = rows.find((t) => t.date >= from && t.balance !== null);
  if (!first) return null;
  // Rows before it without a balance still moved money; walk back through them too.
  const idx = rows.indexOf(first);
  let bal = first.balance! - (first.credit ?? 0) + (first.debit ?? 0);
  for (let i = idx - 1; i >= 0 && rows[i].date >= from; i--) bal -= (rows[i].credit ?? 0) - (rows[i].debit ?? 0);
  return round2(bal);
}

function accountClosing(rows: LedgerTxn[], to: string): number | null {
  let last: number | null = null;
  for (const t of rows) {
    if (t.date > to) break;
    if (t.balance !== null) last = t.balance;
  }
  return last;
}

const sumNullable = (vals: (number | null)[]) => (vals.every((v) => v === null) ? null : round2(vals.reduce<number>((s, v) => s + (v ?? 0), 0)));
const round2 = (n: number) => Math.round(n * 100) / 100;

export function openingBalance(all: LedgerTxn[], p: Period): number | null {
  return sumNullable([...byAccount(all).values()].map((rows) => accountOpening(rows, p.from)));
}

export function closingBalance(all: LedgerTxn[], p: Period): number | null {
  return sumNullable([...byAccount(all).values()].map((rows) => accountClosing(rows, p.to)));
}

/** End-of-day balance for each day of the period (all accounts in scope summed). */
export function dailyBalances(all: LedgerTxn[], p: Period): { date: string; balance: number | null }[] {
  const days = Math.min(dayNum(p.to) - dayNum(p.from) + 1, 3700);
  const total: (number | null)[] = new Array(days).fill(null);
  for (const rows of byAccount(all).values()) {
    let bal = accountOpening(rows, p.from);
    let i = 0;
    const inRange = rows.filter((t) => t.date >= p.from && t.date <= p.to);
    for (let d = 0; d < days; d++) {
      const iso = addDays(p.from, d);
      while (i < inRange.length && inRange[i].date === iso) {
        const t = inRange[i++];
        bal = t.balance ?? (bal === null ? null : round2(bal + (t.credit ?? 0) - (t.debit ?? 0)));
      }
      if (bal !== null) total[d] = round2((total[d] ?? 0) + bal);
    }
  }
  return total.map((balance, d) => ({ date: addDays(p.from, d), balance }));
}

/* ------------------------------------------------------------------- KPIs */

export interface Kpis {
  opening: number | null;
  closing: number | null;
  receipts: number;
  payments: number;
  net: number;
  count: number;
  review: number;
  lowest: { date: string; balance: number } | null;
  overdraftDays: number;
  averageBalance: number | null;
}

export function kpis(all: LedgerTxn[], p: Period): Kpis {
  const rows = inPeriod(all, p);
  const receipts = round2(rows.reduce((s, t) => s + (t.credit ?? 0), 0));
  const payments = round2(rows.reduce((s, t) => s + (t.debit ?? 0), 0));
  const daily = rows.length ? dailyBalances(all, p).filter((d) => d.balance !== null) : [];
  // Average and lowest only over days the statements actually cover.
  const range = dataRange(rows);
  const covered = range ? daily.filter((d) => d.date >= range.from && d.date <= range.to) : [];
  let lowest: Kpis["lowest"] = null;
  for (const d of covered) if (!lowest || d.balance! < lowest.balance) lowest = { date: d.date, balance: d.balance! };
  return {
    opening: rows.length ? openingBalance(all, p) : closingBalance(all, { from: p.from, to: addDays(p.from, -1) }),
    closing: closingBalance(all, p),
    receipts,
    payments,
    net: round2(receipts - payments),
    count: rows.length,
    review: rows.filter(needsReview).length,
    lowest,
    overdraftDays: covered.filter((d) => d.balance! < 0).length,
    averageBalance: covered.length ? round2(covered.reduce((s, d) => s + d.balance!, 0) / covered.length) : null,
  };
}

/** % change, or null when there is nothing meaningful to compare against. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || Math.abs(previous) < 0.005) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/* --------------------------------------------------------------- cash flow */

export type Granularity = "day" | "week" | "month";

export function pickGranularity(p: Period): Granularity {
  const days = dayNum(p.to) - dayNum(p.from) + 1;
  return days <= 45 ? "day" : days <= 190 ? "week" : "month";
}

export interface FlowBucket {
  key: string;
  from: string;
  to: string;
  receipts: number;
  payments: number;
  net: number;
}

const weekStart = (iso: string) => {
  const n = dayNum(iso);
  const dow = (new Date(n * DAY).getUTCDay() + 6) % 7; // Monday = 0
  return isoOf(n - dow);
};

export function cashflowSeries(all: LedgerTxn[], p: Period, g: Granularity): FlowBucket[] {
  const buckets: FlowBucket[] = [];
  if (g === "month") {
    for (let m = monthKey(p.from); m <= monthKey(p.to); m = addMonths(m, 1)) {
      buckets.push({ key: m, from: `${m}-01` < p.from ? p.from : `${m}-01`, to: lastDayOfMonth(m) > p.to ? p.to : lastDayOfMonth(m), receipts: 0, payments: 0, net: 0 });
    }
  } else {
    const step = g === "day" ? 1 : 7;
    for (let d = g === "day" ? p.from : weekStart(p.from); d <= p.to; d = addDays(d, step)) {
      const end = addDays(d, step - 1);
      buckets.push({ key: d, from: d < p.from ? p.from : d, to: end > p.to ? p.to : end, receipts: 0, payments: 0, net: 0 });
    }
  }
  for (const t of inPeriod(all, p)) {
    const b = buckets.find((x) => t.date >= x.from && t.date <= x.to);
    if (!b) continue;
    b.receipts += t.credit ?? 0;
    b.payments += t.debit ?? 0;
  }
  for (const b of buckets) {
    b.receipts = round2(b.receipts);
    b.payments = round2(b.payments);
    b.net = round2(b.receipts - b.payments);
  }
  return buckets;
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
  share: number;
}

export function categoryTotals(rows: LedgerTxn[], side: "debit" | "credit"): CategoryTotal[] {
  const map = new Map<string, { total: number; count: number }>();
  let grand = 0;
  for (const t of rows) {
    const v = t[side];
    if (!v) continue;
    grand += v;
    const e = map.get(t.category) ?? { total: 0, count: 0 };
    e.total += v;
    e.count += 1;
    map.set(t.category, e);
  }
  return [...map.entries()]
    .map(([category, v]) => ({ category, total: round2(v.total), count: v.count, share: grand ? (v.total / grand) * 100 : 0 }))
    .sort((a, b) => b.total - a.total);
}

export interface StatementLine {
  category: string;
  values: number[];
  total: number;
}

export interface CashflowStatement {
  columns: { key: string; from: string; to: string }[];
  opening: (number | null)[];
  receipts: StatementLine[];
  payments: StatementLine[];
  totalReceipts: number[];
  totalPayments: number[];
  net: number[];
  closing: (number | null)[];
  total: { opening: number | null; receipts: number; payments: number; net: number; closing: number | null };
}

/** Direct-method cash-flow statement with one column per calendar month of the period. */
export function cashflowStatement(all: LedgerTxn[], p: Period): CashflowStatement {
  const columns = cashflowSeries(all, p, "month").map(({ key, from, to }) => ({ key, from, to }));
  const lines = (side: "credit" | "debit") => {
    const cats = categoryTotals(inPeriod(all, p), side).map((c) => c.category);
    return cats.map((category) => {
      const values = columns.map((c) =>
        round2(inPeriod(all, c).reduce((s, t) => s + (t.category === category ? t[side] ?? 0 : 0), 0))
      );
      return { category, values, total: round2(values.reduce((a, b) => a + b, 0)) };
    });
  };
  const receipts = lines("credit");
  const payments = lines("debit");
  const colSum = (ls: StatementLine[]) => columns.map((_, i) => round2(ls.reduce((s, l) => s + l.values[i], 0)));
  const totalReceipts = colSum(receipts);
  const totalPayments = colSum(payments);
  const k = kpis(all, p);
  return {
    columns,
    opening: columns.map((c) => openingBalance(all, c)),
    receipts,
    payments,
    totalReceipts,
    totalPayments,
    net: columns.map((_, i) => round2(totalReceipts[i] - totalPayments[i])),
    closing: columns.map((c) => closingBalance(all, c)),
    total: { opening: k.opening, receipts: k.receipts, payments: k.payments, net: k.net, closing: k.closing },
  };
}

/* --------------------------------------------------------------- recurring */

export interface RecurringItem {
  key: string;
  label: string;
  direction: "in" | "out";
  months: number;
  count: number;
  average: number;
  last: string;
  category: string;
}

/** Narrations that come back in at least three different months at a similar amount. */
export function recurringItems(rows: LedgerTxn[]): RecurringItem[] {
  const groups = new Map<string, LedgerTxn[]>();
  for (const t of rows) {
    const k = narrationKey(t.description);
    if (!k) continue;
    const key = `${t.type}|${k}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const out: RecurringItem[] = [];
  for (const [key, list] of groups) {
    const months = new Set(list.map((t) => monthKey(t.date))).size;
    if (months < 3) continue;
    const amounts = list.map((t) => t.debit ?? t.credit ?? 0);
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const sd = Math.sqrt(amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length);
    if (mean <= 0 || sd / mean > 0.35) continue;
    const last = list.reduce((a, b) => (b.date > a.date ? b : a));
    out.push({
      key,
      label: key.split("|")[1],
      direction: last.type === "credit" ? "in" : "out",
      months,
      count: list.length,
      average: round2(mean),
      last: last.date,
      category: last.category,
    });
  }
  return out.sort((a, b) => b.average * b.count - a.average * a.count);
}

/* ---------------------------------------------------------- reconciliation */

export interface BalanceBreak {
  uid: string;
  date: string;
  description: string;
  expected: number;
  actual: number;
  difference: number;
}

export interface StatementRecon {
  fileId: string;
  name: string;
  accountKey: string;
  from: string | null;
  to: string | null;
  rows: number;
  opening: number | null;
  receipts: number;
  payments: number;
  closing: number | null;
  expectedClosing: number | null;
  difference: number | null;
  breaks: BalanceBreak[];
  missingBalances: number;
  printedTotals: ReadQuality["totals"];
  review: number;
  edited: number;
  status: "balanced" | "issues" | "unverifiable";
}

const EPS = 0.005;

/** Checks one statement's own rows (in statement order) against its running balance. */
export function reconcileStatement(
  file: { id: string; name: string; quality?: ReadQuality },
  accountKey: string,
  rows: LedgerTxn[]
): StatementRecon {
  const ordered = [...rows].sort((a, b) => a.order - b.order);
  const receipts = round2(ordered.reduce((s, t) => s + (t.credit ?? 0), 0));
  const payments = round2(ordered.reduce((s, t) => s + (t.debit ?? 0), 0));
  const breaks: BalanceBreak[] = [];
  let expected: number | null = null;
  let opening: number | null = null;
  let closing: number | null = null;
  let flowBeforeFirstBalance = 0;
  for (const t of ordered) {
    const move = (t.credit ?? 0) - (t.debit ?? 0);
    if (t.balance === null) {
      if (expected !== null) expected = round2(expected + move);
      else flowBeforeFirstBalance += move;
      continue;
    }
    if (expected === null) {
      opening = round2(t.balance - move - flowBeforeFirstBalance);
    } else {
      const exp = round2(expected + move);
      if (Math.abs(exp - t.balance) > EPS) {
        breaks.push({ uid: t.uid, date: t.date, description: t.description, expected: exp, actual: t.balance, difference: round2(t.balance - exp) });
      }
    }
    expected = t.balance;
    closing = t.balance;
  }
  const expectedClosing = opening === null ? null : round2(opening + receipts - payments);
  const difference = closing === null || expectedClosing === null ? null : round2(closing - expectedClosing);
  const range = dataRange(ordered);
  const printedTotals = rows.some((t) => t.edited) ? editedTotals(file.quality, receipts, payments) : file.quality?.totals ?? "unknown";
  return {
    fileId: file.id,
    name: file.name,
    accountKey,
    from: range?.from ?? null,
    to: range?.to ?? null,
    rows: ordered.length,
    opening,
    receipts,
    payments,
    closing,
    expectedClosing,
    difference,
    breaks,
    missingBalances: ordered.filter((t) => t.balance === null).length,
    printedTotals,
    review: ordered.filter(needsReview).length,
    edited: ordered.filter((t) => t.edited).length,
    status: closing === null ? "unverifiable" : breaks.length === 0 && printedTotals !== "mismatch" ? "balanced" : "issues",
  };
}

/** After edits, compare the new sums with the totals printed on the statement. */
function editedTotals(q: ReadQuality | undefined, receipts: number, payments: number): ReadQuality["totals"] {
  if (!q || q.totals === "unknown" || (!q.totalCredit && !q.totalDebit)) return q?.totals ?? "unknown";
  return Math.abs(q.totalCredit - receipts) < 0.01 && Math.abs(q.totalDebit - payments) < 0.01 ? "match" : "mismatch";
}

export interface ContinuityIssue {
  accountKey: string;
  fromName: string;
  toName: string;
  after: string;
  before: string;
  closing: number;
  nextOpening: number;
  difference: number;
}

/**
 * Between consecutive statements of one account, the closing balance must
 * carry over as the next opening balance. When it doesn't, transactions are
 * missing from the uploaded set (a statement or pages were not uploaded).
 */
export function continuityIssues(recons: StatementRecon[]): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  for (const list of byAccount(recons.filter((r) => r.from)).values()) {
    const sorted = [...list].sort((a, b) => (a.from! < b.from! ? -1 : a.from! > b.from! ? 1 : a.to! < b.to! ? -1 : 1));
    // Compare each statement with the one that reaches furthest before it, so a short
    // statement nested inside a longer one doesn't hide (or fake) a gap.
    let reach = sorted[0];
    for (const b of sorted.slice(1)) {
      if (b.from! <= reach.to!) {
        if (b.to! > reach.to!) reach = b; // overlapping: duplicates are removed instead
        continue;
      }
      if (reach.closing !== null && b.opening !== null) {
        const diff = round2(b.opening - reach.closing);
        if (Math.abs(diff) > EPS) {
          issues.push({ accountKey: reach.accountKey, fromName: reach.name, toName: b.name, after: reach.to!, before: b.from!, closing: reach.closing, nextOpening: b.opening, difference: diff });
        }
      }
      reach = b;
    }
  }
  return issues;
}

/* ------------------------------------------------------------ analyst notes */

export function analystNotes(args: {
  current: Kpis;
  previous: Kpis | null;
  payments: CategoryTotal[];
  rows: LedgerTxn[];
  issues: number;
  currency: string;
  fmt: (n: number) => string;
}): Insight[] {
  const { current: k, previous: prev, payments, rows, issues, fmt } = args;
  const notes: Insight[] = [];
  if (k.count === 0) return notes;

  notes.push({
    id: "net",
    tone: k.net >= 0 ? "positive" : "warning",
    title: k.net >= 0 ? `Net inflow of ${fmt(k.net)}` : `Net outflow of ${fmt(-k.net)}`,
    detail:
      k.receipts > 0
        ? `Payments used ${((k.payments / k.receipts) * 100).toFixed(0)}% of receipts this period.`
        : "No receipts in this period; every movement was a payment.",
  });

  if (prev && prev.count > 0) {
    const c = change(k.payments, prev.payments);
    if (c !== null && Math.abs(c) >= 10) {
      notes.push({
        id: "payments-trend",
        tone: c > 0 ? "warning" : "positive",
        title: `Payments ${c > 0 ? "up" : "down"} ${Math.abs(c).toFixed(0)}% on the previous period`,
        detail: `${fmt(k.payments)} against ${fmt(prev.payments)}.`,
      });
    }
  }

  if (payments[0] && payments[0].share >= 40) {
    notes.push({
      id: "concentration",
      tone: "neutral",
      title: `${payments[0].category} is ${payments[0].share.toFixed(0)}% of payments`,
      detail: `${fmt(payments[0].total)} across ${payments[0].count} payment${payments[0].count === 1 ? "" : "s"}. High concentration in one category.`,
    });
  }

  if (k.overdraftDays > 0) {
    notes.push({
      id: "overdraft",
      tone: "critical",
      title: `Overdrawn on ${k.overdraftDays} day${k.overdraftDays === 1 ? "" : "s"}`,
      detail: k.lowest ? `Lowest balance ${fmt(k.lowest.balance)} on ${k.lowest.date}.` : "The balance went below zero.",
    });
  }

  const debits = rows.filter((t) => t.debit).map((t) => t.debit!);
  if (debits.length >= 8) {
    const mean = debits.reduce((a, b) => a + b, 0) / debits.length;
    const sd = Math.sqrt(debits.reduce((a, b) => a + (b - mean) ** 2, 0) / debits.length);
    const large = debits.filter((d) => sd > 0 && (d - mean) / sd > 3).length;
    if (large > 0) {
      notes.push({
        id: "outliers",
        tone: "warning",
        title: `${large} unusually large payment${large === 1 ? "" : "s"}`,
        detail: `More than three standard deviations above the average payment of ${fmt(mean)}. Confirm they were authorised.`,
      });
    }
  }

  if (k.review > 0) {
    notes.push({
      id: "review",
      tone: "warning",
      title: `${k.review} scanned row${k.review === 1 ? "" : "s"} to check`,
      detail: "Figures were corrected from the running balance or are hard to read. Open them in the ledger and mark them reviewed.",
    });
  }

  if (issues > 0) {
    notes.push({
      id: "recon",
      tone: "critical",
      title: `${issues} reconciliation issue${issues === 1 ? "" : "s"}`,
      detail: "A running balance doesn't add up or a statement is missing. See Reconciliation.",
    });
  }
  return notes;
}

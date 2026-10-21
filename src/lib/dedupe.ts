import type { Transaction } from "./types";

export interface Batch {
  /** Upload id (file name + size + modified time). */
  source: string;
  transactions: Transaction[];
}

export interface MergeResult {
  transactions: Transaction[];
  /** How many rows from each upload were ignored as duplicates. */
  duplicates: Record<string, number>;
}

const cents = (n: number | null) => (n === null ? null : Math.round(n * 100));
const amountOf = (t: Transaction) => cents(t.debit ?? t.credit);
const direction = (t: Transaction) => (t.debit !== null ? "D" : "C");

/** Description reduced to its letters and digits, so OCR spacing and punctuation don't matter. */
const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

function dayGap(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** Rough description similarity in [0, 1], tolerant of OCR misreads. */
function similar(a: string, b: string): number {
  const x = squash(a), y = squash(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Share of character bigrams in common (Dice coefficient).
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const gx = grams(x), gy = grams(y);
  let common = 0;
  for (const [g, n] of gx) common += Math.min(n, gy.get(g) ?? 0);
  return (2 * common) / Math.max(1, x.length - 1 + y.length - 1);
}

/**
 * Whether two rows are the same bank transaction. The running balance is the
 * strongest evidence: two genuine transactions can share a date, amount and
 * description, but never the balance after them as well.
 */
export function isSameTransaction(a: Transaction, b: Transaction): boolean {
  if (direction(a) !== direction(b) || amountOf(a) !== amountOf(b)) return false;
  const balA = cents(a.balance), balB = cents(b.balance);
  if (balA !== null && balB !== null) {
    if (balA !== balB) return false;
    // Same amount and same resulting balance: allow for an OCR-estimated date.
    const slack = a.dateEstimated || b.dateEstimated ? 3 : 0;
    return dayGap(a.date, b.date) <= slack;
  }
  // No balance on one side: needs the same day and a near-identical description.
  return a.date === b.date && similar(a.description, b.description) >= 0.8;
}

/** Text-layer rows are exact; OCR rows are ranked by how well they were confirmed. */
function quality(t: Transaction): number {
  if (!t.confidence) return 3;
  return { verified: 2, corrected: 1, review: 0 }[t.confidence];
}

const key = (t: Transaction) => `${t.date.slice(0, 7)}|${direction(t)}|${amountOf(t)}`;

/**
 * Merges transactions from several (possibly overlapping) statements into one
 * chronological ledger, ignoring every row that repeats a transaction already
 * kept: the same statement uploaded twice, overlapping periods, a scan and
 * an e-statement of the same month, or a row repeated across a page break.
 * When copies differ, the better-read copy is kept.
 */
export function mergeAndDedupe(batches: Batch[]): MergeResult {
  const kept: (Transaction & { rank: number })[] = [];
  // Candidates bucketed by month + direction + amount, so matching stays fast.
  const index = new Map<string, number[]>();
  const duplicates: Record<string, number> = {};

  batches.forEach((batch, rank) => {
    duplicates[batch.source] = 0;
    for (const txn of batch.transactions) {
      // An estimated date may sit in the neighbouring month; look there too.
      const months = new Set([key(txn)]);
      if (txn.dateEstimated) {
        const d = new Date(txn.date);
        for (const shift of [-3, 3]) {
          const n = new Date(d.getTime() + shift * 86_400_000).toISOString().slice(0, 10);
          months.add(key({ ...txn, date: n }));
        }
      }
      let match = -1;
      for (const k of months) {
        match = (index.get(k) ?? []).find((i) => {
          const other = kept[i];
          // Inside one statement, two balance-less rows with the same date and
          // amount may be genuine separate payments, so only the balance can
          // prove a repeat there.
          if (other.rank === rank && (other.balance === null || txn.balance === null)) return false;
          return isSameTransaction(other, txn);
        }) ?? -1;
        if (match >= 0) break;
      }
      if (match >= 0) {
        duplicates[batch.source] += 1;
        if (quality(txn) > quality(kept[match])) kept[match] = { ...txn, rank: kept[match].rank };
        continue;
      }
      kept.push({ ...txn, rank });
      const k = key(txn);
      index.set(k, [...(index.get(k) ?? []), kept.length - 1]);
    }
  });

  const transactions = kept
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      // Same-day rows keep their statement order (balance isn't monotonic within a day).
      return a.rank - b.rank || a.order - b.order;
    })
    .map(({ rank: _rank, ...t }) => t);
  return { transactions, duplicates };
}

import type { Transaction } from "./types";

/**
 * Merges transactions from multiple (possibly overlapping) statement
 * uploads into one chronologically ordered, duplicate-free ledger.
 * Duplicates are identified by date + description + amounts + balance,
 * so re-uploading the same statement, or an overlapping page range, is safe.
 */
export function mergeAndDedupe(batches: Transaction[][]): Transaction[] {
  const seen = new Map<string, Transaction>();
  for (const batch of batches) {
    for (const txn of batch) {
      const key = `${txn.date}|${txn.description}|${txn.debit}|${txn.credit}|${txn.balance}`;
      if (!seen.has(key)) {
        seen.set(key, txn);
      }
    }
  }
  return [...seen.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    // Same-day rows: preserve the order they appeared in on the statement
    // (balance isn't monotonic within a day once both debits and credits occur).
    return a.order - b.order;
  });
}

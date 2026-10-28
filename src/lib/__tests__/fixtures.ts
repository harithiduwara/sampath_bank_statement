import { applyOverride, uidOf, type LedgerTxn } from "../accounting";
import type { Transaction } from "../types";

let order = 0;
/** amount > 0 is a receipt (credit), < 0 a payment (debit). */
export function txn(date: string, description: string, amount: number, balance: number | null, extra: Partial<Transaction> = {}): Transaction {
  order += 1;
  return {
    id: uidOf("f1", order),
    date,
    description,
    debit: amount < 0 ? -amount : null,
    credit: amount > 0 ? amount : null,
    balance,
    type: amount < 0 ? "debit" : "credit",
    category: "Other",
    sourceFile: "f1.pdf",
    sourcePage: 1,
    order,
    raw: "",
    ...extra,
  };
}

export function ledger(rows: Transaction[], accountKey = "acct:1", fileId = "f1"): LedgerTxn[] {
  return rows.map((t) => applyOverride(t, { fileId, accountKey, currency: "LKR" }, undefined, {}));
}

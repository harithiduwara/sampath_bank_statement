import writeXlsxFile, { type Cell, type Sheet } from "write-excel-file/browser";
import { cashflowStatement, categoryTotals, kpis, type LedgerTxn } from "./accounting";
import { month } from "./format";
import type { Workspace } from "../state/store";

type Value = string | number | null | undefined;
type Workbook = Sheet<never>[];

/**
 * One sheet from a header row and plain rows. Statement text is always a
 * text cell, never a formula, so "=HYPERLINK(...)" in a narration stays inert.
 */
function sheet(name: string, header: string[], rows: Value[][], widths: number[]): Sheet<never> {
  const headerRow: Cell[] = header.map((value) => ({ value, fontWeight: "bold" }));
  const body: Cell[][] = rows.map((r) => r.map((v) => (v === "" || v === undefined ? null : v)));
  return { sheet: name.slice(0, 31), data: [headerRow, ...body], columns: widths.map((width) => ({ width })), stickyRowsCount: 1 };
}

const READ: Record<NonNullable<LedgerTxn["confidence"]>, string> = { verified: "Confirmed", corrected: "Auto-corrected", review: "Needs review" };

function ledgerSheet(rows: LedgerTxn[], accountLabel: (key: string) => string): Sheet<never> {
  return sheet(
    "Ledger",
    ["Date", "Account", "Description", "Category", "Receipt", "Payment", "Balance", "Status", "Reviewed", "Edited", "Original values", "Note", "Source file", "Page"],
    rows.map((t) => [
      t.date,
      accountLabel(t.accountKey),
      t.description,
      t.category,
      t.credit,
      t.debit,
      t.balance,
      t.confidence ? READ[t.confidence] : "Text layer",
      t.reviewed ? "Yes" : "",
      t.edited ? "Yes" : "",
      t.original ? Object.entries(t.original).map(([k, v]) => `${k}: ${v ?? "—"}`).join("; ") : "",
      t.note,
      t.sourceFile,
      t.sourcePage,
    ]),
    [12, 22, 40, 20, 14, 14, 14, 14, 9, 8, 28, 30, 26, 6]
  );
}

/** Keeps only safe filename characters (account numbers come from the PDF). */
export function safeFileName(base: string, suffix = "workbook"): string {
  const cleaned = base.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `${cleaned || "statements"}-${suffix}.xlsx`;
}

/** Full workbook for the selected account(s) and period. */
export async function exportWorkbook(ws: Workspace): Promise<void> {
  if (!ws.period) return;
  const p = ws.period;
  const label = (key: string) => ws.accounts.find((a) => a.key === key)?.label ?? key;
  const k = kpis(ws.ledger, p);
  const cf = cashflowStatement(ws.ledger, p);

  const summary = sheet(
    "Summary",
    ["Item", "Value"],
    [
      ["Scope", ws.scopeLabel],
      ["Currency", ws.currency],
      ["Period from", p.from],
      ["Period to", p.to],
      ["Opening balance", k.opening],
      ["Receipts", k.receipts],
      ["Payments", k.payments],
      ["Net cash flow", k.net],
      ["Closing balance", k.closing],
      ["Transactions", k.count],
      ["Rows needing review", k.review],
      ["Days overdrawn", k.overdraftDays],
      ["Generated", new Date().toISOString().slice(0, 19).replace("T", " ")],
    ],
    [24, 28]
  );

  const cols = cf.columns.map((c) => month(c.key));
  const cfRows: Value[][] = [
    ["Opening balance", ...cf.opening, cf.total.opening],
    ["Receipts"],
    ...cf.receipts.map((l) => [`  ${l.category}`, ...l.values, l.total]),
    ["Total receipts", ...cf.totalReceipts, cf.total.receipts],
    ["Payments"],
    ...cf.payments.map((l) => [`  ${l.category}`, ...l.values.map((v) => -v), -l.total]),
    ["Total payments", ...cf.totalPayments.map((v) => -v), -cf.total.payments],
    ["Net cash flow", ...cf.net, cf.total.net],
    ["Closing balance", ...cf.closing, cf.total.closing],
  ];
  const cashflow = sheet("Cash flow", ["Line", ...cols, "Total"], cfRows, [26, ...cols.map(() => 14), 14]);

  const cats = (side: "credit" | "debit", title: string) =>
    categoryTotals(ws.rows, side).map((c) => [title, c.category, c.count, c.total, Number(c.share.toFixed(1))] as Value[]);
  const categories = sheet("Categories", ["Type", "Category", "Transactions", "Total", "% of type"], [...cats("credit", "Receipts"), ...cats("debit", "Payments")], [12, 24, 14, 16, 10]);

  const recon = sheet(
    "Reconciliation",
    ["Statement", "Account", "From", "To", "Rows", "Opening", "Receipts", "Payments", "Expected closing", "Closing", "Difference", "Balance breaks", "Printed totals", "Status"],
    ws.recons.map((r) => [r.name, label(r.accountKey), r.from, r.to, r.rows, r.opening, r.receipts, r.payments, r.expectedClosing, r.closing, r.difference, r.breaks.length, r.printedTotals, r.status]),
    [28, 20, 12, 12, 7, 14, 14, 14, 16, 14, 12, 14, 14, 12]
  );

  const statements = sheet(
    "Statements",
    ["File", "Account", "Pages", "Transactions read", "Duplicates ignored", "Scanned (OCR)", "Status"],
    ws.state.files.map((f) => [f.name, label(ws.fileAccount[f.id] ?? ""), f.pagesTotal, f.txnCount, ws.duplicates[f.id] ?? 0, f.usedOcr ? "Yes" : "No", f.status === "error" ? `Failed: ${f.message ?? ""}` : f.status]),
    [30, 20, 7, 16, 16, 12, 24]
  );

  const wb: Workbook = [summary, ledgerSheet(ws.rows, label), cashflow, categories, recon, statements];
  const base = ws.scopeAccounts.length === 1 ? ws.scopeAccounts[0].accountNo ?? "statement" : "all-accounts";
  await writeXlsxFile(wb).toFile(safeFileName(`${base}_${p.from}_${p.to}`));
}

/** Just the rows currently shown in the ledger (after filters). */
export async function exportLedgerRows(ws: Workspace, rows: LedgerTxn[]): Promise<void> {
  const label = (key: string) => ws.accounts.find((a) => a.key === key)?.label ?? key;
  await writeXlsxFile([ledgerSheet(rows, label)]).toFile(safeFileName(`ledger_${ws.period?.from ?? ""}_${ws.period?.to ?? ""}`, "filtered"));
}

import writeXlsxFile, { type Cell, type Sheet } from "write-excel-file/browser";
import type { AnalysisBucket, CategoryTotal, Transaction } from "./types";
import type { Summary } from "./analysis";

type Value = string | number | null | undefined;
type Workbook = Sheet<never>[];

/**
 * Builds one sheet from a header row and plain rows. Text from a statement is
 * always written as a text cell, never as a formula, so a description such as
 * "=HYPERLINK(...)" stays harmless when the file is opened in Excel.
 */
function sheet(name: string, header: string[], rows: Value[][], widths: number[]): Sheet<never> {
  const headerRow: Cell[] = header.map((value) => ({ value, fontWeight: "bold" }));
  const body: Cell[][] = rows.map((r) => r.map((v) => (v === "" || v === undefined ? null : v)));
  return {
    sheet: name,
    data: [headerRow, ...body],
    columns: widths.map((width) => ({ width })),
    stickyRowsCount: 1,
  };
}

const round = (n: number, dp = 2) => Number(n.toFixed(dp));

const READ_CHECK: Record<NonNullable<Transaction["confidence"]>, string> = {
  verified: "Confirmed",
  corrected: "Auto-corrected",
  review: "Needs review",
};

/**
 * Builds the "runtime" workbook in memory from the current ledger state.
 * Called on export, so the Excel file always mirrors exactly what's on screen.
 */
export function buildWorkbook(
  txns: Transaction[],
  buckets: AnalysisBucket[],
  categories: CategoryTotal[],
  summary: Summary
): Workbook {
  return [
    sheet(
      "Transactions",
      ["Date", "Description", "Category", "Debit", "Credit", "Balance", "Source File", "Page", "Read check", "Date estimated"],
      txns.map((t) => [
        t.date,
        t.description,
        t.category,
        t.debit,
        t.credit,
        t.balance,
        t.sourceFile,
        t.sourcePage,
        t.confidence ? READ_CHECK[t.confidence] : "",
        t.dateEstimated ? "Yes" : "",
      ]),
      [12, 40, 18, 14, 14, 14, 26, 6, 15, 14]
    ),
    sheet(
      "Monthly Summary",
      ["Month", "Income", "Expense", "Net"],
      buckets.map((b) => [b.label, round(b.income), round(b.expense), round(b.net)]),
      [14, 14, 14, 14]
    ),
    sheet(
      "Category Breakdown",
      ["Category", "Total", "Transactions", "% of Expense"],
      categories.map((c) => [c.category, round(c.total), c.count, round(c.pctOfExpense, 1)]),
      [20, 14, 14, 14]
    ),
    sheet(
      "Overview",
      ["Metric", "Value"],
      [
        ["Total Income", round(summary.totalIncome)],
        ["Total Expense", round(summary.totalExpense)],
        ["Net", round(summary.net)],
        ["Savings Rate (%)", round(summary.savingsRate, 1)],
        ["Avg Monthly Income", round(summary.avgMonthlyIncome)],
        ["Avg Monthly Expense", round(summary.avgMonthlyExpense)],
        ["Starting Balance", summary.startBalance],
        ["Ending Balance", summary.endBalance],
        ["Transactions", summary.txnCount],
      ],
      [22, 16]
    ),
  ];
}

/** Keeps only safe filename characters (the account number comes from the PDF). */
export function safeFileName(base: string): string {
  const cleaned = base.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  return `${cleaned || "bank-statement"}-analysis.xlsx`;
}

export async function downloadWorkbook(wb: Workbook, filename: string) {
  await writeXlsxFile(wb).toFile(filename);
}

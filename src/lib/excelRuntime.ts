import * as XLSX from "xlsx";
import type { AnalysisBucket, CategoryTotal, Transaction } from "./types";
import type { Summary } from "./analysis";

/**
 * Builds the "runtime" workbook in memory from the current ledger state.
 * Called again every time transactions change, so the Excel export always
 * mirrors exactly what's on screen (one workbook, three live sheets).
 */
export function buildWorkbook(
  txns: Transaction[],
  buckets: AnalysisBucket[],
  categories: CategoryTotal[],
  summary: Summary
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const txnRows = txns.map((t) => ({
    Date: t.date,
    Description: t.description,
    Category: t.category,
    Debit: t.debit ?? "",
    Credit: t.credit ?? "",
    Balance: t.balance ?? "",
    "Source File": t.sourceFile,
    Page: t.sourcePage,
  }));
  const wsTxns = XLSX.utils.json_to_sheet(txnRows);
  wsTxns["!cols"] = [
    { wch: 12 }, { wch: 40 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 26 }, { wch: 6 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTxns, "Transactions");

  const monthlyRows = buckets.map((b) => ({
    Month: b.label,
    Income: Number(b.income.toFixed(2)),
    Expense: Number(b.expense.toFixed(2)),
    Net: Number(b.net.toFixed(2)),
  }));
  const wsMonthly = XLSX.utils.json_to_sheet(monthlyRows);
  wsMonthly["!cols"] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsMonthly, "Monthly Summary");

  const categoryRows = categories.map((c) => ({
    Category: c.category,
    Total: Number(c.total.toFixed(2)),
    Transactions: c.count,
    "% of Expense": Number(c.pctOfExpense.toFixed(1)),
  }));
  const wsCategory = XLSX.utils.json_to_sheet(categoryRows);
  wsCategory["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsCategory, "Category Breakdown");

  const overviewRows = [
    { Metric: "Total Income", Value: Number(summary.totalIncome.toFixed(2)) },
    { Metric: "Total Expense", Value: Number(summary.totalExpense.toFixed(2)) },
    { Metric: "Net", Value: Number(summary.net.toFixed(2)) },
    { Metric: "Savings Rate (%)", Value: Number(summary.savingsRate.toFixed(1)) },
    { Metric: "Avg Monthly Income", Value: Number(summary.avgMonthlyIncome.toFixed(2)) },
    { Metric: "Avg Monthly Expense", Value: Number(summary.avgMonthlyExpense.toFixed(2)) },
    { Metric: "Starting Balance", Value: summary.startBalance ?? "" },
    { Metric: "Ending Balance", Value: summary.endBalance ?? "" },
    { Metric: "Transactions", Value: summary.txnCount },
  ];
  const wsOverview = XLSX.utils.json_to_sheet(overviewRows);
  wsOverview["!cols"] = [{ wch: 22 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsOverview, "Overview");

  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename = "bank-statement-analysis.xlsx") {
  XLSX.writeFile(wb, filename);
}

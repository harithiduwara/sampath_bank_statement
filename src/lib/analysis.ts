import type { AnalysisBucket, CategoryTotal, Insight, Transaction } from "./types";

export function monthlyBuckets(txns: Transaction[]): AnalysisBucket[] {
  const map = new Map<string, AnalysisBucket>();
  for (const t of txns) {
    const key = t.date.slice(0, 7); // yyyy-mm
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { key, label: monthLabel(key), income: 0, expense: 0, net: 0 };
      map.set(key, bucket);
    }
    if (t.credit) bucket.income += t.credit;
    if (t.debit) bucket.expense += t.debit;
    bucket.net = bucket.income - bucket.expense;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function categoryBreakdown(txns: Transaction[]): CategoryTotal[] {
  const map = new Map<string, { total: number; count: number }>();
  let totalExpense = 0;
  for (const t of txns) {
    if (!t.debit) continue;
    totalExpense += t.debit;
    const entry = map.get(t.category) ?? { total: 0, count: 0 };
    entry.total += t.debit;
    entry.count += 1;
    map.set(t.category, entry);
  }
  return [...map.entries()]
    .map(([category, v]) => ({
      category,
      total: v.total,
      count: v.count,
      pctOfExpense: totalExpense ? (v.total / totalExpense) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export interface Summary {
  totalIncome: number;
  totalExpense: number;
  net: number;
  avgMonthlyIncome: number;
  avgMonthlyExpense: number;
  savingsRate: number; // %
  startBalance: number | null;
  endBalance: number | null;
  largestExpense: Transaction | null;
  largestIncome: Transaction | null;
  txnCount: number;
  monthsSpanned: number;
}

export function buildSummary(txns: Transaction[], buckets: AnalysisBucket[]): Summary {
  const totalIncome = txns.reduce((s, t) => s + (t.credit ?? 0), 0);
  const totalExpense = txns.reduce((s, t) => s + (t.debit ?? 0), 0);
  const months = Math.max(buckets.length, 1);
  const sortedByDate = [...txns].sort((a, b) => (a.date < b.date ? -1 : 1));
  const withBalance = txns.filter((t) => t.balance !== null);
  const largestExpense = txns.filter((t) => t.debit).sort((a, b) => (b.debit ?? 0) - (a.debit ?? 0))[0] ?? null;
  const largestIncome = txns.filter((t) => t.credit).sort((a, b) => (b.credit ?? 0) - (a.credit ?? 0))[0] ?? null;

  return {
    totalIncome,
    totalExpense,
    net: totalIncome - totalExpense,
    avgMonthlyIncome: totalIncome / months,
    avgMonthlyExpense: totalExpense / months,
    savingsRate: totalIncome ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0,
    startBalance: withBalance[0]?.balance ?? null,
    endBalance: withBalance[withBalance.length - 1]?.balance ?? null,
    largestExpense,
    largestIncome,
    txnCount: sortedByDate.length,
    monthsSpanned: buckets.length,
  };
}

/** Rule-based "financial analyst" narrative over the parsed ledger. */
export function buildInsights(
  txns: Transaction[],
  buckets: AnalysisBucket[],
  categories: CategoryTotal[],
  summary: Summary
): Insight[] {
  const insights: Insight[] = [];
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  if (summary.txnCount === 0) return insights;

  insights.push({
    id: "savings-rate",
    tone: summary.savingsRate >= 20 ? "positive" : summary.savingsRate >= 0 ? "neutral" : "critical",
    title: `Savings rate: ${summary.savingsRate.toFixed(1)}%`,
    detail:
      summary.savingsRate >= 20
        ? "Income comfortably exceeds outflows across the period analyzed — a healthy buffer for reserves or investment."
        : summary.savingsRate >= 0
        ? "Income exceeds expenses, but the margin is thin. Small shocks could tip this negative."
        : "Expenses exceeded income over this period. This account is drawing down its balance.",
  });

  if (buckets.length >= 2) {
    const last = buckets[buckets.length - 1];
    const prev = buckets[buckets.length - 2];
    const change = prev.expense ? ((last.expense - prev.expense) / prev.expense) * 100 : 0;
    if (Math.abs(change) >= 10) {
      insights.push({
        id: "spend-trend",
        tone: change > 0 ? "warning" : "positive",
        title: `Spending ${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(0)}% month-over-month`,
        detail: `${last.label} expenses were ${fmt(last.expense)} vs ${fmt(prev.expense)} in ${prev.label}.`,
      });
    }
  }

  if (categories[0]) {
    insights.push({
      id: "top-category",
      tone: "neutral",
      title: `${categories[0].category} is the largest outflow`,
      detail: `${fmt(categories[0].total)} across ${categories[0].count} transaction(s), ${categories[0].pctOfExpense.toFixed(0)}% of total spend.`,
    });
  }

  if (summary.largestExpense) {
    insights.push({
      id: "largest-expense",
      tone: "neutral",
      title: "Largest single outflow",
      detail: `${summary.largestExpense.description} — ${fmt(summary.largestExpense.debit ?? 0)} on ${summary.largestExpense.date}.`,
    });
  }

  // Simple anomaly scan: debit transactions far beyond the typical size.
  const debits = txns.filter((t) => t.debit).map((t) => t.debit!) as number[];
  if (debits.length >= 5) {
    const mean = debits.reduce((a, b) => a + b, 0) / debits.length;
    const variance = debits.reduce((a, b) => a + (b - mean) ** 2, 0) / debits.length;
    const stdDev = Math.sqrt(variance);
    const anomalies = txns.filter((t) => t.debit && stdDev > 0 && (t.debit - mean) / stdDev > 3);
    if (anomalies.length > 0) {
      insights.push({
        id: "anomalies",
        tone: "warning",
        title: `${anomalies.length} unusually large transaction(s) detected`,
        detail: `Flagged via statistical outlier detection (>3σ from the mean debit of ${fmt(mean)}). Worth a manual review.`,
      });
    }
  }

  if (summary.startBalance !== null && summary.endBalance !== null) {
    const delta = summary.endBalance - summary.startBalance;
    insights.push({
      id: "balance-trend",
      tone: delta >= 0 ? "positive" : "warning",
      title: `Balance ${delta >= 0 ? "grew" : "declined"} by ${fmt(Math.abs(delta))}`,
      detail: `From ${fmt(summary.startBalance)} to ${fmt(summary.endBalance)} over the analyzed period.`,
    });
  }

  return insights;
}

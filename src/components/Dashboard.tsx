import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  ArcElement,
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import type { AnalysisBucket, CategoryTotal, Transaction } from "../lib/types";
import type { Summary } from "../lib/analysis";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler);

const GRID = "rgba(255,255,255,0.06)";
const TEXT = "rgba(255,255,255,0.55)";

const PALETTE = ["#3fa391", "#d9a441", "#6fc4b4", "#d9534f", "#7c9ce0", "#c48fd9", "#5fb3d9", "#e0a2c4"];

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function Dashboard({
  txns,
  buckets,
  categories,
  summary,
}: {
  txns: Transaction[];
  buckets: AnalysisBucket[];
  categories: CategoryTotal[];
  summary: Summary;
}) {
  if (txns.length === 0) return null;

  const balancePoints = txns
    .filter((t) => t.balance !== null)
    .map((t) => ({ x: t.date, y: t.balance as number }));

  return (
    <section className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Income" value={money(summary.totalIncome)} tone="credit" />
        <StatCard label="Total Expense" value={money(summary.totalExpense)} tone="debit" />
        <StatCard label="Net" value={money(summary.net)} tone={summary.net >= 0 ? "credit" : "debit"} />
        <StatCard label="Savings Rate" value={`${summary.savingsRate.toFixed(1)}%`} tone="gold" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4 sm:p-5 lg:col-span-3">
          <h3 className="mb-3 text-sm font-semibold text-white/80">Income vs. Expense by month</h3>
          <div className="h-72">
            <Bar
              data={{
                labels: buckets.map((b) => b.label),
                datasets: [
                  { label: "Income", data: buckets.map((b) => b.income), backgroundColor: "#3fa391", borderRadius: 6, maxBarThickness: 28 },
                  { label: "Expense", data: buckets.map((b) => b.expense), backgroundColor: "#d9534f", borderRadius: 6, maxBarThickness: 28 },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: TEXT }, position: "top" as const } },
                scales: {
                  x: { ticks: { color: TEXT }, grid: { display: false } },
                  y: { ticks: { color: TEXT }, grid: { color: GRID } },
                },
              }}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4 sm:p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-semibold text-white/80">Spend by category</h3>
          <div className="h-72">
            <Doughnut
              data={{
                labels: categories.slice(0, 8).map((c) => c.category),
                datasets: [
                  {
                    data: categories.slice(0, 8).map((c) => c.total),
                    backgroundColor: PALETTE,
                    borderColor: "#0f1b2e",
                    borderWidth: 2,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { labels: { color: TEXT, boxWidth: 10, font: { size: 11 } }, position: "bottom" as const } },
              }}
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-semibold text-white/80">Balance trend</h3>
        <div className="h-64">
          <Line
            data={{
              labels: balancePoints.map((p) => p.x),
              datasets: [
                {
                  label: "Balance",
                  data: balancePoints.map((p) => p.y),
                  borderColor: "#d9a441",
                  backgroundColor: "rgba(217,164,65,0.12)",
                  fill: true,
                  tension: 0.25,
                  pointRadius: 0,
                  borderWidth: 2,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: TEXT, maxTicksLimit: 10 }, grid: { display: false } },
                y: { ticks: { color: TEXT }, grid: { color: GRID } },
              },
            }}
          />
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "credit" | "debit" | "gold" }) {
  const color = tone === "credit" ? "text-credit-500" : tone === "debit" ? "text-debit-500" : "text-gold-400";
  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4">
      <p className="text-xs uppercase tracking-wide text-white/40">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

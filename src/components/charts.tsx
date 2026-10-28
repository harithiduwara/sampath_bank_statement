import { useEffect, useMemo, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import type { FlowBucket, Granularity } from "../lib/accounting";
import { amount, compact, date, month, shortDate } from "../lib/format";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Filler);

const TOKENS = ["--series-1", "--series-2", "--series-1-soft", "--grid", "--axis", "--ink", "--ink-2", "--surface", "--line", "--crit"] as const;
type Tokens = Record<(typeof TOKENS)[number], string>;

/** Reads the colour tokens and re-reads them when the theme changes. */
export function useTokens(): Tokens {
  const read = () => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(TOKENS.map((t) => [t, css.getPropertyValue(t).trim()])) as Tokens;
  };
  const [tokens, setTokens] = useState<Tokens>(read);
  useEffect(() => {
    const update = () => setTokens(read());
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener("change", update);
    return () => {
      mo.disconnect();
      mq?.removeEventListener("change", update);
    };
  }, []);
  return tokens;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function baseOptions(t: Tokens): ChartOptions<"bar" | "line"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion() ? false : { duration: 300 },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t["--surface"],
        titleColor: t["--ink"],
        bodyColor: t["--ink-2"],
        footerColor: t["--ink"],
        borderColor: t["--line"],
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
        usePointStyle: true,
        titleFont: { weight: 600 },
        footerFont: { weight: 600 },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { color: t["--grid"] },
        ticks: { color: t["--axis"], maxRotation: 0, autoSkipPadding: 16, font: { size: 11 } },
      },
      y: {
        grid: { color: t["--grid"] },
        border: { display: false },
        ticks: { color: t["--axis"], font: { size: 11 }, callback: (v) => compact(Number(v)), maxTicksLimit: 6 },
      },
    },
  };
}

export function bucketLabel(b: FlowBucket, g: Granularity): string {
  if (g === "month") return month(b.key);
  if (g === "week") return `w/c ${shortDate(b.key)}`;
  return shortDate(b.key);
}

export function LegendKey({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Receipts vs payments per bucket: two series, one axis, net in the tooltip. */
export function CashflowChart({ buckets, granularity }: { buckets: FlowBucket[]; granularity: Granularity }) {
  const t = useTokens();
  const data = useMemo(
    () => ({
      labels: buckets.map((b) => bucketLabel(b, granularity)),
      datasets: [
        { label: "Receipts", data: buckets.map((b) => b.receipts), backgroundColor: t["--series-1"], borderRadius: 4, borderSkipped: "bottom" as const, maxBarThickness: 22, categoryPercentage: 0.72, barPercentage: 0.88 },
        { label: "Payments", data: buckets.map((b) => b.payments), backgroundColor: t["--series-2"], borderRadius: 4, borderSkipped: "bottom" as const, maxBarThickness: 22, categoryPercentage: 0.72, barPercentage: 0.88 },
      ],
    }),
    [buckets, granularity, t]
  );
  const options = useMemo(() => {
    const o = baseOptions(t) as ChartOptions<"bar">;
    o.plugins!.tooltip!.callbacks = {
      title: (items: TooltipItem<"bar">[]) => {
        const b = buckets[items[0].dataIndex];
        return b.from === b.to ? date(b.from) : `${date(b.from)} – ${date(b.to)}`;
      },
      label: (i: TooltipItem<"bar">) => ` ${i.dataset.label}: ${amount(i.parsed.y)}`,
      footer: (items: TooltipItem<"bar">[]) => `Net: ${amount(buckets[items[0].dataIndex].net)}`,
    };
    return o;
  }, [t, buckets]);
  return (
    <div className="h-72" role="img" aria-label={`Receipts and payments by ${granularity}. Use the table view for the figures.`}>
      <Bar data={data} options={options} />
    </div>
  );
}

/** End-of-day balance. A zero line appears when the account goes overdrawn. */
export function BalanceChart({ points }: { points: { date: string; balance: number | null }[] }) {
  const t = useTokens();
  const negative = points.some((p) => p.balance !== null && p.balance < 0);
  const data = useMemo(
    () => ({
      labels: points.map((p) => shortDate(p.date)),
      datasets: [
        {
          label: "Balance",
          data: points.map((p) => p.balance),
          borderColor: t["--series-1"],
          backgroundColor: t["--series-1-soft"],
          fill: negative ? { value: 0 } : "start",
          borderWidth: 2,
          pointRadius: points.length === 1 ? 4 : 0,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: t["--surface"],
          pointBackgroundColor: t["--series-1"],
          stepped: "before" as const,
          spanGaps: false,
        },
      ],
    }),
    [points, t, negative]
  );
  const options = useMemo(() => {
    const o = baseOptions(t) as ChartOptions<"line">;
    o.plugins!.tooltip!.callbacks = {
      title: (items: TooltipItem<"line">[]) => date(points[items[0].dataIndex].date),
      label: (i: TooltipItem<"line">) => ` Balance: ${amount(i.parsed.y)}`,
    };
    o.scales!.x!.ticks = { ...o.scales!.x!.ticks, maxTicksLimit: 8 };
    if (negative) {
      o.scales!.y!.grid = { color: (ctx) => (ctx.tick.value === 0 ? t["--crit"] : t["--grid"]) };
    } else {
      (o.scales!.y as { beginAtZero?: boolean }).beginAtZero = false;
    }
    return o;
  }, [t, points, negative]);
  return (
    <div className="h-64" role="img" aria-label="End-of-day account balance over the period. Use the table view for the figures.">
      <Line data={data} options={options} />
    </div>
  );
}

/** Horizontal bars in plain HTML: one series, one colour, value as text beside it. */
export function CategoryBars({ items, total }: { items: { category: string; total: number; count: number; share: number }[]; total: number }) {
  const max = Math.max(...items.map((i) => i.total), 1);
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.category}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">{i.category}</span>
            <span className="num shrink-0 text-ink-2">
              {amount(i.total)} <span className="text-xs text-ink-3">· {i.share.toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-3" aria-hidden="true">
            <div className="h-2 rounded-full bg-series-1" style={{ width: `${Math.max((i.total / max) * 100, 1.5)}%` }} />
          </div>
        </li>
      ))}
      {total > 0 && <li className="sr-only">Total {amount(total)}</li>}
    </ul>
  );
}

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, FileLock2, FileUp, Lightbulb, ScanText, ShieldCheck, Sparkles } from "lucide-react";
import clsx from "clsx";
import {
  analystNotes,
  cashflowSeries,
  categoryTotals,
  change,
  dailyBalances,
  kpis,
  needsReview,
  pickGranularity,
  recurringItems,
  type LedgerTxn,
} from "../lib/accounting";
import { amount, date, money, plural } from "../lib/format";
import { useWorkspace } from "../state/store";
import { BalanceChart, CashflowChart, CategoryBars, LegendKey, bucketLabel, useTokens } from "../components/charts";
import { Badge, Card, Delta, EmptyState, Kpi, PageHeader, Segmented, Status, td, th } from "../components/ui";
import type { Insight } from "../lib/types";
import { NoData } from "./common";

export default function OverviewView({ onUpload }: { onUpload: () => void }) {
  const ws = useWorkspace();
  if (ws.state.files.length === 0) return <Welcome onUpload={onUpload} />;
  if (ws.ledger.length === 0 || !ws.period) return <NoData onUpload={onUpload} what="transactions" />;
  return <Dashboard />;
}

function Dashboard() {
  const ws = useWorkspace();
  const tokens = useTokens();
  const p = ws.period!;
  const cur = ws.currency;
  const [cfMode, setCfMode] = useState<"chart" | "table">("chart");
  const [balMode, setBalMode] = useState<"chart" | "table">("chart");

  const k = useMemo(() => kpis(ws.ledger, p), [ws.ledger, p]);
  // Only compare when the previous period actually has data.
  const prev = useMemo(() => {
    if (!ws.previous || !ws.range || ws.previous.to < ws.range.from) return null;
    return kpis(ws.ledger, ws.previous);
  }, [ws.ledger, ws.previous, ws.range]);
  const g = pickGranularity(p);
  const buckets = useMemo(() => cashflowSeries(ws.ledger, p, g), [ws.ledger, p, g]);
  const daily = useMemo(() => dailyBalances(ws.ledger, p), [ws.ledger, p]);
  const payCats = useMemo(() => categoryTotals(ws.rows, "debit"), [ws.rows]);
  const recurring = useMemo(() => recurringItems(ws.ledger.filter((t) => t.date <= p.to)), [ws.ledger, p]);
  const issues = ws.recons.filter((r) => r.status === "issues").length + ws.continuity.length;
  const notes = useMemo(
    () => analystNotes({ current: k, previous: prev, payments: payCats, rows: ws.rows, issues, currency: cur, fmt: (n) => money(n, cur) }),
    [k, prev, payCats, ws.rows, issues, cur]
  );
  const largest = useMemo(
    () => [...ws.rows].sort((a, b) => (b.debit ?? b.credit ?? 0) - (a.debit ?? a.credit ?? 0)).slice(0, 6),
    [ws.rows]
  );

  const pctOrNull = (a: number | null, b: number | null) => (prev ? change(a, b) : null);
  const topCats = payCats.length > 7 ? [...payCats.slice(0, 6), foldOther(payCats.slice(6))] : payCats;

  return (
    <>
      <PageHeader
        title="Overview"
        description={
          <>
            {ws.scopeLabel} · {date(p.from)} – {date(p.to)} · {plural(k.count, "transaction")}
            {ws.hiddenCurrencies.length > 0 && <> · other currencies ({ws.hiddenCurrencies.join(", ")}) are in the account menu</>}
          </>
        }
      />

      {(k.review > 0 || issues > 0) && (
        <div role="status" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
          <AlertTriangle size={16} className="text-warn" aria-hidden="true" />
          <span className="flex-1 text-ink">
            {k.review > 0 && <>{plural(k.review, "scanned row")} to check. </>}
            {issues > 0 && <>{plural(issues, "reconciliation issue")} found.</>}
          </span>
          {k.review > 0 && (
            <a className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline" href="#/ledger?status=review">
              Review rows <ArrowRight size={14} aria-hidden="true" />
            </a>
          )}
          {issues > 0 && (
            <a className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline" href="#/reconciliation">
              Open reconciliation <ArrowRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Opening balance" value={money(k.opening, cur)} footer={<span className="text-xs text-ink-3">{date(p.from)}</span>} />
        <Kpi label="Receipts" value={money(k.receipts, cur)} footer={<Delta value={pctOrNull(k.receipts, prev?.receipts ?? null)} />} />
        <Kpi label="Payments" value={money(k.payments, cur)} footer={<Delta value={pctOrNull(k.payments, prev?.payments ?? null)} goodWhenUp={false} />} />
        <Kpi
          label="Net cash flow"
          value={`${k.net > 0 ? "+" : ""}${money(k.net, cur)}`}
          tone={k.net < 0 ? "warn" : undefined}
          footer={<Delta value={pctOrNull(k.net, prev?.net ?? null)} />}
        />
        <Kpi label="Closing balance" value={money(k.closing, cur)} footer={<Delta value={pctOrNull(k.closing, prev?.closing ?? null)} />} />
        <Kpi
          label="Lowest balance"
          value={money(k.lowest?.balance ?? null, cur)}
          tone={k.lowest && k.lowest.balance < 0 ? "crit" : undefined}
          footer={
            <span className="text-xs text-ink-3">
              {k.lowest ? date(k.lowest.date) : "—"}
              {k.overdraftDays > 0 && <span className="font-medium text-crit"> · {k.overdraftDays}d overdrawn</span>}
            </span>
          }
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Cash flow"
          subtitle={`Receipts and payments by ${g}`}
          actions={<Segmented label="Cash flow view" value={cfMode} onChange={setCfMode} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
        >
          {cfMode === "chart" ? (
            <>
              <div className="mb-3">
                <LegendKey items={[{ label: "Receipts", color: tokens["--series-1"] }, { label: "Payments", color: tokens["--series-2"] }]} />
              </div>
              <CashflowChart buckets={buckets} granularity={g} />
            </>
          ) : (
            <div className="scrollbar-thin max-h-80 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr>
                    <th scope="col" className={th}>{g === "day" ? "Day" : g === "week" ? "Week" : "Month"}</th>
                    <th scope="col" className={clsx(th, "text-right")}>Receipts</th>
                    <th scope="col" className={clsx(th, "text-right")}>Payments</th>
                    <th scope="col" className={clsx(th, "text-right")}>Net</th>
                  </tr>
                </thead>
                <tbody className="num">
                  {buckets.filter((b) => b.receipts || b.payments).map((b) => (
                    <tr key={b.key}>
                      <td className={td}>{bucketLabel(b, g)}</td>
                      <td className={clsx(td, "text-right")}>{amount(b.receipts)}</td>
                      <td className={clsx(td, "text-right")}>{amount(b.payments)}</td>
                      <td className={clsx(td, "text-right font-medium")}>{amount(b.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Payments by category" subtitle={`${money(k.payments, cur)} in total`}>
          {topCats.length ? (
            <CategoryBars items={topCats} total={k.payments} />
          ) : (
            <EmptyState title="No payments in this period" />
          )}
          {topCats.length > 0 && (
            <a href="#/reports?tab=categories" className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              Category analysis <ArrowRight size={13} aria-hidden="true" />
            </a>
          )}
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Balance"
          subtitle="End-of-day balance"
          actions={<Segmented label="Balance view" value={balMode} onChange={setBalMode} options={[{ value: "chart", label: "Chart" }, { value: "table", label: "Table" }]} />}
        >
          {daily.some((d) => d.balance !== null) ? (
            balMode === "chart" ? (
              <BalanceChart points={daily} />
            ) : (
              <BalanceTable rows={ws.rows} />
            )
          ) : (
            <EmptyState title="No balances to plot">These statements don't show a running balance.</EmptyState>
          )}
        </Card>
        <NotesCard notes={notes} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Largest transactions" subtitle="By amount, this period" bodyClassName="p-0">
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className={th}>Date</th>
                  <th scope="col" className={th}>Description</th>
                  <th scope="col" className={clsx(th, "hidden sm:table-cell")}>Category</th>
                  <th scope="col" className={clsx(th, "text-right")}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {largest.map((t) => (
                  <tr key={t.uid} className="hover:bg-surface-2">
                    <td className={clsx(td, "whitespace-nowrap text-ink-2")}>{date(t.date)}</td>
                    <td className={td}>
                      <a href={`#/ledger?row=${encodeURIComponent(t.uid)}`} className="text-ink hover:text-accent hover:underline">
                        {t.description}
                      </a>
                      {needsReview(t) && (
                        <Badge tone={t.confidence === "review" ? "crit" : "warn"} className="ml-2">
                          {t.confidence === "review" ? "Check" : "Corrected"}
                        </Badge>
                      )}
                    </td>
                    <td className={clsx(td, "hidden text-ink-2 sm:table-cell")}>{t.category}</td>
                    <td className={clsx(td, "num whitespace-nowrap text-right font-medium")}>
                      {t.credit ? <span>+{amount(t.credit)}</span> : <span>−{amount(t.debit)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Recurring items" subtitle="Same narration in 3+ months at a similar amount">
          {recurring.length ? (
            <ul className="divide-y divide-line">
              {recurring.slice(0, 6).map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{r.label}</p>
                    <p className="text-xs text-ink-3">
                      {r.months} months · last {date(r.last)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num text-sm text-ink">{amount(r.average)}</p>
                    <Badge tone={r.direction === "in" ? "info" : "neutral"}>{r.direction === "in" ? "Receipt" : "Payment"}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing recurring yet">Recurring items appear once three or more months of statements are uploaded.</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}

function foldOther(rest: { total: number; count: number; share: number }[]) {
  return {
    category: `Other (${rest.length} categories)`,
    total: rest.reduce((s, c) => s + c.total, 0),
    count: rest.reduce((s, c) => s + c.count, 0),
    share: rest.reduce((s, c) => s + c.share, 0),
  };
}

function BalanceTable({ rows }: { rows: LedgerTxn[] }) {
  // Closing balance per day that had activity.
  const days = new Map<string, number>();
  for (const t of rows) if (t.balance !== null) days.set(t.date, t.balance);
  return (
    <div className="scrollbar-thin max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0">
          <tr>
            <th scope="col" className={th}>Date</th>
            <th scope="col" className={clsx(th, "text-right")}>End-of-day balance</th>
          </tr>
        </thead>
        <tbody className="num">
          {[...days].map(([d, b]) => (
            <tr key={d}>
              <td className={td}>{date(d)}</td>
              <td className={clsx(td, "text-right", b < 0 && "text-crit")}>{amount(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NOTE_TONE: Record<Insight["tone"], "good" | "warn" | "crit" | "info"> = { positive: "good", warning: "warn", critical: "crit", neutral: "info" };
const NOTE_LABEL: Record<Insight["tone"], string> = { positive: "Good", warning: "Watch", critical: "Action", neutral: "Note" };

function NotesCard({ notes }: { notes: Insight[] }) {
  return (
    <Card title="Analyst notes" subtitle="Automated reading of this period: a starting point, not advice">
      {notes.length ? (
        <ul className="flex flex-col gap-3.5">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-3">
              <div className="pt-0.5">
                <Status tone={NOTE_TONE[n.tone]}>{NOTE_LABEL[n.tone]}</Status>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{n.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{n.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Lightbulb size={20} aria-hidden="true" />} title="Nothing to note" />
      )}
    </Card>
  );
}

/* ----------------------------------------------------------------- Welcome */

function Welcome({ onUpload }: { onUpload: () => void }) {
  const features = [
    { icon: FileLock2, title: "Locked or unlocked PDFs", text: "Enter a PIN once; it unlocks every statement that shares it." },
    { icon: ScanText, title: "Scans and photos", text: "OCR reads printed statements and checks every figure against the running balance." },
    { icon: Sparkles, title: "Merged and reconciled", text: "Statements are put in order, duplicates are ignored and balances are reconciled." },
    { icon: ShieldCheck, title: "Private by design", text: "Everything happens in this browser tab. Nothing is uploaded or stored." },
  ];
  return (
    <div className="mx-auto max-w-4xl py-6">
      <div className="mb-8 text-center">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-accent">Bank accounting workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Turn bank statements into reconciled books</h1>
        <p className="mx-auto mt-3 max-w-2xl text-base text-ink-3">
          Upload statements for one or more accounts. You get a categorised ledger, cash-flow reports and a reconciliation you can export to Excel.
        </p>
      </div>
      <button
        type="button"
        onClick={onUpload}
        className="group flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-line-strong bg-surface px-6 py-14 text-center shadow-card transition-colors hover:border-accent hover:bg-accent-soft/40"
      >
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent transition-transform group-hover:scale-105">
          <FileUp size={22} aria-hidden="true" />
        </span>
        <span className="text-base font-semibold text-ink">Drop statements anywhere, or click to browse</span>
        <span className="mt-1 text-sm text-ink-3">PDF, PNG, JPEG or WEBP · up to 50 MB and 60 pages each</span>
        <span className="mt-5 inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink shadow-card">Upload statements</span>
      </button>
      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {features.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
            <Icon size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="mt-0.5 text-sm text-ink-3">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}


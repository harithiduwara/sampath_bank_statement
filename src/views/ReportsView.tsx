import { Fragment, useMemo, useState } from "react";
import clsx from "clsx";
import { FileSpreadsheet, Printer } from "lucide-react";
import { cashflowStatement, categoryTotals, inPeriod, type CashflowStatement } from "../lib/accounting";
import { accounting, amount, date, month, percent } from "../lib/format";
import { exportWorkbook } from "../lib/excelRuntime";
import { useWorkspace } from "../state/store";
import { useRoute } from "../state/ui";
import { Button, Card, EmptyState, PageHeader, Segmented, td, th } from "../components/ui";
import { NoData } from "./common";

type Tab = "cashflow" | "categories" | "monthly";
const TABS: { value: Tab; label: string }[] = [
  { value: "cashflow", label: "Cash flow statement" },
  { value: "categories", label: "Category analysis" },
  { value: "monthly", label: "Monthly summary" },
];

export default function ReportsView({ onUpload }: { onUpload: () => void }) {
  const ws = useWorkspace();
  const { params, go } = useRoute();
  const tab = (TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "cashflow") as Tab;
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const cf = useMemo(() => (ws.period ? cashflowStatement(ws.ledger, ws.period) : null), [ws.ledger, ws.period]);

  if (ws.ledger.length === 0 || !ws.period || !cf) return <NoData onUpload={onUpload} what="reports" />;
  const title = TABS.find((t) => t.value === tab)!.label;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Statements of cash movement for the selected account and period, ready to print or export."
        actions={
          <>
            <Button icon={<Printer size={15} aria-hidden="true" />} onClick={() => window.print()}>
              Print
            </Button>
            <Button icon={<FileSpreadsheet size={15} aria-hidden="true" />} onClick={() => void exportWorkbook(ws)}>
              Export workbook
            </Button>
          </>
        }
      />
      <div className="no-print mb-4">
        <Segmented label="Report" value={tab} onChange={(v) => go("reports", { tab: v })} options={TABS} />
      </div>

      <Card bodyClassName="p-0">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            {ws.scopeLabel} · {date(ws.period.from)} to {date(ws.period.to)} · amounts in {ws.currency}
            {tab === "cashflow" && " · payments shown in brackets"}
          </p>
        </div>
        {tab === "cashflow" && <CashflowTable cf={cf} />}
        {tab === "categories" && <Categories />}
        {tab === "monthly" && <Monthly cf={cf} />}
        <p className="px-5 py-3 text-[11px] text-ink-3">
          Prepared from bank statements in Statement Studio on {date(today)}. Figures include any corrections made in the ledger.
        </p>
      </Card>
    </>
  );
}

const stick = "sticky left-0 z-[1] bg-surface";

function CashflowTable({ cf }: { cf: CashflowStatement }) {
  const many = cf.columns.length > 1;
  const row = ({ label, values, total, strong, indent, muted }: { label: string; values: (number | null)[]; total: number | null; strong?: boolean; indent?: boolean; muted?: boolean }) => (
    <tr className={clsx(strong && "font-semibold")}>
      <th scope="row" className={clsx(td, stick, "text-left font-[inherit]", indent && "pl-8 font-normal text-ink-2", muted && "text-ink-2")}>{label}</th>
      {many && values.map((v, i) => <td key={cf.columns[i].key} className={clsx(td, "text-right")}>{accounting(v)}</td>)}
      <td className={clsx(td, "text-right", "bg-surface-2")}>{accounting(total)}</td>
    </tr>
  );
  const section = (name: string) => (
    <tr>
      <th scope="rowgroup" colSpan={cf.columns.length + 2} className={clsx("border-b border-line bg-surface-2 px-3 pb-1.5 pt-4 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-3")}>
        {name}
      </th>
    </tr>
  );
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="num w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th scope="col" className={clsx(th, stick, "min-w-[14rem] bg-surface-2")}>Line</th>
            {many && cf.columns.map((c) => <th key={c.key} scope="col" className={clsx(th, "text-right")}>{month(c.key)}</th>)}
            <th scope="col" className={clsx(th, "text-right")}>{many ? "Total" : month(cf.columns[0].key)}</th>
          </tr>
        </thead>
        <tbody>
          {row({ label: "Opening balance", values: cf.opening, total: cf.total.opening, strong: true })}
          {section("Receipts")}
          {cf.receipts.length ? cf.receipts.map((l) => <Fragment key={l.category}>{row({ label: l.category, values: l.values, total: l.total, indent: true })}</Fragment>) : row({ label: "No receipts", values: cf.columns.map(() => 0), total: 0, indent: true })}
          {row({ label: "Total receipts", values: cf.totalReceipts, total: cf.total.receipts, strong: true })}
          {section("Payments")}
          {cf.payments.length ? cf.payments.map((l) => <Fragment key={l.category}>{row({ label: l.category, values: l.values.map((v) => -v), total: -l.total, indent: true })}</Fragment>) : row({ label: "No payments", values: cf.columns.map(() => 0), total: 0, indent: true })}
          {row({ label: "Total payments", values: cf.totalPayments.map((v) => -v), total: -cf.total.payments, strong: true })}
          {section("Result")}
          {row({ label: "Net cash flow", values: cf.net, total: cf.total.net, strong: true })}
          {row({ label: "Closing balance", values: cf.closing, total: cf.total.closing, strong: true })}
          {cf.total.opening !== null && cf.total.closing !== null && Math.abs(cf.total.opening + cf.total.net - cf.total.closing) > 0.01 && (
            <tr>
              <td colSpan={cf.columns.length + 2} className="px-3 py-2 text-xs text-warn">
                Opening balance + net cash flow differs from the closing balance by {accounting(cf.total.closing - cf.total.opening - cf.total.net)}. See Reconciliation.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Categories() {
  const ws = useWorkspace();
  const sides: { side: "credit" | "debit"; title: string }[] = [
    { side: "credit", title: "Receipts" },
    { side: "debit", title: "Payments" },
  ];
  return (
    <div className="grid grid-cols-1 gap-0 xl:grid-cols-2">
      {sides.map(({ side, title }) => {
        const cats = categoryTotals(ws.rows, side);
        const total = cats.reduce((s, c) => s + c.total, 0);
        return (
          <section key={side} className="min-w-0 border-line xl:odd:border-r">
            <h3 className="px-5 pb-2 pt-4 text-sm font-semibold text-ink">{title}</h3>
            {cats.length === 0 ? (
              <EmptyState title={`No ${title.toLowerCase()} in this period`} />
            ) : (
              <div className="scrollbar-thin overflow-x-auto">
                <table className="num w-full min-w-[480px] text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className={th}>Category</th>
                      <th scope="col" className={clsx(th, "text-right")}>Count</th>
                      <th scope="col" className={clsx(th, "text-right")}>Average</th>
                      <th scope="col" className={clsx(th, "text-right")}>Total</th>
                      <th scope="col" className={clsx(th, "w-36")}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cats.map((c) => (
                      <tr key={c.category}>
                        <th scope="row" className={clsx(td, "text-left font-normal text-ink")}>
                          <a className="hover:text-accent hover:underline" href={`#/ledger?category=${encodeURIComponent(c.category)}`}>
                            {c.category}
                          </a>
                        </th>
                        <td className={clsx(td, "text-right text-ink-2")}>{c.count}</td>
                        <td className={clsx(td, "text-right text-ink-2")}>{amount(c.total / c.count)}</td>
                        <td className={clsx(td, "text-right font-medium")}>{amount(c.total)}</td>
                        <td className={td}>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-surface-3" aria-hidden="true">
                              <div className="h-1.5 rounded-full bg-series-1" style={{ width: `${Math.max(c.share, 1)}%` }} />
                            </div>
                            <span className="w-11 text-right text-xs text-ink-3">{percent(c.share, 0)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <th scope="row" className="px-3 py-2.5 text-left">Total</th>
                      <td className="px-3 py-2.5 text-right">{cats.reduce((s, c) => s + c.count, 0)}</td>
                      <td />
                      <td className="px-3 py-2.5 text-right">{amount(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Monthly({ cf }: { cf: CashflowStatement }) {
  const ws = useWorkspace();
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="num w-full min-w-[820px] text-sm">
        <thead>
          <tr>
            <th scope="col" className={th}>Month</th>
            <th scope="col" className={clsx(th, "text-right")}>Opening</th>
            <th scope="col" className={clsx(th, "text-right")}>Receipts</th>
            <th scope="col" className={clsx(th, "text-right")}>Payments</th>
            <th scope="col" className={clsx(th, "text-right")}>Net</th>
            <th scope="col" className={clsx(th, "text-right")}>Closing</th>
            <th scope="col" className={clsx(th, "text-right")}>Transactions</th>
            <th scope="col" className={clsx(th, "text-right")}>Payments ÷ receipts</th>
          </tr>
        </thead>
        <tbody>
          {cf.columns.map((c, i) => {
            const count = inPeriod(ws.ledger, c).length;
            const ratio = cf.totalReceipts[i] ? (cf.totalPayments[i] / cf.totalReceipts[i]) * 100 : null;
            return (
              <tr key={c.key} className="hover:bg-surface-2">
                <th scope="row" className={clsx(td, "text-left font-medium text-ink")}>{month(c.key)}</th>
                <td className={clsx(td, "text-right")}>{accounting(cf.opening[i])}</td>
                <td className={clsx(td, "text-right")}>{accounting(cf.totalReceipts[i])}</td>
                <td className={clsx(td, "text-right")}>{accounting(-cf.totalPayments[i])}</td>
                <td className={clsx(td, "text-right font-medium")}>{accounting(cf.net[i])}</td>
                <td className={clsx(td, "text-right", (cf.closing[i] ?? 0) < 0 && "text-crit")}>{accounting(cf.closing[i])}</td>
                <td className={clsx(td, "text-right text-ink-2")}>{count}</td>
                <td className={clsx(td, "text-right text-ink-2")}>{percent(ratio, 0)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-surface-2 font-semibold">
            <th scope="row" className="px-3 py-2.5 text-left">Period</th>
            <td className="px-3 py-2.5 text-right">{accounting(cf.total.opening)}</td>
            <td className="px-3 py-2.5 text-right">{accounting(cf.total.receipts)}</td>
            <td className="px-3 py-2.5 text-right">{accounting(-cf.total.payments)}</td>
            <td className="px-3 py-2.5 text-right">{accounting(cf.total.net)}</td>
            <td className="px-3 py-2.5 text-right">{accounting(cf.total.closing)}</td>
            <td className="px-3 py-2.5 text-right">{ws.rows.length}</td>
            <td className="px-3 py-2.5 text-right">{percent(cf.total.receipts ? (cf.total.payments / cf.total.receipts) * 100 : null, 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}


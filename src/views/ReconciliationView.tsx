import { Fragment, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Link2Off } from "lucide-react";
import type { StatementRecon } from "../lib/accounting";
import { accounting, amount, date, plural } from "../lib/format";
import { useWorkspace } from "../state/store";
import { Card, EmptyState, Kpi, PageHeader, Status, td, th } from "../components/ui";
import { NoData } from "./common";

const STATUS: Record<StatementRecon["status"], { tone: "good" | "crit" | "info"; label: string }> = {
  balanced: { tone: "good", label: "Reconciled" },
  issues: { tone: "crit", label: "Issues" },
  unverifiable: { tone: "info", label: "No balances" },
};

const TOTALS: Record<StatementRecon["printedTotals"], { tone: "good" | "crit" | "info"; label: string } | null> = {
  match: { tone: "good", label: "Match" },
  mismatch: { tone: "crit", label: "Differ" },
  unknown: null,
};

export default function ReconciliationView({ onUpload }: { onUpload: () => void }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (ws.recons.length === 0) return <NoData onUpload={onUpload} what="statements to reconcile" />;

  const label = (key: string) => ws.accounts.find((a) => a.key === key)?.label ?? key;
  const inLedger = new Set(ws.ledger.map((t) => t.uid));
  const balanced = ws.recons.filter((r) => r.status === "balanced").length;
  const withIssues = ws.recons.filter((r) => r.status === "issues").length;
  const review = ws.recons.reduce((s, r) => s + r.review, 0);
  const allGood = withIssues === 0 && ws.continuity.length === 0;
  const sorted = [...ws.recons].sort((a, b) => (a.accountKey + (a.from ?? "")).localeCompare(b.accountKey + (b.from ?? "")));

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Each statement is checked on its own: opening balance + receipts − payments must equal the closing balance, row by row. Consecutive statements must carry the balance over."
      />

      <div
        role="status"
        className={clsx(
          "mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
          allGood ? "border-good/30 bg-good-soft" : "border-crit/30 bg-crit-soft"
        )}
      >
        <Status tone={allGood ? "good" : "crit"}>{allGood ? "Reconciled" : "Needs attention"}</Status>
        <p className="text-ink">
          {allGood
            ? `All ${plural(ws.recons.length, "statement")} reconcile and the balance carries over between them.`
            : [withIssues > 0 && `${plural(withIssues, "statement")} with balance differences`, ws.continuity.length > 0 && `${plural(ws.continuity.length, "gap")} between statements`]
                .filter(Boolean)
                .join(" and ") + ". Details below."}
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Statements" value={ws.recons.length} footer={<span className="text-xs text-ink-3">{plural(ws.scopeAccounts.length, "account")}</span>} />
        <Kpi label="Reconciled" value={balanced} footer={<span className="text-xs text-ink-3">running balance adds up</span>} />
        <Kpi label="With issues" value={withIssues} tone={withIssues ? "crit" : undefined} footer={<span className="text-xs text-ink-3">balance breaks or totals differ</span>} />
        <Kpi label="Scanned rows to check" value={review} tone={review ? "warn" : undefined} footer={review ? <a className="text-xs font-medium text-accent hover:underline" href="#/ledger?status=review">Open in ledger</a> : <span className="text-xs text-ink-3">none</span>} />
      </div>

      <Card title="Statements" subtitle="Expand a statement to see the rows where the balance doesn't add up" bodyClassName="p-0" className="mb-5">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th scope="col" className={th}>Statement</th>
                <th scope="col" className={clsx(th, "text-right")}>Opening</th>
                <th scope="col" className={clsx(th, "text-right")}>+ Receipts</th>
                <th scope="col" className={clsx(th, "text-right")}>− Payments</th>
                <th scope="col" className={clsx(th, "text-right")}>= Expected</th>
                <th scope="col" className={clsx(th, "text-right")}>Closing</th>
                <th scope="col" className={clsx(th, "text-right")}>Difference</th>
                <th scope="col" className={th}>Printed totals</th>
                <th scope="col" className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="num">
              {sorted.map((r) => {
                const expanded = open.has(r.fileId);
                const s = STATUS[r.status];
                const totals = TOTALS[r.printedTotals];
                return (
                  <Fragment key={r.fileId}>
                    <tr className="hover:bg-surface-2">
                      <td className={td}>
                        <button
                          type="button"
                          onClick={() => toggle(r.fileId)}
                          aria-expanded={expanded}
                          className="flex items-center gap-1.5 text-left font-medium text-ink hover:text-accent"
                        >
                          {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
                          <span className="max-w-[15rem] truncate" title={r.name}>{r.name}</span>
                        </button>
                        <p className="ml-6 whitespace-nowrap text-xs text-ink-3">
                          {r.from ? `${date(r.from)} – ${date(r.to)}` : "No dated rows"} · {plural(r.rows, "row")}
                          {ws.scopeAccounts.length > 1 && <> · {label(r.accountKey)}</>}
                        </p>
                      </td>
                      <td className={clsx(td, "text-right")}>{accounting(r.opening)}</td>
                      <td className={clsx(td, "text-right")}>{accounting(r.receipts)}</td>
                      <td className={clsx(td, "text-right")}>{accounting(r.payments)}</td>
                      <td className={clsx(td, "text-right")}>{accounting(r.expectedClosing)}</td>
                      <td className={clsx(td, "text-right font-medium")}>{accounting(r.closing)}</td>
                      <td className={clsx(td, "text-right font-medium", r.difference ? "text-crit" : "text-ink-3")}>{r.difference === null ? "—" : accounting(r.difference)}</td>
                      <td className={td}>{totals ? <Status tone={totals.tone}>{totals.label}</Status> : <span className="text-xs text-ink-3">Not printed</span>}</td>
                      <td className={td}>
                        <Status tone={s.tone}>{s.label}</Status>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={9} className="border-b border-line bg-surface-2 px-6 py-4">
                          <StatementDetail r={r} inLedger={inLedger} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Continuity between statements" subtitle="The closing balance of one statement should be the opening balance of the next">
        {ws.continuity.length === 0 ? (
          <EmptyState title="No gaps found">
            {ws.recons.length > 1 ? "Every statement picks up where the previous one ended." : "Upload more statements of the same account to check continuity."}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {ws.continuity.map((c) => (
              <li key={`${c.fromName}-${c.toName}`} className="flex gap-3 rounded-lg border border-line p-3">
                <Link2Off size={18} className="mt-0.5 shrink-0 text-crit" aria-hidden="true" />
                <div className="text-sm">
                  <p className="font-medium text-ink">
                    Missing transactions between {date(c.after)} and {date(c.before)}
                  </p>
                  <p className="mt-0.5 text-ink-3">
                    <span className="text-ink-2">{c.fromName}</span> closes at <span className="num">{amount(c.closing)}</span>, but{" "}
                    <span className="text-ink-2">{c.toName}</span> opens at <span className="num">{amount(c.nextOpening)}</span>, a difference of{" "}
                    <span className="num font-medium text-ink">{amount(c.difference)}</span>. Upload the statement that covers this gap. Account: {label(c.accountKey)}.
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function StatementDetail({ r, inLedger }: { r: StatementRecon; inLedger: Set<string> }) {
  const facts = [
    r.missingBalances > 0 && `${plural(r.missingBalances, "row")} without a printed balance (carried forward in the check)`,
    r.edited > 0 && `${plural(r.edited, "row")} edited by you`,
    r.review > 0 && `${plural(r.review, "scanned row")} still to review`,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {r.status === "unverifiable" && <p className="text-ink-2">This statement has no running balance, so it can't be checked row by row.</p>}
      {r.printedTotals === "mismatch" && (
        <p className="text-ink-2">The receipts or payments add up to a different total than the one printed on the statement. A row is probably misread or missing.</p>
      )}
      {r.breaks.length > 0 ? (
        <>
          <p className="font-medium text-ink">{plural(r.breaks.length, "row")} where the running balance doesn't follow from the one before:</p>
          <table className="w-full max-w-3xl text-sm">
            <thead>
              <tr>
                <th scope="col" className={th}>Date</th>
                <th scope="col" className={th}>Description</th>
                <th scope="col" className={clsx(th, "text-right")}>Expected balance</th>
                <th scope="col" className={clsx(th, "text-right")}>Statement balance</th>
                <th scope="col" className={clsx(th, "text-right")}>Difference</th>
              </tr>
            </thead>
            <tbody className="num">
              {r.breaks.map((b) => (
                <tr key={b.uid}>
                  <td className={clsx(td, "whitespace-nowrap")}>{date(b.date)}</td>
                  <td className={td}>
                    {inLedger.has(b.uid) ? (
                      <a className="text-accent hover:underline" href={`#/ledger?row=${encodeURIComponent(b.uid)}`}>
                        {b.description}
                      </a>
                    ) : (
                      <span title="This row was ignored as a duplicate of another statement">{b.description}</span>
                    )}
                  </td>
                  <td className={clsx(td, "text-right")}>{amount(b.expected)}</td>
                  <td className={clsx(td, "text-right")}>{amount(b.actual)}</td>
                  <td className={clsx(td, "text-right font-medium text-crit")}>{accounting(b.difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-ink-3">Open a row to compare it with the paper statement and correct the amount or balance. The check re-runs as you save.</p>
        </>
      ) : (
        r.status !== "unverifiable" && <p className="text-ink-2">Every row follows from the previous balance.</p>
      )}
      {facts.length > 0 && <p className="text-xs text-ink-3">{facts.join(" · ")}</p>}
    </div>
  );
}

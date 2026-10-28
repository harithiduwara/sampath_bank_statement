import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, FilterX, Search, StickyNote } from "lucide-react";
import { needsReview, type LedgerTxn } from "../lib/accounting";
import { amount, date, plural } from "../lib/format";
import { exportLedgerRows } from "../lib/excelRuntime";
import { useWorkspace } from "../state/store";
import { useRoute } from "../state/ui";
import { Badge, Button, Card, EmptyState, PageHeader, Segmented, Select, fieldClass, td, th } from "../components/ui";
import TransactionDrawer, { CATEGORY_LIST_ID, CategoryOptions } from "../components/TransactionDrawer";
import { NoData } from "./common";

type SortKey = "date" | "description" | "category" | "credit" | "debit" | "balance";
type StatusFilter = "all" | "review" | "ocr" | "edited" | "reviewed" | "notes";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "review", label: "Needs review" },
  { value: "ocr", label: "Read from a scan" },
  { value: "edited", label: "Edited" },
  { value: "reviewed", label: "Marked reviewed" },
  { value: "notes", label: "Has a note" },
];

const matchStatus = (t: LedgerTxn, s: StatusFilter) =>
  s === "all" ||
  (s === "review" && needsReview(t)) ||
  (s === "ocr" && Boolean(t.confidence)) ||
  (s === "edited" && t.edited) ||
  (s === "reviewed" && t.reviewed) ||
  (s === "notes" && Boolean(t.note));

export default function LedgerView({ params, onUpload }: { params: URLSearchParams; onUpload: () => void }) {
  const ws = useWorkspace();
  const { go } = useRoute();
  const search = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | "in" | "out">("all");
  const [category, setCategory] = useState(params.get("category") ?? "all");
  const [status, setStatus] = useState<StatusFilter>((params.get("status") as StatusFilter) || "all");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: 1 });
  const [paging, setPaging] = useState({ sig: "", page: 0 });
  const [pageSize, setPageSize] = useState(50);
  const [picked, setSelected] = useState<Set<string>>(new Set());
  // Selection never outlives the rows it pointed to (period change, removed file).
  const selected = useMemo(() => {
    const live = new Set(ws.rows.map((t) => t.uid));
    return new Set([...picked].filter((uid) => live.has(uid)));
  }, [picked, ws.rows]);
  const [bulkCategory, setBulkCategory] = useState("");

  // A link like #/ledger?status=review applies its filter even when the ledger is already open.
  const linked = `${params.get("status") ?? ""}|${params.get("category") ?? ""}`;
  const [seenLink, setSeenLink] = useState(linked);
  if (linked !== seenLink) {
    setSeenLink(linked);
    if (params.get("status")) setStatus(params.get("status") as StatusFilter);
    if (params.get("category")) setCategory(params.get("category")!);
  }

  const openUid = params.get("row");
  // Filters that live in the URL survive opening and closing a row.
  const keep = (extra: Record<string, string> = {}) => {
    const p: Record<string, string> = { ...extra };
    if (status !== "all") p.status = status;
    if (category !== "all") p.category = category;
    return p;
  };
  const open = openUid ? ws.ledger.find((t) => t.uid === openUid) ?? null : null;

  // "/" jumps to search, like most data tools.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lo = min ? Number(min.replace(/,/g, "")) : null;
    const hi = max ? Number(max.replace(/,/g, "")) : null;
    const out = ws.rows.filter((t) => {
      const value = t.debit ?? t.credit ?? 0;
      return (
        (!needle || t.description.toLowerCase().includes(needle) || t.note?.toLowerCase().includes(needle) || t.category.toLowerCase().includes(needle) || amount(value).includes(needle)) &&
        (type === "all" || (type === "in" ? t.credit !== null : t.debit !== null)) &&
        (category === "all" || t.category === category) &&
        matchStatus(t, status) &&
        (lo === null || Number.isNaN(lo) || value >= lo) &&
        (hi === null || Number.isNaN(hi) || value <= hi)
      );
    });
    if (sort.key !== "date" || sort.dir !== 1) {
      const idx = new Map(ws.rows.map((t, i) => [t.uid, i]));
      out.sort((a, b) => {
        const va = a[sort.key], vb = b[sort.key];
        const cmp =
          va === vb ? 0 : va === null || va === undefined ? 1 : vb === null || vb === undefined ? -1 : typeof va === "number" ? va - (vb as number) : String(va).localeCompare(String(vb));
        return cmp * sort.dir || (idx.get(a.uid)! - idx.get(b.uid)!) * sort.dir;
      });
    }
    return out;
  }, [ws.rows, q, type, category, status, min, max, sort]);

  // Back to the first page whenever the result set changes shape.
  const sig = JSON.stringify([q, type, category, status, min, max, sort, pageSize, ws.period]);
  const page = paging.sig === sig ? paging.page : 0;
  const setPage = (n: number) => setPaging({ sig, page: n });

  if (ws.ledger.length === 0) return <NoData onUpload={onUpload} what="transactions" />;

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize);
  const totals = filtered.reduce((s, t) => ({ in: s.in + (t.credit ?? 0), out: s.out + (t.debit ?? 0) }), { in: 0, out: 0 });
  const filtersOn = q || type !== "all" || category !== "all" || status !== "all" || min || max;
  const reviewCount = ws.rows.filter(needsReview).length;
  const allOnPage = visible.length > 0 && visible.every((t) => selected.has(t.uid));

  const toggle = (uid: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });

  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "date" || key === "description" || key === "category" ? 1 : -1 }));
  // A render helper (not a component) so the header button keeps focus after sorting.
  const sortable = (k: SortKey, children: string, right?: boolean) => (
    <th key={k} scope="col" className={clsx(th, right && "text-right")} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => sortBy(k)} className={clsx("inline-flex items-center gap-1 uppercase hover:text-ink", right && "flex-row-reverse")}>
        {children}
        {sort.key === k && (sort.dir === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
      </button>
    </th>
  );

  const reset = () => {
    setQ("");
    setType("all");
    setCategory("all");
    setStatus("all");
    setMin("");
    setMax("");
  };

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every transaction in the selected account and period. Open a row to correct it, categorise it, add a note or mark it reviewed."
        actions={
          <>
            {reviewCount > 0 && status !== "review" && (
              <Button onClick={() => setStatus("review")}>
                <Badge tone="warn">{reviewCount}</Badge> to review
              </Button>
            )}
            <Button icon={<Download size={15} aria-hidden="true" />} disabled={filtered.length === 0} onClick={() => void exportLedgerRows(ws, filtered)}>
              Export {filtersOn ? "filtered" : "all"}
            </Button>
          </>
        }
      />

      <Card bodyClassName="p-0">
        {/* Filters */}
        <div className="no-print flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
          <div className="relative min-w-[14rem] flex-1">
            <label htmlFor="ledger-search" className="sr-only">
              Search transactions
            </label>
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
            <input
              id="ledger-search"
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search description, category, note or amount"
              className={`${fieldClass} w-full pl-8`}
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[10px] text-ink-3 sm:block">/</kbd>
          </div>
          <Segmented
            label="Direction"
            value={type}
            onChange={setType}
            options={[
              { value: "all", label: "All" },
              { value: "in", label: "Receipts" },
              { value: "out", label: "Payments" },
            ]}
          />
          <Select hideLabel label="Category" value={category} onChange={setCategory} options={[{ value: "all", label: "All categories" }, ...ws.categories.map((c) => ({ value: c, label: c }))]} />
          <Select hideLabel label="Status" value={status} onChange={(v) => setStatus(v as StatusFilter)} options={STATUS_OPTIONS} />
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor="amt-min">Minimum amount</label>
            <input id="amt-min" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} placeholder="Min" className={`${fieldClass} w-24`} />
            <span className="text-ink-3" aria-hidden="true">–</span>
            <label className="sr-only" htmlFor="amt-max">Maximum amount</label>
            <input id="amt-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder="Max" className={`${fieldClass} w-24`} />
          </div>
          {filtersOn && (
            <Button variant="ghost" icon={<FilterX size={15} aria-hidden="true" />} onClick={reset}>
              Clear
            </Button>
          )}
        </div>

        {/* Bulk actions */}
        {selected.size > 0 && (
          <div className="no-print flex flex-wrap items-center gap-2 border-b border-line bg-accent-soft px-4 py-2.5 text-sm" role="region" aria-label="Bulk actions">
            <span className="font-medium text-ink">{plural(selected.size, "row")} selected</span>
            <span className="mx-1 h-4 w-px bg-line-strong" aria-hidden="true" />
            <label htmlFor="bulk-cat" className="sr-only">Category for selected rows</label>
            <input id="bulk-cat" list={CATEGORY_LIST_ID} value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} placeholder="Category…" className={`${fieldClass} h-8 w-44`} />
            <Button
              size="sm"
              variant="primary"
              disabled={!bulkCategory.trim()}
              onClick={() => {
                ws.actions.override([...selected], { category: bulkCategory.trim() });
                setBulkCategory("");
              }}
            >
              Set category
            </Button>
            <Button size="sm" onClick={() => ws.actions.override([...selected], { reviewed: true })}>
              Mark reviewed
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        )}
        <CategoryOptions />

        {/* Grid */}
        {filtered.length === 0 ? (
          <EmptyState title="No transactions match" action={filtersOn ? <Button onClick={reset}>Clear filters</Button> : undefined}>
            {filtersOn ? "Try fewer filters." : "There are no transactions in this period."}
          </EmptyState>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
              <caption className="sr-only">Transactions, {filtered.length} rows</caption>
              <thead>
                <tr>
                  <th scope="col" className={clsx(th, "w-10")}>
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allOnPage}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          visible.forEach((t) => (allOnPage ? n.delete(t.uid) : n.add(t.uid)));
                          return n;
                        })
                      }
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                  </th>
                  {sortable("date", "Date")}
                  {sortable("description", "Description")}
                  {sortable("category", "Category")}
                  {sortable("credit", "Receipt", true)}
                  {sortable("debit", "Payment", true)}
                  {sortable("balance", "Balance", true)}
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.uid} className={clsx("group hover:bg-surface-2", selected.has(t.uid) && "bg-accent-soft/60", openUid === t.uid && "bg-surface-3")}>
                    <td className={td}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.description} on ${date(t.date)}`}
                        checked={selected.has(t.uid)}
                        onChange={() => toggle(t.uid)}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                    <td className={clsx(td, "num whitespace-nowrap text-ink-2")}>
                      {t.dateEstimated && !t.original?.date ? (
                        <span title="Unreadable on the scan; estimated from the rows around it" className="italic">
                          ~{date(t.date)}
                        </span>
                      ) : (
                        date(t.date)
                      )}
                    </td>
                    <td className={clsx(td, "max-w-[28rem]")}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => go("ledger", keep({ row: t.uid }))}
                          className="truncate text-left font-medium text-ink hover:text-accent hover:underline"
                          title={t.description}
                        >
                          {t.description}
                        </button>
                        <RowBadges t={t} />
                      </div>
                    </td>
                    <td className={clsx(td, "whitespace-nowrap text-ink-2")}>
                      {t.category}
                      {t.categorySource !== "auto" && <span className="sr-only"> (set by you)</span>}
                    </td>
                    <td className={clsx(td, "num whitespace-nowrap text-right text-ink")}>{t.credit !== null ? amount(t.credit) : ""}</td>
                    <td className={clsx(td, "num whitespace-nowrap text-right text-ink")}>{t.debit !== null ? amount(t.debit) : ""}</td>
                    <td className={clsx(td, "num whitespace-nowrap text-right", t.balance !== null && t.balance < 0 ? "text-crit" : "text-ink-2")}>{amount(t.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-surface-2 font-semibold">
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-ink" colSpan={3}>
                    Total · {plural(filtered.length, "row")}
                    <span className="ml-2 font-normal text-ink-3">net {amount(totals.in - totals.out)}</span>
                  </td>
                  <td className="num px-3 py-2.5 text-right text-ink">{amount(totals.in)}</td>
                  <td className="num px-3 py-2.5 text-right text-ink">{amount(totals.out)}</td>
                  <td className="px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-ink-3">
            <span>
              {current * pageSize + 1}–{Math.min(filtered.length, (current + 1) * pageSize)} of {filtered.length.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <label htmlFor="page-size">Rows per page</label>
              <select id="page-size" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className={`${fieldClass} h-8 px-2`}>
                {[25, 50, 100, 250].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <Button size="sm" variant="ghost" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page" icon={<ChevronLeft size={15} />} />
              <span>
                Page {current + 1} of {pages}
              </span>
              <Button size="sm" variant="ghost" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} aria-label="Next page" icon={<ChevronRight size={15} />} />
            </div>
          </div>
        )}
      </Card>

      <TransactionDrawer key={open?.uid ?? "none"} txn={open} onClose={() => go("ledger", keep())} />
    </>
  );
}

function RowBadges({ t }: { t: LedgerTxn }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {needsReview(t) && (
        <Badge tone={t.confidence === "review" ? "crit" : "warn"} title={t.confidence === "review" ? "Hard to read on the scan: compare with the paper statement" : "Digits corrected using the running balance"}>
          {t.confidence === "review" ? "Check" : "Corrected"}
        </Badge>
      )}
      {t.reviewed && <Badge tone="good">Reviewed</Badge>}
      {t.edited && <Badge tone="info">Edited</Badge>}
      {t.note && (
        <span title={t.note} className="text-ink-3">
          <StickyNote size={13} aria-label="Has a note" />
        </span>
      )}
    </span>
  );
}

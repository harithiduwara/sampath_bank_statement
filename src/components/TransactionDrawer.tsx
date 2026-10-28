import { useMemo, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { narrationKey, needsReview, type EditableFields, type LedgerTxn } from "../lib/accounting";
import { amount, date } from "../lib/format";
import { useWorkspace } from "../state/store";
import { Badge, Button, DefList, Drawer, Status, fieldClass } from "./ui";

export const CATEGORY_LIST_ID = "category-options";

const STANDARD = [
  "Salary / Payroll",
  "Sales / Customer receipts",
  "Transfers",
  "Cash",
  "Cheques",
  "Supplier payments",
  "Rent",
  "Utilities",
  "Taxes",
  "Loan / Investment",
  "Card / POS",
  "ATM Withdrawal",
  "Fees & Charges",
  "Interest",
  "Owner drawings",
  "Other",
];

/** One shared datalist: standard accounting categories plus everything already in use. */
export function CategoryOptions() {
  const { categories } = useWorkspace();
  const all = useMemo(() => [...new Set([...STANDARD, ...categories])].sort(), [categories]);
  return (
    <datalist id={CATEGORY_LIST_ID}>
      {all.map((c) => (
        <option key={c} value={c} />
      ))}
    </datalist>
  );
}

const FIELDS: (keyof EditableFields)[] = ["date", "description", "debit", "credit", "balance"];
const LABEL: Record<keyof EditableFields, string> = { date: "Date", description: "Description", debit: "Payment", credit: "Receipt", balance: "Balance" };

type Form = Record<keyof EditableFields, string>;

const toForm = (v: Partial<EditableFields>): Form => ({
  date: v.date ?? "",
  description: v.description ?? "",
  debit: v.debit === null || v.debit === undefined ? "" : String(v.debit),
  credit: v.credit === null || v.credit === undefined ? "" : String(v.credit),
  balance: v.balance === null || v.balance === undefined ? "" : String(v.balance),
});

const parseAmount = (s: string): number | null | "bad" => {
  const v = s.replace(/[,\s]/g, "").replace(/^−/, "-");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : "bad";
};

const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export default function TransactionDrawer({ txn, onClose }: { txn: LedgerTxn | null; onClose: () => void }) {
  const ws = useWorkspace();
  const t = txn;
  // What the statement said, before any edit.
  const read = useMemo<EditableFields | null>(() => (t ? { date: t.date, description: t.description, debit: t.debit, credit: t.credit, balance: t.balance, ...t.original } : null), [t]);
  const [form, setForm] = useState<Form>(() => toForm(t ?? {}));
  const [category, setCategory] = useState(t?.category ?? "");
  const [applyAll, setApplyAll] = useState(false);
  const [note, setNote] = useState(t?.note ?? "");
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saved, setSaved] = useState(false);


  if (!t || !read) return <Drawer open={false} title="" onClose={onClose}>{null}</Drawer>;

  const account = ws.accounts.find((a) => a.key === t.accountKey);
  const override = ws.state.overrides[t.uid];
  const key = narrationKey(t.description);
  const similar = ws.ledger.filter((x) => narrationKey(x.description) === key).length;

  const validate = (): Partial<EditableFields> | null => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (!validDate(form.date)) e.date = "Use a valid date.";
    if (!form.description.trim()) e.description = "Description can't be empty.";
    const debit = parseAmount(form.debit), credit = parseAmount(form.credit), balance = parseAmount(form.balance);
    if (debit === "bad" || (typeof debit === "number" && debit <= 0)) e.debit = "Enter a positive amount, or leave empty.";
    if (credit === "bad" || (typeof credit === "number" && credit <= 0)) e.credit = "Enter a positive amount, or leave empty.";
    if (balance === "bad") e.balance = "Enter a number, or leave empty.";
    if (!e.debit && !e.credit && (debit === null) === (credit === null)) e.credit = "Enter either a receipt or a payment, not both.";
    setErrors(e);
    if (Object.keys(e).length) return null;
    return { date: form.date, description: form.description.trim(), debit: debit as number | null, credit: credit as number | null, balance: balance as number | null };
  };

  const save = (extra: { reviewed?: boolean } = {}) => {
    const values = validate();
    if (!values) return;
    // Only keep fields that differ from the statement; a field set back to its read value is no longer an edit.
    const edits: Partial<EditableFields> = {};
    for (const f of FIELDS) (edits as Record<string, unknown>)[f] = values[f] !== read[f] ? values[f] : undefined;
    const cat = category.trim();
    if (cat && applyAll) ws.actions.categorizeSimilar(values.description!, cat);
    ws.actions.override([t.uid], {
      edits,
      category: cat && !applyAll && cat !== t.category ? cat : applyAll ? undefined : override?.category,
      note: note.trim(),
      ...extra,
    });
    setSaved(true);
  };

  const revert = () => {
    ws.actions.override([t.uid], { edits: Object.fromEntries(FIELDS.map((f) => [f, undefined])) as Partial<EditableFields> });
    setForm(toForm(read));
  };

  const field = (f: keyof Form, opts: { type?: string; inputMode?: "decimal" } = {}) => (
    <div className={f === "description" ? "col-span-2" : ""}>
      <label htmlFor={`f-${f}`} className="mb-1 flex items-center justify-between text-xs font-medium text-ink-3">
        {LABEL[f]}
        {t.original && f in t.original && (
          <span className="font-normal" title="Value read from the statement">
            was {f === "date" || f === "description" ? String(t.original[f] ?? "—") : amount(t.original[f] as number | null)}
          </span>
        )}
      </label>
      <input
        id={`f-${f}`}
        type={opts.type ?? "text"}
        inputMode={opts.inputMode}
        value={form[f]}
        aria-invalid={Boolean(errors[f])}
        aria-describedby={errors[f] ? `e-${f}` : undefined}
        onChange={(e) => {
          setSaved(false);
          setForm({ ...form, [f]: e.target.value });
        }}
        className={`${fieldClass} num w-full ${errors[f] ? "border-crit" : ""}`}
      />
      {errors[f] && (
        <p id={`e-${f}`} className="mt-1 text-xs text-crit">
          {errors[f]}
        </p>
      )}
    </div>
  );

  return (
    <Drawer
      open
      title={t.description}
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          {date(t.date)} · {t.credit !== null ? `Receipt ${amount(t.credit)}` : `Payment ${amount(t.debit)}`}
          {needsReview(t) && <Status tone="warn">{t.confidence === "review" ? "Check against paper" : "Auto-corrected"}</Status>}
          {t.reviewed && <Status tone="good">Reviewed</Status>}
          {t.edited && <Badge tone="info">Edited</Badge>}
        </span>
      }
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-ink-3" aria-live="polite">
            {saved ? "Saved. Totals and reconciliation are updated." : override?.updatedAt ? `Last changed ${new Date(override.updatedAt).toLocaleString()}` : "No changes yet"}
          </span>
          <div className="flex gap-2">
            {!t.reviewed ? (
              <Button icon={<CheckCircle2 size={15} aria-hidden="true" />} onClick={() => save({ reviewed: true })}>
                Save & mark reviewed
              </Button>
            ) : (
              <Button onClick={() => ws.actions.override([t.uid], { reviewed: false })}>Mark not reviewed</Button>
            )}
            <Button variant="primary" onClick={() => save()}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-6"
      >
        {t.confidence && (
          <section className="rounded-lg border border-line bg-surface-2 p-3 text-xs">
            <p className="mb-1 font-medium text-ink-2">Read from a scan</p>
            <p className="text-ink-3">
              {t.confidence === "verified"
                ? "Every figure on this row agrees with the running balance."
                : t.confidence === "corrected"
                  ? "Some digits were misread and corrected so the running balance adds up. Compare with the paper statement."
                  : "This row was hard to read. Compare the figures with the paper statement and correct them below."}
            </p>
            {t.raw && <p className="mt-2 break-words font-mono text-[11px] text-ink-3">OCR text: {t.raw}</p>}
          </section>
        )}

        <fieldset>
          <legend className="mb-3 flex w-full items-center justify-between text-sm font-semibold text-ink">
            Transaction
            {t.edited && (
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} aria-hidden="true" />} onClick={revert}>
                Revert to statement
              </Button>
            )}
          </legend>
          <div className="grid grid-cols-2 gap-3">
            {field("date", { type: "date" })}
            {field("balance", { inputMode: "decimal" })}
            {field("description")}
            {field("credit", { inputMode: "decimal" })}
            {field("debit", { inputMode: "decimal" })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink">Category</legend>
          <label htmlFor="f-category" className="sr-only">Category</label>
          <input id="f-category" list={CATEGORY_LIST_ID} value={category} onChange={(e) => (setSaved(false), setCategory(e.target.value))} className={`${fieldClass} w-full`} />
          <p className="mt-1 text-xs text-ink-3">
            {t.categorySource === "auto" ? "Suggested automatically." : t.categorySource === "rule" ? "Set by a rule for similar rows." : "Set by you."}
          </p>
          {key && similar > 1 && (
            <label className="mt-2 flex items-start gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
              <span>
                Apply to all {similar} rows starting “{key}”, including future uploads
              </span>
            </label>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold text-ink">Note</legend>
          <label htmlFor="f-note" className="sr-only">Note</label>
          <textarea
            id="f-note"
            rows={3}
            value={note}
            onChange={(e) => (setSaved(false), setNote(e.target.value))}
            placeholder="e.g. invoice number, who approved it"
            className={`${fieldClass} h-auto w-full py-2`}
          />
        </fieldset>

        <section>
          <h3 className="mb-3 text-sm font-semibold text-ink">Source</h3>
          <DefList
            items={[
              ["Account", account ? `${account.label} · ${account.currency}` : "—"],
              ["Statement", t.sourceFile],
              ["Page", String(t.sourcePage)],
              ["Read as", t.confidence ? "Scan (OCR)" : "PDF text"],
              ...(t.dateEstimated ? ([["Date", "Estimated: unreadable on the scan"]] as [string, string][]) : []),
            ]}
          />
        </section>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Drawer>
  );
}

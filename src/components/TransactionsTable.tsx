import { useMemo, useState } from "react";
import type { Transaction } from "../lib/types";

const currency = (n: number | null) =>
  n === null ? "—" : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TransactionsTable({ txns }: { txns: Transaction[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const categories = useMemo(
    () => ["All", ...new Set(txns.map((t) => t.category))].sort((a, b) => (a === "All" ? -1 : a.localeCompare(b))),
    [txns]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return txns.filter((t) => {
      const matchesQuery = !q || t.description.toLowerCase().includes(q) || t.sourceFile.toLowerCase().includes(q);
      const matchesCat = category === "All" || t.category === category;
      return matchesQuery && matchesCat;
    });
  }, [txns, query, category]);

  if (txns.length === 0) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-ink-900/60 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-white">
          Transactions <span className="text-white/40">({filtered.length})</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search description or file…"
            className="w-56 rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white outline-none ring-brand-400/50 placeholder:text-white/30 focus:ring-2"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white outline-none ring-brand-400/50 focus:ring-2"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="scrollbar-thin max-h-[32rem] overflow-auto rounded-xl border border-white/5">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 bg-ink-900 text-left text-xs uppercase tracking-wide text-white/40">
            <tr>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">Description</th>
              <th className="px-3 py-2.5">Category</th>
              <th className="px-3 py-2.5 text-right">Debit</th>
              <th className="px-3 py-2.5 text-right">Credit</th>
              <th className="px-3 py-2.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                <td className="whitespace-nowrap px-3 py-2 text-white/70">{t.date}</td>
                <td className="px-3 py-2 text-white/90">{t.description}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-white/60">{t.category}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-debit-500">
                  {t.debit ? currency(t.debit) : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-credit-500">
                  {t.credit ? currency(t.credit) : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-white/70">{currency(t.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

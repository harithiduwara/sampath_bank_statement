import type { Insight } from "../lib/types";

const TONE_STYLE: Record<Insight["tone"], string> = {
  positive: "border-credit-500/30 bg-credit-500/10 text-credit-500",
  warning: "border-gold-400/30 bg-gold-400/10 text-gold-400",
  critical: "border-debit-500/30 bg-debit-500/10 text-debit-500",
  neutral: "border-white/10 bg-white/5 text-white/70",
};

export default function InsightsPanel({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <section className="rounded-2xl border border-white/10 bg-ink-900/60 p-4 sm:p-5">
      <h2 className="mb-1 text-base font-semibold text-white">Analyst notes</h2>
      <p className="mb-4 text-sm text-white/50">Automated read of this ledger — treat as a starting point, not advice.</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {insights.map((i) => (
          <li key={i.id} className={`rounded-xl border px-4 py-3 ${TONE_STYLE[i.tone]}`}>
            <p className="text-sm font-semibold">{i.title}</p>
            <p className="mt-1 text-xs leading-relaxed opacity-90">{i.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

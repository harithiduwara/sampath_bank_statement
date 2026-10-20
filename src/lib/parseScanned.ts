import { categorize } from "./categorize";
import { cleanNarration } from "./sampathVocab";
import { amountDistance, expandPattern, nearbyValues, parseFuzzyAmount, parseFuzzyDate, type FuzzyAmount, type FuzzyDate } from "./ocrText";
import { isTotalLabel, type OcrLine, type ScannedTable, type TableRow } from "./scanTable";
import type { ReadQuality, StatementMeta, Transaction } from "./types";

export interface ScannedPage {
  page: number;
  tables: ScannedTable[];
  pageLines: OcrLine[];
}

const JUNK_TOKEN = /^[^A-Za-z0-9]+$/;

const MONTH_LIKE = /^[A-Za-z0-9]{3}$/;

function splitLead(lead: string): { date: FuzzyDate | null; description: string } {
  const tokens = lead.split(/\s+/).filter(Boolean);
  let date: FuzzyDate | null = null;
  let start = 0;
  // the date may be split by OCR ("30 Jun26", "08) un26") or carry a stray
  // leading glyph ("C080¢:t26"), so also try joining it with the next token
  search: for (let i = 0; i < Math.min(3, tokens.length); i++) {
    for (const take of [1, 2]) {
      const token = tokens.slice(i, i + take).join("");
      if (take === 2 && (tokens.length < i + 2 || token.length > 11)) continue;
      const d = parseFuzzyDate(token) ?? (token.length > 6 ? parseFuzzyDate(token.slice(1)) : null);
      if (d) {
        date = d;
        start = i + take;
        break search;
      }
    }
  }
  let rest = tokens.slice(start);
  if (!date) {
    // an unreadable date still occupies the first slot(s): digits, junk, or a month fragment
    while (
      rest.length > 1 &&
      (JUNK_TOKEN.test(rest[0]) || /\d/.test(rest[0]) || rest[0].length <= 2 || (MONTH_LIKE.test(rest[0]) && parseFuzzyDate(`01${rest[0]}26`)))
    )
      rest = rest.slice(1);
  }
  rest = rest.filter((t) => !JUNK_TOKEN.test(t));
  // figures from an adjacent amount column occasionally bleed into the lead cell
  while (rest.length > 1 && /[\d%?][.,]|[.,]\d/.test(rest[rest.length - 1])) rest.pop();
  while (rest.length > 1 && /^[^A-Za-z0-9]*[A-Za-z]?[^A-Za-z0-9]*$/.test(rest[rest.length - 1])) rest.pop();
  return { date, description: cleanNarration(rest) };
}

const toIso = (d: FuzzyDate) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** Keeps the largest chronologically ordered subset of dates; the rest are OCR misreads. */
function repairDates(dates: (string | null)[], fallback: string | null): { iso: string; estimated: boolean }[] {
  const idx = dates.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  // longest non-decreasing subsequence over the readable dates
  const len: number[] = [], prev: number[] = [];
  for (let a = 0; a < idx.length; a++) {
    len[a] = 1;
    prev[a] = -1;
    for (let b = 0; b < a; b++) {
      if (dates[idx[b]]! <= dates[idx[a]]! && len[b] + 1 > len[a]) {
        len[a] = len[b] + 1;
        prev[a] = b;
      }
    }
  }
  const keep = new Set<number>();
  let end = len.length ? len.indexOf(Math.max(...len)) : -1;
  while (end >= 0) {
    keep.add(idx[end]);
    end = prev[end];
  }
  const out: { iso: string; estimated: boolean }[] = [];
  for (let i = 0; i < dates.length; i++) {
    if (keep.has(i)) {
      out.push({ iso: dates[i]!, estimated: false });
      continue;
    }
    let before: string | null = null, after: string | null = null;
    for (let k = i - 1; k >= 0 && !before; k--) if (keep.has(k)) before = dates[k];
    for (let k = i + 1; k < dates.length && !after; k++) if (keep.has(k)) after = dates[k];
    out.push({ iso: before ?? after ?? fallback ?? "1970-01-01", estimated: true });
  }
  return out;
}

const cents = (v: number) => Math.round(v * 100);

interface ParsedRow {
  row: TableRow;
  page: number;
  isTotal: boolean;
  description: string;
  date: FuzzyDate | null;
  balance: FuzzyAmount | null;
  debit: FuzzyAmount | null;
  credit: FuzzyAmount | null;
  /** All independent OCR readings of the balance / amount cells. */
  balances: FuzzyAmount[];
  amounts: FuzzyAmount[];
}

const readAll = (texts: string[] | undefined) =>
  (texts ?? []).map(parseFuzzyAmount).filter((a): a is FuzzyAmount => a !== null);

function extractMeta(pages: ScannedPage[]): StatementMeta {
  const text = pages.flatMap((p) => p.pageLines.map((l) => l.text)).join("\n");
  const meta: StatementMeta = { bank: /sampath/i.test(text) ? "Sampath Bank PLC" : undefined };
  if (/LKR/.test(text)) meta.currency = "LKR";
  const acct = /(\d[\d ]{9,14}\d)\s+LKR/.exec(text) ?? /ACCOUNT\s*N[O0][^\n\d]*(\d{8,14})/i.exec(text);
  if (acct) meta.accountNo = acct[1].replace(/\s/g, "");
  const period = /(\d{2})\W?(\d{2})\W?(\d{4})\s*t[o0]\s*(\d{2})\W?(\d{2})\W?(\d{4})/i.exec(text);
  if (period) {
    meta.periodFrom = `${period[3]}-${period[2]}-${period[1]}`;
    meta.periodTo = `${period[6]}-${period[5]}-${period[4]}`;
  }
  return meta;
}

/**
 * Turns OCR'd table rows into transactions. Every row must satisfy
 * previous balance − debit + credit = balance, so misread digits are
 * corrected by choosing, row by row, the balance that agrees best with
 * the OCR'd balance, the OCR'd amount and the next row's figures.
 */
export function parseScannedStatement(
  pages: ScannedPage[],
  sourceFile: string
): { transactions: Transaction[]; meta: StatementMeta; quality: ReadQuality } {
  const meta = extractMeta(pages);
  const rows: ParsedRow[] = [];
  for (const p of pages) {
    for (const table of p.tables) {
      for (const row of table.rows) {
        const isTotal = isTotalLabel(row.lead);
        const { date, description } = splitLead(row.lead);
        rows.push({
          row,
          page: p.page,
          isTotal,
          description,
          date,
          balance: row.cells.balance ? parseFuzzyAmount(row.cells.balance) : null,
          debit: row.cells.debit ? parseFuzzyAmount(row.cells.debit) : null,
          credit: row.cells.credit ? parseFuzzyAmount(row.cells.credit) : null,
          balances: readAll(row.readings?.balance ?? (row.cells.balance ? [row.cells.balance] : [])),
          amounts: readAll(
            row.readings?.debit ?? row.readings?.credit ?? (row.cells.debit ?? row.cells.credit ? [row.cells.debit ?? row.cells.credit!] : [])
          ),
        });
      }
    }
  }

  const body = rows.filter((r) => !r.isTotal && (r.balance || r.debit || r.credit));
  const totals = rows.filter((r) => r.isTotal);

  // ---- balance chain (Viterbi over candidate balances) ----
  const deltaFromAmount = (r: ParsedRow): number | null => {
    if (r.debit?.value != null) return -cents(r.debit.value);
    if (r.credit?.value != null) return cents(r.credit.value);
    return null;
  };
  // Overdrawn (Dr) balances are rare; if the statement never prints one, a
  // negative running balance is almost certainly a wrong path.
  const everOverdrawn = body.some((r) => r.balance?.suffix === "Dr");
  /** How badly a balance disagrees with what OCR read in the balance cell. */
  const nodeMemo = body.map(() => new Map<number, number>());
  const nodeCost = (i: number, c: number) => {
    const memo = nodeMemo[i].get(c);
    if (memo !== undefined) return memo;
    const r = body[i];
    const dr = r.balances.some((b) => b.suffix === "Dr");
    const signPenalty = c < 0 ? (dr ? 0 : everOverdrawn ? 1 : 2) : dr && r.balances.every((b) => b.suffix === "Dr") ? 1 : 0;
    // slightly below 1 per digit: when a balance and an amount disagree
    // equally, trust the (shorter) amount cell
    const v = r.balances.length
      ? 0.9 * Math.min(...r.balances.map((b) => amountDistance(Math.abs(c) / 100, b.pattern))) + signPenalty
      : 0.8 + signPenalty;
    nodeMemo[i].set(c, v);
    return v;
  };
  const readAmounts = body.flatMap((r) => r.amounts.map((a) => a.value).filter((v): v is number => v !== null));
  readAmounts.sort((a, b) => a - b);
  const typicalAmount = Math.max(1, cents(readAmounts[readAmounts.length >> 1] ?? 1000));
  /** How badly a balance change disagrees with the row's debit/credit cell. */
  const transMemo = body.map(() => new Map<number, number>());
  const transCost = (i: number, prev: number, c: number) => {
    const delta = c - prev;
    const memo = transMemo[i].get(delta);
    if (memo !== undefined) return memo;
    const r = body[i];
    let v: number;
    // The amount cell may simply have been missed. A weak preference for
    // smaller moves keeps such rows from accepting phantom transactions as
    // readily as real ones (and lets the beam rank neighbours sensibly).
    if (!r.amounts.length) v = delta === 0 ? 0 : 1.5 + 0.3 * Math.min(1, Math.abs(delta) / typicalAmount);
    else if (delta === 0) v = 3;
    else
      v =
        Math.min(...r.amounts.map((a) => amountDistance(Math.abs(delta) / 100, a.pattern))) +
        ((delta < 0) !== Boolean(r.debit) ? 1 : 0);
    transMemo[i].set(delta, v);
    return v;
  };
  const scoreAgainst = (i: number, c: number, prev: number | null) =>
    nodeCost(i, c) + (prev === null ? 0 : transCost(i, prev, c));

  // Candidate balances per row: what OCR read, plus values implied by
  // neighbouring rows' balances and amounts (propagated a few rows each way).
  const n = body.length;
  // Seed each row with what OCR read in its balance cell, plus every value
  // one OCR slip away; neighbouring rows then decide which one is right.
  const seeds: number[][] = body.map((r) => {
    const values = new Set<number>();
    for (const b of r.balances) {
      const sign = b.suffix === "Dr" ? -1 : 1;
      for (const v of [...expandPattern(b.pattern), ...nearbyValues(b.pattern)]) values.add(sign * v);
    }
    return [...values];
  });
  // Possible balance changes for a row: the OCR'd amount, or — when a digit
  // or two were unreadable — every way of filling them in.
  const steps = body.map((r): number[] => {
    if (!r.amounts.length) return [0];
    const sign = r.debit ? -1 : 1;
    const values: number[] = [];
    for (const amt of r.amounts) {
      values.push(...expandPattern(amt.pattern));
      // an unreadable glyph is often a split one: also try it as a spurious extra digit
      if ((amt.pattern.match(/[?!]/g) ?? []).length === 1) {
        for (let i = 0; i < amt.pattern.length; i++) values.push(...expandPattern(amt.pattern.slice(0, i) + amt.pattern.slice(i + 1)));
      }
      // A shaky reading (doubtful glyph, or no balance on the row to check it
      // against) may also hide a plain digit slip: propose those too.
      const likely = amt.pattern.replace(/!/g, "1");
      if (!likely.includes("?") && (likely !== amt.pattern || !r.balances.length)) values.push(...nearbyValues(likely));
    }
    return [...new Set(values)].map((v) => sign * v);
  });

  // Forward–backward beam search. Each round proposes balances implied by
  // the neighbours' surviving candidates, then keeps those on the cheapest
  // complete paths: cost so far plus cost to go (taken from the previous
  // round's backward pass). Without the look-ahead, a row with unreadable
  // digits yields dozens of equally good fills and the true one can be
  // pruned before the next row's printed balance confirms it.
  const BEAM = 40;
  const best = (m: Map<number, number>, k: number) =>
    [...m.entries()].sort((a, b) => a[1] - b[1]).slice(0, k).map(([c]) => c);
  let keep: number[][] = seeds.map(() => []);
  let fwd: Map<number, number>[] = [];
  let toGo: Map<number, number>[] = body.map(() => new Map());
  for (let round = 0; round < 3; round++) {
    fwd = [];
    for (let i = 0; i < n; i++) {
      const f = new Map<number, number>();
      const relax = (c: number, v: number) => {
        if (v < (f.get(c) ?? Infinity)) f.set(c, v);
      };
      // forward-generated candidates: cost is known from their source
      if (i > 0) {
        for (const [p, fp] of fwd[i - 1]) for (const d of steps[i]) relax(p + d, fp + transCost(i, p, p + d) + nodeCost(i, p + d));
      }
      // seeds, backward-generated and carried-over candidates: best of the
      // strongest predecessors (the final Viterbi pass is exact)
      const others = new Set([...seeds[i], ...keep[i]]);
      if (i < n - 1) {
        const strongestNext = [...toGo[i + 1].entries()].sort((a, b) => a[1] - b[1]).slice(0, 12).map(([c]) => c);
        for (const nx of strongestNext.length ? strongestNext : keep[i + 1].slice(0, 12)) {
          for (const d of steps[i + 1]) others.add(nx - d);
        }
      }
      if (i === 0 && !others.size) others.add(0);
      const strongestPrev = i > 0 ? [...fwd[i - 1].entries()].sort((a, b) => a[1] - b[1]).slice(0, 10) : [];
      for (const c of others) {
        let v = 0;
        if (i > 0) {
          v = Infinity;
          for (const [p, fp] of strongestPrev) v = Math.min(v, fp + transCost(i, p, c));
        }
        relax(c, v + nodeCost(i, c));
      }
      if (!f.size && i > 0) for (const [p, fp] of fwd[i - 1]) relax(p, fp + transCost(i, p, p) + nodeCost(i, p));
      // look-ahead from the previous round's cost-to-go of the next row,
      // evaluated for the most promising candidates only
      const next = i < n - 1 ? toGo[i + 1] : null;
      const ranked = new Map<number, number>();
      const shortlist = f.size > 240 ? [...f.entries()].sort((a, b) => a[1] - b[1]).slice(0, 240) : [...f.entries()];
      for (const [c, v] of shortlist) {
        let h = 0;
        if (next && next.size) {
          h = Infinity;
          for (const [nx, g] of next) h = Math.min(h, transCost(i + 1, c, nx) + nodeCost(i + 1, nx) + g);
        }
        ranked.set(c, v + h);
      }
      keep[i] = best(ranked, BEAM);
      fwd.push(new Map(keep[i].map((c) => [c, f.get(c)!])));
    }
    // backward pass: exact cost to go over the surviving candidates
    toGo = body.map(() => new Map());
    for (let i = n - 1; i >= 0; i--) {
      for (const c of keep[i]) {
        let g = 0;
        if (i < n - 1) {
          g = Infinity;
          for (const [nx, gn] of toGo[i + 1]) g = Math.min(g, transCost(i + 1, c, nx) + nodeCost(i + 1, nx) + gn);
        }
        toGo[i].set(c, g);
      }
    }
  }

  // ---- best path, checked against the printed totals ----
  const options = keep;
  const viterbi = () => {
    const cost: number[][] = [];
    const back: number[][] = [];
    for (let i = 0; i < n; i++) {
      cost.push([]);
      back.push([]);
      options[i].forEach((c, k) => {
        const own = nodeCost(i, c);
        if (i === 0) {
          cost[i][k] = own;
          back[i][k] = -1;
          return;
        }
        let best = Infinity, arg = 0;
        options[i - 1].forEach((p, j) => {
          const total = cost[i - 1][j] + transCost(i, p, c);
          if (total < best) [best, arg] = [total, j];
        });
        cost[i][k] = own + best;
        back[i][k] = arg;
      });
    }
    const path = new Array<number>(n);
    if (n) {
      let k = cost[n - 1].indexOf(Math.min(...cost[n - 1]));
      for (let i = n - 1; i >= 0; i--) {
        path[i] = options[i][k];
        k = back[i][k];
      }
    }
    return path;
  };
  const sums = (path: number[]) => {
    let debit = 0, credit = 0;
    for (let i = 0; i < n; i++) {
      const d = i === 0 ? deltaFromAmount(body[0]) ?? 0 : path[i] - path[i - 1];
      if (d < 0) debit -= d;
      else credit += d;
    }
    return { debit, credit };
  };
  const printed = totals[totals.length - 1];
  const agreesWithTotals = (debit: number, credit: number): ReadQuality["totals"] => {
    if (!printed || (!printed.debit && !printed.credit)) return "unknown";
    // Agreement up to unreadable glyphs (each costs < 1) is a match. The
    // printed Total line is OCR'd too, so if one total agrees exactly a
    // single misread digit in the other is tolerated.
    const dD = printed.debit ? amountDistance(debit / 100, printed.debit.pattern) : 0;
    const dC = printed.credit ? amountDistance(credit / 100, printed.credit.pattern) : 0;
    const exact = (d: number) => d < 1;
    return (exact(dD) && exact(dC)) ||
      (exact(dD) && dC < 1.5 && printed.debit) ||
      (exact(dC) && dD < 1.5 && printed.credit)
      ? "match"
      : "mismatch";
  };

  // When a lost cell and a misread digit cancel out locally, the cheapest
  // path invents an offsetting pair of phantom transactions — and the printed
  // totals expose it. Search short windows of rows (balances on either side
  // held fixed) for the cheapest re-reading that makes the totals agree.
  let B = viterbi();
  if (printed && n > 1 && agreesWithTotals(sums(B).debit, sums(B).credit) === "mismatch") {
    const segCost = (path: number[], from: number, to: number) => {
      let c = 0;
      for (let i = from; i <= Math.min(to, n - 1); i++) c += nodeCost(i, path[i]) + (i ? transCost(i, path[i - 1], path[i]) : 0);
      return c;
    };
    const baseSums = sums(B);
    const exactDebit = printed.debit?.value != null ? cents(printed.debit.value) : null;
    const exactCredit = printed.credit?.value != null ? cents(printed.credit.value) : null;
    const rowDelta = (path: number[], i: number) => (i === 0 ? deltaFromAmount(body[0]) ?? 0 : path[i] - path[i - 1]);
    let best: { path: number[]; extra: number } | null = null;
    for (let len = 1; len <= 3 && !best; len++) {
      for (let i = 1; i + len - 1 < n; i++) {
        const j = i + len - 1;
        const last = Math.min(j + 1, n - 1);
        const base = segCost(B, i, last);
        // debit/credit sums with rows i..last removed; trials add them back
        let restD = baseSums.debit, restC = baseSums.credit;
        for (let k = i; k <= last; k++) {
          const d = rowDelta(B, k);
          if (d < 0) restD += d;
          else restC -= d;
        }
        const trial = [...B];
        const walk = (k: number) => {
          if (k > j) {
            let debit = restD, credit = restC;
            for (let q = i; q <= last; q++) {
              const d = rowDelta(trial, q);
              if (d < 0) debit -= d;
              else credit += d;
            }
            // cheap exact test first: a match needs at least one total spot on
            // whenever that printed total was fully readable
            if (exactDebit !== null && exactCredit !== null && debit !== exactDebit && credit !== exactCredit) return;
            if (agreesWithTotals(debit, credit) !== "match") return;
            const extra = segCost(trial, i, last) - base;
            if (!best || extra < best.extra) best = { path: [...trial], extra };
            return;
          }
          for (const c of options[k]) {
            trial[k] = c;
            walk(k + 1);
          }
          trial[k] = B[k];
        };
        walk(i);
      }
    }
    if (best) B = (best as { path: number[] }).path;
  }

  // ---- dates ----
  // the printed statement period is read reliably and bounds every row date
  const inPeriod = (iso: string) =>
    (!meta.periodFrom || iso >= meta.periodFrom) && (!meta.periodTo || iso <= meta.periodTo);
  const fallback = meta.periodFrom ?? null;
  const fixedDates = repairDates(
    body.map((r) => (r.date && inPeriod(toIso(r.date)) ? toIso(r.date) : null)),
    fallback
  );

  const transactions: Transaction[] = [];
  let verified = 0, corrected = 0, uncertain = 0;
  let sumDebit = 0, sumCredit = 0;
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    const prevBal = i > 0 ? B[i - 1] : null;
    let delta: number;
    if (prevBal === null) {
      // first row: opening balance, unless it carries an amount
      const d = deltaFromAmount(r);
      if (d === null) continue;
      delta = d;
    } else {
      delta = B[i] - prevBal;
    }
    if (delta === 0) continue; // opening, B/F and C/F rows only restate the balance

    const ownScore = scoreAgainst(i, B[i], prevBal);
    const confidence: Transaction["confidence"] = ownScore === 0 ? "verified" : ownScore <= 2 ? "corrected" : "review";
    if (confidence === "verified") verified++;
    else if (confidence === "corrected") corrected++;
    else uncertain++;

    const debit = delta < 0 ? -delta / 100 : null;
    const credit = delta > 0 ? delta / 100 : null;
    if (debit) sumDebit += -delta;
    if (credit) sumCredit += delta;
    const description = r.description || "(unreadable)";
    const date = fixedDates[i];
    transactions.push({
      id: `ocr_${sourceFile}_${r.page}_${i}_${B[i]}`,
      date: date.iso,
      description,
      debit,
      credit,
      balance: B[i] / 100,
      type: credit !== null ? "credit" : "debit",
      category: categorize(description),
      sourceFile,
      sourcePage: r.page,
      order: r.page * 100000 + i,
      raw: [r.row.lead, r.row.cells.debit, r.row.cells.credit, r.row.cells.balance].filter(Boolean).join(" | "),
      confidence,
      dateEstimated: date.estimated,
    });
  }

  // ---- printed totals cross-check ----
  const totalsCheck = agreesWithTotals(sumDebit, sumCredit);

  return {
    transactions,
    meta,
    quality: { verified, corrected, review: uncertain, totals: totalsCheck, totalDebit: sumDebit / 100, totalCredit: sumCredit / 100 },
  };
}

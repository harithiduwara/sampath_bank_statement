import type { PdfLine } from "./pdf";
import type { StatementMeta, Transaction } from "./types";
import { categorize } from "./categorize";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const DATE_TOKEN = /^(\d{1,2})([A-Za-z]{3})(\d{2}|\d{4})$/;
const LEADING_DATE = /^(\d{1,2}[A-Za-z]{3}(?:\d{4}|\d{2}))\b/;
const AMOUNT_TOKEN = /^-?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})(Cr|Dr)?$/i;
const HEADER_ROW = /DATE/i;
const TOTAL_ROW = /^total\s*:?/i;

function parseDateToken(tok: string): string | null {
  const m = DATE_TOKEN.exec(tok);
  if (!m) return null;
  const [, dd, mon, yy] = m;
  const monthNum = MONTHS[mon.toLowerCase()];
  if (!monthNum) return null;
  const year = yy.length === 2 ? `20${yy}` : yy;
  const day = dd.padStart(2, "0");
  return `${year}-${monthNum}-${day}`;
}

function parseAmount(tok: string): { value: number; suffix: "Cr" | "Dr" | null } | null {
  const m = AMOUNT_TOKEN.exec(tok);
  if (!m) return null;
  const value = parseFloat(tok.replace(/,/g, "").replace(/Cr|Dr/i, ""));
  const suffix = m[3] ? ((m[3][0].toUpperCase() + m[3][1].toLowerCase()) as "Cr" | "Dr") : null;
  return { value, suffix };
}

interface ColumnMap {
  debitX: number | null;
  creditX: number | null;
}

function detectColumns(line: PdfLine): ColumnMap | null {
  if (!HEADER_ROW.test(line.text)) return null;
  let debitX: number | null = null;
  let creditX: number | null = null;
  for (const w of line.words) {
    if (/^debits?$/i.test(w.text)) debitX = w.x;
    if (/^credits?$/i.test(w.text)) creditX = w.x;
  }
  if (debitX === null && creditX === null) return null;
  return { debitX, creditX };
}

function hash(parts: (string | number | null)[]): string {
  const s = parts.join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `t_${(h >>> 0).toString(36)}_${s.length}`;
}

export interface ParseResult {
  transactions: Transaction[];
  meta: StatementMeta;
}

/**
 * Parses Sampath Bank-style statement lines (and similar DATE / PARTICULARS /
 * DEBITS / CREDITS / BALANCE table layouts). Falls back to balance-delta
 * inference for the debit/credit split when column positions can't be
 * determined, so the parser degrades gracefully on other bank formats that
 * still print a running balance.
 */
export function parseStatementLines(
  lines: PdfLine[],
  sourceFile: string,
  sourcePage: number
): ParseResult {
  const transactions: Transaction[] = [];
  const meta: StatementMeta = { bank: "Sampath Bank PLC", currency: "LKR" };

  let columns: ColumnMap | null = null;
  let prevBalance: number | null = null;
  let tableEnded = false;
  let rowIndex = 0;

  const accountMatch = lines.find((l) => /ACCOUNT NO/i.test(l.text));
  if (accountMatch) {
    const m = /(\d{6,})/.exec(accountMatch.text);
    if (m) meta.accountNo = m[1];
  }
  const periodMatch = lines.find((l) => /FOR THE PERIOD/i.test(l.text));
  if (periodMatch) {
    const m = /(\d{2}-\d{2}-\d{4})\s*to\s*(\d{2}-\d{2}-\d{4})/i.exec(periodMatch.text);
    if (m) {
      meta.periodFrom = m[1].split("-").reverse().join("-");
      meta.periodTo = m[2].split("-").reverse().join("-");
    }
  }

  for (const line of lines) {
    const cols = detectColumns(line);
    if (cols) {
      columns = cols;
      continue;
    }
    if (TOTAL_ROW.test(line.text)) {
      tableEnded = true;
      continue;
    }
    if (tableEnded) continue;

    const words = line.words;
    if (words.length === 0) continue;

    // A PDF text run can bundle "date + description" into a single item
    // (e.g. "01Jul26 KIRULAPO CACHQ"), so detect the date from the line's
    // full text rather than assuming it's an isolated word.
    const dateMatch = LEADING_DATE.exec(line.text);
    if (!dateMatch) continue; // not a transaction row (page footer, etc.)
    const dateIso = parseDateToken(dateMatch[1]);
    if (!dateIso) continue;

    // Collect trailing numeric word-items (up to 2: amount, balance).
    const numerics: { x: number; amount: ReturnType<typeof parseAmount> }[] = [];
    let cursor = words.length - 1;
    while (cursor >= 0 && numerics.length < 2) {
      const amount = parseAmount(words[cursor].text);
      if (!amount) break;
      numerics.unshift({ x: words[cursor].x, amount });
      cursor--;
    }
    if (numerics.length === 0) continue; // malformed row, skip defensively

    const descWords = words.slice(0, cursor + 1);
    let description = descWords.map((w) => w.text).join(" ").trim();
    if (description.startsWith(dateMatch[1])) {
      description = description.slice(dateMatch[1].length).trim();
    }

    const balanceTok = numerics[numerics.length - 1];
    const balance = balanceTok.amount!.value * (balanceTok.amount!.suffix === "Dr" ? -1 : 1);

    let debit: number | null = null;
    let credit: number | null = null;

    if (numerics.length === 2) {
      const amtTok = numerics[0];
      const amtValue = amtTok.amount!.value;
      if (columns && (columns.debitX !== null || columns.creditX !== null)) {
        const distToDebit = columns.debitX !== null ? Math.abs(amtTok.x - columns.debitX) : Infinity;
        const distToCredit = columns.creditX !== null ? Math.abs(amtTok.x - columns.creditX) : Infinity;
        if (distToDebit <= distToCredit) debit = amtValue;
        else credit = amtValue;
      } else if (prevBalance !== null) {
        // Fallback: infer direction from how the balance moved.
        if (balance >= prevBalance) credit = amtValue;
        else debit = amtValue;
      } else {
        credit = amtValue; // best-effort default
      }
    } else if (prevBalance !== null) {
      // No explicit amount column captured (rare) - derive from balance delta.
      const delta = Math.round((balance - prevBalance) * 100) / 100;
      if (delta > 0) credit = delta;
      else if (delta < 0) debit = -delta;
    }

    const isOpeningOrCarry = /^(c\/f|b\/f)?$/i.test(description) && debit === null && credit === null;

    const txn: Transaction = {
      id: "",
      date: dateIso,
      description: isOpeningOrCarry
        ? prevBalance === null
          ? "Opening Balance"
          : "Closing Balance (C/F)"
        : description || "(no description)",
      debit,
      credit,
      balance,
      type: credit !== null ? "credit" : "debit",
      category: isOpeningOrCarry ? "Balance" : categorize(description),
      sourceFile,
      sourcePage,
      order: sourcePage * 100000 + rowIndex,
      raw: line.text,
    };
    txn.id = hash([txn.date, txn.description, txn.debit, txn.credit, txn.balance, sourceFile]);
    rowIndex += 1;

    if (!isOpeningOrCarry) {
      transactions.push(txn);
    }
    prevBalance = balance;
  }

  return { transactions, meta };
}

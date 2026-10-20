export type TxnType = "debit" | "credit";

export interface Transaction {
  /** Stable hash used for de-duplication across uploaded statements */
  id: string;
  date: string; // ISO yyyy-mm-dd
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  type: TxnType;
  category: string;
  sourceFile: string;
  sourcePage: number;
  /** Position within the source document, for stable same-date ordering. */
  order: number;
  raw: string;
  /** OCR'd rows only: whether the figures were confirmed by the running balance. */
  confidence?: "verified" | "corrected" | "review";
  dateEstimated?: boolean;
}

export interface ReadQuality {
  verified: number;
  corrected: number;
  review: number;
  /** Whether our debit/credit sums equal the statement's printed "Total" line. */
  totals: "match" | "mismatch" | "unknown";
  totalDebit: number;
  totalCredit: number;
}

export interface StatementMeta {
  accountNo?: string;
  accountName?: string;
  currency?: string;
  periodFrom?: string;
  periodTo?: string;
  bank?: string;
}

export interface ProcessedFile {
  id: string;
  name: string;
  size: number;
  status: "queued" | "unlocking" | "reading" | "ocr" | "parsing" | "done" | "error" | "needs-pin";
  message?: string;
  pagesTotal?: number;
  pagesOcr?: number;
  txnCount?: number;
  meta?: StatementMeta;
  usedOcr: boolean;
  quality?: ReadQuality;
}

export interface AnalysisBucket {
  key: string;
  label: string;
  income: number;
  expense: number;
  net: number;
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
  pctOfExpense: number;
}

export interface Insight {
  id: string;
  tone: "positive" | "warning" | "neutral" | "critical";
  title: string;
  detail: string;
}

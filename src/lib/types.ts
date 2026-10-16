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

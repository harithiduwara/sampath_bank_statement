import { useCallback, useMemo, useRef, useState } from "react";
import UploadZone from "./components/UploadZone";
import ProcessingLog from "./components/ProcessingLog";
import PinModal from "./components/PinModal";
import TransactionsTable from "./components/TransactionsTable";
import Dashboard from "./components/Dashboard";
import InsightsPanel from "./components/InsightsPanel";
import { processFile } from "./lib/pipeline";
import { mergeAndDedupe } from "./lib/dedupe";
import { buildInsights, buildSummary, categoryBreakdown, monthlyBuckets } from "./lib/analysis";
import { buildWorkbook, downloadWorkbook, safeFileName } from "./lib/excelRuntime";
import type { ProcessedFile, StatementMeta, Transaction } from "./lib/types";

interface PinRequest {
  fileName: string;
  attempt: number;
  resolve: (pin: string | null) => void;
}

export default function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [batches, setBatches] = useState<Record<string, Transaction[]>>({});
  const [meta, setMeta] = useState<StatementMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinRequest, setPinRequest] = useState<PinRequest | null>(null);

  const knownPassword = useRef<string | null>(null);

  const { transactions: txns, duplicates } = useMemo(
    () => mergeAndDedupe(Object.entries(batches).map(([source, transactions]) => ({ source, transactions }))),
    [batches]
  );
  const buckets = useMemo(() => monthlyBuckets(txns), [txns]);
  const categories = useMemo(() => categoryBreakdown(txns), [txns]);
  const summary = useMemo(() => buildSummary(txns, buckets), [txns, buckets]);
  const insights = useMemo(() => buildInsights(txns, buckets, categories, summary), [txns, buckets, categories, summary]);

  const askForPassword = useCallback(
    (fileName: string) =>
      (attempt: number) =>
        new Promise<string | null>((resolve) => {
          setPinRequest({ fileName, attempt, resolve });
        }),
    []
  );

  const handleFiles = useCallback(async (incoming: File[]) => {
    setBusy(true);
    for (const file of incoming) {
      const id = `${file.name}_${file.size}_${file.lastModified}`;
      setFiles((prev) => [...prev.filter((f) => f.id !== id), { id, name: file.name, size: file.size, status: "queued", usedOcr: false }]);

      const update = (patch: Partial<ProcessedFile>) =>
        setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch, id } : f)));
      let result;
      try {
        result = await processFile(file, knownPassword.current, {
          onUpdate: update,
          askForPassword: askForPassword(file.name),
        });
      } catch {
        // A malformed file must not stall the rest of the batch.
        update({ status: "error", message: "Could not read this file" });
        continue;
      }

      if (result.passwordUsed) knownPassword.current = result.passwordUsed;
      if (result.transactions.length > 0) {
        setBatches((prev) => ({ ...prev, [id]: result.transactions }));
      }
      if (result.meta) setMeta((prev) => prev ?? result.meta);
    }
    setBusy(false);
  }, [askForPassword]);

  const resolvePin = useCallback(
    (pin: string | null) => {
      pinRequest?.resolve(pin);
      setPinRequest(null);
    },
    [pinRequest]
  );

  const handleExport = useCallback(() => {
    const wb = buildWorkbook(txns, buckets, categories, summary);
    void downloadWorkbook(wb, safeFileName(meta?.accountNo ?? "bank-statement"));
  }, [txns, buckets, categories, summary, meta]);

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <Header txnCount={txns.length} onExport={handleExport} />

      <UploadZone onFiles={handleFiles} busy={busy} />

      <ProcessingLog files={files} duplicates={duplicates} />

      {meta && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-white/10 bg-ink-900/40 px-4 py-3 text-xs text-white/50">
          {meta.bank && <span><strong className="text-white/70">{meta.bank}</strong></span>}
          {meta.accountNo && <span>Account: {meta.accountNo}</span>}
          {meta.periodFrom && meta.periodTo && <span>Period: {meta.periodFrom} → {meta.periodTo}</span>}
          {meta.currency && <span>Currency: {meta.currency}</span>}
        </div>
      )}

      <Dashboard txns={txns} buckets={buckets} categories={categories} summary={summary} />
      <InsightsPanel insights={insights} />
      <TransactionsTable txns={txns} />

      {files.length === 0 && (
        <EmptyState />
      )}

      <Footer />

      {pinRequest && (
        <PinModal fileName={pinRequest.fileName} attempt={pinRequest.attempt} onSubmit={resolvePin} />
      )}
    </div>
  );
}

function Header({ txnCount, onExport }: { txnCount: number; onExport: () => void }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Statement Studio</p>
        <h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Bank Statement Analyzer</h1>
        <p className="mt-1 max-w-xl text-sm text-white/50">
          Unlock, OCR, merge and visualize your bank statements — entirely in your browser.
        </p>
      </div>
      <button
        onClick={onExport}
        disabled={txnCount === 0}
        className="inline-flex items-center gap-2 self-start rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-30 sm:self-auto"
      >
        <DownloadIcon />
        Download Excel
      </button>
    </header>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-white/40">
      Upload one or more statements above to see unlocking, OCR, deduplication and analysis in action.
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-4 border-t border-white/5 pt-5 text-center text-xs text-white/30">
      Processing happens 100% client-side — PDFs, PINs and images never leave your device.
    </footer>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v11M12 15l-4-4M12 15l4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

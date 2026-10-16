import { AnimatePresence, motion } from "framer-motion";
import type { ProcessedFile } from "../lib/types";

const STATUS_LABEL: Record<ProcessedFile["status"], string> = {
  queued: "Queued",
  unlocking: "Checking for lock…",
  "needs-pin": "Waiting for PIN",
  reading: "Reading pages…",
  ocr: "Running OCR…",
  parsing: "Parsing transactions…",
  done: "Done",
  error: "Failed",
};

export default function ProcessingLog({ files }: { files: ProcessedFile[] }) {
  if (files.length === 0) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4">
      <h3 className="mb-3 text-sm font-semibold text-white/70">Processing queue</h3>
      <ul className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {files.map((f) => (
            <motion.li
              key={f.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between gap-3 rounded-xl bg-ink-950/60 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white/90">{f.name}</p>
                <p className="text-xs text-white/50">
                  {STATUS_LABEL[f.status]}
                  {f.message ? ` — ${f.message}` : ""}
                  {f.usedOcr ? " · OCR used" : ""}
                  {typeof f.txnCount === "number" ? ` · ${f.txnCount} transactions` : ""}
                </p>
              </div>
              <StatusDot status={f.status} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function StatusDot({ status }: { status: ProcessedFile["status"] }) {
  if (status === "done") {
    return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-credit-500" />;
  }
  if (status === "error") {
    return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-debit-500" />;
  }
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400/60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gold-400" />
    </span>
  );
}

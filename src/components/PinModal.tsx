import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface PinModalProps {
  fileName: string;
  attempt: number;
  onSubmit: (pin: string | null) => void;
}

export default function PinModal({ fileName, attempt, onSubmit }: PinModalProps) {
  const [pin, setPin] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 backdrop-blur-sm px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-modal-title"
      >
        <motion.form
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 300, damping: 26 }}
          className="w-full max-w-sm rounded-2xl border border-white/10 bg-ink-900 p-6 shadow-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            if (pin.trim()) onSubmit(pin.trim());
          }}
        >
          <div className="mb-1 flex items-center gap-2 text-brand-300">
            <LockIcon />
            <h2 id="pin-modal-title" className="text-sm font-semibold uppercase tracking-wide">
              Statement locked
            </h2>
          </div>
          <p className="mb-4 text-sm text-white/60">
            <span className="font-medium text-white/80">{fileName}</span> is password protected. Enter the PDF
            PIN to unlock it — it stays in this browser tab and is reused automatically for any other files
            that need the same PIN.
          </p>
          {attempt > 0 && (
            <p className="mb-3 rounded-lg bg-debit-500/10 px-3 py-2 text-xs font-medium text-debit-500">
              That PIN didn't work. Please try again.
            </p>
          )}
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PDF PIN / password"
            className="mb-4 w-full rounded-xl border border-white/10 bg-ink-950 px-4 py-3 text-base tracking-widest text-white outline-none ring-brand-400/60 placeholder:text-white/30 focus:ring-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onSubmit(null)}
              className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm font-medium text-white/70 transition hover:bg-white/5"
            >
              Skip file
            </button>
            <button
              type="submit"
              disabled={!pin.trim()}
              className="flex-1 rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Unlock
            </button>
          </div>
        </motion.form>
      </motion.div>
    </AnimatePresence>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="11" width="16" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

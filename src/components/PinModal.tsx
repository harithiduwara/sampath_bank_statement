import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { LIMITS } from "../lib/limits";
import { Button, fieldClass } from "./ui";

interface PinModalProps {
  fileName: string;
  attempt: number;
  onSubmit: (pin: string | null) => void;
}

/** Asks for a locked PDF's PIN. The PIN is kept in memory and reused for the next locked files. */
export default function PinModal({ fileName, attempt, onSubmit }: PinModalProps) {
  const [pin, setPin] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSubmit(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSubmit]);

  const left = LIMITS.maxPinAttempts - attempt;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4" role="dialog" aria-modal="true" aria-labelledby="pin-title" aria-describedby="pin-desc">
      <motion.form
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-pop"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.trim()) onSubmit(pin.trim());
        }}
      >
        <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-accent">
          <Lock size={18} aria-hidden="true" />
        </div>
        <h2 id="pin-title" className="text-base font-semibold text-ink">
          Enter the statement PIN
        </h2>
        <p id="pin-desc" className="mt-1 text-sm text-ink-3">
          <span className="font-medium text-ink-2">{fileName}</span> is password protected. The PIN stays in this tab and
          unlocks any other statements that use it.
        </p>
        {attempt > 0 && (
          <p role="alert" className="mt-3 rounded-lg bg-crit-soft px-3 py-2 text-xs font-medium text-crit">
            That PIN didn't work. {left} attempt{left === 1 ? "" : "s"} left.
          </p>
        )}
        <label htmlFor="pin-input" className="mt-4 block text-xs font-medium text-ink-3">
          PIN or password
        </label>
        <input
          id="pin-input"
          ref={inputRef}
          type="password"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          className={`${fieldClass} mt-1 w-full tracking-widest`}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => onSubmit(null)}>Skip this file</Button>
          <Button type="submit" variant="primary" disabled={!pin.trim()}>
            Unlock
          </Button>
        </div>
      </motion.form>
    </div>
  );
}

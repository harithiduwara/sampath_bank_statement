import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";

interface UploadZoneProps {
  onFiles: (files: File[]) => void;
  busy: boolean;
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/*";

export default function UploadZone({ onFiles, busy }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [onFiles]
  );

  return (
    <motion.div
      layout
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      role="button"
      tabIndex={0}
      aria-label="Upload bank statement files"
      className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-8 py-14 text-center transition-colors ${
        dragging ? "border-brand-400 bg-brand-500/10" : "border-white/15 hover:border-white/30"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="mb-4 rounded-2xl bg-brand-500/15 p-4 text-brand-300 transition group-hover:scale-105">
        <UploadIcon />
      </div>
      <p className="mb-1 text-lg font-semibold text-white">
        {dragging ? "Drop to upload" : "Drag & drop bank statements"}
      </p>
      <p className="max-w-md text-sm text-white/50">
        PDF (locked or unlocked) or scanned images. Everything is read and unlocked locally in your browser —
        nothing is uploaded to a server.
      </p>
      <span className="mt-5 rounded-full border border-white/15 px-4 py-2 text-xs font-medium text-white/70">
        {busy ? "Processing…" : "Browse files"}
      </span>
    </motion.div>
  );
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

import { useState } from "react";
import clsx from "clsx";
import { FileText, FileUp, Image as ImageIcon, KeyRound, Loader2, Trash2 } from "lucide-react";
import { LIMITS } from "../lib/limits";
import { bytes, date, plural } from "../lib/format";
import type { ProcessedFile } from "../lib/types";
import { useWorkspace } from "../state/store";
import { Badge, Button, Card, EmptyState, PageHeader, Status, td, th } from "../components/ui";

const STEP: Record<ProcessedFile["status"], string> = {
  queued: "Queued",
  unlocking: "Opening",
  "needs-pin": "Waiting for PIN",
  reading: "Reading pages",
  ocr: "Reading scan (OCR)",
  parsing: "Reconciling",
  done: "Done",
  error: "Failed",
};

export default function StatementsView({ onUpload }: { onUpload: () => void }) {
  const ws = useWorkspace();
  const [confirmClear, setConfirmClear] = useState(false);
  const files = ws.state.files;
  const label = (id: string) => ws.accounts.find((a) => a.key === ws.fileAccount[id]);
  const recon = (id: string) => ws.recons.find((r) => r.fileId === id);

  return (
    <>
      <PageHeader
        title="Statements"
        description="Every uploaded statement, which account it belongs to and how well it was read. Duplicate rows across statements are ignored automatically."
        actions={
          files.length > 0 &&
          (confirmClear ? (
            <>
              <span className="text-sm text-ink-2">Remove all statements, edits and the PIN?</span>
              <Button variant="danger" onClick={() => (ws.actions.clear(), setConfirmClear(false))}>
                Yes, clear session
              </Button>
              <Button variant="ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} disabled={ws.busy} onClick={() => setConfirmClear(true)}>
              Clear session
            </Button>
          ))
        }
      />

      <button
        type="button"
        onClick={onUpload}
        className="no-print mb-5 flex w-full items-center gap-4 rounded-xl border-2 border-dashed border-line-strong bg-surface px-5 py-5 text-left transition-colors hover:border-accent hover:bg-accent-soft/40"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <FileUp size={19} aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink">Add statements: drop files anywhere or click to browse</span>
          <span className="block text-xs text-ink-3">
            PDF (locked or not), PNG, JPEG, WEBP · max {LIMITS.maxFileBytes / 1024 / 1024} MB and {LIMITS.maxPages} pages per file · several accounts at once is fine
          </span>
        </span>
      </button>

      <Card title="Uploaded statements" subtitle={files.length ? plural(files.length, "file") : undefined} bodyClassName="p-0">
        {files.length === 0 ? (
          <EmptyState icon={<FileText size={22} aria-hidden="true" />} title="No statements yet">
            Uploaded statements appear here with their status.
          </EmptyState>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[980px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th scope="col" className={th}>File</th>
                  <th scope="col" className={th}>Account</th>
                  <th scope="col" className={th}>Period</th>
                  <th scope="col" className={clsx(th, "text-right")}>Rows</th>
                  <th scope="col" className={clsx(th, "text-right")}>Duplicates</th>
                  <th scope="col" className={th}>Read quality</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {files.map((f) => {
                  const acct = label(f.id);
                  const r = recon(f.id);
                  const working = !["done", "error"].includes(f.status);
                  const dup = ws.duplicates[f.id] ?? 0;
                  const isImage = /\.(png|jpe?g|webp)$/i.test(f.name);
                  return (
                    <tr key={f.id} className="hover:bg-surface-2">
                      <td className={td}>
                        <div className="flex items-center gap-2.5">
                          {isImage ? <ImageIcon size={16} className="shrink-0 text-ink-3" aria-hidden="true" /> : <FileText size={16} className="shrink-0 text-ink-3" aria-hidden="true" />}
                          <div className="min-w-0">
                            <p className="max-w-[16rem] truncate font-medium text-ink" title={f.name}>{f.name}</p>
                            <p className="text-xs text-ink-3">
                              {bytes(f.size)}
                              {f.pagesTotal ? ` · ${plural(f.pagesTotal, "page")}` : ""}
                              {f.usedOcr ? " · scanned" : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className={td}>
                        {acct ? (
                          <div>
                            <p className="text-ink" title={acct.accountNo}>{acct.label}</p>
                            {acct.inferredFileIds.includes(f.id) && (
                              <Badge tone="info" title="No account number could be read; matched to the only account in this currency">Assumed</Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                      <td className={clsx(td, "whitespace-nowrap text-ink-2")}>{r?.from ? `${date(r.from)} – ${date(r.to)}` : "—"}</td>
                      <td className={clsx(td, "num text-right text-ink")}>{f.txnCount ?? "—"}</td>
                      <td className={clsx(td, "num text-right")}>
                        {dup > 0 ? (
                          <span className="text-ink-2" title="Already in another uploaded statement, so ignored">
                            {dup} ignored
                          </span>
                        ) : (
                          <span className="text-ink-3">{f.status === "done" ? "0" : "—"}</span>
                        )}
                      </td>
                      <td className={td}>
                        {f.quality ? (
                          <div className="flex flex-wrap gap-1">
                            <Badge tone="good">{f.quality.verified} confirmed</Badge>
                            {f.quality.corrected > 0 && <Badge tone="warn">{f.quality.corrected} corrected</Badge>}
                            {f.quality.review > 0 && <Badge tone="crit">{f.quality.review} to check</Badge>}
                            {f.quality.totals === "match" && <Badge tone="good">Totals match</Badge>}
                            {f.quality.totals === "mismatch" && <Badge tone="crit">Totals differ</Badge>}
                          </div>
                        ) : f.status === "done" ? (
                          <span className="text-xs text-ink-3">Text PDF: exact</span>
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                      </td>
                      <td className={td}>
                        {working ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-ink-2" aria-live="polite">
                            {f.status === "needs-pin" ? <KeyRound size={14} className="text-warn" aria-hidden="true" /> : <Loader2 size={14} className="animate-spin text-accent" aria-hidden="true" />}
                            {f.message ?? STEP[f.status]}
                          </span>
                        ) : f.status === "error" ? (
                          <Status tone="crit" title={f.message}>{f.message ?? "Failed"}</Status>
                        ) : (
                          <Status tone={r?.status === "issues" ? "warn" : "good"}>{r?.status === "issues" ? "Read · check reconciliation" : "Read"}</Status>
                        )}
                      </td>
                      <td className={clsx(td, "text-right")}>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={working}
                          onClick={() => ws.actions.removeFile(f.id)}
                          aria-label={`Remove ${f.name}`}
                          icon={<Trash2 size={14} aria-hidden="true" />}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-4 text-sm text-ink-3 md:grid-cols-3">
        <p>
          <span className="font-medium text-ink-2">Locked PDFs.</span> You're asked for the PIN once; it's tried on every other locked statement and forgotten when you clear the session.
          After {LIMITS.maxPinAttempts} wrong tries a file is skipped.
        </p>
        <p>
          <span className="font-medium text-ink-2">Scans and photos.</span> Each figure is checked against the running balance and the printed totals. Rows that couldn't be confirmed are flagged in the ledger.
        </p>
        <p>
          <span className="font-medium text-ink-2">Nothing is stored.</span> Closing or reloading the tab discards everything. Export to Excel to keep your work.
        </p>
      </div>
    </>
  );
}

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  BookOpenCheck,
  FileSpreadsheet,
  FileStack,
  FileText,
  LayoutDashboard,
  Loader2,
  Menu,
  Monitor,
  Moon,
  Scale,
  ShieldCheck,
  Sun,
  Upload,
  X,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "./state/store";
import { useRoute, useTheme, type ThemePref, type ViewId } from "./state/ui";
import { needsReview } from "./lib/accounting";
import { exportWorkbook } from "./lib/excelRuntime";
import { ACCEPT } from "./lib/limits";
import { Button } from "./components/ui";
import PeriodPicker from "./components/PeriodPicker";
import PinModal from "./components/PinModal";
import ErrorBoundary from "./components/ErrorBoundary";
import OverviewView from "./views/OverviewView";

// Less-visited views load on first visit.
const LedgerView = lazy(() => import("./views/LedgerView"));
const ReconciliationView = lazy(() => import("./views/ReconciliationView"));
const ReportsView = lazy(() => import("./views/ReportsView"));
const StatementsView = lazy(() => import("./views/StatementsView"));


export default function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}

const NAV: { id: ViewId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "ledger", label: "Ledger", icon: BookOpenCheck },
  { id: "reconciliation", label: "Reconciliation", icon: Scale },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "statements", label: "Statements", icon: FileStack },
];

function Shell() {
  const ws = useWorkspace();
  const { view, params, go } = useRoute();
  const theme = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);

  // Move focus to the page on navigation so keyboard and screen-reader users land in the content.
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [view]);

  // Files can be dropped anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => hasFiles(e) && (depth++, setDragging(true));
    const leave = (e: DragEvent) => hasFiles(e) && --depth <= 0 && (depth = 0, setDragging(false));
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) {
        void ws.actions.addFiles(files);
        go("statements");
      }
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [ws.actions, go]);

  const upload = () => fileInput.current?.click();
  const hasData = ws.ledger.length > 0;
  const reviewCount = ws.ledger.filter(needsReview).length;
  const reconIssues = ws.recons.filter((r) => r.status === "issues").length + ws.continuity.length;
  const processing = ws.state.files.filter((f) => !["done", "error"].includes(f.status)).length;
  const badges: Partial<Record<ViewId, { n: number; tone: "warn" | "crit" | "info" }>> = {
    ledger: reviewCount ? { n: reviewCount, tone: "warn" } : undefined,
    reconciliation: reconIssues ? { n: reconIssues, tone: "crit" } : undefined,
    statements: processing ? { n: processing, tone: "info" } : undefined,
  };

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col bg-side text-side-ink">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <div className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-ink">
          <FileSpreadsheet size={16} aria-hidden="true" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">Statement Studio</p>
          <p className="text-[11px] text-side-ink-2">Bank accounting workspace</p>
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-0.5 px-3">
        {NAV.map(({ id, label, icon: Icon }) => {
          const b = badges[id];
          const active = view === id;
          return (
            <li key={id}>
              <a
                href={`#/${id}`}
                aria-current={active ? "page" : undefined}
                onClick={() => setNavOpen(false)}
                className={clsx(
                  "flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                  active ? "bg-side-2 font-medium text-white" : "text-side-ink-2 hover:bg-side-2/60 hover:text-side-ink"
                )}
              >
                <Icon size={17} aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {b && (
                  <span
                    className={clsx(
                      "rounded-full px-1.5 text-[11px] font-semibold leading-5",
                      b.tone === "crit" ? "bg-[#f97066]/20 text-[#fda29b]" : b.tone === "warn" ? "bg-[#fdb022]/20 text-[#fec84b]" : "bg-[#53b1fd]/20 text-[#84caff]"
                    )}
                  >
                    {b.n}
                    <span className="sr-only">{b.tone === "info" ? " processing" : b.tone === "warn" ? " to review" : " issues"}</span>
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto space-y-3 px-5 pb-5">
        <div className="rounded-lg border border-white/10 bg-side-2/50 p-3 text-[11px] leading-relaxed text-side-ink-2">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-side-ink">
            <ShieldCheck size={13} aria-hidden="true" /> Private by design
          </p>
          Statements, PINs and edits stay in this browser tab. Nothing is uploaded or stored.
        </div>
        <ThemeSwitch value={theme.pref} onChange={theme.setPref} />
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>

      {/* Sidebar: fixed on desktop, drawer on mobile */}
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-60 lg:block">{sidebar}</aside>
      {navOpen && (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setNavOpen(false)} aria-hidden="true" />
          <aside className="relative h-full w-64 shadow-pop">
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              className="absolute right-3 top-3.5 rounded-md p-1.5 text-side-ink-2 hover:bg-side-2"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      {/* Top bar: one scope for every view */}
      <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
          <button
            type="button"
            className="-ml-1 rounded-md p-2 text-ink-2 hover:bg-surface-3 lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={18} />
          </button>
          {hasData ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {ws.scopeOptions.length > 1 ? (
                <label className="flex min-w-0 items-center">
                  <span className="sr-only">Account</span>
                  <select
                    value={ws.state.scope}
                    onChange={(e) => ws.actions.setScope(e.target.value)}
                    className="h-9 max-w-[16rem] truncate rounded-lg border border-line-strong bg-surface px-3 pr-8 text-sm font-medium text-ink shadow-card outline-none focus:border-accent"
                  >
                    {ws.scopeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="truncate rounded-lg bg-surface-3 px-3 py-2 text-sm font-medium text-ink" title={ws.scopeAccounts[0]?.accountNo}>
                  {ws.scopeAccounts[0]?.label || "Account"} · {ws.currency}
                </span>
              )}
              <PeriodPicker />
            </div>
          ) : (
            <p className="flex-1 text-sm text-ink-3">Upload bank statements to begin</p>
          )}

          <div className="flex items-center gap-2">
            {processing > 0 && (
              <a href="#/statements" className="hidden items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-ink-2 hover:bg-surface-3 sm:inline-flex" aria-live="polite">
                <Loader2 size={14} className="animate-spin text-accent" aria-hidden="true" />
                Processing {processing} file{processing === 1 ? "" : "s"}
              </a>
            )}
            <Button variant="secondary" icon={<Upload size={15} aria-hidden="true" />} onClick={upload}>
              <span className="hidden sm:inline">Upload</span>
              <span className="sr-only sm:hidden">Upload statements</span>
            </Button>
            <Button
              variant="primary"
              disabled={!hasData}
              icon={<FileSpreadsheet size={15} aria-hidden="true" />}
              onClick={() => void exportWorkbook(ws)}
              title="Excel workbook of the selected account and period"
            >
              <span className="hidden sm:inline">Export</span>
              <span className="sr-only sm:hidden">Export to Excel</span>
            </Button>
          </div>
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) {
            void ws.actions.addFiles(files);
            if (view !== "statements" && hasData) return;
            go("statements");
          }
        }}
      />

      <main id="main" ref={main} tabIndex={-1} className="mx-auto max-w-[1440px] px-4 py-6 outline-none sm:px-6 lg:py-8">
        <ErrorBoundary resetKey={view}>
        <Suspense fallback={<div className="grid h-64 place-items-center text-ink-3"><Loader2 className="animate-spin" size={20} aria-label="Loading" /></div>}>
        {view === "overview" && <OverviewView onUpload={upload} />}
        {view === "ledger" && <LedgerView params={params} onUpload={upload} />}
        {view === "reconciliation" && <ReconciliationView onUpload={upload} />}
        {view === "reports" && <ReportsView onUpload={upload} />}
        {view === "statements" && <StatementsView onUpload={upload} />}
        </Suspense>
        </ErrorBoundary>
      </main>

      {dragging && (
        <div className="no-print pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-accent/10 p-6 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-surface px-10 py-8 text-center shadow-pop">
            <Upload className="mx-auto mb-2 text-accent" size={28} aria-hidden="true" />
            <p className="text-base font-semibold text-ink">Drop statements to add them</p>
            <p className="mt-1 text-sm text-ink-3">PDF (locked or unlocked), PNG, JPEG or WEBP</p>
          </div>
        </div>
      )}

      {ws.state.pin && <PinModal key={`${ws.state.pin.fileName}-${ws.state.pin.attempt}`} fileName={ws.state.pin.fileName} attempt={ws.state.pin.attempt} onSubmit={ws.actions.resolvePin} />}
    </div>
  );
}

function ThemeSwitch({ value, onChange }: { value: ThemePref; onChange: (v: ThemePref) => void }) {
  const opts: { v: ThemePref; label: string; icon: typeof Sun }[] = [
    { v: "light", label: "Light", icon: Sun },
    { v: "dark", label: "Dark", icon: Moon },
    { v: "system", label: "System", icon: Monitor },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 rounded-lg bg-side-2/70 p-0.5">
      {opts.map(({ v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={clsx(
            "flex h-7 items-center justify-center gap-1 rounded-md text-[11px] transition-colors",
            value === v ? "bg-white/10 text-white" : "text-side-ink-2 hover:text-side-ink"
          )}
        >
          <Icon size={12} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

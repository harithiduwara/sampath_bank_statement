import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import {
  applyOverride,
  continuityIssues,
  dataRange,
  fileIdOfUid,
  narrationKey,
  previousPeriod,
  reconcileStatement,
  resolveAccounts,
  resolvePeriod,
  uidOf,
  type Account,
  type ContinuityIssue,
  type LedgerTxn,
  type Override,
  type Period,
  type PresetId,
  type StatementRecon,
} from "../lib/accounting";
import { mergeAndDedupe } from "../lib/dedupe";
import type { ProcessedFile, Transaction } from "../lib/types";

/* ------------------------------------------------------------------ state */

interface PinRequest {
  fileName: string;
  attempt: number;
  resolve: (pin: string | null) => void;
}

interface State {
  files: ProcessedFile[];
  batches: Record<string, Transaction[]>;
  overrides: Record<string, Override>;
  /** Category chosen for every row with the same narration. */
  rules: Record<string, string>;
  scope: string; // "all" | "all:<currency>" | account key
  preset: PresetId;
  custom: Period | null;
  pin: PinRequest | null;
}

type Action =
  | { type: "file"; id: string; patch: Partial<ProcessedFile> & { name?: string } }
  | { type: "batch"; id: string; rows: Transaction[] }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "override"; uids: string[]; patch: Override }
  | { type: "rule"; key: string; category: string | null }
  | { type: "scope"; scope: string }
  | { type: "period"; preset: PresetId; custom?: Period | null }
  | { type: "pin"; pin: PinRequest | null };

const initial: State = { files: [], batches: {}, overrides: {}, rules: {}, scope: "all", preset: "all", custom: null, pin: null };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "file": {
      const exists = s.files.some((f) => f.id === a.id);
      const files = exists
        ? s.files.map((f) => (f.id === a.id ? { ...f, ...a.patch, id: a.id } : f))
        : [...s.files, { name: "", size: 0, status: "queued" as const, usedOcr: false, ...a.patch, id: a.id }];
      return { ...s, files };
    }
    case "batch":
      return { ...s, batches: { ...s.batches, [a.id]: a.rows } };
    case "remove": {
      const { [a.id]: _gone, ...batches } = s.batches;
      const overrides = Object.fromEntries(Object.entries(s.overrides).filter(([uid]) => fileIdOfUid(uid) !== a.id));
      return { ...s, files: s.files.filter((f) => f.id !== a.id), batches, overrides };
    }
    case "clear":
      return { ...initial };
    case "override": {
      const stamp = new Date().toISOString();
      const overrides = { ...s.overrides };
      for (const uid of a.uids) {
        const prev = overrides[uid] ?? {};
        overrides[uid] = { ...prev, ...a.patch, edits: a.patch.edits ? { ...prev.edits, ...a.patch.edits } : prev.edits, updatedAt: stamp };
      }
      return { ...s, overrides };
    }
    case "rule": {
      const rules = { ...s.rules };
      if (a.category) rules[a.key] = a.category;
      else delete rules[a.key];
      return { ...s, rules };
    }
    case "scope":
      return { ...s, scope: a.scope };
    case "period":
      return { ...s, preset: a.preset, custom: a.custom ?? s.custom };
    case "pin":
      return { ...s, pin: a.pin };
  }
}

/* ---------------------------------------------------------------- derived */

export interface ScopeOption {
  value: string;
  label: string;
}

export interface Workspace {
  state: State;
  busy: boolean;
  accounts: Account[];
  fileAccount: Record<string, string>;
  scopeOptions: ScopeOption[];
  /** Accounts the current scope covers (one currency). */
  scopeAccounts: Account[];
  scopeLabel: string;
  currency: string;
  /** Every ledger row in scope (all dates). */
  ledger: LedgerTxn[];
  /** Ledger rows in scope and in the selected period. */
  rows: LedgerTxn[];
  range: Period | null;
  period: Period | null;
  previous: Period | null;
  duplicates: Record<string, number>;
  recons: StatementRecon[];
  continuity: ContinuityIssue[];
  categories: string[];
  /** Everything uploaded in another currency than the current scope. */
  hiddenCurrencies: string[];
  actions: {
    addFiles: (files: File[]) => Promise<void>;
    removeFile: (id: string) => void;
    clear: () => void;
    setScope: (scope: string) => void;
    setPeriod: (preset: PresetId, custom?: Period | null) => void;
    override: (uids: string[], patch: Override) => void;
    categorizeSimilar: (description: string, category: string) => void;
    resolvePin: (pin: string | null) => void;
  };
}

const Ctx = createContext<Workspace | null>(null);

export function useWorkspace(): Workspace {
  const ws = useContext(Ctx);
  if (!ws) throw new Error("useWorkspace outside WorkspaceProvider");
  return ws;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const knownPassword = useRef<string | null>(null);
  const queue = useRef(Promise.resolve());

  /* ------------------------------------------------------------- actions */

  const askForPassword = useCallback(
    (fileName: string) => (attempt: number) =>
      new Promise<string | null>((resolve) => dispatch({ type: "pin", pin: { fileName, attempt, resolve } })),
    []
  );

  const processOne = useCallback(
    async (file: File) => {
      const id = `${file.name}_${file.size}_${file.lastModified}`;
      dispatch({ type: "file", id, patch: { name: file.name, size: file.size, status: "queued", message: undefined, usedOcr: false } });
      const update = (patch: Partial<ProcessedFile>) => dispatch({ type: "file", id, patch });
      try {
        // pdf.js and the OCR engine load on first upload, not with the page.
        const { processFile } = await import("../lib/pipeline");
        const result = await processFile(file, knownPassword.current, { onUpdate: update, askForPassword: askForPassword(file.name) });
        if (result.passwordUsed) knownPassword.current = result.passwordUsed;
        // Row ids are made unique per upload so edits and keys never collide.
        dispatch({ type: "batch", id, rows: result.transactions.map((t) => ({ ...t, id: uidOf(id, t.order) })) });
      } catch {
        update({ status: "error", message: "Could not read this file" });
      }
    },
    [askForPassword]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      // One queue for the whole session, so files dropped while others are
      // still processing wait their turn (and share the PIN prompt).
      for (const f of files) {
        const id = `${f.name}_${f.size}_${f.lastModified}`;
        dispatch({ type: "file", id, patch: { name: f.name, size: f.size, status: "queued", message: undefined, usedOcr: false } });
      }
      queue.current = files.reduce((p, f) => p.then(() => processOne(f)), queue.current);
      return queue.current;
    },
    [processOne]
  );

  const actions = useMemo<Workspace["actions"]>(
    () => ({
      addFiles,
      removeFile: (id) => dispatch({ type: "remove", id }),
      clear: () => {
        knownPassword.current = null;
        dispatch({ type: "clear" });
      },
      setScope: (scope) => dispatch({ type: "scope", scope }),
      setPeriod: (preset, custom) => dispatch({ type: "period", preset, custom }),
      override: (uids, patch) => dispatch({ type: "override", uids, patch }),
      categorizeSimilar: (description, category) => dispatch({ type: "rule", key: narrationKey(description), category }),
      resolvePin: (pin) => {
        state.pin?.resolve(pin);
        dispatch({ type: "pin", pin: null });
      },
    }),
    [addFiles, state.pin]
  );

  /* ------------------------------------------------------------- derived */

  const { accounts, fileAccount } = useMemo(
    () => resolveAccounts(state.files.filter((f) => state.batches[f.id]).map((f) => ({ id: f.id, name: f.name, meta: f.meta, usedOcr: f.usedOcr }))),
    [state.files, state.batches]
  );

  const accountByKey = useMemo(() => new Map(accounts.map((a) => [a.key, a])), [accounts]);

  const ctxOf = useCallback(
    (fileId: string) => {
      const key = fileAccount[fileId] ?? `file:${fileId}`;
      return { fileId, accountKey: key, currency: accountByKey.get(key)?.currency ?? "LKR" };
    },
    [fileAccount, accountByKey]
  );

  const merged = useMemo(
    () => mergeAndDedupe(state.files.filter((f) => state.batches[f.id]).map((f) => ({ source: f.id, transactions: state.batches[f.id] }))),
    [state.files, state.batches]
  );

  const ledgerAll = useMemo(() => {
    const rows = merged.transactions.map((t, i) => ({ t: applyOverride(t, ctxOf(fileIdOfUid(t.id)), state.overrides[t.id], state.rules), i }));
    // An edited date can move a row; otherwise keep the merged order.
    rows.sort((a, b) => (a.t.date !== b.t.date ? (a.t.date < b.t.date ? -1 : 1) : a.i - b.i));
    return rows.map((r) => r.t);
  }, [merged, ctxOf, state.overrides, state.rules]);

  const currencies = useMemo(() => [...new Set(accounts.map((a) => a.currency))], [accounts]);

  const scopeOptions = useMemo<ScopeOption[]>(() => {
    const opts: ScopeOption[] =
      currencies.length <= 1
        ? [{ value: "all", label: accounts.length > 1 ? `All accounts (${accounts.length})` : "All accounts" }]
        : currencies.map((c) => ({ value: `all:${c}`, label: `All ${c} accounts` }));
    if (accounts.length > 1 || currencies.length > 1) opts.push(...accounts.map((a) => ({ value: a.key, label: `${a.label} · ${a.currency}` })));
    return opts;
  }, [accounts, currencies]);

  // Fall back to a valid scope when accounts change (e.g. a file was removed).
  const scope = scopeOptions.some((o) => o.value === state.scope) ? state.scope : scopeOptions[0]?.value ?? "all";

  const scopeAccounts = useMemo(() => {
    if (scope === "all") return accounts;
    if (scope.startsWith("all:")) return accounts.filter((a) => a.currency === scope.slice(4));
    return accounts.filter((a) => a.key === scope);
  }, [scope, accounts]);

  const scopeKeys = useMemo(() => new Set(scopeAccounts.map((a) => a.key)), [scopeAccounts]);
  const ledger = useMemo(() => ledgerAll.filter((t) => scopeKeys.has(t.accountKey)), [ledgerAll, scopeKeys]);
  const range = useMemo(() => dataRange(ledger), [ledger]);
  const period = useMemo(() => resolvePeriod(state.preset, range, state.custom ?? undefined), [state.preset, range, state.custom]);
  const rows = useMemo(() => (period ? ledger.filter((t) => t.date >= period.from && t.date <= period.to) : []), [ledger, period]);

  const recons = useMemo(
    () =>
      state.files
        .filter((f) => state.batches[f.id] && scopeKeys.has(fileAccount[f.id]))
        .map((f) => {
          const ctx = ctxOf(f.id);
          const rowsOfFile = state.batches[f.id].map((t) => applyOverride(t, ctx, state.overrides[t.id], state.rules));
          return reconcileStatement({ id: f.id, name: f.name, quality: f.quality }, ctx.accountKey, rowsOfFile);
        }),
    [state.files, state.batches, state.overrides, state.rules, scopeKeys, fileAccount, ctxOf]
  );

  const continuity = useMemo(() => continuityIssues(recons), [recons]);
  const categories = useMemo(() => [...new Set(ledgerAll.map((t) => t.category))].sort(), [ledgerAll]);

  const busy = state.files.some((f) => !["done", "error"].includes(f.status));

  // Nothing is stored, so warn before the tab is closed with work in it.
  useEffect(() => {
    if (state.files.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.files.length]);

  const currency = scopeAccounts[0]?.currency ?? "LKR";
  const ws: Workspace = {
    state: { ...state, scope },
    busy,
    accounts,
    fileAccount,
    scopeOptions,
    scopeAccounts,
    scopeLabel: scopeAccounts.length === 1 ? `${scopeAccounts[0].label} · ${scopeAccounts[0].currency}` : scopeOptions.find((o) => o.value === scope)?.label ?? "All accounts",
    currency,
    ledger,
    rows,
    range,
    period,
    previous: period ? previousPeriod(period) : null,
    duplicates: merged.duplicates,
    recons,
    continuity,
    categories,
    hiddenCurrencies: currencies.filter((c) => c !== currency),
    actions,
  };
  return <Ctx.Provider value={ws}>{children}</Ctx.Provider>;
}

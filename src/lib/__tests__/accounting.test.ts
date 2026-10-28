import { describe, expect, it } from "vitest";
import {
  applyOverride,
  cashflowSeries,
  cashflowStatement,
  categoryTotals,
  change,
  closingBalance,
  continuityIssues,
  dailyBalances,
  kpis,
  narrationKey,
  openingBalance,
  pickGranularity,
  previousPeriod,
  reconcileStatement,
  recurringItems,
  resolveAccounts,
  resolvePeriod,
} from "../accounting";
import { ledger, txn } from "./fixtures";

// Opening 1,000 -> +5,000 -> -2,000 -> -50 -> +1,000 = 4,950
const sept = () =>
  ledger([
    txn("2026-09-01", "CASH DEP", 5000, 6000),
    txn("2026-09-10", "CHQ 123", -2000, 4000),
    txn("2026-09-20", "S/CHG", -50, 3950),
    txn("2026-10-02", "VSRTFR", 1000, 4950),
  ]);

describe("accounts", () => {
  it("treats an OCR account number one digit off as the same account", () => {
    const { accounts, fileAccount } = resolveAccounts([
      { id: "scan", name: "scan.pdf", usedOcr: true, meta: { accountNo: "900123456789", currency: "LKR" } },
      { id: "pdf", name: "e.pdf", usedOcr: false, meta: { accountNo: "100123456789", currency: "LKR", bank: "Sampath Bank PLC" } },
    ]);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accountNo).toBe("100123456789");
    expect(fileAccount.scan).toBe(fileAccount.pdf);
  });
  it("keeps genuinely different accounts and currencies apart", () => {
    const { accounts } = resolveAccounts([
      { id: "a", name: "a", usedOcr: false, meta: { accountNo: "100123456789", currency: "LKR" } },
      { id: "b", name: "b", usedOcr: false, meta: { accountNo: "022822115565", currency: "LKR" } },
      { id: "c", name: "c", usedOcr: false, meta: { accountNo: "100123456789", currency: "USD" } },
    ]);
    expect(accounts).toHaveLength(3);
  });
  it("attaches a statement without a number to the only account, and says so", () => {
    const { accounts, fileAccount } = resolveAccounts([
      { id: "a", name: "a", usedOcr: false, meta: { accountNo: "100123456789" } },
      { id: "img", name: "photo.jpg", usedOcr: true, meta: {} },
    ]);
    expect(fileAccount.img).toBe(fileAccount.a);
    expect(accounts[0].inferredFileIds).toEqual(["img"]);
  });
  it("leaves an unnumbered statement on its own when the account is ambiguous", () => {
    const { accounts } = resolveAccounts([
      { id: "a", name: "a", usedOcr: false, meta: { accountNo: "100123456789" } },
      { id: "b", name: "b", usedOcr: false, meta: { accountNo: "022822115565" } },
      { id: "img", name: "photo.jpg", usedOcr: true },
    ]);
    expect(accounts.find((x) => x.key === "file:img")).toBeTruthy();
  });
});

describe("periods", () => {
  const range = { from: "2026-07-03", to: "2026-10-15" };
  it("anchors relative presets on the latest transaction, not today", () => {
    expect(resolvePeriod("latest-month", range)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(resolvePeriod("previous-month", range)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolvePeriod("latest-quarter", range)).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(resolvePeriod("ytd", range)).toEqual({ from: "2026-01-01", to: "2026-10-15" });
  });
  it("swaps a custom range entered backwards", () => {
    expect(resolvePeriod("custom", range, { from: "2026-09-30", to: "2026-09-01" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("compares whole months with the previous whole months", () => {
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod({ from: "2026-01-01", to: "2026-03-31" })).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(previousPeriod({ from: "2026-03-05", to: "2026-03-14" })).toEqual({ from: "2026-02-23", to: "2026-03-04" });
  });
  it("chooses chart granularity by period length", () => {
    expect(pickGranularity({ from: "2026-09-01", to: "2026-09-30" })).toBe("day");
    expect(pickGranularity({ from: "2026-07-01", to: "2026-09-30" })).toBe("week");
    expect(pickGranularity({ from: "2026-01-01", to: "2026-12-31" })).toBe("month");
  });
});

describe("balances and KPIs", () => {
  it("derives opening and closing balances", () => {
    const all = sept();
    expect(openingBalance(all, { from: "2026-09-01", to: "2026-09-30" })).toBe(1000);
    expect(closingBalance(all, { from: "2026-09-01", to: "2026-09-30" })).toBe(3950);
    expect(openingBalance(all, { from: "2026-10-01", to: "2026-10-31" })).toBe(3950);
  });
  it("sums accounts in the consolidated view", () => {
    const all = [...sept(), ...ledger([txn("2026-09-05", "DEP", 100, 600)], "acct:2", "f2")].sort((a, b) => (a.date < b.date ? -1 : 1));
    expect(openingBalance(all, { from: "2026-09-01", to: "2026-09-30" })).toBe(1500);
    expect(closingBalance(all, { from: "2026-09-01", to: "2026-09-30" })).toBe(4550);
  });
  it("computes period KPIs", () => {
    const k = kpis(sept(), { from: "2026-09-01", to: "2026-09-30" });
    expect(k).toMatchObject({ opening: 1000, closing: 3950, receipts: 5000, payments: 2050, net: 2950, count: 3, overdraftDays: 0 });
    expect(k.lowest).toEqual({ date: "2026-09-20", balance: 3950 });
  });
  it("carries the balance into an empty period", () => {
    const k = kpis(sept(), { from: "2026-11-01", to: "2026-11-30" });
    expect(k).toMatchObject({ count: 0, opening: 4950, closing: 4950, receipts: 0, payments: 0 });
  });
  it("counts overdrawn days", () => {
    const all = ledger([txn("2026-09-01", "A", -1500, -500), txn("2026-09-04", "B", 1000, 500)]);
    expect(kpis(all, { from: "2026-09-01", to: "2026-09-04" }).overdraftDays).toBe(3);
  });
  it("forward-fills the daily balance", () => {
    const d = dailyBalances(sept(), { from: "2026-08-31", to: "2026-09-02" });
    expect(d.map((x) => x.balance)).toEqual([1000, 6000, 6000]);
  });
  it("returns null change when there is no base", () => {
    expect(change(10, 0)).toBeNull();
    expect(change(150, 100)).toBe(50);
  });
});

describe("cash flow", () => {
  it("buckets receipts and payments, including empty buckets", () => {
    const s = cashflowSeries(sept(), { from: "2026-09-01", to: "2026-10-31" }, "month");
    expect(s.map((b) => [b.key, b.receipts, b.payments])).toEqual([["2026-09", 5000, 2050], ["2026-10", 1000, 0]]);
  });
  it("builds a cash-flow statement whose columns roll forward", () => {
    const rows = sept().map((t) => ({ ...t, category: t.credit ? "Deposits" : "Cheques" }));
    const cf = cashflowStatement(rows, { from: "2026-09-01", to: "2026-10-31" });
    expect(cf.opening).toEqual([1000, 3950]);
    expect(cf.closing).toEqual([3950, 4950]);
    expect(cf.net).toEqual([2950, 1000]);
    cf.columns.forEach((_, i) => expect(cf.opening[i]! + cf.net[i]).toBeCloseTo(cf.closing[i]!));
    expect(cf.total).toMatchObject({ opening: 1000, closing: 4950, receipts: 6000, payments: 2050 });
  });
  it("totals categories with shares", () => {
    const rows = sept().map((t) => ({ ...t, category: t.description === "S/CHG" ? "Fees" : "Cheques" }));
    const c = categoryTotals(rows, "debit");
    expect(c[0]).toMatchObject({ category: "Cheques", total: 2000, count: 1 });
    expect(c[1].share).toBeCloseTo((50 / 2050) * 100);
  });
});

describe("recurring", () => {
  it("finds narrations repeated across three months at a similar amount", () => {
    const rows = ledger([
      txn("2026-07-05", "CEB BILL 001", -5000, null),
      txn("2026-08-05", "CEB BILL 002", -5200, null),
      txn("2026-09-05", "CEB BILL 003", -4900, null),
      txn("2026-09-07", "ONE OFF", -90000, null),
    ]);
    const r = recurringItems(rows);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ label: "CEB BILL", months: 3, direction: "out" });
  });
  it("normalises narrations", () => {
    expect(narrationKey("KIRULAPO CACHQ 19")).toBe(narrationKey("KIRULAPO  CACHQ-24"));
  });
});

describe("reconciliation", () => {
  const file = { id: "f1", name: "f1.pdf" };
  it("balances a clean statement", () => {
    const r = reconcileStatement(file, "acct:1", sept());
    expect(r).toMatchObject({ status: "balanced", opening: 1000, closing: 4950, expectedClosing: 4950, difference: 0, breaks: [] });
  });
  it("finds the row where the running balance breaks", () => {
    const rows = ledger([txn("2026-09-01", "A", 100, 1100), txn("2026-09-02", "B", -30, 1060), txn("2026-09-03", "C", -10, 1050)]);
    const r = reconcileStatement(file, "acct:1", rows);
    expect(r.status).toBe("issues");
    expect(r.breaks).toHaveLength(1);
    expect(r.breaks[0]).toMatchObject({ description: "B", expected: 1070, actual: 1060, difference: -10 });
  });
  it("re-balances after the user corrects the misread amount", () => {
    const raw = [txn("2026-09-01", "A", 100, 1100), txn("2026-09-02", "B", -30, 1060)];
    const rows = raw.map((t, i) =>
      applyOverride(t, { fileId: "f1", accountKey: "acct:1", currency: "LKR" }, i === 1 ? { edits: { debit: 40 } } : undefined, {})
    );
    expect(rows[1]).toMatchObject({ edited: true, original: { debit: 30 }, debit: 40 });
    expect(reconcileStatement(file, "acct:1", rows).status).toBe("balanced");
  });
  it("carries the expected balance across rows with no balance", () => {
    const rows = ledger([txn("2026-09-01", "A", 100, 1100), txn("2026-09-02", "B", -30, null), txn("2026-09-03", "C", -10, 1060)]);
    const r = reconcileStatement(file, "acct:1", rows);
    expect(r).toMatchObject({ status: "balanced", missingBalances: 1 });
  });
  it("flags a missing statement between two statements of one account", () => {
    const a = reconcileStatement({ id: "a", name: "aug.pdf" }, "acct:1", ledger([txn("2026-08-10", "X", 100, 1100)], "acct:1", "a"));
    const b = reconcileStatement({ id: "b", name: "oct.pdf" }, "acct:1", ledger([txn("2026-10-10", "Y", 100, 1500)], "acct:1", "b"));
    const issues = continuityIssues([b, a]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ fromName: "aug.pdf", toName: "oct.pdf", closing: 1100, nextOpening: 1400, difference: 300 });
  });
  it("compares with the statement that reaches furthest when statements overlap", () => {
    const long = reconcileStatement({ id: "a", name: "jun-sep.pdf" }, "acct:1", ledger([txn("2026-06-08", "X", 100, 100), txn("2026-09-18", "Y", 900, 1000)], "acct:1", "a"));
    const nested = reconcileStatement({ id: "b", name: "jul.pdf" }, "acct:1", ledger([txn("2026-07-01", "Z", 50, 150), txn("2026-07-03", "Z2", -10, 140)], "acct:1", "b"));
    const next = reconcileStatement({ id: "c", name: "sep-oct.pdf" }, "acct:1", ledger([txn("2026-09-22", "W", 10, 510)], "acct:1", "c"));
    const issues = continuityIssues([long, nested, next]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ fromName: "jun-sep.pdf", toName: "sep-oct.pdf", closing: 1000, nextOpening: 500, difference: -500 });
  });
  it("accepts consecutive statements whose balances carry over", () => {
    const a = reconcileStatement({ id: "a", name: "a" }, "acct:1", ledger([txn("2026-08-10", "X", 100, 1100)], "acct:1", "a"));
    const b = reconcileStatement({ id: "b", name: "b" }, "acct:1", ledger([txn("2026-09-10", "Y", 100, 1200)], "acct:1", "b"));
    expect(continuityIssues([a, b])).toEqual([]);
  });
});

describe("overrides", () => {
  it("treats undefined edits as 'keep the statement value'", () => {
    const t = txn("2026-09-01", "KIRULAPO CACHQ 19", -10, 1);
    const r = applyOverride(t, { fileId: "f1", accountKey: "a", currency: "LKR" }, { edits: { description: undefined, debit: undefined, note: undefined } as never, note: "n" }, {});
    expect(r).toMatchObject({ description: "KIRULAPO CACHQ 19", debit: 10, edited: false, note: "n" });
  });
  it("is not an edit when the value equals the statement", () => {
    const t = txn("2026-09-01", "X", -10, 1);
    expect(applyOverride(t, { fileId: "f1", accountKey: "a", currency: "LKR" }, { edits: { debit: 10 } }, {}).edited).toBe(false);
  });
  it("applies category rules to similar narrations and manual category wins", () => {
    const t = txn("2026-09-01", "KIRULAPO CACHQ 19", -10, 1);
    const ctx = { fileId: "f1", accountKey: "a", currency: "LKR" };
    const rules = { [narrationKey("KIRULAPO CACHQ 22")]: "Supplier payments" };
    expect(applyOverride(t, ctx, undefined, rules)).toMatchObject({ category: "Supplier payments", categorySource: "rule" });
    expect(applyOverride(t, ctx, { category: "Rent" }, rules)).toMatchObject({ category: "Rent", categorySource: "manual" });
  });
});

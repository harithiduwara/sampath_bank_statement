import { describe, expect, it } from "vitest";
import { mergeAndDedupe } from "../dedupe";
import type { Transaction } from "../types";
import { txn as t } from "./fixtures";

const run = (...bs: Transaction[][]) => mergeAndDedupe(bs.map((transactions, i) => ({ source: `s${i}`, transactions })));
const sept = () => [t("2026-09-01", "CASH DEP", 5000, 15000), t("2026-09-10", "CHQ 123", -2000, 13000), t("2026-09-20", "S/CHG", -50, 12950), t("2026-09-28", "VSRTFR", 1000, 13950)];

describe("duplicate transactions", () => {
  it("ignores a statement uploaded twice and reports the count", () => {
    const r = run(sept(), sept());
    expect(r.transactions).toHaveLength(4);
    expect(r.duplicates.s1).toBe(4);
  });
  it("keeps only the new rows of an overlapping statement", () => {
    const next = [t("2026-09-20", "S/CHG", -50, 12950), t("2026-09-28", "VSRTFR", 1000, 13950), t("2026-10-02", "ATM", -500, 13450)];
    expect(run(sept(), next).transactions).toHaveLength(5);
  });
  it("keeps genuine identical payments on the same day", () => {
    expect(run([t("2026-09-20", "S/CHG", -50, 1000), t("2026-09-20", "S/CHG", -50, 950)]).transactions).toHaveLength(2);
    expect(run([t("2026-09-20", "S/CHG", -50, null), t("2026-09-20", "S/CHG", -50, null)]).transactions).toHaveLength(2);
  });
  it("drops a row repeated across a page break", () => {
    expect(run([t("2026-09-20", "S/CHG", -50, 950), t("2026-09-20", "S/CHG", -50, 950)]).transactions).toHaveLength(1);
  });
  it("matches a scan against the e-statement and keeps the better copy", () => {
    const r = run([t("2026-09-10", "CHO l23", -2000, 13000, { confidence: "corrected" })], [t("2026-09-10", "CHQ 123", -2000, 13000)]);
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0].description).toBe("CHQ 123");
  });
  it("tolerates an estimated OCR date", () => {
    expect(run(sept(), [t("2026-09-12", "CHQ 123", -2000, 13000, { dateEstimated: true })]).transactions).toHaveLength(4);
  });
  it("does not merge different months, directions or descriptions without balance", () => {
    expect(run([t("2026-09-20", "LOAN", -500, 1000)], [t("2026-10-20", "LOAN", -500, 1000)]).transactions).toHaveLength(2);
    expect(run([t("2026-09-20", "X", -500, 1000)], [t("2026-09-20", "X", 500, 1000)]).transactions).toHaveLength(2);
    expect(run([t("2026-09-20", "POS KEELLS", -1500, null)], [t("2026-09-20", "POS KEELLS.", -1500, null)]).transactions).toHaveLength(1);
  });
});

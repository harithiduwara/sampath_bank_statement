import { describe, expect, it } from "vitest";
import { categorize } from "../categorize";

describe("Sampath narration categories", () => {
  it.each([
    ["KIRULAPO CHQBKCHG", "Fees & Charges"],
    ["KIRULAPO S/CHG", "Fees & Charges"],
    ["KIRULAPO INITIAL DEPOSIT", "Deposits"],
    ["CITY VSRTFR-John Doe", "Transfers"],
    ["KIRULAPO CACHQ 19", "Cheques"],
    ["MAHARAGA CASH", "Cash"],
    ["NSC J Doe Investment", "Loan / Investment"],
    ["", "Uncategorized"],
  ])("%s -> %s", (d, c) => expect(categorize(d)).toBe(c));
});

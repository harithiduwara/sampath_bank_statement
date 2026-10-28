interface Rule {
  category: string;
  pattern: RegExp;
}

// Ordered rules: first match wins. Tuned for common Sampath Bank narration
// codes (VSRTFR, CACHQ, SLIPS, CDM, POS, ATM...) plus generic keywords.
const RULES: Rule[] = [
  { category: "Salary / Payroll", pattern: /salary|payroll|epf|etf/i },
  { category: "Fees & Charges", pattern: /s\/chg|chqbkchg|\bchg\b|charge|\bfee|commission|sms alert|ledger fee/i },
  { category: "Deposits", pattern: /initial|deposit/i },
  { category: "Transfers", pattern: /vsrtfr|rtgs|ceftfr|slips|fund\s*transfer|neft|swift/i },
  { category: "Cash", pattern: /\bcash\b|cdm\b/i },
  { category: "Cheques", pattern: /cachq|trchq|cheque|chq\b/i },
  { category: "Utilities", pattern: /\bceb\b|electricity|water board|dialog|\bslt\b|mobitel|hutch|utility/i },
  { category: "Loan / Investment", pattern: /investmen|loan|lease|fd\s*int/i },
  { category: "Card / POS", pattern: /\bpos\b|card purchase|visa|master ?card/i },
  { category: "ATM Withdrawal", pattern: /\batm\b/i },
  { category: "Interest", pattern: /interest|\bint\.?\b/i },
];

export function categorize(description: string): string {
  const desc = description.trim();
  if (!desc) return "Uncategorized";
  for (const rule of RULES) {
    if (rule.pattern.test(desc)) return rule.category;
  }
  return "Other";
}

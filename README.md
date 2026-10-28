# Statement Studio — bank accounting workspace

A static, client-only accounting dashboard that turns PDF and photographed
bank statements into a reconciled, categorised ledger with cash-flow reports
and an Excel export — entirely in the browser. Built for GitHub Pages: there
is no backend, so nothing you upload ever leaves your device.

**Live app:** https://harithiduwara.github.io/sampath_bank_statement/

## Workspace

| View | What it's for |
|---|---|
| **Overview** | KPIs for the selected account and period (opening, receipts, payments, net cash flow, closing, lowest balance) with change vs. the previous period; cash-flow and balance charts (each with a table view); payments by category; analyst notes; largest and recurring transactions. |
| **Ledger** | Data grid with search (`/`), direction, category, status and amount filters; sorting; pagination; totals; bulk categorise / mark reviewed; a row drawer to correct figures, set a category (optionally for every similar narration), add notes and mark reviewed. Edits keep the statement's original values (audit trail). |
| **Reconciliation** | Per statement: opening + receipts − payments = closing, the exact rows where the running balance breaks, printed-totals check, and gaps between consecutive statements. Re-runs as you correct rows. |
| **Reports** | Direct-method cash-flow statement (months as columns), category analysis and monthly summary. Printable. |
| **Statements** | Upload queue, account matching, period, duplicates ignored, OCR read quality, remove a file, clear the session. |

The top bar sets one scope for every view: **account** (or all accounts in
one currency) and **period** (presets anchored on the latest statement date,
or a custom range). Export writes a workbook with Summary, Ledger, Cash flow,
Categories, Reconciliation and Statements sheets.

## How statements are read

1. **Unlock**: a PDF PIN is asked once and reused for every locked file (max 5 tries per file).
2. **Read**: text PDFs are parsed directly; scans and photos go through a column-aware OCR pipeline (Tesseract) whose figures are checked against the running balance and the printed totals.
3. **Accounts**: statements are grouped by account number; an OCR misread one digit off is merged, and a statement with no readable number joins the only account in its currency (marked "Assumed").
4. **Merge**: rows from overlapping statements are de-duplicated on date, amount, direction and balance; the better-read copy wins.
5. **Categorise**: rules tuned for Sampath narration codes (VSRTFR, CACHQ, S/CHG, CHQBKCHG…), overridable per row or per narration.

The accounting model (`src/lib/accounting.ts`) is pure and unit-tested.

## Tech stack

- [Vite](https://vite.dev/) + React + TypeScript, Tailwind CSS v4, Inter (self-hosted), lucide icons
- [`pdfjs-dist`](https://mozilla.github.io/pdf.js/) for PDF parsing/decryption, [`tesseract.js`](https://tesseract.projectnaptha.com/) for OCR (both lazy-loaded)
- [`chart.js`](https://www.chartjs.org/) for charts, [`write-excel-file`](https://www.npmjs.com/package/write-excel-file) for the workbook
- Vitest for tests

## Local development

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check + production build to dist/
npm run preview   # serve the production build locally
npm run lint
npm test          # unit tests (accounting, duplicates, categories)
```

## Deployment

`.github/workflows/deploy.yml` builds the app and publishes `dist/` to
GitHub Pages on every push to `main` (and the current default branch), after the unit tests pass. In the repository settings, set
**Settings → Pages → Source** to **GitHub Actions**. `vite.config.ts` sets
`base: '/sampath_bank_statement/'` to match the Pages project URL — update
it if the repository is renamed.

## Parser notes

The transaction parser is tuned against real Sampath Bank e-statement
exports (DATE / PARTICULARS / DEBITS / CREDITS / BALANCE table, dates like
`01Jul26`, balances suffixed `Cr`/`Dr`). It is intentionally defensive:

- It does not require a literal text header row (some statement PDFs bake
  the English/Sinhala/Tamil column headers into a background image rather
  than real text), so it looks for a leading date token on each line to
  detect transaction rows.
- When a header row *is* present with real `DEBITS`/`CREDITS` text, their
  x-position on the page is used to classify ambiguous amount columns.
- Otherwise, the debit/credit direction is inferred from how the running
  balance moves between consecutive rows — a bank-agnostic fallback that
  works on any statement format that prints a balance per line.

Statements in a different layout will still populate dates, amounts, and
balances provided they follow the same general pattern; description-only
category tagging may need new keyword rules in `src/lib/categorize.ts`.

## Privacy

No analytics, no server, no uploads. Statements, the PIN, edits and notes stay
in the browser tab's memory and are discarded on refresh (the page asks before
closing). The only thing stored is the light/dark theme choice. A
Content-Security-Policy limits the page to its own origin.

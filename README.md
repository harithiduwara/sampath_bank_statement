# Bank Statement Analyzer

A static, client-only web app that turns PDF/image bank statements into a
clean, de-duplicated ledger with a live Excel export and a financial
dashboard — entirely in the browser. Built for GitHub Pages: there is no
backend, so nothing you upload ever leaves your device.

**Live app:** `https://<your-username>.github.io/sampath_bank_statement/`

## What it does

1. **Upload** one or more PDF statements (locked or unlocked) or scanned
   image photos of a statement, via drag-and-drop or file picker.
2. **Unlock** — if a PDF is password-protected, you're prompted for the PIN
   once; it's remembered in memory for the rest of the session so a batch of
   statements that share one PIN only needs it entered a single time.
3. **Read** — text-based PDF pages are parsed directly; pages that are
   scanned images (or standalone image uploads) are rasterized and run
   through OCR (Tesseract) in a background worker.
4. **Parse** — a table-aware parser tuned for Sampath Bank's statement
   layout (DATE / PARTICULARS / DEBITS / CREDITS / BALANCE) extracts each
   transaction. Where the printed debit/credit columns can't be pinpointed
   on-page, the parser falls back to inferring the direction from the
   running balance delta, so it degrades gracefully on other bank layouts
   that still print a balance per row.
5. **Merge & de-duplicate** — transactions from every uploaded file are
   combined, sorted chronologically, and duplicates (by date + description +
   amounts + balance) are collapsed, so re-uploading overlapping statement
   pages is safe.
6. **Categorize & visualize** — each transaction is auto-tagged (salary,
   transfers, cheques, cash, utilities, loans, card/POS, ATM, fees,
   interest…) and rendered as monthly income/expense bars, a category
   breakdown, and a balance trend, alongside a rule-based "analyst notes"
   panel (savings rate, spend trend, largest outflow, statistical outlier
   detection).
7. **Export** — a live, three-sheet Excel workbook (Transactions, Monthly
   Summary, Category Breakdown, Overview) rebuilds on every change and
   downloads with one click.

## Why fully client-side

GitHub Pages only serves static files — there is no server to run a
decryption service, OCR engine, or spreadsheet backend. So every step above
(PDF decryption, OCR, parsing, categorization, charting, `.xlsx` generation)
runs in your browser using `pdf.js`, `tesseract.js`, `chart.js`, and
`SheetJS`. Your statements, PINs, and account details are never transmitted
anywhere.

## Tech stack

- [Vite](https://vite.dev/) + React + TypeScript
- Tailwind CSS v4 for styling, [Framer Motion](https://www.framer.com/motion/) for interaction polish
- [`pdfjs-dist`](https://mozilla.github.io/pdf.js/) for PDF parsing/decryption
- [`tesseract.js`](https://tesseract.projectnaptha.com/) for OCR
- [`chart.js`](https://www.chartjs.org/) / `react-chartjs-2` for the dashboard
- [`xlsx` (SheetJS)](https://sheetjs.com/) for the runtime Excel workbook

## Local development

```bash
npm install
npm run dev       # start the dev server
npm run build     # type-check + production build to dist/
npm run preview   # serve the production build locally
npm run lint
```

## Deployment

`.github/workflows/deploy.yml` builds the app and publishes `dist/` to
GitHub Pages on every push to `main`. In the repository settings, set
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

No analytics, no server, no uploads. Everything — including the entered PIN
— stays in the browser tab's memory and is discarded on refresh.

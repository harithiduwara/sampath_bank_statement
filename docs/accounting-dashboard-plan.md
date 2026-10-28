# Accounting dashboard — plan

Goal: turn the statement analyzer into an accounting workspace an accountant or
business owner can close a period with. Everything still runs in the browser.
No statement data, PIN or edit leaves the device or is stored.

## Users and jobs

| Who | Job |
|---|---|
| Owner / finance lead | "Where does the cash stand, and where did it go this period?" |
| Accountant / bookkeeper | Reconcile statements, fix misread rows, categorise, produce a cash-flow report, export to Excel |
| Auditor / reviewer | See what was read, what was corrected or edited, and why |

## Information architecture

App shell: left sidebar (collapses to a drawer on mobile) + top bar with the
global scope: **account**, **period**, upload, export and theme. Every view
re-renders against the same scope.

1. **Overview**: KPIs with change vs. the previous equal period (opening, closing,
   receipts, payments, net cash flow, items to review); cash-flow chart; balance
   trend; payments by category; recurring items; analyst notes.
2. **Ledger**: a dense data grid with search, type, category, status and amount
   filters; sorting; pagination; totals for the filtered rows; bulk recategorise;
   a row drawer to edit, annotate and mark reviewed (keeps an audit trail); and
   export of the filtered view.
3. **Reconciliation**: per statement, opening + receipts − payments = closing;
   running-balance breaks; printed-totals check; continuity and coverage gaps
   between consecutive statements; an overall status.
4. **Reports**: cash-flow statement (direct method, months as columns),
   category analysis and monthly summary. Printable and exportable.
5. **Statements**: upload, processing queue, list of statements with account,
   period, pages, rows, duplicates ignored, read quality; remove a statement;
   clear the whole session.

## Scenarios covered

**Data shape**
- No data: a guided empty state with upload, supported formats and the privacy promise.
- One transaction, or one month: comparisons and charts hide or degrade instead of showing noise.
- Thousands of rows: the grid paginates; charts aggregate (daily ≤ 92 days, else weekly/monthly).
- Rows without a balance (some scans): excluded from balance maths and flagged in reconciliation.
- Negative balances (overdraft): highlighted, with days overdrawn counted.

**Multiple statements**
- Overlapping or repeated statements: duplicates ignored (existing logic), with the count shown per file.
- Gaps between statements: the missing date range is reported.
- Balance doesn't carry over between statements: reported as a continuity break.
- Several accounts: an account selector plus a consolidated view.
- Same account, account number misread by OCR (one digit off): merged into one account.
- Mixed currencies: never summed; the consolidated view is limited to one currency.

**Quality and corrections**
- OCR rows flagged "review" or "corrected": surfaced in KPIs, the ledger and reconciliation.
- User edits (date, description, amounts, balance), category changes, notes and "reviewed":
  applied on top of the read data. The original value is kept and shown (audit trail).
  Reconciliation re-runs against the edited values.
- Categorise similar: one change can apply to every row with the same narration.

**Files and processing**
- Locked PDFs (shared PIN), wrong PIN, cancelled PIN, bad or unsupported files: existing handling, now shown in Statements.
- Removing a wrongly uploaded statement; clearing the session (also forgets the PIN).
- Leaving the page with data loaded asks for confirmation (data is never stored).
- Processing continues while the user browses other views; the top bar shows progress.

**Experience**
- Light and dark themes (system default, manual toggle), with chart colours validated for both.
- Keyboard: every control is reachable; `/` focuses ledger search; Esc closes drawers.
- Screen readers: landmarks, labelled controls, a table twin for every chart.
- Reduced motion respected; print stylesheet for reports.
- Mobile: sidebar drawer, scrollable grids, stacked KPIs.

## Engineering

- Pure, unit-tested accounting functions in `src/lib/accounting.ts` (Vitest), plus
  dedupe tests; tests run in CI before the build.
- App state in one reducer + context (`src/state`), no new runtime frameworks.
- Self-hosted Inter font (CSP: `font-src 'self'`); icons from `lucide-react`.
- Chart colours from the validated reference palette, as CSS variables for
  light and dark; numbers in text ink, tabular figures in tables.
- Security skill re-run before release: no new network calls or storage.

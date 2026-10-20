---
name: security-audit
description: Security audit for this browser-only bank statement analyzer (React + Vite on GitHub Pages, pdf.js, tesseract.js, SheetJS). Use when asked to check for vulnerabilities, before a release, or after changing file handling, PDF unlocking, OCR, Excel export, dependencies or the deploy workflow.
---

# Security audit: Bank Statement Analyzer

The app runs entirely in the visitor's browser. Bank statements, PINs and the
parsed ledger must never leave the device. Every check below protects that
promise or the user's machine from a hostile file.

## Threat model

| Asset | Threat |
|---|---|
| Statement contents, account numbers, PDF PINs | Leaking to a third party (network, storage, logs, analytics) |
| The visitor's browser | A crafted PDF/image that runs script, hangs the tab or exhausts memory |
| The exported Excel file | Formula injection: text from a statement that runs as a formula when opened |
| The deployed site | Supply-chain: vulnerable or hijacked npm packages / GitHub Actions |

## Procedure

Work through every section. Record each finding as
`severity · file:line · what · fix`. Fix confirmed issues, then re-run the
checks in **Verify**.

### 1. Dependencies
- `npm audit --omit=dev` and `npm audit`. Any high/critical in a runtime
  dependency is a must-fix.
- Do not reintroduce `xlsx` from the npm registry: it is frozen at 0.18.5
  with prototype-pollution and ReDoS CVEs. The app only writes workbooks,
  via `write-excel-file`.
- `pdfjs-dist` must be ≥ 4.2.67 (CVE-2024-4367, arbitrary JS via fonts).
  Keep `isEvalSupported: false` on `getDocument`. Note: 5.x+/6.x use
  `Map.getOrInsertComputed`, which breaks in current browsers, so stay on 4.x
  unless that is verified.
- Exact-version pins for anything copied into `public/` (tesseract worker,
  wasm cores, traineddata) so the bundled copy matches what was reviewed.

### 2. Data never leaves the browser
- `grep -rnE "fetch\(|XMLHttpRequest|sendBeacon|WebSocket|navigator\.share|import\(\"http" src`.
  The only allowed requests are same-origin assets under `import.meta.env.BASE_URL`.
- tesseract.js must use self-hosted `workerPath`, `corePath`, `langPath`.
  Any CDN default means the page talks to a third party.
- pdf.js worker must be bundled (`?url` import), not a CDN URL.
- The Content-Security-Policy `<meta>` is injected into the production
  build by the plugin in `vite.config.ts`. It must keep:
  `connect-src 'self'`, no third-party `script-src`. pdf.js and tesseract
  need `worker-src 'self' blob:` and `'wasm-unsafe-eval'`.
- `grep -rnE "localStorage|sessionStorage|indexedDB|document\.cookie" src`.
  PINs must never be persisted. Statement data should not be either.
- `grep -rn "console\.(log|info|debug)" src`. No logging of PINs, text or rows.

### 3. Untrusted input handling (PDFs, images)
- `LIMITS` in `src/lib/pipeline.ts` caps file size, page count, PIN
  attempts and canvas pixels; files are identified by magic bytes
  (`sniffKind`), not by name or `file.type`. Any new input path must go
  through the same checks.
- Bound canvas dimensions when rendering pages or images (browsers crash or
  allocate GBs on huge canvases). Downscale anything above the pixel budget.
- One bad file must not stall the batch: `processFile` errors are caught per
  file in `App.tsx`.
- The remembered PIN lives only in a React ref (memory), never in storage.
- No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` with
  file-derived content. React text rendering is safe by default.

### 4. Excel / CSV export
- Export uses `write-excel-file` (write-only, no parser attack surface).
  Statement text must be written as plain string cells; never use
  `type: 'Formula'` for file-derived values, so "=HYPERLINK(...)" in a
  description stays inert text.
- If a CSV export is ever added, prefix cells starting with `=`, `+`, `-`,
  `@`, tab or CR with `'`.
- Export filename comes from the PDF (account number): keep it to
  `[A-Za-z0-9_-]` (`safeFileName` in `src/lib/excelRuntime.ts`).

### 5. Build and deploy
- Workflow: top-level `permissions: {}`, build job `contents: read`, deploy
  job `pages: write` + `id-token: write`; checkout with
  `persist-credentials: false`.
- No `pull_request_target`, no untrusted `${{ github.event.* }}` interpolated
  into `run:` steps.
- `npm ci` (lockfile-respecting), not `npm install`.
- Third-party actions pinned to a full commit SHA (first-party `actions/*`
  may use a major tag).
- No secrets, statement PDFs or `.lab/` data committed:
  `git ls-files | grep -iE "\.pdf$|\.lab/|\.env"` must be empty.

## Verify
1. `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run build`
2. `npm audit --omit=dev` shows no high/critical.
3. Serve `dist/` (`npx vite preview`) and, with Playwright, load: a fake
   `.pdf` (must be rejected), an encrypted PDF (wrong PINs stop after the
   cap, the right PIN works), and a scanned statement (OCR must work). Then
   download the Excel file. Expect no CSP violations, no page errors, and
   zero requests to any other origin.
4. Write the findings table (fixed / accepted with reason) in the final
   report.

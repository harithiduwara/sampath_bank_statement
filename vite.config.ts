import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * Content-Security-Policy for the production build. Statements and PINs must
 * never leave the browser, so the page may only talk to its own origin.
 * 'wasm-unsafe-eval' is needed for the OCR engine, blob: workers for pdf.js
 * and tesseract.js. (Dev server is exempt: it relies on inline scripts.)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const contentSecurityPolicy = (): Plugin => ({
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
  ],
})

// Repo is served at https://<user>.github.io/sampath_bank_statement/
export default defineConfig({
  base: '/sampath_bank_statement/',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  worker: {
    format: 'es',
  },
})

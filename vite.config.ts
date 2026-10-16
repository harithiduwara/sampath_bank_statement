import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Repo is served at https://<user>.github.io/sampath_bank_statement/
export default defineConfig({
  base: '/sampath_bank_statement/',
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
})

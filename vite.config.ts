import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const serverPort = process.env.REVAI_PORT ?? '8797'

// Single source of truth: package.json (bumped by the release flow). Injected as a
// build-time constant so the header never drifts from the real version again.
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }

export default defineConfig({
  root: 'src/app',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../../dist/app',
    emptyOutDir: true,
  },
  server: {
    // '^/api/' (regex) — a plain '/api' prefix would also match the module '/api.ts'
    // and swallow it on the way to the backend (blank page in `npm run dev`)
    proxy: {
      '^/api/': { target: `http://127.0.0.1:${serverPort}`, ws: false },
    },
  },
})

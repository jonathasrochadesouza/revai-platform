import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const serverPort = process.env.REVAI_PORT ?? '8797'

export default defineConfig({
  root: 'src/app',
  plugins: [react()],
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

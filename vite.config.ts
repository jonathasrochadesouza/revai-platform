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
    proxy: {
      '/api': { target: `http://127.0.0.1:${serverPort}`, ws: false },
    },
  },
})

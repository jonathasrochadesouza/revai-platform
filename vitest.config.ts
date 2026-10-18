// Vitest runs from the repo root — vite.config.ts has root: 'src/app' (SPA build),
// which would hide src/server and src/shared tests.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
})

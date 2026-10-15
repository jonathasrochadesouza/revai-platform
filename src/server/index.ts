// revai platform — local API + static SPA (npm run start)
import fs from 'node:fs'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { ensureDirs, REPOS_DIR, REVAI_DIR } from './paths'
import { appRoot, staticDistDir } from './root'
import { api } from './routes'
import { readSettings } from './store'

// dev/CLI: chdir to the root so relative paths work; packaged: main.cjs sets envs — no chdir
const ROOT = appRoot()
if (!process.env.REVAI_APP_ROOT) process.chdir(ROOT)

ensureDirs()

// clone retention (settings)
function cleanupClones() {
  const days = readSettings().cloneRetentionDays
  if (days <= 0) return
  const now = Date.now()
  try {
    for (const host of fs.readdirSync(REPOS_DIR)) {
      for (const org of fs.readdirSync(path.join(REPOS_DIR, host))) {
        for (const repo of fs.readdirSync(path.join(REPOS_DIR, host, org))) {
          const dir = path.join(REPOS_DIR, host, org, repo)
          try {
            const ageMs = now - fs.statSync(dir).mtimeMs
            if (ageMs > days * 24 * 60 * 60 * 1000) fs.rmSync(dir, { recursive: true, force: true })
          } catch { /* foo */ }
        }
      }
    }
  } catch { /* cache empty */ }
}
cleanupClones()

const app = new Hono()
app.route('/api', api)

// static SPA (production) — serveStatic accepts an absolute root (joined directly in fs)
const distDir = staticDistDir()
app.use('/*', serveStatic({ root: distDir }))
app.get('*', (c) => {
  const idx = path.join(distDir, 'index.html')
  if (fs.existsSync(idx)) return c.html(fs.readFileSync(idx, 'utf8'))
  return c.text('revai: front-end build not found — run `npm run build` or use `npm run dev`', 404)
})

const port = Number(process.env.REVAI_PORT ?? 8797)

// bind só no loopback IPv4 — família idêntica ao probe() do electron/main.cjs,
// assim "porta livre" é a mesma verdade para os dois (evita o crash EADDRINUSE :::8797)
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`
  revai · local platform
  API + UI ........ http://127.0.0.1:${port}
  Data ............ ${REVAI_DIR} (repos/, reviews/, settings.json, harnesses.json)
  Exit with Ctrl+C
`)
  if (process.argv.includes('--open')) {
    import('./proc').then(({ shellOpen }) => void shellOpen(`http://127.0.0.1:${port}`))
  }
})

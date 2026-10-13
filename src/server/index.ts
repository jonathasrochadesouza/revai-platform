// revai platform — API local + SPA estática (npm run start)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { ensureDirs, REPOS_DIR, REVAI_DIR } from './paths'
import { api } from './routes'
import { readSettings } from './store'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
process.chdir(ROOT)

ensureDirs()

// retenção dos clones (settings)
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
  } catch { /* cache vazio */ }
}
cleanupClones()

const app = new Hono()
app.route('/api', api)

// SPA estática (produção)
const dist = 'dist/app'
app.use('/*', serveStatic({ root: dist }))
app.get('*', (c) => {
  const idx = path.join(process.cwd(), dist, 'index.html')
  if (fs.existsSync(idx)) return c.html(fs.readFileSync(idx, 'utf8'))
  return c.text('revai: build do front não encontrado — rode `npm run build` ou use `npm run dev`.', 404)
})

const port = Number(process.env.REVAI_PORT ?? 8797)

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`
  revai · plataforma local
  API + UI ........ http://127.0.0.1:${port}
  Dados ........... ${REVAI_DIR} (repos/, reviews/, settings.json, harnesses.json)
  Saia com Ctrl+C
`)
  if (process.argv.includes('--open')) {
    import('./proc').then(({ shellOpen }) => void shellOpen(`http://127.0.0.1:${port}`))
  }
})

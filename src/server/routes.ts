// API local em 127.0.0.1 — contratuais {error:{code,message,detail}} e SSE para jobs longos.
import fs from 'node:fs'
import path from 'node:path'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { AppError, ERRORS } from './errors'
import { REVAI_DIR, REPOS_DIR, recordDir } from './paths'
import * as proj from './projects'
import * as harn from './harnesses'
import { runReview, patchFindingStatus } from './pipeline'
import type { Send } from './pipeline'
import { runFix } from './fixloop'
import * as store from './store'
import * as g from './git'
import { exec, shellOpen, stream } from './proc'
import { pickFolder } from './picker'
import { gitVersion } from './git'
import type { FixEvent, ReviewRecord, RunFixBody, RunReviewBody, SseEvent, Settings } from '../shared/types'

export const jobs = new Map<string, () => Promise<void>>()

export const api = new Hono()

function pick<T extends object>(body: unknown): T {
  return (body ?? {}) as T
}

async function loadRecord(id: string): Promise<ReviewRecord> {
  const record = store.loadRecord(id)
  if (!record) throw new AppError('reviews/not-found', `review ${id} não encontrada`, undefined, 404)
  return record
}

api.onError((err, c) => {
  const e = AppError.from(err)
  return c.json({ error: { code: e.code, message: e.message, detail: e.detail } }, (e.status ?? 500) as 500)
})

// ── runtime ───────────────────────────────────────────────────────────────
api.get('/health', (c) => c.json({ ok: true, revaiDir: REVAI_DIR, version: '0.1.0' }))

api.get('/env', async (c) =>
  c.json({
    node: process.version,
    git: await gitVersion(),
    platform: process.platform,
    revaiDir: REVAI_DIR,
  }),
)

api.get('/errors', (c) => c.json(Object.entries(ERRORS).map(([code, v]) => ({ code, ...v }))))

// ── onboarding / harnesses ────────────────────────────────────────────────
api.get('/onboarding/detect', async (c) => {
  const harnesses = await harn.discoverHarnesses()
  return c.json({
    harnesses,
    runtime: {
      node: process.version,
      git: await gitVersion(),
      platform: process.platform,
      revaiDir: REVAI_DIR,
    },
  })
})

api.get('/harnesses', async (c) => c.json({ harnesses: await harn.discoverHarnesses() }))

api.post('/harnesses', async (c) => {
  const body = pick<{ id?: string; exe?: string; model?: string; isDefault?: boolean; customName?: string }>(await c.req.json().catch(() => ({})))
  if (!body.id) throw new AppError('harness/not-found', 'id do harness obrigatório')
  if (body.id.startsWith('custom-')) {
    const customName = body.customName && body.customName.trim()
    if (!customName) throw new AppError('harness/not-found', 'customName obrigatório para harness customizado')
    if (!body.exe || !fs.existsSync(body.exe)) throw new AppError('harness/not-found', 'caminho do executável inválido')
    store.upsertHarnessState({ defId: body.id, customName, exe: body.exe })
  } else {
    const states = store.readHarnessStates()
    if (body.isDefault) for (const s of states) s.isDefault = false
    const current = states.find((s) => s.defId === body.id) ?? { defId: body.id }
    const next = {
      ...current,
      defId: body.id,
      ...(body.exe ? { exe: body.exe } : {}),
      ...(body.model ? { model: body.model } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    }
    store.upsertHarnessState(next)
  }
  if (body.isDefault && !body.id.startsWith('custom-')) {
    const states = store.readHarnessStates()
    for (const s of states) if (s.defId !== body.id) s.isDefault = false
    store.writeHarnessStates(states)
  }
  return c.json({ harnesses: await harn.discoverHarnesses() })
})

api.post('/harnesses/validate', async (c) => {
  const body = pick<{ id?: string }>(await c.req.json().catch(() => ({})))
  if (!body.id) throw new AppError('harness/not-found', 'id do harness obrigatório')
  return c.json(await harn.validateHarness(body.id))
})

// ── settings ──────────────────────────────────────────────────────────────
api.get('/settings', (c) => c.json(store.readSettings()))

api.put('/settings', async (c) => {
  const body = pick<Partial<Settings>>(await c.req.json().catch(() => ({})))
  const next: Settings = { ...store.readSettings(), ...body }
  store.writeSettings(next)
  return c.json(next)
})

// ── projects ──────────────────────────────────────────────────────────────
api.post('/projects/resolve', async (c) => {
  const body = pick<{ source?: string }>(await c.req.json().catch(() => ({})))
  if (!body.source) throw new AppError('source/unrecognized', 'source obrigatória')
  const { parsed, info } = await proj.resolveSource(body.source)
  return c.json({ parsed, info })
})

api.post('/projects/prepare', async (c) => {
  const body = pick<{ source?: string }>(await c.req.json().catch(() => ({})))
  if (!body.source) throw new AppError('source/unrecognized', 'source obrigatória')
  const prepared = await proj.prepareFromInput(body.source, () => { /* logs de clone vão no stream do review */ })
  return c.json(prepared)
})

// ── reviews ───────────────────────────────────────────────────────────────
api.post('/reviews/stream', async (c) => {
  const cfg = await c.req.json<RunReviewBody>()
  if (!cfg?.source || !cfg?.head) throw new AppError('source/unrecognized', 'source/head obrigatórios')
  const jobId = `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return streamSSE(c, async (s) => {
    const send: Send = async (ev: SseEvent) => {
      try { await s.writeSSE({ data: JSON.stringify(ev) }) } catch { /* cliente saiu */ }
    }
    await send({ t: 'job', id: jobId })
    try {
      await runReview(send, cfg, jobId, jobs)
    } finally {
      jobs.delete(jobId)
    }
  })
})

api.get('/reviews', (c) => {
  const gate = c.req.query('gate')
  const q = c.req.query('q')?.toLowerCase()
  const limit = Number(c.req.query('limit') ?? 0)
  let rows = store.readIndex()
  if (gate === 'passed' || gate === 'failed') rows = rows.filter((r) => r.gate === gate)
  if (q) {
    rows = rows.filter(
      (r) => r.repoLabel.toLowerCase().includes(q) || r.head.toLowerCase().includes(q) || String(r.prNumber) === q,
    )
  }
  if (limit > 0) rows = rows.slice(0, limit)
  return c.json(rows)
})

api.get('/reviews/:id', async (c) => c.json(await loadRecord(c.req.param('id'))))

api.patch('/reviews/:id/findings/:fid', async (c) => {
  const body = pick<{ status?: 'open' | 'resolved' | 'skipped' }>(await c.req.json().catch(() => ({})))
  const action = body.status
  if (action !== 'open' && action !== 'resolved' && action !== 'skipped') {
    throw new AppError('findings/bad-status', 'status deve ser open | resolved | skipped')
  }
  const updated = await patchFindingStatus(await loadRecord(c.req.param('id')), c.req.param('fid'), action)
  return c.json(updated)
})

api.post('/reviews/:id/fix/stream', async (c) => {
  const body = await c.req.json<RunFixBody>()
  const ids = Array.isArray(body?.ids) ? body.ids : []
  if (!ids.length) throw new AppError('fix/no-changes', 'fila de fixes vazia')
  const record = await loadRecord(c.req.param('id'))
  const jobId = `fx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return streamSSE(c, async (s) => {
    const send = async (ev: FixEvent) => {
      try { await s.writeSSE({ data: JSON.stringify(ev) }) } catch { /* cliente saiu */ }
    }
    try {
      await runFix(send, record, ids, jobId, jobs, body?.runTests)
    } finally {
      jobs.delete(jobId)
    }
  })
})

api.post('/reviews/:id/push', async (c) => {
  const record = await loadRecord(c.req.param('id'))
  const body = pick<{ branch?: string }>(await c.req.json().catch(() => ({})))
  const dir = record.repo.dir
  if (!dir || !fs.existsSync(dir)) throw new AppError('repo/inaccessible', 'clone inexistente no cache')
  const branch = body.branch || `revai/fix-${record.slug}`
  const co = await g.git(['checkout', '-B', branch], dir)
  if (co.code !== 0) throw new AppError('push/failed', 'falha ao criar a branch', co.stderr.trim())
  await g.git(['add', '-A'], dir)
  const cm = await g.git(['commit', '-m', `fix: apply revai fixes for ${record.slug}`], dir)
  if (cm.code !== 0) throw new AppError('push/failed', 'falha ao commitar', cm.stderr.trim())
  const ps = await stream(['git', 'push', '-u', 'origin', branch, '--progress'], { cwd: dir, timeoutMs: 120_000 })
  if (ps.code !== 0) {
    throw new AppError('push/failed', 'push recusado pelo remoto', (ps.stderr || ps.stdout).trim().split('\n').slice(-3).join('\n'))
  }
  return c.json({ branch, output: (ps.stdout + ps.stderr).trim().split('\n').slice(-4).join('\n') })
})

api.post('/reviews/:id/reset', async (c) => {
  const record = await loadRecord(c.req.param('id'))
  const dir = record.repo.dir
  if (!dir || !fs.existsSync(dir)) throw new AppError('repo/inaccessible', 'clone inexistente no cache')
  await g.git(['reset', '--hard', 'HEAD'], dir)
  await g.git(['clean', '-fd'], dir)
  return c.json({ ok: true })
})

api.get('/reviews/:id/artifacts/:kind', async (c) => {
  const record = await loadRecord(c.req.param('id'))
  const kind = c.req.param('kind')
  const dir = recordDir(record.id)
  const name = kind === 'patch' ? 'review.patch' : kind === 'fixpatch' ? 'fix.patch' : kind === 'html' ? 'review.html' : kind === 'record' ? 'record.json' : ''
  if (!name) throw new AppError('internal/not-found', 'artefato desconhecido', undefined, 404)
  const file = path.join(dir, name)
  const buf = fs.readFileSync(file)
  if (kind === 'html') {
    return c.newResponse(buf, 200, { 'Content-Type': 'text/html; charset=utf-8' })
  }
  const download = kind === 'patch' || kind === 'fixpatch' || kind === 'record'
  return c.newResponse(buf, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...(download ? { 'Content-Disposition': `attachment; filename="${name}"` } : {}),
  })
})

api.post('/reviews/:id/open-report', async (c) => {
  const record = await loadRecord(c.req.param('id'))
  const file = path.join(recordDir(record.id), 'review.html')
  if (!fs.existsSync(file)) throw new AppError('internal/not-found', 'HTML da skill não está no cache deste review', undefined, 404)
  await shellOpen(file)
  return c.json({ ok: true })
})

api.post('/reviews/:id/open-editor', async (c) => {
  const record = await loadRecord(c.req.param('id'))
  const dir = record.repo.dir
  if (!dir || !fs.existsSync(dir)) throw new AppError('repo/inaccessible', 'clone inexistente no cache')
  for (const cmd of ['code', 'cursor']) {
    const r = await exec(process.platform === 'win32' ? ['where', cmd] : ['which', cmd], { timeoutMs: 5_000 })
    if (r.code === 0 && r.stdout.trim()) {
      const exe = process.platform === 'win32' ? `${cmd}.cmd` : r.stdout.trim().split('\n')[0]
      await exec([exe, dir], { timeoutMs: 30_000 })
      return c.json({ ok: true, editor: cmd })
    }
  }
  await shellOpen(dir)
  return c.json({ ok: true, editor: 'explorer' })
})

api.delete('/reviews/:id', async (c) => {
  store.deleteRecord(c.req.param('id'))
  return c.json({ ok: true })
})

// ── sistema ───────────────────────────────────────────────────────────────
/** Diálogo nativo do SO para escolher pasta ('Pasta local' na tela Nova review). */
api.post('/system/pick-folder', async (c) => {
  const body = pick<{ startIn?: string }>(await c.req.json().catch(() => ({})))
  return c.json({ path: await pickFolder(body.startIn) })
})

api.post('/jobs/:jobId/cancel', (c) => {
  const kill = jobs.get(c.req.param('jobId'))
  if (kill) void kill()
  return c.json({ ok: true })
})

// ── manutenção ────────────────────────────────────────────────────────────
api.get('/maintenance/stats', (c) => {
  const repos = listRepos()
  const rows = store.readIndex()
  return c.json({
    repos: repos.length,
    reposBytes: repos.reduce((s, r) => s + g.dirSize(r), 0),
    reviews: rows.length,
  })
})

api.post('/maintenance/clear-repos', (c) => {
  for (const d of listRepos()) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* foo */ }
  }
  return c.json({ ok: true })
})

api.post('/maintenance/open-folder', async (c) => {
  const body = pick<{ target?: 'repos' | 'reviews' }>(await c.req.json().catch(() => ({})))
  const dir = body.target === 'reviews' ? path.join(REVAI_DIR, 'reviews') : REPOS_DIR
  fs.mkdirSync(dir, { recursive: true })
  await shellOpen(path.dirname(dir) === REVAI_DIR ? dir : dir)
  return c.json({ ok: true })
})

function listRepos(): string[] {
  const out: string[] = []
  try {
    for (const host of fs.readdirSync(REPOS_DIR)) {
      const hostDir = path.join(REPOS_DIR, host)
      if (!fs.statSync(hostDir).isDirectory()) continue
      for (const org of fs.readdirSync(hostDir)) {
        const orgDir = path.join(hostDir, org)
        if (!fs.statSync(orgDir).isDirectory()) continue
        for (const repo of fs.readdirSync(orgDir)) out.push(path.join(orgDir, repo))
      }
    }
  } catch { /* dir ausente */ }
  return out
}

export function notFoundForApi(c: Context) {
  return c.json({ error: { code: 'internal/not-found', message: 'rota inexistente' } }, 404)
}

// Pipeline de review — os mesmos 5 passos da skill, com eventos SSE:
//   1 Preparar clone → 2 Gerar patch → 3 Analisar mudanças (harness) → 4 Registrar findings → 5 Validar schema → 6 Montar relatório
import fs from 'node:fs'
import path from 'node:path'
import { parseSource } from '../shared/urls'
import { computeGate } from '../shared/gate'
import type { Finding, ReviewMeta, ReviewRecord, RunReviewBody, SseEvent, StepId } from '../shared/types'
import { stream, type RunHandle } from './proc'
import { AppError } from './errors'
import * as skill from './skill'
import * as proj from './projects'
import * as h from './harnesses'
import { saveRecord } from './store'
import { recordDir } from './paths'

export type Send = (ev: SseEvent) => Promise<void>
export type JobRegistry = Map<string, () => Promise<void>>

const REVIEW_TIMEOUT_MS = 25 * 60 * 1000

const STEP_LABELS: Record<StepId, string> = {
  clone: 'Preparar clone',
  patch: 'Gerar patch',
  analyze: 'Analisar mudanças',
  capture: 'Registrar findings',
  validate: 'Validar schema',
  assemble: 'Montar relatório',
}

/** prompt enviado ao harness pela stdin (curto, por path — igual copiar prompt da skill) */
export function buildReviewPrompt(o: {
  repoDir: string
  slug: string
  head: string
  base: string
  skillPath: string
  languages: string[]
  filesChanged: number
  additions: number
  deletions: number
}): string {
  const sep = path.sep
  const patchPath = `${o.repoDir}${sep}.revai${sep}data${sep}${o.slug}.patch`
  const focus = o.languages.length ? o.languages.join(', ') : 'general'
  return [
    `You are executing the "revai" code-review skill end-to-end.`,
    ``,
    `Patch (ONLY '+' and '−' lines are in scope):`,
    `  ${patchPath}`,
    ``,
    `Read first:`,
    `  ${o.skillPath}${sep}SKILL.md`,
    `  ${o.skillPath}${sep}references${sep}rubric.md`,
    `  ${o.skillPath}${sep}references${sep}stack-playbooks.md (focus: ${focus})`,
    `  project overrides if present: ${o.repoDir}${sep}.revai${sep}rules.md (supersedes baseline) — also consult CODING_STANDARDS.md / CONTRIBUTING.md when present.`,
    ``,
    `Head: ${o.head} (base: ${o.base}) — ${o.filesChanged} files, +${o.additions} −${o.deletions}.`,
    ``,
    `Deliverables — write ONLY these two files (schema V2, valid JSON):`,
    `  ${o.repoDir}${sep}.revai${sep}data${sep}${o.slug}-review.json   (array of findings)`,
    `  ${o.repoDir}${sep}.revai${sep}data${sep}${o.slug}-meta.json     (object: author, reviewer, branch, walkthrough, files[])`,
    ``,
    `Finding ids start at CR-01. Severity: critical|major|minor|trivial. Effort: quick-win|estimated|significant.`,
    `Categories: security|performance|stability|data-integrity. proposedFix optional: {language:'ts'|'java'|'cs', before:[old lines], after:[new lines]}.`,
    `You MAY read repo files for context. You MUST NOT modify project files (except the two JSONs above). Do not commit.`,
    `Finish with a 3-line terminal summary of findings (no report markup).`,
  ].join('\n')
}

export async function runReview(send: Send, cfg: RunReviewBody, jobId: string, jobs: JobRegistry): Promise<void> {
  const t0 = Date.now()
  const id = `r-${t0.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  let currentStep: StepId = 'clone'
  const guard = (code: string, msg: string, detail?: string, status = 400): AppError => new AppError(code, msg, detail, status)

  const step = (status: 'running' | 'done' | 'failed', detail?: string) =>
    send({ t: 'step', id: currentStep, label: STEP_LABELS[currentStep], status, detail })

  try {
    // 1. Preparar clone
    await step('running')
    const parsed = parseSource(cfg.source)
    const prepared = await proj.prepare(parsed, (l) => send({ t: 'log', stream: 'git', line: l }))
    await step('done', prepared.repoDir)

    // 2. Gerar patch
    currentStep = 'patch'
    await step('running')
    await send({ t: 'log', stream: 'script', line: '$ node revai.mjs diff --current' })
    const diff = await skill.runDiff(prepared.repoDir)
    void send({ t: 'log', stream: 'script', line: `${diff.slug} · ${diff.filesChanged} arquivos · +${diff.additions} −${diff.deletions}` })
    await send({ t: 'stats', filesChanged: diff.filesChanged, additions: diff.additions, deletions: diff.deletions, slug: diff.slug, patchPath: diff.patchPath })
    await step('done')

    if (diff.filesChanged === 0) throw guard('repo/empty-diff', 'Nenhuma mudança entre base e head.')

    // 3. Analisar mudanças (harness)
    currentStep = 'analyze'
    await step('running')
    const inv = h.invoke(cfg.harnessId, 'review', null, cfg.model)
    const prompt = buildReviewPrompt({
      repoDir: prepared.repoDir,
      slug: diff.slug,
      head: prepared.head,
      base: prepared.base,
      skillPath: skill.skillDir(),
      languages: prepared.languages,
      filesChanged: prepared.filesChanged,
      additions: prepared.additions,
      deletions: prepared.deletions,
    })
    const argv = h.finalArgv(inv, prompt)
    let agentHandle: RunHandle | null = null
    const run = await stream(argv, {
      cwd: prepared.repoDir,
      stdin: inv.stdin ? prompt : undefined,
      timeoutMs: REVIEW_TIMEOUT_MS,
      onLine: (l, s) => void send({ t: 'log', stream: 'agent', line: l, cls: s === 'err' ? 't-err' : undefined }),
      onSpawn: (exec_handle) => {
        agentHandle = exec_handle
        jobs.set(jobId, () => { void exec_handle.kill(); return Promise.resolve() })
      },
    })
    if (run.code !== 0 || run.timedOut) {
      const all = run.stdout + '\n' + run.stderr
      const authFail = /not logged in|unauthorized|missing bearer|401|login required|_API_KEY|permission denied|sign in/i.test(all)
      if (authFail) {
        throw guard(
          'harness/login-needed',
          `O runner ${cfg.harnessId} não está autenticado — rode o login do CLI e valide de novo.`,
          run.stderr.trim().split('\n').slice(-2).join('\n') || undefined,
          401,
        )
      }
      const tail = (run.timedOut ? 'timeout' : run.stderr.trim().split('\n').filter(Boolean).slice(-3).join('\n')) || `exit ${run.code}`
      throw guard(run.timedOut ? 'agent/timeout' : 'agent/failed', `harness ${cfg.harnessId} terminou com erro`, tail, 500)
    }
    await step('done')

    // 4. Registrar findings
    currentStep = 'capture'
    await step('running')
    const reviewJsonPath = path.join(prepared.repoDir, '.revai', 'data', `${diff.slug}-review.json`)
    const metaJsonPath = path.join(prepared.repoDir, '.revai', 'data', `${diff.slug}-meta.json`)
    for (const p of [reviewJsonPath, metaJsonPath]) {
      if (!fs.existsSync(p)) throw guard('agent/failed', `arquivo esperado não foi escrito: ${path.basename(p)}`, p, 500)
    }
    let findings: Finding[]
    let meta: ReviewMeta
    try {
      findings = JSON.parse(fs.readFileSync(reviewJsonPath, 'utf8'))
      if (!Array.isArray(findings)) throw new Error('review.json deve ser um array')
      meta = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8'))
    } catch (e) {
      throw guard('agent/failed', 'JSON inválido escrito pelo agente', String(e), 500)
    }
    findings = findings.map((f, i) => {
      const ff = { ...f } as Finding
      if (!ff.id) ff.id = `CR-${String(i + 1).padStart(2, '0')}`
      if (!ff.status) ff.status = 'open'
      return ff
    })
    await step('done', `${findings.length} findings`)

    // 5. Validar schema (script da skill — nada é gerado até passar)
    currentStep = 'validate'
    await step('running')
    const gen = await skill.generateReview(prepared.repoDir, diff.slug)
    await step('done', 'report gerado pela skill')

    // 6. Montar relatório
    currentStep = 'assemble'
    await step('running')
    const gate = computeGate(findings, [])
    const dir = recordDir(id)
    fs.mkdirSync(dir, { recursive: true })
    const copy = (src: string, name: string) => {
      try { fs.copyFileSync(src, path.join(dir, name)) } catch { /* foo */ }
      return name
    }
    const record: ReviewRecord = {
      id,
      createdAt: Date.now(),
      repo: {
        host: parsed.host, org: parsed.org, name: parsed.repo,
        url: parsed.url,
        dir: prepared.repoDir,
        label: prepared.label,
      },
      head: prepared.head,
      headBranch: prepared.headBranch,
      base: prepared.base,
      slug: diff.slug,
      prNumber: parsed.ref?.prNumber,
      harnessId: cfg.harnessId,
      harnessName: h.harnessName(cfg.harnessId),
      model: cfg.model && cfg.model !== 'auto' ? cfg.model : undefined,
      refKind: prepared.refKind,
      stats: { filesChanged: diff.filesChanged, additions: diff.additions, deletions: diff.deletions, durationMs: Date.now() - t0 },
      rules: prepared.rules,
      meta,
      findings,
      skipped: [],
      gate,
      artifacts: {
        patch: copy(diff.patchPath, 'review.patch'),
        html: gen.htmlPath ? copy(gen.htmlPath, 'review.html') : undefined,
        reviewJson: copy(reviewJsonPath, 'review.json'),
        metaJson: copy(metaJsonPath, 'meta.json'),
      },
    }
    saveRecord(record)
    await send({ t: 'gate', gate })
    await step('done', `${record.stats.filesChanged} arquivos · ${record.stats.durationMs / 1000}s`)
    await send({ t: 'done', reviewId: id })
  } catch (e) {
    const isCancel = (e as any)?.code === 'job/cancelled'
    if (isCancel) {
      await step('failed')
      await send({ t: 'cancelled', note: 'artefatos parciais ficam em .revai/data no clone' })
      return
    }
    const err = e instanceof AppError ? e : AppError.from(e)
    await step('failed', err.message)
    await send({ t: 'error', code: err.code, message: err.message, detail: err.detail })
  }
}

export async function patchFindingStatus(
  record: ReviewRecord,
  fid: string,
  action: 'open' | 'resolved' | 'skipped',
): Promise<ReviewRecord> {
  const f = record.findings.find((x) => x.id === fid)
  if (!f) throw new AppError('findings/not-found', `finding ${fid} inexistente`, undefined, 404)
  if (action === 'open') {
    // restaurar = desfazer o PULAR apenas — não reabre um finding resolvido
    record.skipped = record.skipped.filter((s) => s !== fid)
  } else if (action === 'resolved') {
    f.status = 'resolved'
    record.skipped = record.skipped.filter((s) => s !== fid)
  } else {
    if (f.status === 'resolved') {
      throw new AppError('findings/already-resolved', 'Finding resolvido não pode ser pulado', undefined, 409)
    }
    if (!record.skipped.includes(fid)) record.skipped.push(fid)
  }
  record.gate = computeGate(record.findings, record.skipped)
  saveRecord(record)
  // mantém o HTML da skill em sinc (best-effort — requer clone ativo)
  try {
    if (record.repo.dir && fs.existsSync(record.repo.dir)) {
      const reviewJsonPath = path.join(record.repo.dir, '.revai', 'data', `${record.slug}-review.json`)
      if (fs.existsSync(reviewJsonPath)) {
        fs.writeFileSync(reviewJsonPath, JSON.stringify(record.findings, null, 2) + '\n', 'utf8')
        const gen = await skill.generateReview(record.repo.dir, record.slug)
        if (gen.htmlPath) fs.copyFileSync(gen.htmlPath, path.join(recordDir(record.id), 'review.html'))
        record.artifacts.html = record.artifacts.html ?? 'review.html'
        saveRecord(record)
      }
    }
  } catch { /* sem sync — UI continua única fonte */ }
  return record
}

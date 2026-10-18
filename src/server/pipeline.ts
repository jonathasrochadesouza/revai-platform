// Review pipeline — the same 5 steps as the skill, with SSE events:
//   1 Prepare clone → 2 Generate patch → 3 Analyze changes (harness) → 4 Capture findings → 5 Validate schema → 6 Assemble report
import fs from 'node:fs'
import path from 'node:path'
import { parseSource } from '../shared/urls'
import { computeGate, PRIORITY_MAP } from '../shared/gate'
import type { Finding, ReviewMeta, ReviewRecord, RunReviewBody, SseEvent, StepId } from '../shared/types'
import { stream, type RunHandle } from './proc'
import { AppError } from './errors'
import { slugify } from '../shared/slug'
import * as skill from './skill'
import * as proj from './projects'
import * as h from './harnesses'
import { saveRecord } from './store'
import { recordDir } from './paths'

export type Send = (ev: SseEvent) => Promise<void>
export type JobRegistry = Map<string, () => Promise<void>>

const REVIEW_TIMEOUT_MS = 25 * 60 * 1000

const STEP_LABELS: Record<StepId, string> = {
  clone: 'Prepare clone',
  patch: 'Generate patch',
  analyze: 'Analyze changes',
  capture: 'Capture findings',
  validate: 'Validate schema',
  assemble: 'Assemble report',
}

/** prompt sent to the harness via stdin (short, by path — same as copying the prompt from the skill) */
export function buildReviewPrompt(o: {
  repoDir: string
  slug: string
  head: string
  base: string
  skillPath: string // '' → inline baseline (skill not installed)
  languages: string[]
  filesChanged: number
  additions: number
  deletions: number
  fullFolder?: boolean // folder-full review: whole project in scope, no patch
  scopePath?: string // full-folder: file manifest instead of the patch
}): string {
  const sep = path.sep
  const focus = o.languages.length ? o.languages.join(', ') : 'general'

  const scopeLines = o.fullFolder
    ? [
        `Scope: FULL-FOLDER review — the source is not a git repository, so there is no patch; every file is in scope.`,
        `  File manifest: ${o.scopePath}`,
      ]
    : [
        `Patch (ONLY '+' and '−' lines are in scope):`,
        `  ${o.repoDir}${sep}.revai${sep}data${sep}${o.slug}.patch`,
      ]

  const readFirst = o.skillPath
    ? [
        `Read first:`,
        `  ${o.skillPath}${sep}SKILL.md`,
        `  ${o.skillPath}${sep}references${sep}rubric.md`,
        `  ${o.skillPath}${sep}references${sep}stack-playbooks.md (focus: ${focus})`,
        `  project overrides if present: ${o.repoDir}${sep}.revai${sep}rules.md (supersedes baseline) — also consult CODING_STANDARDS.md / CONTRIBUTING.md when present.`,
      ]
    : [
        `The revai skill is not installed — follow this baseline instead:`,
        `  Look for security, performance, stability and data-integrity issues (focus: ${focus}).`,
        `  Severity: critical (must fix) / major (should fix) / minor / trivial. Effort: quick-win | estimated | significant.`,
        `  Project overrides if present: ${o.repoDir}${sep}.revai${sep}rules.md (supersedes baseline) — also consult CODING_STANDARDS.md / CONTRIBUTING.md when present.`,
      ]

  const headLine = o.fullFolder
    ? `Full folder: ${o.head} — ${o.filesChanged} files (${o.additions} lines). Prioritize the most impactful issues; do not pad the report.`
    : `Head: ${o.head} (base: ${o.base}) — ${o.filesChanged} files, +${o.additions} −${o.deletions}.`

  return [
    `You are executing the "revai" code-review skill end-to-end.`,
    ``,
    ...scopeLines,
    ``,
    ...readFirst,
    ``,
    headLine,
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

/** lightweight in-platform schema check — used when the skill's validator is unavailable (no skill / full-folder) */
function validateFindingsSchema(findings: Finding[], meta: ReviewMeta): void {
  const bad = (msg: string) => new AppError('schema/validation', 'Schema V2 validation failed — nothing is generated until it passes', msg)
  if (!Array.isArray(findings) || findings.length === 0) throw bad('review.json must be a non-empty array of findings')
  if (!meta || typeof meta !== 'object' || !Array.isArray(meta.files)) throw bad('meta.json must be an object with author, reviewer, branch, walkthrough, files[]')
  for (const f of findings) {
    if (!f.id || !f.title || !f.description || !f.file || !f.lines) {
      throw bad(`finding ${f.id ?? '(no id)'} is missing id/title/description/file/lines`)
    }
    const sev = f.severity ?? (f.priority ? PRIORITY_MAP[f.priority] : undefined)
    if (!sev) throw bad(`finding ${f.id}: severity must be critical|major|minor|trivial`)
    if (f.category && !['security', 'performance', 'stability', 'data-integrity'].includes(f.category)) {
      throw bad(`finding ${f.id}: category "${f.category}" is not security|performance|stability|data-integrity`)
    }
  }
}

export async function runReview(send: Send, cfg: RunReviewBody, jobId: string, jobs: JobRegistry): Promise<void> {
  const t0 = Date.now()
  const id = `r-${t0.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  let currentStep: StepId = 'clone'
  const guard = (code: string, msg: string, detail?: string, status = 400): AppError => new AppError(code, msg, detail, status)

  const step = (status: 'running' | 'done' | 'failed', detail?: string) =>
    send({ t: 'step', id: currentStep, label: STEP_LABELS[currentStep], status, detail })

  try {
    // 1. Prepare clone
    await step('running')
    const parsed = parseSource(cfg.source)
    const prepared = await proj.prepare(parsed, (l) => send({ t: 'log', stream: 'git', line: l }))
    await step('done', prepared.repoDir)

    // 2. Generate patch — full-folder: scope manifest; git: skill/built-in diff.
    //    Empty diff vs base is not an error: it degrades to a full-folder review.
    currentStep = 'patch'
    await step('running')
    let isFullFolder = prepared.refKind === 'folder-full'
    let diff: skill.DiffOutput | null = null
    if (!isFullFolder) {
      try {
        if (skill.skillAvailable()) {
          await send({ t: 'log', stream: 'script', line: '$ node revai.mjs diff --current' })
          diff = await skill.runDiff(prepared.repoDir)
        } else {
          await send({ t: 'log', stream: 'script', line: 'revai skill not found — using the built-in diff fallback' })
          diff = await skill.fallbackDiff(prepared.repoDir, slugify(prepared.headBranch), prepared.base, prepared.headBranch)
        }
        if (diff.filesChanged === 0) diff = null // empty vs base → degrade below
      } catch (e) {
        if ((e as AppError).code === 'repo/empty-diff') diff = null
        else throw e
      }
      if (!diff) {
        await send({ t: 'log', stream: 'script', line: 'no changes between base and head — falling back to a full-folder review' })
      }
    }
    if (!diff) {
      // full-folder scope manifest (source without git, or empty diff vs base)
      isFullFolder = true
      const fullFiles = proj.walkFullFolder(prepared.repoDir)
      const slug = slugify(prepared.label)
      const dataDir = path.join(prepared.repoDir, '.revai', 'data')
      fs.mkdirSync(dataDir, { recursive: true })
      const scopePath = path.join(dataDir, `${slug}-scope.txt`)
      fs.writeFileSync(
        scopePath,
        fullFiles.filter((f) => !f.ignored).map((f) => `${f.path}\t${f.added} lines`).join('\n') + '\n',
        'utf8',
      )
      diff = {
        slug,
        patchPath: scopePath,
        filesChanged: fullFiles.filter((f) => !f.ignored).length,
        additions: fullFiles.reduce((s, f) => s + (f.ignored ? 0 : f.added), 0),
        deletions: 0,
      }
      await send({ t: 'log', stream: 'script', line: `full-folder scope → ${scopePath}` })
    }
    if (isFullFolder) {
      void send({ t: 'log', stream: 'script', line: `${diff.slug} · ${diff.filesChanged} files (full folder, ${diff.additions} lines)` })
    } else {
      void send({ t: 'log', stream: 'script', line: `${diff.slug} · ${diff.filesChanged} files · +${diff.additions} −${diff.deletions}` })
    }
    await send({ t: 'stats', filesChanged: diff.filesChanged, additions: diff.additions, deletions: diff.deletions, slug: diff.slug, patchPath: diff.patchPath })
    await step('done')

    if (diff.filesChanged === 0) {
      throw guard('repo/empty-diff', 'No reviewable files found in the folder')
    }

    // 3. Analyze changes (harness)
    currentStep = 'analyze'
    await step('running')
    const inv = h.invoke(cfg.harnessId, 'review', null, cfg.model)
    const prompt = buildReviewPrompt({
      repoDir: prepared.repoDir,
      slug: diff.slug,
      head: prepared.head,
      base: prepared.base,
      skillPath: skill.findSkillDir(),
      languages: prepared.languages,
      filesChanged: diff.filesChanged,
      additions: diff.additions,
      deletions: diff.deletions,
      fullFolder: isFullFolder,
      scopePath: isFullFolder ? diff.patchPath : undefined,
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
          `The ${cfg.harnessId} runner is not authenticated — run the CLI login and validate again`,
          run.stderr.trim().split('\n').slice(-2).join('\n') || undefined,
          401,
        )
      }
      const tail = (run.timedOut ? 'timeout' : run.stderr.trim().split('\n').filter(Boolean).slice(-3).join('\n')) || `exit ${run.code}`
      throw guard(run.timedOut ? 'agent/timeout' : 'agent/failed', `harness ${cfg.harnessId} finished with an error`, tail, 500)
    }
    await step('done')

    // 4. Capture findings
    currentStep = 'capture'
    await step('running')
    const reviewJsonPath = path.join(prepared.repoDir, '.revai', 'data', `${diff.slug}-review.json`)
    const metaJsonPath = path.join(prepared.repoDir, '.revai', 'data', `${diff.slug}-meta.json`)
    for (const p of [reviewJsonPath, metaJsonPath]) {
      if (!fs.existsSync(p)) throw guard('agent/failed', `Expected file was not written: ${path.basename(p)}`, p, 500)
    }
    let findings: Finding[]
    let meta: ReviewMeta
    try {
      findings = JSON.parse(fs.readFileSync(reviewJsonPath, 'utf8'))
      if (!Array.isArray(findings)) throw new Error('review.json must be an array')
      meta = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8'))
    } catch (e) {
      throw guard('agent/failed', 'Invalid JSON written by the agent', String(e), 500)
    }
    findings = findings.map((f, i) => {
      const ff = { ...f } as Finding
      if (!ff.id) ff.id = `CR-${String(i + 1).padStart(2, '0')}`
      if (!ff.status) ff.status = 'open'
      return ff
    })
    await step('done', `${findings.length} findings`)

    // 5. Validate schema — skill validator when available (git mode); in-platform check otherwise
    currentStep = 'validate'
    await step('running')
    let gen: { htmlPath: string } = { htmlPath: '' }
    if (!isFullFolder && skill.skillAvailable()) {
      gen = await skill.generateReview(prepared.repoDir, diff.slug)
      await step('done', 'Report generated by the skill')
    } else {
      validateFindingsSchema(findings, meta)
      await step('done', isFullFolder ? 'Validated in-platform (full-folder review)' : 'Validated in-platform (skill not installed)')
    }

    // 6. Assemble report
    currentStep = 'assemble'
    await step('running')
    const gate = computeGate(findings, [])
    const dir = recordDir(id)
    fs.mkdirSync(dir, { recursive: true })
    const copy = (src: string, name: string): string | undefined => {
      try {
        fs.copyFileSync(src, path.join(dir, name))
        return name
      } catch { /* source missing — artifact stays absent */ return undefined }
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
        // full-folder has no patch — the scope manifest replaces it (kept out of artifacts on purpose)
        patch: isFullFolder ? undefined : copy(diff.patchPath, 'review.patch'),
        html: gen.htmlPath ? copy(gen.htmlPath, 'review.html') : undefined,
        reviewJson: copy(reviewJsonPath, 'review.json'),
        metaJson: copy(metaJsonPath, 'meta.json'),
      },
    }
    saveRecord(record)
    await send({ t: 'gate', gate })
    await step('done', `${record.stats.filesChanged} files · ${record.stats.durationMs / 1000}s`)
    await send({ t: 'done', reviewId: id })
  } catch (e) {
    const isCancel = (e as any)?.code === 'job/cancelled'
    if (isCancel) {
      await step('failed')
      await send({ t: 'cancelled', note: 'Partial artifacts remain in .revai/data in the clone' })
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
  if (!f) throw new AppError('findings/not-found', `Finding ${fid} not found`, undefined, 404)
  if (action === 'open') {
    // restore undoes the SKIP only — it does not reopen a resolved finding
    record.skipped = record.skipped.filter((s) => s !== fid)
  } else if (action === 'resolved') {
    f.status = 'resolved'
    record.skipped = record.skipped.filter((s) => s !== fid)
  } else {
    if (f.status === 'resolved') {
      throw new AppError('findings/already-resolved', 'A resolved finding cannot be skipped', undefined, 409)
    }
    if (!record.skipped.includes(fid)) record.skipped.push(fid)
  }
  record.gate = computeGate(record.findings, record.skipped)
  saveRecord(record)
  // keeps the skill HTML in sync (best-effort — requires an active clone)
  try {
    if (record.repo.dir && fs.existsSync(record.repo.dir)) {
      const reviewJsonPath = path.join(record.repo.dir, '.revai', 'data', `${record.slug}-review.json`)
      if (fs.existsSync(reviewJsonPath) && skill.skillAvailable()) {
        fs.writeFileSync(reviewJsonPath, JSON.stringify(record.findings, null, 2) + '\n', 'utf8')
        const gen = await skill.generateReview(record.repo.dir, record.slug)
        if (gen.htmlPath) fs.copyFileSync(gen.htmlPath, path.join(recordDir(record.id), 'review.html'))
        record.artifacts.html = record.artifacts.html ?? 'review.html'
        saveRecord(record)
      }
    }
  } catch { /* no sync — the UI remains the single source */ }
  return record
}

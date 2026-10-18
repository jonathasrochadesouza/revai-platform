// Fix loop — fix queue: apply (harness) → run tests → finding resolved → gate delta.
import fs from 'node:fs'
import path from 'node:path'
import { exec, stream, type RunHandle } from './proc'
import { AppError } from './errors'
import { computeGate, effSev } from '../shared/gate'
import type { FixEvent, Finding, ReviewRecord } from '../shared/types'
import * as skill from './skill'
import { detectTestCommand } from './projects'
import * as h from './harnesses'
import { saveRecord, readSettings } from './store'
import { recordDir } from './paths'
import * as g from './git'

export type SendFn = (ev: FixEvent) => Promise<void>

const FIX_TIMEOUT_MS = 20 * 60 * 1000
const TEST_TIMEOUT_MS = 10 * 60 * 1000

const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*(?:\x07|\x1B\\)?|\x1B[@-Z\\-_]/g

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}

function tail(s: string, n = 3): string {
  return stripAnsi(s).trim().split('\n').filter(Boolean).slice(-n).join('\n').slice(0, 400)
}

export function buildFixPrompt(record: ReviewRecord, f: Finding): string {
  const sev = effSev(f) ?? 'major'
  const L: string[] = [
    'You are applying ONE fix from a revai code review.',
    '',
    `Finding ${f.id} — severity: ${sev}; category: ${f.category ?? 'stability'}; effort: ${f.effort}`,
    `File: ${f.file}   Lines: ${f.lines}`,
    `What is wrong: ${f.title} — ${f.description}`,
  ]
  if (f.rationale) L.push(`Why it matters: ${f.rationale}`)
  L.push('')
  if (f.proposedFix) {
    const pf = f.proposedFix
    L.push(`Proposed fix (${pf.language}): translate the INTENT below to REAL code in this repo:`)
    L.push('--- before ---')
    for (const line of pf.before ?? []) L.push(`   ${line}`)
    L.push('--- after ---')
    for (const line of pf.after ?? []) L.push(`   ${line}`)
  } else if (f.copilotSummary) {
    L.push(`Fix guidance: ${f.copilotSummary}`)
  } else {
    L.push('Fix guidance: infer the minimal correct change from the description above.')
  }
  L.push(
    '',
    'Rules: apply ONLY this change to the file above (minimal edit, match the repo code style).',
    'You MAY read neighboring code for context. Do NOT touch .revai/ or .git/. Do NOT commit.',
    'Finish with a single terminal line summarizing what you changed.',
  )
  return L.join('\n')
}

export async function runFix(
  send: SendFn,
  record: ReviewRecord,
  ids: string[],
  jobId: string,
  jobs: Map<string, () => Promise<void>>,
  runTests?: boolean,
): Promise<void> {
  const settings = readSettings()
  const wantTests = runTests ?? settings.runTestsInFixLoop
  const applied: string[] = []
  const failed: string[] = []
  const before = record.gate
  let cancelled = false
  let current: RunHandle | null = null
  // cancellation registered from the start — holds between items too (kills the current spawn when there is one)
  jobs.set(jobId, async () => {
    cancelled = true
    await current?.kill()
  })

  try {
    if (!record.repo.dir || !fs.existsSync(record.repo.dir)) {
      throw new AppError('repo/inaccessible', 'The clone for this review is no longer in ~/.revai/repos')
    }
    await send({ t: 'job', id: jobId })
    await send({
      t: 'queue',
      items: ids
        .map((id) => record.findings.find((f) => f.id === id))
        .filter((f): f is Finding => !!f)
        .map((f) => ({ id: f.id, title: f.title, severity: effSev(f), category: f.category })),
    })

    for (const id of ids) {
      if (cancelled) break
      const f = record.findings.find((x) => x.id === id)
      if (!f) continue

      // ── Apply fix
      await send({ t: 'item', id, step: 'apply', status: 'running' })
      const prompt = buildFixPrompt(record, f)
      const inv = h.invoke(record.harnessId, 'fix', null, record.model)
      const run = await stream(h.finalArgv(inv, prompt), {
        cwd: record.repo.dir,
        stdin: inv.stdin ? prompt : undefined,
        timeoutMs: FIX_TIMEOUT_MS,
        onLine: (l) => void send({ t: 'log', id, stream: 'agent', line: l }),
        onSpawn: (handle) => { current = handle },
      })
      if (cancelled) break
      if (run.code !== 0 || run.timedOut) {
        const detail = run.timedOut ? 'timeout' : tail(run.stderr) || `exit ${run.code}`
        await send({ t: 'item', id, step: 'apply', status: 'failed', detail })
        await send({ t: 'item', id, step: 'failed', status: 'failed', detail })
        failed.push(id)
        continue
      }
      const wt = await g.worktreeNumstat(record.repo.dir)
      if (cancelled) break
      if (wt.files.length === 0) {
        await send({ t: 'item', id, step: 'apply', status: 'failed', detail: 'The agent made no file changes' })
        await send({ t: 'item', id, step: 'failed', status: 'failed', detail: 'The agent made no file changes' })
        failed.push(id)
        continue
      }
      await send({ t: 'item', id, step: 'apply', status: 'ok' })

      // ── Run tests
      if (wantTests) {
        await send({ t: 'item', id, step: 'test', status: 'running' })
        if (cancelled) break
        const tc = detectTestCommand(record.repo.dir)
        if (!tc) {
          await send({ t: 'item', id, step: 'test', status: 'ok', detail: 'No test command detected' })
        } else {
          const tr = await stream(tc.argv, {
            cwd: record.repo.dir,
            timeoutMs: TEST_TIMEOUT_MS,
            onLine: (l) => void send({ t: 'log', id, stream: 'tests', line: l }),
          })
          if (cancelled) break
          if (tr.code !== 0 || tr.timedOut) {
            await send({ t: 'item', id, step: 'test', status: 'failed', detail: tr.timedOut ? 'timeout' : 'Tests failed — change kept for inspection' })
            await send({ t: 'item', id, step: 'failed', status: 'failed', detail: 'Tests failed' })
            failed.push(id)
            continue
          }
          await send({ t: 'item', id, step: 'test', status: 'ok' })
        }
      }

      applied.push(id)
      await send({ t: 'item', id, step: 'done', status: 'ok' })
    }

    // ── Cancelled: does NOT consolidate anything (status/gate stay as they were) and notifies the client
    if (cancelled) {
      saveRecord(record)
      await send({ t: 'cancelled', note: 'Execution interrupted — partial changes remain in the clone until it is discarded' })
      return
    }

    // ── Consolidate: resolved status, gate delta, skill HTML and fix patch
    if (applied.length) {
      for (const id of applied) {
        const f = record.findings.find((x) => x.id === id)
        if (f) f.status = 'resolved'
      }
      record.fixApplied = [...(record.fixApplied ?? []), ...applied].filter((v, i, a) => a.indexOf(v) === i)
      const after = computeGate(record.findings, record.skipped)
      record.gate = after

      try {
        const reviewJsonP = path.join(record.repo.dir!, '.revai', 'data', `${record.slug}-review.json`)
        if (fs.existsSync(reviewJsonP)) {
          fs.writeFileSync(reviewJsonP, JSON.stringify(record.findings, null, 2) + '\n', 'utf8')
          if (skill.skillAvailable()) {
            const gen = await skill.generateReview(record.repo.dir!, record.slug)
            if (gen.htmlPath) {
              fs.copyFileSync(gen.htmlPath, path.join(recordDir(record.id), 'review.html'))
              record.artifacts.html = record.artifacts.html ?? 'review.html'
            }
          }
        }
      } catch { /* no sync — the platform UI is the primary source */ }
      try {
        const r = await exec(['git', 'diff', '--no-color', '--no-ext-diff'], { cwd: record.repo.dir! })
        if (r.code === 0 && r.stdout.trim()) {
          fs.writeFileSync(path.join(recordDir(record.id), 'fix.patch'), r.stdout, 'utf8')
          record.artifacts.fixPatch = 'fix.patch'
        }
      } catch { /* no patch */ }
      saveRecord(record)
      await send({ t: 'gate', before, after, applied, failed })
      await send({ t: 'done', reviewId: record.id, patchName: record.artifacts.fixPatch })
      return
    }

    saveRecord(record)
    await send({ t: 'gate', before, after: record.gate, applied, failed })
    await send({ t: 'done', reviewId: record.id })
  } catch (e) {
    if (cancelled || (e as any)?.code === 'job/cancelled') {
      saveRecord(record)
      await send({ t: 'cancelled', note: 'Changes remain in the clone — use Discard to revert' })
      return
    }
    const err = AppError.from(e)
    await send({ t: 'error', code: err.code, message: err.message, detail: err.detail })
  }
}

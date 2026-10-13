// Git plumbing — clone em cache ~/.revai/repos, branches, base detection, numstat, push/reset.
import fs from 'node:fs'
import path from 'node:path'
import { exec, stream } from './proc'
import type { FileStat } from '../shared/types'

export async function git(args: string[], cwd?: string, timeoutMs = 60_000) {
  return exec(['git', ...args], { cwd, timeoutMs })
}

/** roda mostrando progresso (clone/fetch) */
export function gitStream(
  args: string[],
  cwd: string | undefined,
  onLine: (line: string) => void,
  timeoutMs = 300_000,
) {
  return stream(['git', ...args], { cwd, onLine: (l) => onLine(l), timeoutMs })
}

export async function gitVersion(): Promise<string> {
  const r = await git(['--version'])
  return /git version ([^\s]+)/.exec(r.stdout)?.[1] ?? r.stdout.trim()
}

export async function isGitDir(dir: string): Promise<boolean> {
  const r = await git(['rev-parse', '--is-inside-work-tree'], dir)
  return r.code === 0 && r.stdout.includes('true')
}

export async function toplevel(dir: string): Promise<string> {
  const r = await git(['rev-parse', '--show-toplevel'], dir)
  return r.stdout.trim().split('\n')[0] ?? dir
}

export async function currentBranch(dir: string): Promise<string | null> {
  const r = await git(['rev-parse', '--abbrev-ref', 'HEAD'], dir)
  const v = r.stdout.trim()
  return r.code === 0 && v !== 'HEAD' ? v : null
}

export async function remoteUrl(dir: string): Promise<string | null> {
  const r = await git(['remote', 'get-url', 'origin'], dir)
  return r.code === 0 ? r.stdout.trim() : null
}

export async function lastCommitAuthor(dir: string): Promise<{ author: string; date: string } | null> {
  const r = await git(['log', '-1', '--format=%an%x09%ad', '--date=iso'], dir)
  const [author, date] = r.stdout.trim().split('\t')
  if (!author) return null
  return { author, date }
}

/** branch remota sugerida pelo origin/HEAD (como findBaseBranch da skill) */
export async function originHead(dir: string): Promise<string | null> {
  const r = await git(['remote', 'show', 'origin'], dir, 30_000)
  const m = r.stdout.match(/HEAD branch: ([^\s]+)/)
  return m ? m[1] : null
}

export async function remoteBranches(dir: string): Promise<string[]> {
  const r = await git(['branch', '-r', '--format=%(refname:short)'], dir)
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.includes('HEAD'))
    .sort()
}

export async function mergeBase(dir: string, a: string, b: string): Promise<string | null> {
  const r = await git(['merge-base', a, b], dir)
  return r.code === 0 ? r.stdout.trim().split('\n')[0] : null
}

/** detectBase: settings.defaultBase → origin/HEAD → main/master/develop (1ª com merge-base ok) */
export async function detectBase(
  dir: string,
  headRemoteRef: string,
  defaultBase: string,
): Promise<{ base: string; suggestions: string[] }> {
  const branches = await remoteBranches(dir)
  const strip = (ref: string) => ref.replace(/^origin\//, '')
  const candidates: string[] = [defaultBase]
  const oh = await originHead(dir)
  if (oh && !candidates.includes(oh)) candidates.push(oh)
  for (const extra of ['main', 'master', 'develop']) if (!candidates.includes(extra)) candidates.push(extra)

  const suggestions: string[] = []
  let base = ''
  for (const cand of candidates) {
    const full = branches.includes(`origin/${cand}`) ? `origin/${cand}` : cand
    const mb = await mergeBase(dir, headRemoteRef, full)
    if (mb && strip(headRemoteRef) !== cand) {
      if (!base) base = strip(full) === cand ? cand : full
      suggestions.push(cand)
    }
  }
  if (!base && oh) base = oh
  if (!base) base = defaultBase
  return { base, suggestions: suggestions.length ? suggestions.slice(0, 4) : [base] }
}

const LOCKFILE_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|go\.sum|composer\.lock|packages\.lock\.json)$/

export async function diffNumstat(dir: string, range: string[]): Promise<{ files: FileStat[]; additions: number; deletions: number }> {
  const r = await git(['diff', '--no-color', '--no-ext-diff', '--numstat', ...range], dir, 120_000)
  return parseNumstat(r.stdout)
}

export function dirSize(dir: string): number {
  let total = 0
  const walk = (d: string) => {
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try { total += fs.statSync(p).size } catch { /* file gone */ }
      }
    }
  }
  walk(dir)
  return total
}

export async function worktreeNumstat(dir: string): Promise<{ files: FileStat[]; additions: number; deletions: number }> {
  const r = await git(['diff', '--no-color', '--no-ext-diff', '--numstat'], dir)
  return parseNumstat(r.stdout)
}

export function parseNumstat(out: string): { files: FileStat[]; additions: number; deletions: number } {
  const files: FileStat[] = []
  let additions = 0, deletions = 0
  for (const line of out.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!m) continue
    const a = m[1] === '-' ? 0 : Number(m[1])
    const d = m[2] === '-' ? 0 : Number(m[2])
    const p = m[3].includes(' => ') ? (m[3].split(' => ').pop() ?? m[3]).replace(/^\{|\}$/g, '') : m[3]
    files.push({ path: p, added: a, removed: d, ignored: LOCKFILE_RE.test(p) })
    additions += a
    deletions += d
  }
  return { files, additions, deletions }
}

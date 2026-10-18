// Source resolution + clone staging in the ~/.revai/repos cache + prep for screen 03.
import fs from 'node:fs'
import path from 'node:path'
import { parseSource } from '../shared/urls'
import type { ParsedSource, Prepared, FileStat } from '../shared/types'
import * as g from './git'
import { repoPath, REPOS_DIR } from './paths'
import { AppError } from './errors'
import { readSettings } from './store'

export interface ResolveResult {
  accessible: boolean
  message: string
  defaultBranch?: string
  headHint?: { label: string; ref: string }
  /** present when the review mode degrades (e.g. full-folder review of a non-git directory) */
  warning?: string
}

const exists = (p: string) => fs.existsSync(p)

function tailOf(s: string, n = 3): string {
  return s.trim().split('\n').filter(Boolean).slice(-n).join('\n').slice(0, 500)
}

export async function resolveSource(input: string): Promise<{ parsed: ParsedSource; info: ResolveResult }> {
  const parsed = parseSource(input)
  if (parsed.kind === 'folder') {
    if (!exists(parsed.repo)) throw new AppError('source/unrecognized', 'Folder does not exist', parsed.repo)
    if (!(await g.isGitDir(parsed.repo))) {
      // not an error anymore: the review degrades to a full-folder review (no base/diff comparison)
      return {
        parsed,
        info: {
          accessible: true,
          message: 'Full-folder review — the folder is not a git repository',
          warning: 'Not a git repository — the review will cover the entire folder, without comparing changes against a base.',
        },
      }
    }
    const branch = await g.currentBranch(parsed.repo)
    return {
      parsed,
      info: {
        accessible: true,
        message: 'Valid local folder',
        defaultBranch: branch ?? undefined,
        headHint: branch ? { label: branch, ref: branch } : undefined,
      },
    }
  }

  const r = await g.git(['ls-remote', '--symref', parsed.url!, 'HEAD'], undefined, 45_000)
  if (r.code !== 0) {
    const tail = tailOf(r.stderr, 2)
    throw new AppError('repo/inaccessible', 'Could not read the remote repository', tail || undefined, 404)
  }
  const symref = /ref: refs\/heads\/([^\t]+)\tHEAD/.exec(r.stdout)?.[1]?.trim()
  return {
    parsed,
    info: {
      accessible: true,
      message: parsed.ref ? `Detected ref: ${parsed.ref.kind}` : 'Repository accessible',
      defaultBranch: symref,
      headHint: parsed.ref
        ? { label: parsed.ref.label, ref: parsed.ref.value }
        : symref
          ? { label: symref, ref: symref }
          : undefined,
    },
  }
}

const LANG_BY_EXT: Record<string, string> = {
  ts: 'Frontend', tsx: 'Frontend', js: 'Frontend', jsx: 'Frontend', css: 'Frontend', html: 'Frontend',
  cs: 'Backend', java: 'Backend', go: 'Backend', rs: 'Backend', kt: 'Backend', c: 'Backend', cpp: 'Backend',
  sql: 'Data', csv: 'Data',
}

function detectLanguages(files: FileStat[]): string[] {
  const counts = new Map<string, number>()
  for (const f of files) {
    if (f.ignored) continue
    if (/migration|schema|repository/i.test(f.path)) {
      counts.set('Data', (counts.get('Data') ?? 0) + 1)
      continue
    }
    const ext = f.path.split('.').pop()?.toLowerCase() ?? ''
    const lang = LANG_BY_EXT[ext]
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1)
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  return ['Backend', 'Data', 'Frontend'].filter((l) => top.includes(l))
}

export function detectTestCommand(dir: string): { argv: string[]; label: string } | null {
  if (exists(path.join(dir, 'package.json'))) return { argv: ['npm', 'test'], label: 'npm test' }
  for (const n of ['mvnw.cmd', 'mvnw.bat', 'mvnw']) {
    const p = path.join(dir, n)
    if (exists(p)) return { argv: [p, 'test'], label: 'mvn test (wrapper)' }
  }
  if (exists(path.join(dir, 'pom.xml'))) return { argv: ['mvn', 'test'], label: 'mvn test' }
  for (const n of ['gradlew.bat', 'gradlew']) {
    const p = path.join(dir, n)
    if (exists(p)) return { argv: [p, 'test'], label: 'gradle test (wrapper)' }
  }
  return null
}

/** clone/fetch with progress streaming */
async function setupClone(parsed: ParsedSource, onLine: (l: string) => void): Promise<string> {
  fs.mkdirSync(REPOS_DIR, { recursive: true })
  const dir = repoPath(parsed.host, parsed.org, parsed.repo)
  if (!exists(path.join(dir, '.git'))) {
    onLine(`git clone ${parsed.url}`)
    const r = await g.gitStream(['clone', '--progress', parsed.url!, dir], undefined, onLine, 600_000)
    if (r.code !== 0) {
      const tail = tailOf(r.stderr)
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignored */ }
      throw new AppError('repo/inaccessible', `Clone failed for ${parsed.url}`, tail, 404)
    }
    onLine(`Clone ready → ${dir}`)
    return dir
  }
  const r = await g.gitStream(['fetch', 'origin', '--prune', '--tags', '--progress'], dir, onLine, 600_000)
  if (r.code !== 0) {
    throw new AppError('repo/inaccessible', 'Fetch failed — check the system credentials', tailOf(r.stderr), 404)
  }
  onLine('Fetch up to date')
  return dir
}

async function checkoutHead(
  dir: string,
  parsed: ParsedSource,
  onLine: (l: string) => void,
): Promise<{ headBranch: string; refKind: Prepared['refKind'] }> {
  const ref = parsed.ref
  if (!ref) {
    const r0 = await g.git(['remote', 'show', 'origin'], dir, 60_000)
    const value = /HEAD branch: ([^\s]+)/.exec(r0.stdout)?.[1] ?? 'main'
    const r = await g.git(['checkout', '-B', value, `origin/${value}`], dir)
    onLine(`checkout default: ${value}`)
    if (r.code !== 0) throw new AppError('repo/head-not-found', 'Failed to check out the default branch', tailOf(r.stderr), 404)
    return { headBranch: value, refKind: 'branch' }
  }
  if (ref.kind === 'branch') {
    const r = await g.gitStream(['checkout', '-B', ref.value, `origin/${ref.value}`, '--progress'], dir, onLine, 300_000)
    if (r.code !== 0) throw new AppError('repo/head-not-found', 'Branch not found on the remote', ref.value, 404)
    return { headBranch: ref.value, refKind: 'branch' }
  }
  if (ref.kind === 'pr') {
    const local = `revai-pr-${ref.prNumber}`
    const specs = ['github', 'gitlab'].includes(parsed.provider)
      ? [parsed.provider === 'github' ? `pull/${ref.prNumber}/head` : `merge-requests/${ref.prNumber}/head`]
      : [`pull/${ref.prNumber}/head`, `merge-requests/${ref.prNumber}/head`]
    let ok = false
    for (const spec of specs) {
      const r = await g.gitStream(['fetch', 'origin', `${spec}:${local}`, '--progress'], dir, onLine, 600_000)
      if (r.code === 0) { ok = true; break }
      onLine(`refspec ${spec} unavailable, trying alternative…`)
    }
    if (!ok) throw new AppError('repo/head-not-found', `PR/MR #${ref.prNumber} not found on the remote`)
    const co = await g.git(['checkout', '-B', local], dir)
    if (co.code !== 0) throw new AppError('repo/head-not-found', 'Failed to check out the PR', tailOf(co.stderr), 404)
    return { headBranch: local, refKind: 'pr' }
  }
  // sha
  const local = `revai-${ref.value.slice(0, 7)}`
  const r = await g.git(['rev-parse', '--verify', `${ref.value}^{commit}`], dir)
  if (r.code !== 0) throw new AppError('repo/head-not-found', 'Commit not found', ref.value, 404)
  const co = await g.git(['checkout', '-B', local, ref.value], dir)
  if (co.code !== 0) throw new AppError('repo/head-not-found', 'Failed to check out the commit', tailOf(co.stderr), 404)
  return { headBranch: local, refKind: 'sha' }
}

// ── full-folder review (no git) ──────────────────────────────────────────────
// Folders without a git repository are reviewed as a whole: every file is in
// scope, there is no base/diff comparison. Directory walk with sensible
// excludes (dependencies, build output, binaries, lockfiles) and a hard cap.

const FULL_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', 'coverage',
  '__pycache__', '.next', '.nuxt', '.venv', 'venv', '.gradle', 'bin', 'obj',
  '.idea', '.vscode', '.revai', 'release', '.vite',
])
const FULL_BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'icns', 'pdf', 'zip', 'gz', 'tar', 'jar',
  'exe', 'dll', 'so', 'dylib', 'woff', 'woff2', 'ttf', 'eot', 'otf',
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'db', 'sqlite', 'class', 'pyc',
])
export const MAX_FULL_FILES = 400

export function walkFullFolder(repoDir: string): FileStat[] {
  const files: FileStat[] = []
  const walk = (d: string) => {
    if (files.length >= MAX_FULL_FILES) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files.length >= MAX_FULL_FILES) break
      if (e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (FULL_EXCLUDE_DIRS.has(e.name)) continue
        walk(p)
      } else {
        const ext = (e.name.split('.').pop() ?? '').toLowerCase()
        if (FULL_BINARY_EXT.has(ext)) continue
        try {
          const added = fs.readFileSync(p, 'utf8').split('\n').length
          files.push({ path: path.relative(repoDir, p).split(path.sep).join('/'), added, removed: 0, ignored: g.isLockfile(e.name) })
        } catch { /* unreadable/binary — skip */ }
      }
    }
  }
  walk(repoDir)
  return files
}

/** full-folder Prepared — no base, no diff, head = folder name */
function prepareFullFolder(repoDir: string, onLine: (l: string) => void): Prepared {
  onLine(`Local folder (no git) — full review: ${repoDir}`)
  const files = walkFullFolder(repoDir)
  const label = path.basename(repoDir)
  const totalLines = files.reduce((s, f) => s + (f.ignored ? 0 : f.added), 0)
  const rulesLines = exists(path.join(repoDir, '.revai', 'rules.md'))
    ? (() => { try { return fs.readFileSync(path.join(repoDir, '.revai', 'rules.md'), 'utf8').split('\n').length } catch { return 0 } })()
    : 0
  return {
    repoDir,
    label,
    head: label,
    headBranch: label,
    refKind: 'folder-full',
    base: '',
    baseSuggestions: [],
    branches: [],
    files,
    filesChanged: files.filter((f) => !f.ignored).length,
    // folder-full convention: "added" carries the file line count (size), removed stays 0
    additions: totalLines,
    deletions: 0,
    rules: {
      rulesMd: rulesLines > 0,
      rulesLines,
      contributing: exists(path.join(repoDir, 'CONTRIBUTING.md')),
      codingStandards: exists(path.join(repoDir, 'CODING_STANDARDS.md')) || exists(path.join(repoDir, 'coding-standards.md')),
    },
    languages: detectLanguages(files),
    estimateMs: 30_000 + files.length * 4_500 + totalLines * 40,
  }
}

export async function prepare(parsed: ParsedSource, onLine: (l: string) => void): Promise<Prepared> {
  let repoDir = ''
  let headLabel = ''
  let headBranch = ''
  let refKind: Prepared['refKind'] = 'branch'
  let branches: string[] = []
  let commits = 0
  let lastCommitAuthor: string | undefined

  if (parsed.kind === 'folder') {
    repoDir = parsed.repo
    if (!(await g.isGitDir(repoDir))) return prepareFullFolder(repoDir, onLine)
    headBranch = (await g.currentBranch(repoDir)) ?? 'HEAD'
    headLabel = headBranch
    refKind = 'working-tree'
    onLine(`Local folder: ${repoDir}`)
    branches = (await g.remoteBranches(repoDir)).map((b) => b.replace(/^origin\//, ''))
  } else {
    repoDir = await setupClone(parsed, onLine)
    const res = await checkoutHead(repoDir, parsed, onLine)
    headBranch = res.headBranch
    headLabel = parsed.ref?.label ?? headBranch
    refKind = res.refKind
    branches = (await g.remoteBranches(repoDir)).map((b) => b.replace(/^origin\//, ''))
  }

  const settings = readSettings()
  const refForBase = refKind === 'working-tree' ? 'HEAD' : headBranch
  const detection = await g.detectBase(repoDir, refForBase, settings.defaultBase)
  const base = detection.base

  const mb = (await g.mergeBase(repoDir, refForBase, base.startsWith('origin/') ? base : `origin/${base}`)) ?? base
  const stat = await g.diffNumstat(repoDir, [`${mb}...${refForBase}`])
  const files = stat.files
  const additions = stat.additions
  const deletions = stat.deletions
  const warning = files.some((f) => !f.ignored)
    ? undefined
    : 'No changes between base and head — the review will cover the entire folder (full-folder mode) instead.'

  if (refKind !== 'working-tree') {
    const cr = await g.git(['rev-list', '--count', `${base}..${headBranch}`], repoDir)
    if (cr.code === 0) commits = Number(cr.stdout.trim()) || 0
    const last = await g.lastCommitAuthor(repoDir)
    if (last) lastCommitAuthor = last.author
  }

  let rulesLines = 0
  const rulesMd = exists(path.join(repoDir, '.revai', 'rules.md'))
  if (rulesMd) {
    try { rulesLines = fs.readFileSync(path.join(repoDir, '.revai', 'rules.md'), 'utf8').split('\n').length } catch { /* foo */ }
  }

  return {
    repoDir,
    label: parsed.kind === 'folder' ? path.basename(repoDir) : `${parsed.host}/${parsed.org}/${parsed.repo}`,
    head: headLabel,
    headBranch,
    refKind,
    base,
    baseSuggestions: detection.suggestions.slice(0, 4),
    branches: [...new Set(branches)],
    files,
    filesChanged: files.filter((f) => !f.ignored).length,
    additions,
    deletions,
    rules: {
      rulesMd,
      rulesLines,
      contributing: exists(path.join(repoDir, 'CONTRIBUTING.md')),
      codingStandards: exists(path.join(repoDir, 'CODING_STANDARDS.md')) || exists(path.join(repoDir, 'coding-standards.md')),
    },
    languages: detectLanguages(files),
    estimateMs: 30_000 + files.length * 4_500 + additions * 150,
    warning,
    commits,
    lastCommitAuthor,
  }
}

export function prepareFromInput(input: string, onLine: (l: string) => void): Promise<Prepared> {
  return prepare(parseSource(input), onLine)
}

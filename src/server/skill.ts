// Bridge to the revai skill (skill-version/revai/skills/revai):
//   revai.mjs diff --current  → .revai/data/<slug>.patch
//   generate-review.mjs <slug> --no-open  → validates the JSONs and generates .revai/reviews/<slug>-review.html
import fs from 'node:fs'
import path from 'node:path'
import { exec } from './proc'
import { AppError } from './errors'
import { appRoot } from './root'
import * as g from './git'

export const PLATFORM_ROOT = appRoot()
// the skill is vendored in the repo (resources/revai-skill); skill-version/ is the legacy location
const VENDORED_SKILL_DIR = path.resolve(PLATFORM_ROOT, 'resources', 'revai-skill')
const LEGACY_SKILL_DIR = path.resolve(PLATFORM_ROOT, 'skill-version', 'revai', 'skills', 'revai')

const hasScripts = (dir: string) => fs.existsSync(path.join(dir, 'scripts', 'revai.mjs'))

/** files inside app.asar cannot be spawned by a child node process — use the unpacked twin */
function unpackAsar(dir: string): string {
  return dir.includes('app.asar') && !dir.includes('app.asar.unpacked')
    ? dir.replace('app.asar', 'app.asar.unpacked')
    : dir
}

/** best-effort resolution without throwing: '' when the skill is absent */
export function findSkillDir(): string {
  const candidates = [
    process.env.REVAI_SKILL_DIR ? unpackAsar(path.resolve(process.env.REVAI_SKILL_DIR)) : '',
    unpackAsar(VENDORED_SKILL_DIR),
    LEGACY_SKILL_DIR,
  ].filter(Boolean)
  for (const dir of candidates) {
    if (hasScripts(dir)) return dir
  }
  return ''
}

export function skillAvailable(): boolean {
  return findSkillDir() !== ''
}

export function skillDir(): string {
  const dir = findSkillDir()
  if (!dir) {
    throw new AppError(
      'skill/not-found',
      'revai skill not found (REVAI_SKILL_DIR, resources/revai-skill and skill-version/ all missing)',
      'Vendor the skill at resources/revai-skill or point REVAI_SKILL_DIR to a checkout of it',
    )
  }
  return dir
}

export function exists(p: string): boolean {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

export interface DiffOutput {
  slug: string
  patchPath: string
  filesChanged: number
  additions: number
  deletions: number
}

/** run `node revai.mjs diff --current` in the clone; returns artifact + stats */
export async function runDiff(cloneDir: string): Promise<DiffOutput> {
  const r = await exec([process.execPath, path.join(skillDir(), 'scripts', 'revai.mjs'), 'diff', '--current'], {
    cwd: cloneDir,
    timeoutMs: 120_000,
  })
  if (r.code !== 0) {
    const emptyHint = /empty/i.test(r.stderr) || /nothing to review|sem mudanças/i.test(r.stderr)
    throw new AppError(
      emptyHint ? 'repo/empty-diff' : 'diff/failed',
      emptyHint ? 'Empty patch — no changes between base and head' : 'revai.mjs diff finished with an error',
      r.stderr.trim().split('\n').slice(-3).join('\n') || undefined,
      emptyHint ? 409 : 500,
    )
  }
  const kv: Record<string, string> = {}
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = line.match(/^(Branch|Patch|Files|Lines|Slug)\s*:\s*(.+)$/)
    if (m) kv[m[1]] = m[2].trim()
  }
  const slug = kv['Slug'] ?? ''
  const patchPath = kv['Patch'] ?? ''
  if (!slug || !patchPath) {
    throw new AppError('diff/failed', 'diff returned no artifacts', r.stdout.trim())
  }
  const lm = kv['Lines']?.match(/^\+(\d+)\s*\/\s*-(\d+)$/)
  const fm = kv['Files']?.match(/^(\d+)/)
  return {
    slug,
    patchPath: path.isAbsolute(patchPath) ? patchPath : path.resolve(cloneDir, patchPath),
    filesChanged: fm ? Number(fm[1]) : 0,
    additions: lm ? Number(lm[1]) : 0,
    deletions: lm ? Number(lm[2]) : 0,
  }
}

/** validates the JSONs + assembles the skill HTML. An error here = schema/validation (real script messages). */
export async function generateReview(cloneDir: string, slug: string, timeoutMs = 120_000): Promise<{ htmlPath: string }> {
  const r = await exec([process.execPath, path.join(skillDir(), 'scripts', 'generate-review.mjs'), slug, '--no-open'], {
    cwd: cloneDir,
    timeoutMs,
  })
  if (r.code !== 0) {
    throw new AppError(
      'schema/validation',
      'Schema V2 validation failed — nothing is generated until it passes',
      r.stderr.trim().split('\n').slice(-4).join('\n') || r.stdout.trim().split('\n').slice(-4).join('\n'),
    )
  }
  const htmlPath = path.join(cloneDir, '.revai', 'reviews', `${slug}-review.html`)
  return { htmlPath: exists(htmlPath) ? htmlPath : '' }
}

/** built-in fallback (no skill): same artifact shape as the skill's `revai.mjs diff --current`,
 *  but using the platform's own base/head refs instead of the skill's origin/HEAD detection */
export async function fallbackDiff(repoDir: string, slug: string, base: string, head: string): Promise<DiffOutput> {
  const baseRef = base.startsWith('origin/') ? base : `origin/${base}`
  let mb = await g.mergeBase(repoDir, head, baseRef)
  if (!mb && !base.startsWith('origin/')) mb = await g.mergeBase(repoDir, head, base)
  const range = `${mb ?? base}...${head}`
  const r = await g.git(['diff', '--no-color', '--no-ext-diff', '--unified=3', range], repoDir, 120_000)
  if (r.code !== 0) {
    throw new AppError('diff/failed', 'git diff finished with an error', r.stderr.trim().split('\n').slice(-3).join('\n') || undefined, 500)
  }
  const patch = r.stdout.replace(/\r\n/g, '\n')
  if (!patch.trim()) {
    throw new AppError('repo/empty-diff', 'Empty patch — no changes between base and head', undefined, 409)
  }
  const dataDir = path.join(repoDir, '.revai', 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const patchPath = path.join(dataDir, `${slug}.patch`)
  fs.writeFileSync(patchPath, patch, 'utf8')
  const ns = await g.git(['diff', '--no-color', '--no-ext-diff', '--numstat', range], repoDir, 120_000)
  const stat = g.parseNumstat(ns.stdout)
  return {
    slug,
    patchPath,
    filesChanged: stat.files.filter((f) => !f.ignored).length,
    additions: stat.additions,
    deletions: stat.deletions,
  }
}

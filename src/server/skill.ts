// Ponte com a skill revai (skill-version/revai/skills/revai):
//   revai.mjs diff --current  → .revai/data/<slug>.patch
//   generate-review.mjs <slug> --no-open  → valida os JSONs e gera .revai/reviews/<slug>-review.html
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exec } from './proc'
import { AppError } from './errors'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PLATFORM_ROOT = path.resolve(HERE, '..', '..')
const DEFAULT_SKILL_DIR = path.resolve(PLATFORM_ROOT, 'skill-version', 'revai', 'skills', 'revai')

export function skillDir(): string {
  const dir = process.env.REVAI_SKILL_DIR ? path.resolve(process.env.REVAI_SKILL_DIR) : DEFAULT_SKILL_DIR
  if (!fs.existsSync(path.join(dir, 'scripts', 'revai.mjs'))) {
    throw new AppError('skill/not-found', `skill revai não encontrada em ${dir}`, 'Defina REVAI_SKILL_DIR ou mantenha skill-version/ na raiz do projeto.')
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

/** rodar `node revai.mjs diff --current` no clone; retorna artefato + stats */
export async function runDiff(cloneDir: string): Promise<DiffOutput> {
  const r = await exec([process.execPath, path.join(skillDir(), 'scripts', 'revai.mjs'), 'diff', '--current'], {
    cwd: cloneDir,
    timeoutMs: 120_000,
  })
  if (r.code !== 0) {
    const emptyHint = /empty/i.test(r.stderr) || /nothing to review|sem mudanças/i.test(r.stderr)
    throw new AppError(
      emptyHint ? 'repo/empty-diff' : 'diff/failed',
      emptyHint ? 'Patch vazio — nenhuma mudança entre base e head' : 'revai.mjs diff terminou com erro',
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
    throw new AppError('diff/failed', 'diff não retornou artefatos', r.stdout.trim())
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

/** valida os JSONs + monta o HTML da skill. Erro aqui = schema/validation (mensagens reais do script). */
export async function generateReview(cloneDir: string, slug: string, timeoutMs = 120_000): Promise<{ htmlPath: string }> {
  const r = await exec([process.execPath, path.join(skillDir(), 'scripts', 'generate-review.mjs'), slug, '--no-open'], {
    cwd: cloneDir,
    timeoutMs,
  })
  if (r.code !== 0) {
    throw new AppError(
      'schema/validation',
      'Validação do schema V2 falhou — nada é gerado até passar',
      r.stderr.trim().split('\n').slice(-4).join('\n') || r.stdout.trim().split('\n').slice(-4).join('\n'),
    )
  }
  const htmlPath = path.join(cloneDir, '.revai', 'reviews', `${slug}-review.html`)
  return { htmlPath: exists(htmlPath) ? htmlPath : '' }
}

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

export const REVAI_DIR = process.env.REVAI_HOME
  ? path.resolve(process.env.REVAI_HOME)
  : path.join(os.homedir(), '.revai')
export const REPOS_DIR = path.join(REVAI_DIR, 'repos')
export const REVIEWS_DIR = path.join(REVAI_DIR, 'reviews')

export function ensureDirs() {
  for (const d of [REVAI_DIR, REPOS_DIR, REVIEWS_DIR]) fs.mkdirSync(d, { recursive: true })
}

export function repoPath(host: string, org: string, name: string): string {
  const s = (v: string) => (v || '_').toLowerCase().replace(/[^a-z0-9._-]/g, '_')
  return path.join(REPOS_DIR, s(host), s(org), s(name))
}

export function recordDir(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error('invalid id')
  return path.join(REVIEWS_DIR, id)
}

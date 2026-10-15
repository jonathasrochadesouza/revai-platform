// Human-readable storage in ~/.revai — settings.json, harnesses.json, reviews/index.json
// and reviews/<id>/record.json (+ artifacts copied from the skill). Atomic writes.
import fs from 'node:fs'
import path from 'node:path'
import { REVAI_DIR, REVIEWS_DIR, recordDir } from './paths'
import { DEFAULT_SETTINGS } from './defaults'
import type { HarnessState, ReviewRecord, ReviewRow, Settings } from '../shared/types'

function readJson<T>(file: string, fallback: T): T {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (Array.isArray(fallback)) {
      // a persisted array may have been corrupted by spread (numeric keys) — normalize
      if (Array.isArray(parsed)) return parsed as T
      if (parsed && typeof parsed === 'object') return Object.values(parsed) as unknown as T
      return fallback
    }
    return { ...(fallback as object), ...(parsed as object) } as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

// ── Settings ──────────────────────────────────────────────────────────────
const settingsFile = () => path.join(REVAI_DIR, 'settings.json')
export function readSettings(): Settings {
  return readJson<Settings>(settingsFile(), DEFAULT_SETTINGS)
}
export function writeSettings(s: Settings) {
  writeJson(settingsFile(), s)
}

// ── Harnesses ─────────────────────────────────────────────────────────────
const harnessesFile = () => path.join(REVAI_DIR, 'harnesses.json')
export function readHarnessStates(): HarnessState[] {
  return readJson<HarnessState[]>(harnessesFile(), [])
}
export function writeHarnessStates(list: HarnessState[]) {
  writeJson(harnessesFile(), list)
}
export function upsertHarnessState(state: HarnessState) {
  const list = readHarnessStates()
  const i = list.findIndex((h) => h.defId === state.defId)
  if (i >= 0) list[i] = { ...list[i], ...state }
  else list.push(state)
  writeHarnessStates(list)
}

// ── Reviews ───────────────────────────────────────────────────────────────
const indexFile = () => path.join(REVIEWS_DIR, 'index.json')
export function readIndex(): ReviewRow[] {
  try {
    const rows = JSON.parse(fs.readFileSync(indexFile(), 'utf8'))
    return Array.isArray(rows) ? rows : []
  } catch {
    return []
  }
}
export function saveIndex(rows: ReviewRow[]) {
  writeJson(indexFile(), rows)
}
export function upsertIndex(row: ReviewRow) {
  const rows = readIndex().filter((r) => r.id !== row.id)
  rows.unshift(row)
  saveIndex(rows.slice(0, 500))
}

export function saveRecord(record: ReviewRecord) {
  writeJson(path.join(recordDir(record.id), 'record.json'), record)
  const row: ReviewRow = {
    id: record.id,
    createdAt: record.createdAt,
    repoLabel: record.repo.label,
    head: record.head,
    headBranch: record.headBranch,
    gate: record.gate.status,
    critical: record.gate.criticalOpen,
    open: record.findings.filter((f) => f.status === 'open').length,
    harnessName: record.harnessName,
    durationMs: record.stats.durationMs,
    model: record.model,
    prNumber: record.prNumber,
  }
  upsertIndex(row)
}

export function loadRecord(id: string): ReviewRecord | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(recordDir(id), 'record.json'), 'utf8')) as ReviewRecord
  } catch {
    return null
  }
}

export function deleteRecord(id: string) {
  try {
    fs.rmSync(recordDir(id), { recursive: true, force: true })
  } catch { /* already removed */ }
  saveIndex(readIndex().filter((r) => r.id !== id))
}

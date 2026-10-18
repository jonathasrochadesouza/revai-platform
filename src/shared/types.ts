// Platform data contract — mirrors the skill's V2 schema (skill-version/revai).
// Valid severities/efforts/categories, findings, meta and Quality Gate.

export type Severity = 'critical' | 'major' | 'minor' | 'trivial'
export type Category = 'security' | 'performance' | 'stability' | 'data-integrity'
export type Effort = 'quick-win' | 'estimated' | 'significant'
export type FindingStatus = 'open' | 'resolved'

export interface ProposedFix {
  language: string
  before: string[]
  after: string[]
}

export interface Finding {
  id: string // CR-01, CR-02…
  title: string
  description: string
  file: string
  lines: string
  severity?: Severity
  priority?: Severity // legacy; mapped via PRIORITY_MAP
  effort: Effort
  status: FindingStatus
  category?: Category
  rationale?: string
  copilotSummary?: string // legacy
  proposedFix?: ProposedFix
}

export interface MetaFile {
  path: string
  summary: string
  issues: number
  effort: string
}

export interface ReviewMeta {
  author: string
  reviewer: string
  branch: string
  walkthrough: string
  files: MetaFile[]
}

export interface Gate {
  status: 'passed' | 'failed'
  criteria: { label: string; tone: 'err' | 'warn' | 'info' }[]
  criticalOpen: number
  securityOpen: number
  skippedBlockers: number
  actionableOpen: number
}

// ── Sources ────────────────────────────────────────────────────────────────
export interface ParsedRef {
  value: string // branch, pull/<n>/head or sha
  kind: 'branch' | 'pr' | 'sha'
  prNumber?: number
  label: string // e.g. "feature/PEQ-2450" or "PR #482"
}

export interface ParsedSource {
  kind: 'remote' | 'folder'
  provider: 'github' | 'gitlab' | 'other'
  host: string
  org: string
  repo: string
  url?: string // normalized clone URL
  ref?: ParsedRef
  raw: string
}

// ── Harnesses ─────────────────────────────────────────────────────────────
export interface HarnessDef {
  id: string
  name: string
  cli: string // executable name for "where/which"
  logo: string // 1–2 letters for the tile
  models: string[] // ['auto', …] — the label 'Harness default (auto)' is the host: 'auto'
}

export interface ValidationItem {
  key: string
  label: string
  ok: boolean
  ms: number
  detail?: string
}

export interface HarnessValidation {
  ok: boolean
  at: number
  items: ValidationItem[]
}

export interface HarnessState {
  defId: string // 'kiro' | 'claude' | … | 'custom-<slug>'
  customName?: string // for custom-*
  exe?: string // resolved path/override
  model?: string // 'auto' | model id
  isDefault?: boolean
  lastValidation?: HarnessValidation
  customArgs?: { review?: string[]; fix?: string[]; test?: string[] } // templates {exe} {prompt} {model}
}

// ── Runtime ────────────────────────────────────────────────────────────────
export interface OnboardingHarness {
  id: string
  name: string
  logo: string
  status: 'ready' | 'found' | 'unvalidated' | 'not-found'
  version?: string
  exe?: string
  detail: string
  isDefault: boolean
  validatedAt?: number
  modelName?: string
  model?: string
  models?: string[]
}

export interface RuntimeInfo {
  node: string
  git: string
  platform: string
  revaiDir: string
}

// ── Project preparation (screen 03) ───────────────────────────────────────
export interface FileStat {
  path: string
  added: number
  removed: number
  ignored: boolean // lockfiles
}

export interface RulesInfo {
  rulesMd: boolean
  rulesLines: number
  contributing: boolean
  codingStandards: boolean
}

export interface Prepared {
  repoDir: string
  label: string // "github.com/acme/checkout-api"
  head: string // display label
  headBranch: string // local branch in the clone
  refKind: 'branch' | 'pr' | 'sha' | 'working-tree' | 'folder-full'
  base: string
  baseSuggestions: string[] // ["main (origin/HEAD)", "develop", …]
  branches: string[] // available origin/* refs
  files: FileStat[]
  filesChanged: number
  additions: number
  deletions: number
  rules: RulesInfo
  languages: string[]
  estimateMs: number
  /** present when the review mode degrades (e.g. empty diff vs base → full-folder review) */
  warning?: string
  commits?: number
  lastCommitAuthor?: string
}

// ── Review ────────────────────────────────────────────────────────────────
export interface ReviewRepo {
  host: string
  org: string
  name: string
  url?: string
  dir?: string
  label: string
}

export interface ReviewRecord {
  id: string
  createdAt: number
  repo: ReviewRepo
  head: string
  headBranch: string
  base: string
  slug: string
  prNumber?: number
  harnessId: string
  harnessName: string
  model?: string
  refKind: 'branch' | 'pr' | 'sha' | 'working-tree' | 'folder-full'
  stats: { filesChanged: number; additions: number; deletions: number; durationMs: number }
  rules: RulesInfo
  meta?: ReviewMeta
  findings: Finding[]
  skipped: string[] // "skipped" ids (blocker waived)
  gate: Gate
  artifacts: { patch?: string; html?: string; reviewJson?: string; metaJson?: string; fixPatch?: string }
  fixApplied?: string[]
}

export interface ReviewRow {
  id: string
  createdAt: number
  repoLabel: string
  head: string
  headBranch: string
  gate: 'passed' | 'failed'
  critical: number
  open: number
  harnessName: string
  durationMs: number
  model?: string
  prNumber?: number
}

// ── Settings ──────────────────────────────────────────────────────────────
export interface Settings {
  theme: 'system' | 'dark' | 'light'
  defaultBase: string
  openReportOnFinish: boolean
  runTestsInFixLoop: boolean
  globalRules: string
  cloneRetentionDays: 0 | 7 | 30
}

// ── SSE events ───────────────────────────────────────────────────────────
export type StepId = 'clone' | 'patch' | 'analyze' | 'capture' | 'validate' | 'assemble'

export type SseEvent =
  | { t: 'job'; id: string }
  | { t: 'step'; id: StepId; label: string; status: 'running' | 'done' | 'failed'; detail?: string }
  | { t: 'log'; stream: 'git' | 'agent' | 'script' | 'tests'; line: string; cls?: string }
  | { t: 'stats'; filesChanged: number; additions: number; deletions: number; slug: string; patchPath: string }
  | { t: 'gate'; gate: Gate }
  | { t: 'done'; reviewId: string }
  | { t: 'error'; code: string; message: string; detail?: string }
  | { t: 'cancelled'; note?: string }

export interface RunReviewBody {
  source: string
  head: string
  base: string
  harnessId: string
  model?: string
  rules?: string // extra rules pasted in screen 03 (future)
}

export type FixItemId = string

export type FixEvent =
  | { t: 'job'; id: string }
  | { t: 'queue'; items: { id: string; title: string; severity?: string; category?: string }[] }
  | { t: 'item'; id: string; step: 'apply' | 'test' | 'done' | 'failed'; status: 'running' | 'ok' | 'failed'; ms?: number; detail?: string }
  | { t: 'log'; id?: string; stream: 'agent' | 'tests' | 'git'; line: string }
  | { t: 'gate'; before: Gate; after: Gate; applied: string[]; failed: string[] }
  | { t: 'done'; reviewId: string; patchName?: string }
  | { t: 'error'; code: string; message: string; detail?: string }
  | { t: 'cancelled'; note?: string }

export interface RunFixBody {
  ids: string[]
  runTests?: boolean
}

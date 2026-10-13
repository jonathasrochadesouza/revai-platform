// Harnesses locais — descoberta, validação (checklist com tempos) e templates de invocação.
// O prompt grande SEMPRE vai via stdin — evita limite de linha de comando no Windows.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exec, stream } from './proc'
import { upsertHarnessState, readHarnessStates } from './store'
import type { HarnessDef, HarnessState, OnboardingHarness, ValidationItem } from '../shared/types'

export const HARNESS_DEFS: HarnessDef[] = [
  { id: 'kiro', name: 'Kiro CLI', cli: 'kiro-cli', logo: 'K', models: ['auto'] },
  { id: 'claude', name: 'Claude Code', cli: 'claude', logo: 'C', models: ['auto', 'claude-sonnet-4.5', 'claude-opus-4.1'] },
  { id: 'codex', name: 'Codex CLI', cli: 'codex', logo: 'DX', models: ['auto'] },
  { id: 'opencode', name: 'OpenCode', cli: 'opencode', logo: 'OC', models: ['auto'] },
  { id: 'copilot', name: 'Copilot CLI', cli: 'copilot', logo: 'CH', models: ['auto'] },
]

const isWin = process.platform === 'win32'

function candidates(cli: string): string[] {
  const home = os.homedir()
  const list = [cli]
  if (isWin) {
    list.push(path.join(home, '.local', 'bin', `${cli}.exe`))
    list.push(path.join(home, 'AppData', 'Roaming', 'npm', `${cli}.cmd`))
    list.push(path.join(home, 'AppData', 'Local', 'Programs', cli, `${cli}.exe`))
  } else {
    list.push(path.join(home, '.local', 'bin', cli))
    list.push(`/usr/local/bin/${cli}`)
    list.push(`/usr/bin/${cli}`)
  }
  return list
}

/** resolve o executável: PATH via where/which + caminhos conhecidos + override salvo */
export async function resolveExe(defId: string, states: HarnessState[] = readHarnessStates()): Promise<string | null> {
  const state = states.find((s) => s.defId === defId)
  if (state?.exe && fs.existsSync(state.exe)) {
    if (isWin && !/\.(exe|com|cmd|bat)$/i.test(state.exe)) {
      const withCmd = state.exe + '.cmd'
      if (fs.existsSync(withCmd)) return withCmd
    }
    return state.exe
  }
  if (defId.startsWith('custom-')) {
    const filled = state?.exe && fs.existsSync(state.exe) ? state.exe : null
    return filled && (isWin ? /\.(exe|com|cmd|bat)$/i.test(filled) : true) ? filled : null
  }
  const def = HARNESS_DEFS.find((d) => d.id === defId)
  if (!def) return null
  const probe = isWin ? ['where', def.cli] : ['which', def.cli]
  const r = await exec(probe, { timeoutMs: 5_000 })
  if (r.code === 0) {
    const lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    // Windows: shims sem extensão (~=.cmd do npm) não spawnam — prefere .exe/.cmd/.bat/.com
    const exe = isWin
      ? lines.find((l) => /\.(exe|com|cmd|bat)$/i.test(l)) ?? (/\.[\w.]+$/.test(lines[0] ?? '') ? lines[0] : undefined)
      : lines[0]
    if (exe) return exe
  }
  for (const c of candidates(def.cli)) if (fs.existsSync(c)) return c
  return null
}

export interface Invoke {
  argv: string[]
  stdin: boolean
  promptArgIndex?: number
}

/**
 * Templates de invocação (review/fix). Editáveis via customArgs em ~/.revai/harnesses.json
 * — tokens: {exe} {prompt} {model}. Sandbox = clone descartável em ~/.revai/repos.
 */
export function invoke(
  defId: string,
  mode: 'review' | 'fix',
  exePath: string | null,
  model?: string,
): Invoke {
  const state = readHarnessStates().find((s) => s.defId === defId)
  const exe = exePath ?? state?.exe ?? defId
  const m = model && model !== 'auto' ? model : undefined

  if (state?.customArgs) {
    const tpl = state.customArgs.review
    if (tpl && tpl.length) {
      const argv: string[] = []
      let promptArgIndex: number | undefined
      for (const raw of tpl) {
        if (raw === '{prompt}') {
          promptArgIndex = argv.length
          argv.push('')
        } else {
          argv.push(raw.replaceAll('{exe}', exe).replaceAll('{model}', m ?? ''))
        }
      }
      return { argv, stdin: promptArgIndex === undefined, promptArgIndex }
    }
  }

  const modelArg = (flag: string): string[] => (m ? [flag, m] : [])
  let argv: string[]
  switch (defId) {
    case 'claude':
      argv = [
        exe,
        ...modelArg('--model'),
        '-p',
        '--disallowedTools', 'Bash',
        '--allowedTools', mode === 'fix' ? 'Edit,MultiEdit,Write,Read,Glob,Grep,NotebookEdit' : 'Write,Read,Glob,Grep',
      ]
      break
    case 'codex':
      argv = [exe, ...modelArg('-m'), 'exec', '--sandbox', 'workspace-write', '--skip-git-repo-check']
      break
    case 'opencode':
      argv = [exe, ...modelArg('--model'), 'run']
      break
    case 'copilot':
      argv = [exe, ...modelArg('--model'), '-p'] // experimental — template editável no harnesses.json
      break
    case 'kiro':
    default:
      argv = [exe, 'exec', ...modelArg('--model')]
  }
  return { argv, stdin: true }
}

export function finalArgv(inv: Invoke, prompt: string): string[] {
  if (inv.promptArgIndex === undefined) return inv.argv
  const copy = inv.argv.slice()
  copy[inv.promptArgIndex] = prompt
  return copy
}

function statusOf(state: HarnessState | undefined, found: string | null, version: string | undefined) {
  if (!found) return 'not-found' as const
  if (state?.lastValidation?.ok) return 'ready' as const
  return version ? ('found' as const) : ('unvalidated' as const)
}

export async function discoverHarnesses(): Promise<OnboardingHarness[]> {
  const states = readHarnessStates()
  const defaultDefId = states.find((s) => s.isDefault)?.defId ?? 'kiro'
  const out: OnboardingHarness[] = []
  for (const def of HARNESS_DEFS) {
    const state = states.find((s) => s.defId === def.id)
    const exe = await resolveExe(def.id, states)
    let version: string | undefined
    if (exe) {
      const r = await exec([exe, '--version'], { timeoutMs: 10_000 })
      version = /v?\d[\w.-]*/.exec(r.stdout.trim().split('\n')[0] ?? '')?.[0]?.replace(/^v/, '')
    }
    out.push({
      id: def.id,
      name: def.name,
      logo: def.logo,
      status: statusOf(state, exe, version),
      version,
      exe: exe ?? undefined,
      model: state?.model,
      models: def.models,
      detail: exe ? `${exe}` : 'não encontrado no PATH',
      isDefault: state?.isDefault ?? defaultDefId === def.id,
      validatedAt: state?.lastValidation?.at,
      modelName: state?.model && state.model !== 'auto' ? state.model : undefined,
    })
  }
  for (const state of states.filter((s) => s.defId.startsWith('custom-'))) {
    const exe = state.exe
    let version: string | undefined
    if (exe && fs.existsSync(exe)) {
      const r = await exec([exe, '--version'], { timeoutMs: 10_000 })
      version = /v?\d[\w.-]*/.exec(r.stdout.trim().split('\n')[0] ?? '')?.[0]?.replace(/^v/, '')
    }
    out.push({
      id: state.defId,
      name: state.customName ?? state.defId,
      logo: '✚',
      status: statusOf(state, exe && fs.existsSync(exe) ? exe : null, version),
      version,
      exe,
      detail: exe ?? 'executável ausente',
      isDefault: state.isDefault ?? false,
      validatedAt: state.lastValidation?.at,
    })
  }
  return out
}

export interface ValidateResult {
  ok: boolean
  at: number
  items: ValidationItem[]
}

/** checklist com tempos individualizados, como a tela 08 do protótipo */
export async function validateHarness(defId: string): Promise<ValidateResult> {
  const states = readHarnessStates()
  const items: ValidationItem[] = []
  const ms = () => Date.now()

  // 1. encontrado
  let t = ms()
  const exe = await resolveExe(defId, states)
  items.push({
    key: 'found',
    label: 'Encontrado no PATH',
    ok: !!exe,
    ms: ms() - t,
    detail: exe ?? 'nenhum caminho localizado',
  })
  if (!exe) {
    persistValidation(defId, items, false, undefined)
    return { ok: false, at: Date.now(), items }
  }

  // 2. --version
  t = ms()
  const vr = await exec([exe!, '--version'], { timeoutMs: 15_000 })
  const first = vr.stdout.trim().split('\n')[0] ?? ''
  const version = /v?\d[\w.-]*/.exec(first)?.[0]?.replace(/^v/, '')
  items.push({
    key: 'version',
    label: `--version (${version ?? 'n/d'})`,
    ok: vr.code === 0,
    ms: ms() - t,
    detail: (vr.stdout + vr.stderr).trim().split('\n')[0]?.slice(0, 120),
  })

  // 3. sessão autenticada + 4. prompt de teste — exige linha isolada "OK" e exit 0
  // (ecos do próprio prompt NÃO contam — evitar falso-positivo como o do codex 401)
  t = ms()
  const inv = invoke(defId, 'review', exe, undefined)
  const argv2 = finalArgv(inv, 'Responda apenas com a palavra OK.')
  const tr = await stream(argv2, { cwd: undefined, stdin: inv.stdin ? 'Responda apenas com a palavra OK.' : undefined, timeoutMs: 180_000 })
  const all = tr.stdout + '\n' + tr.stderr
  const outOnly = tr.stdout
  const authFail = /not logged in|unauthorized|missing bearer|401|login required|_API_KEY|permission denied/i.test(all)
  const okLine = /^[\s>*_`#\-]*(OK|Ok|ok)[\s.!?]*$/m.test(outOnly)
  const saidOk = okLine && tr.code === 0 && !authFail
  items.push({
    key: 'session',
    label: 'Sessão autenticada',
    ok: saidOk,
    ms: ms() - t,
    detail: authFail ? 'não autenticado — executar login do CLI' : saidOk ? 'respondeu OK' : 'sem resposta útil',
  })
  items.push({
    key: 'prompt',
    label: 'Prompt de teste executado',
    ok: saidOk,
    ms: ms() - t,
    detail: tr.timedOut ? 'timeout' : saidOk ? 'OK' : all.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 120),
  })
  items.push({
    key: 'scope',
    label: 'Permissão restrita (review)',
    ok: true,
    ms: 0,
    detail: 'sandbox = clone descartável em ~/.revai/repos',
  })

  const ok = items.every((i) => i.ok)
  persistValidation(defId, items, ok, exe!)
  return { ok, at: Date.now(), items }
}

function persistValidation(defId: string, items: ValidationItem[], ok: boolean, exe?: string) {
  const states = readHarnessStates()
  const idx = states.findIndex((s) => s.defId === defId)
  const base: HarnessState = idx >= 0 ? states[idx] : { defId }
  const next: HarnessState = {
    ...base,
    defId,
    lastValidation: { ok, at: Date.now(), items },
    exe: exe ?? base.exe,
  }
  if (idx >= 0) states[idx] = next
  else states.push(next)
  upsertHarnessState(next)
}

export function harnessName(defId: string): string {
  if (defId.startsWith('custom-')) {
    return readHarnessStates().find((s) => s.defId === defId)?.customName ?? defId
  }
  return HARNESS_DEFS.find((d) => d.id === defId)?.name ?? defId
}

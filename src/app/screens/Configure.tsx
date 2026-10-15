// 03-configure — branch/base, changed files, rules and time estimate.
// The runner (default harness chosen in the first setup) runs the review — no harness management here.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, useToast, fmtDur } from '../ui'
import { get, post } from '../api'
import type { OnboardingHarness, Prepared } from '../../shared/types'
import { loadSource, saveRun } from '../flow'

type Err = { code: string; message: string }

function pickDefault(hs: OnboardingHarness[]): OnboardingHarness | null {
  return (
    hs.find((h) => h.isDefault && h.status !== 'not-found') ??
    hs.find((h) => h.status !== 'not-found') ??
    hs.find((h) => h.id !== undefined && h) ??
    null
  )
}

export default function Configure() {
  const nav = useNavigate()
  const toast = useToast()
  const source = loadSource()
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [prepErr, setPrepErr] = useState<Err | null>(null)
  const [head, setHead] = useState('')
  const [base, setBase] = useState('')
  const [runner, setRunner] = useState<OnboardingHarness | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    if (!source) {
      nav('/new', { replace: true })
      return
    }
    get<{ harnesses: OnboardingHarness[] }>('/onboarding/detect')
      .then((d) => setRunner(pickDefault(d.harnesses)))
      .catch(() => {})

    post<Prepared>('/projects/prepare', { source })
      .then((p) => {
        setPrepared(p)
        setHead(p.head)
        setBase(p.base)
      })
      .catch((e) => setPrepErr({ code: e.code ?? 'internal/error', message: e.message }))
  }, [source, nav])

  const start = useCallback(async () => {
    if (!prepared || !source) return
    setStarting(true)
    try {
      let target = runner
      if (!target) {
        const d = await get<{ harnesses: OnboardingHarness[] }>('/onboarding/detect')
        target = pickDefault(d.harnesses)
      }
      if (!target) {
        throw Object.assign(
          new Error('no local CLI found (kiro-cli / claude / codex / opencode) — run the first setup at /onboarding'),
          { code: 'harness/not-found' },
        )
      }
      if (target.status !== 'ready') {
        toast(`Validating ${target.name} before starting…`)
        await post('/harnesses/validate', { id: target.id })
      }
      saveRun({ source, head, base, harnessId: target.id })
      toast(`Review started with ${target.name}`, 'ok')
      nav('/running')
    } catch (e: any) {
      toast(`Failed to start: ${e.message}`, 'err')
    } finally {
      setStarting(false)
    }
  }, [prepared, source, runner, head, base, toast, nav])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        void start()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [start])

  if (prepErr) {
    return (
      <div className="page narrow">
        <h1>Configure</h1>
        <div className="callout err"><Icon name="alert" /><span><b>{prepErr.code}</b><br /><span className="small">{prepErr.message}</span></span></div>
        <button className="btn" onClick={() => nav('/new')}>← New source</button>
      </div>
    )
  }

  if (!prepared) {
    return (
      <div className="page narrow">
        <h1>Configure</h1>
        <div className="row"><span className="spinner" /> <span className="muted">Cloning and preparing the diff…</span></div>
      </div>
    )
  }

  const files = prepared.files.filter((f) => !f.ignored)
  const maxDelta = Math.max(1, ...files.map((f) => f.added + f.removed))

  return (
    <div className="page narrow">
      <h1 className="mono" style={{ fontSize: 18 }}>{prepared.label}</h1>
      <p className="lede">
        Branch + scope. Cloned to <span className="mono small">{prepared.repoDir}</span>
      </p>

      <div className="report-grid">
        <div className="col" style={{ gap: 20 }}>
          <div className="card pad col">
            <div className="grid-2">
              <label className="field">
                branch (head)
                <select className="select" value={head} onChange={(e) => setHead(e.target.value)}>
                  {[prepared.head, ...prepared.branches.filter((b) => b !== prepared.head)].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                base
                <select className="select" value={base} onChange={(e) => setBase(e.target.value)}>
                  {prepared.baseSuggestions.map((b) => (
                    <option key={b} value={b}>{b}{b === prepared.base ? ' (auto)' : ''}</option>
                  ))}
                </select>
              </label>
            </div>
            {!!prepared.commits && (
              <div className="small muted num">
                {prepared.commits} commit(s) {prepared.lastCommitAuthor ? `· last by ${prepared.lastCommitAuthor}` : ''}
              </div>
            )}
          </div>

          <div className="card pad col">
            <b className="small">{prepared.filesChanged} file(s) changed</b>
            {files.slice(0, 9).map((f) => (
              <div key={f.path} className="frow">
                <span className="path mono">{f.path}</span>
                <span className="bar" title={`+${f.added} −${f.removed}`}>
                  <span className="b-add" style={{ width: `${(f.added / maxDelta) * 100}%` }} />
                  <span className="b-del" style={{ width: `${(f.removed / maxDelta) * 100}%` }} />
                </span>
                <span className="num muted">{f.added > 0 ? `+${f.added}` : ''} {f.removed > 0 ? `−${f.removed}` : ''}</span>
              </div>
            ))}
            {prepared.files.filter((f) => f.ignored).slice(0, 3).map((f) => (
              <div key={f.path} className="frow faint">
                <span className="path mono">{f.path}</span>
                <span className="badge small">ignored · lockfile</span>
              </div>
            ))}
          </div>

          <div className="card pad col">
            <b className="small">Rules detected</b>
            <span className="row small"><span className={`dot ${prepared.rules.rulesMd ? 'ok' : 'crit'}`} /> .revai/rules.md {prepared.rules.rulesMd ? `· ${prepared.rules.rulesLines} lines` : 'not found'}</span>
            <span className="row small"><span className={`dot ${prepared.rules.contributing ? 'ok' : 'off'}`} /> CONTRIBUTING.md</span>
            <span className="row small"><span className={`dot ${prepared.rules.codingStandards ? 'ok' : 'off'}`} /> CODING_STANDARDS.md</span>
          </div>
        </div>

        <div className="side-fill col" style={{ gap: 16 }}>
          <div className="card pad row small" style={{ gap: 8 }}>
            <span className={`dot ${runner?.status === 'ready' ? 'ok' : 'off'}`} />
            <b>{runner?.name ?? 'no runner'}</b>
            {runner?.version && <span className="mono num faint">{runner.version}</span>}
            <span className="faint">runs this review · {runner?.status === 'ready' ? 'validated' : 'validates on start'}</span>
          </div>

          <div className="card pad">
            <dl className="kv" style={{ gridTemplateColumns: '92px 1fr' }}>
              <dt>Scope</dt><dd>Changed lines only</dd>
              <dt>Playbooks</dt><dd>{prepared.languages.join(', ') || 'General'}</dd>
              <dt>Time</dt><dd className="num">~{fmtDur(prepared.estimateMs)}</dd>
            </dl>
          </div>

          <button className="btn primary lg" disabled={starting} onClick={() => void start()}>
            Start review <kbd>Ctrl ↵</kbd> {starting && <span className="spinner" />}
          </button>
        </div>
      </div>
    </div>
  )
}

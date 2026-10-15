// 01-onboarding — detection + validation of local harnesses (standalone screen)
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, relTime } from '../ui'
import { get, post } from '../api'
import type { OnboardingHarness, RuntimeInfo, ValidationItem } from '../../shared/types'

type ValidateResult = { ok: boolean; at: number; items: ValidationItem[] }
type Detect = { harnesses: OnboardingHarness[]; runtime: RuntimeInfo }

export default function Onboarding() {
  const nav = useNavigate()
  const [data, setData] = useState<Detect | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [validating, setValidating] = useState<Record<string, boolean>>({})
  const [validations, setValidations] = useState<Record<string, ValidateResult | null>>({})
  const [manualPath, setManualPath] = useState('')
  const [manualName, setManualName] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = () =>
    get<Detect>('/onboarding/detect')
      .then((d) => {
        setData(d)
        setSel((s) => s ?? d.harnesses.find((h) => h.isDefault && h.status === 'ready')?.id ?? d.harnesses.find((h) => h.status !== 'not-found')?.id ?? null)
      })
      .catch(() => {})

  useEffect(() => {
    void reload()
  }, [])

  const validate = async (id: string) => {
    setValidating((v) => ({ ...v, [id]: true }))
    try {
      const r = await post<ValidateResult>('/harnesses/validate', { id })
      setValidations((v) => ({ ...v, [id]: r }))
    } finally {
      setValidating((v) => ({ ...v, [id]: false }))
    }
    void reload()
  }

  const addManual = async () => {
    if (!manualPath.trim()) return
    if (!manualName.trim()) return
    const slug = manualName.trim().toLowerCase().replace(/[^\w-]+/g, '-')
    await post('/harnesses', { id: `custom-${slug}`, customName: manualName.trim(), exe: manualPath.trim() })
    setManualPath('')
    setManualName('')
    void reload()
  }

  const continueFlow = async () => {
    if (!sel) return
    setBusy(true)
    try {
      const ready = validations[sel]?.ok || data?.harnesses.find((h) => h.id === sel)?.status === 'ready'
      if (!ready) await validate(sel)
      await post('/harnesses', { id: sel, isDefault: true })
      nav('/new')
    } finally {
      setBusy(false)
    }
  }

  const status = (h: OnboardingHarness): { dot: string; txt: string } => {
    switch (h.status) {
      case 'ready': return { dot: 'ok', txt: 'Ready' }
      case 'found': return { dot: 'off', txt: 'Found — validate to use' }
      case 'unvalidated': return { dot: 'off', txt: 'Validate to use' }
      default: return { dot: 'off', txt: 'not found in PATH' }
    }
  }

  return (
    <div className="onb">
      <div className="onb-card">
        <div className="row" style={{ gap: 12 }}>
          <img src="/logo.png" alt="" style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-3)' }} />
          <div>
            <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 17 }}>revai</b><span className="badge">first setup</span></div>
            <div className="small muted">We detected the local harnesses that can run the revai skill.</div>
          </div>
        </div>

        <div className="list card">
          {(data?.harnesses ?? []).map((h) => {
            const st = status(h)
            const v = validations[h.id]
            return (
              <div key={h.id}>
                <label className="radio-card" style={{ borderRadius: 0 }} aria-disabled={h.status === 'not-found' && !v}>
                  <input
                    type="radio"
                    name="harness"
                    checked={sel === h.id}
                    onChange={() => setSel(h.id)}
                    disabled={h.status === 'not-found' && !v}
                  />
                  <span className="logo-tile">{h.logo}</span>
                  <span className="col" style={{ gap: 4, flex: 1 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <b>{h.name}</b>
                      {h.version && <span className="mono num">{h.version}</span>}
                      {h.isDefault && <span className="badge accent">Default</span>}
                      {h.status === 'ready' && <span className="badge ok"><span className="dot ok" />Validated {h.validatedAt ? relTime(h.validatedAt) : ''}</span>}
                    </span>
                    <span className="small muted mono">{h.exe ?? h.detail}</span>
                    {v && !v.ok && <span className="small" style={{ color: 'var(--crit)' }}>validation failed — see the checklist below</span>}
                  </span>
                  <span className="btn sm ghost" style={{ pointerEvents: 'auto' }}
                    onClick={(e) => { e.preventDefault(); void validate(h.id) }}>
                    {validating[h.id] ? <span className="spinner" /> : <Icon name="refresh" />} Validate
                  </span>
                </label>
                {v && (
                  <details className="pad" style={{ background: 'var(--bg-2)' }}>
                    <summary className="small muted" style={{ cursor: 'pointer' }}>Validation checklist</summary>
                    <div className="col" style={{ paddingTop: 10 }}>
                      {(v.items ?? []).map((it) => (
                        <div key={it.key} className="row small" style={{ gap: 8 }}>
                          <span className={`dot ${it.ok ? 'ok' : 'crit'}`} />
                          <span>{it.label}</span>
                          <span className="muted">{it.detail}</span>
                          <span className="faint num" style={{ marginLeft: 'auto' }}>{it.ms} ms</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )
          })}
        </div>

        {!data?.harnesses.length && <div className="callout warn"><Icon name="alert" /><span>Looking for local CLIs…</span></div>}

        <div className="card pad col">
          <div className="row">
            <b className="small">Add manual path</b>
            <input className="input" style={{ height: 30 }} placeholder="name (e.g. aider)" value={manualName} onChange={(e) => setManualName(e.target.value)} />
            <input className="input" style={{ flex: 2, height: 30 }} placeholder="executable path" value={manualPath} onChange={(e) => setManualPath(e.target.value)} />
            <button className="btn sm" onClick={() => void addManual()}>Add</button>
          </div>
        </div>

        <div className="card pad col small">
          <div className="row"><Icon name="shield" /> Requirements</div>
          <div className="kv">
            <dt>Git</dt><dd className="num">{data?.runtime.git ?? 'detecting…'}</dd>
            <dt>Node</dt><dd className="num">{data?.runtime.node ?? 'detecting…'}</dd>
            <dt>Data</dt><dd className="mono small">{data?.runtime.revaiDir ?? '~/.revai'}</dd>
            <dt>Server</dt><dd>Running on 127.0.0.1 — nothing leaves your machine</dd>
          </div>
        </div>

        <div className="row">
          <button className="btn ghost" onClick={() => nav('/')}>Skip</button>
          <button className="btn primary lg" disabled={!sel || busy} onClick={() => void continueFlow()} style={{ flex: 1 }}>
            Continue with {data?.harnesses.find((h) => h.id === sel)?.name ?? 'harness'} {busy && <span className="spinner" />}
          </button>
        </div>
      </div>
    </div>
  )
}

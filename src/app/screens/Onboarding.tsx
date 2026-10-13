// 01-onboarding — detecção + validação de harnesses locais (tela standalone)
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
      case 'ready': return { dot: 'ok', txt: 'Pronto' }
      case 'found': return { dot: 'off', txt: 'Encontrado — valide para usar' }
      case 'unvalidated': return { dot: 'off', txt: 'Valide para usar' }
      default: return { dot: 'off', txt: 'não encontrado no PATH' }
    }
  }

  return (
    <div className="onb">
      <div className="onb-card">
        <div className="row" style={{ gap: 12 }}>
          <img src="/logo.png" alt="" style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-3)' }} />
          <div>
            <div className="row" style={{ gap: 8 }}><b style={{ fontSize: 17 }}>revai</b><span className="badge">primeiro setup</span></div>
            <div className="small muted">Detectamos os harnesses locais que podem rodar a skill revai.</div>
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
                      {h.isDefault && <span className="badge accent">Padrão</span>}
                      {h.status === 'ready' && <span className="badge ok"><span className="dot ok" />Validado {h.validatedAt ? relTime(h.validatedAt) : ''}</span>}
                    </span>
                    <span className="small muted mono">{h.exe ?? h.detail}</span>
                    {v && !v.ok && <span className="small" style={{ color: 'var(--crit)' }}>verificação falhou — veja o checklist abaixo</span>}
                  </span>
                  <span className="btn sm ghost" style={{ pointerEvents: 'auto' }}
                    onClick={(e) => { e.preventDefault(); void validate(h.id) }}>
                    {validating[h.id] ? <span className="spinner" /> : <Icon name="refresh" />} Validar
                  </span>
                </label>
                {v && (
                  <details className="pad" style={{ background: 'var(--bg-2)' }}>
                    <summary className="small muted" style={{ cursor: 'pointer' }}>Checklist de validação</summary>
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

        {!data?.harnesses.length && <div className="callout warn"><Icon name="alert" /><span>Procurando CLIs locais…</span></div>}

        <div className="card pad col">
          <div className="row">
            <b className="small">Adicionar caminho manual</b>
            <input className="input" style={{ height: 30 }} placeholder="nome (ex.: aider)" value={manualName} onChange={(e) => setManualName(e.target.value)} />
            <input className="input" style={{ flex: 2, height: 30 }} placeholder="caminho do executável" value={manualPath} onChange={(e) => setManualPath(e.target.value)} />
            <button className="btn sm" onClick={() => void addManual()}>Adicionar</button>
          </div>
        </div>

        <div className="card pad col small">
          <div className="row"><Icon name="shield" /> Requisitos</div>
          <div className="kv">
            <dt>Git</dt><dd className="num">{data?.runtime.git ?? 'detectando…'}</dd>
            <dt>Node</dt><dd className="num">{data?.runtime.node ?? 'detectando…'}</dd>
            <dt>Dados</dt><dd className="mono small">{data?.runtime.revaiDir ?? '~/.revai'}</dd>
            <dt>Servidor</dt><dd>Rodando em 127.0.0.1 — nada sai da sua máquina</dd>
          </div>
        </div>

        <div className="row">
          <button className="btn ghost" onClick={() => nav('/')}>Pular</button>
          <button className="btn primary lg" disabled={!sel || busy} onClick={() => void continueFlow()} style={{ flex: 1 }}>
            Continuar com {data?.harnesses.find((h) => h.id === sel)?.name ?? 'harness'} {busy && <span className="spinner" />}
          </button>
        </div>
      </div>
    </div>
  )
}

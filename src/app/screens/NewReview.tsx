// 02-new-review — colar URL / pasta local, resolver, recentes
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon, GateBadge, relTime, fmtDur, useToast } from '../ui'
import { post, get } from '../api'
import type { ParsedSource, ReviewRow } from '../../shared/types'
import { saveSource } from '../flow'

type ResolveResponse = {
  parsed: ParsedSource
  info: { accessible: boolean; message: string; defaultBranch?: string; headHint?: { label: string; ref: string } }
}

const FORMATS = [
  'github.com/org/repo',
  'github.com/org/repo/tree/branch',
  'github.com/org/repo/pull/482',
  'gitlab.com/group/repo/-/merge_requests/12',
  'git@github.com:org/repo.git',
  'caminho\\para\\pasta',
]

export default function NewReview() {
  const nav = useNavigate()
  const toast = useToast()
  const [kind, setKind] = useState<'remote' | 'folder'>('remote')
  const [src, setSrc] = useState('')
  const [res, setRes] = useState<ResolveResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [recents, setRecents] = useState<ReviewRow[]>([])
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    get<ReviewRow[]>('/reviews?limit=3').then(setRecents).catch(() => {})
  }, [])

  const resolve = async () => {
    if (!src.trim() || busy) return
    setBusy(true)
    setError(null)
    setRes(null)
    try {
      const r = await post<ResolveResponse>('/projects/resolve', { source: kind === 'remote' ? src : src })
      setRes(r)
      saveSource(r.parsed.raw)
    } catch (e: any) {
      setError({ code: e.code ?? 'internal/error', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const pickFolderUi = async () => {
    setPicking(true)
    setError(null)
    setRes(null)
    try {
      const r = await post<{ path: string | null }>('/system/pick-folder')
      if (!r.path) {
        toast('Nenhuma pasta selecionada')
        return
      }
      setKind('folder')
      setSrc(r.path)
      const res2 = await post<ResolveResponse>('/projects/resolve', { source: r.path })
      setRes(res2)
      saveSource(res2.parsed.raw)
    } catch (e: any) {
      setError({ code: e.code ?? 'internal/error', message: e.message })
    } finally {
      setPicking(false)
    }
  }

  const tile = res?.parsed.provider === 'gitlab' ? 'GL' : res?.parsed.provider === 'github' ? 'GH' : 'R'

  return (
    <div className="page narrow">
      <h1>Nova review</h1>
      <p className="lede">Cole a URL do repositório (branch, PR, commit) ou o caminho de uma pasta local.</p>

      <div className="segs row" style={{ marginBottom: 12 }}>
        {(['remote', 'folder'] as const).map((k) => (
          <button key={k} aria-pressed={kind === k}
            onClick={() => setKind(k)}
            style={{ border: 0, background: kind === k ? 'var(--bg-3)' : 'none', color: kind === k ? 'var(--fg)' : 'var(--fg-2)', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', font: '500 12.5px var(--sans)' }}>
            {k === 'remote' ? 'Remoto' : 'Pasta local'}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void resolve() }}
        className={`input big-input ${error ? '' : ''}`}
        style={{ alignItems: 'center' }}
      >
        <Icon name={kind === 'remote' ? 'globe' : 'folder'} />
        <input
          autoFocus
          placeholder={kind === 'remote' ? 'https://github.com/acme/checkout-api/tree/feature/PEQ-2450' : 'Escolha com o botão abaixo ou cole o caminho'}
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          aria-label="Origem da review"
        />
        <button type="submit" className="btn primary" disabled={busy || !src.trim()}>
          {busy ? <span className="spinner" style={{ borderTopColor: 'var(--accent-fg)' }} /> : 'Resolver'} <kbd>↵</kbd>
        </button>
      </form>

      {kind === 'folder' && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" type="button" disabled={picking} onClick={() => void pickFolderUi()}>
            <Icon name="folder" /> {picking ? 'Seletor aberto…' : 'Escolher pasta…'}
          </button>
          <span className="small faint">ou cole o caminho no campo acima — resolução automática dos dois jeitos</span>
        </div>
      )}

      <div className="chipline" style={{ margin: '10px 0 0' }}>
        {FORMATS.map((f) => (
          <span key={f} className="badge mono small" style={{ height: 20 }}>{f}</span>
        ))}
      </div>

      {error && (
        <div className="callout err" style={{ marginTop: 16 }}>
          <Icon name="alert" />
          <span>
            <b>{error.code}</b><br />
            <span className="small">{error.message}</span>
          </span>
        </div>
      )}

      {res && (
        <div className="card pad col" style={{ marginTop: 18 }}>
          <div className="row">
            <span className="logo-tile">{tile}</span>
            <div className="col" style={{ gap: 2, flex: 1 }}>
              <b className="mono small">{res.parsed.kind === 'folder' ? res.parsed.repo : `${res.parsed.host}/${res.parsed.org}/${res.parsed.repo}`}</b>
              <span className="small muted">{res.info.message}</span>
            </div>
            <span className="badge ok"><span className="dot ok" />Acessível</span>
          </div>
          <div className="row small muted">
            {res.info.headHint
              ? <><Icon name="branch" /> <span><b className="mono">{res.info.headHint.label}</b> → base <b className="mono">{res.info.defaultBranch ?? 'auto'}</b></span></>
              : <><Icon name="branch" /> <span>branch padrão <b className="mono">{res.info.defaultBranch ?? 'auto'}</b></span></>}
          </div>
          <div className="row">
            <button className="btn primary" style={{ flex: 1 }} onClick={() => nav('/configure')}>
              Continuar → Branch + harness
            </button>
          </div>
        </div>
      )}

      <h2 className="section"><Icon name="clock" /> Continuar de onde parou</h2>
      {recents.length === 0 && <div className="empty small">nenhum review ainda — quando rodar, aparecem aqui</div>}
      <div className="list card">
        {recents.map((r) => (
          <Link key={r.id} className="list-row" to={`/report/${r.id}`} onClick={() => toast('Abrindo relatório')}>
            <GateBadge status={r.gate} />
            <span className="mono small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.repoLabel} · {r.head}
            </span>
            <span className="small muted num">{r.critical} crítico(s) · {r.open} abertas</span>
            <span className="badge">{r.harnessName}</span>
            <span className="small faint">{fmtDur(r.durationMs)} · {relTime(r.createdAt)}</span>
          </Link>
        ))}
      </div>

      <div className="callout" style={{ marginTop: 28 }}>
        <Icon name="shield" />
        <span className="small muted">
          O código é clonado para <b className="mono">~/.revai/repos</b> e nunca sai da sua máquina. O clone é sandbox do agente — seu trabalho real não é tocado.
        </span>
      </div>
    </div>
  )
}

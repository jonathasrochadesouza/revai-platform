// 05-report — lista + detalhe, filtros, atalhos J/K/S/C/F e ações
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon, GatePanel, GateBadge, SevBadge, CatBadge, CodeDiff, relTime, fmtDur, copyText, useToast, sevOf } from '../ui'
import { get, patch, post } from '../api'
import type { ReviewRecord, Severity } from '../../shared/types'

export default function Report() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [record, setRecord] = useState<ReviewRecord | null>(null)
  const [err, setErr] = useState<{ code: string; message: string } | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [fSev, setFSev] = useState<'all' | Severity>('all')
  const [fStatus, setFStatus] = useState<'all' | 'open' | 'resolved' | 'skipped'>('all')
  const [fFile, setFFile] = useState('all')

  const load = useCallback(async () => {
    if (!id) return
    try {
      const r = await get<ReviewRecord>(`/reviews/${id}`)
      setRecord(r)
      if (!sel) {
        const first = r.findings.find((f) => f.status === 'open' && sevOf(f) === 'critical')
          ?? r.findings.find((f) => f.status === 'open')
        setSel(first?.id ?? r.findings[0]?.id ?? null)
      }
    } catch (e: any) {
      setErr({ code: e.code ?? 'internal/error', message: e.message })
    }
  }, [id, sel])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const findings = record?.findings ?? []
  const files = useMemo(() => [...new Set(findings.map((f) => f.file))], [findings])

  const filtered = findings.filter((f) => {
    if (record?.skipped.includes(f.id) && fStatus !== 'skipped' && fStatus !== 'all') return false
    if (!record?.skipped.includes(f.id) && fStatus === 'skipped') return false
    if (fStatus === 'resolved' && f.status !== 'resolved') return false
    if (fStatus === 'open' && (f.status !== 'open' || record?.skipped.includes(f.id))) return false
    if (fSev !== 'all' && sevOf(f) !== fSev) return false
    if (fFile !== 'all' && f.file !== fFile) return false
    return true
  })

  const changeStatus = async (fid: string, status: 'open' | 'resolved' | 'skipped') => {
    if (!record) return
    try {
      const updated = await patch<ReviewRecord>(`/reviews/${record.id}/findings/${fid}`, { status })
      setRecord(updated)
      const labels: Record<string, string> = { open: 'restaurado', resolved: 'resolvido', skipped: 'pulada' }
      toast(`CR ${fid} ${labels[status]}`, status === 'skipped' ? 'info' : 'ok')
    } catch (e: any) {
      toast(e.message, 'err')
    }
  }

  const idx = filtered.findIndex((f) => f.id === sel)
  const move = (d: number) => {
    if (filtered.length === 0) return
    const i = idx < 0 ? 0 : Math.min(filtered.length - 1, Math.max(0, idx + d))
    setSel(filtered[i].id)
  }

  const keyNav = useCallback(
    (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (e.key === 'j') move(1)
      if (e.key === 'k') move(-1)
      const selF = filtered.find((f) => f.id === sel)
      if (e.key === 's' && sel && selF && selF.status !== 'resolved' && !record?.skipped.includes(selF.id)) void changeStatus(sel, 'skipped')
      if (e.key === 's' && sel && record?.skipped.includes(sel)) void changeStatus(sel, 'open') // S desfaz o pulo
      if (e.key === 'c' && sel && record) {
        void copyText(`Fix ${sel} in the revai review of ${record.slug}`)
        toast('Prompt copiado', 'ok')
      }
      if (e.key === 'f' && sel && record && selF && selF.status !== 'resolved' && !record?.skipped.includes(selF.id)) nav(`/fix/${record.id}?ids=${sel}`)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, record, filtered, nav],
  )

  useEffect(() => {
    document.addEventListener('keydown', keyNav)
    return () => document.removeEventListener('keydown', keyNav)
  }, [keyNav])

  if (err) {
    return (
      <div className="page narrow">
        <h1>Relatório</h1>
        <div className="callout err"><Icon name="alert" /><span><b>{err.code}</b><br /><span className="small">{err.message}</span></span></div>
        <Link className="btn" to="/">← Reviews</Link>
      </div>
    )
  }
  if (!record) {
    return (
      <div className="page narrow">
        <div className="row"><span className="spinner" /> <span className="muted">Carregando relatório…</span></div>
      </div>
    )
  }

  const selFind = findings.find((f) => f.id === sel) ?? null
  const selSkipped = !!(sel && record.skipped.includes(sel))
  const openCount = findings.filter((f) => f.status === 'open' && !record.skipped.includes(f.id)).length
  const resolvedCount = findings.filter((f) => f.status === 'resolved').length
  const skippedCount = record.skipped.length
  const isBlocker = !!selFind && (sevOf(selFind) === 'critical' || selFind.category === 'security')

  return (
    <div className="page">
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ flex: '1 0 auto' }}>{record.repo.label} · <span className="mono">{record.head}</span></h1>
        <GateBadge status={record.gate.status} />
      </div>
      <p className="lede" style={{ marginTop: 0 }}>
        {openCount} abertas · {resolvedCount} resolvidas · {skippedCount} puladas ·
        {' '}{record.stats.filesChanged} arquivo(s) +{record.stats.additions} −{record.stats.deletions} ·
        {' '}{record.harnessName}{record.model ? ` · ${record.model}` : ''} · {fmtDur(record.stats.durationMs)} · {relTime(record.createdAt)}
      </p>

      <div className="report-grid">
        <aside className="side-fill">
          <GatePanel gate={record.gate} />
          <div className="card pad col" style={{ gap: 8 }}>
            <label className="field">
              Severidade
              <select className="select" value={fSev} onChange={(e) => setFSev(e.target.value as any)}>
                <option value="all">Todas</option>
                {(['critical', 'major', 'minor', 'trivial'] as Severity[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">
              Status
              <select className="select" value={fStatus} onChange={(e) => setFStatus(e.target.value as any)}>
                <option value="all">Todos</option>
                <option value="open">Abertas</option>
                <option value="resolved">Resolvidas</option>
                <option value="skipped">Puladas</option>
              </select>
            </label>
            <label className="field">
              Arquivo
              <select className="select" value={fFile} onChange={(e) => setFFile(e.target.value)}>
                <option value="all">Todos</option>
                {files.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          </div>
          <div className="card pad col small">
            <b>Onde ficam os dados</b>
            <span className="mono faint small">{record.id}/review.patch</span>
            <span className="mono faint small">{record.id}/review.json</span>
            <div className="col" style={{ marginTop: 6, gap: 8, alignItems: 'flex-start' }}>
              <a className="btn sm" href={`/api/reviews/${record.id}/artifacts/patch`} download>
                <Icon name="download" /> Baixar patch
              </a>
              <button className="btn sm ghost" onClick={async () => { await post(`/reviews/${record.id}/open-report`); toast('HTML da skill aberto no navegador', 'ok') }}>
                <Icon name="external" /> Ver HTML da skill
              </button>
            </div>
          </div>
        </aside>

        <div className="col" style={{ gap: 0 }}>
          {filtered.length === 0 && <div className="empty"><div className="small">nenhum finding com este filtro</div></div>}
          <div className="list card">
            {filtered.map((f) => {
              const sev = sevOf(f)
              const skipped = record.skipped.includes(f.id)
              return (
                <button
                  key={f.id}
                  className={`finding ${sel === f.id ? 'sel' : ''}`}
                  style={{ background: 'none', border: 0, borderTop: '1px solid var(--line)', width: '100%', textAlign: 'left', font: 'inherit' }}
                  onClick={() => setSel(f.id)}
                >
                  <div className="meta-1">
                    <SevBadge sev={sev} />
                    <CatBadge cat={f.category} />
                    {f.status === 'resolved' && <span className="badge ok">resolvido</span>}
                    {skipped && <span className="badge accent">pulada</span>}
                    <span className="mono faint small" style={{ marginLeft: 'auto' }}>{f.id}</span>
                  </div>
                  <b className="small">{f.title}</b>
                  <div className="mono faint small">{f.file}:{f.lines}</div>
                </button>
              )
            })}
          </div>

          {selFind && (
            <div className="card pad col" style={{ marginTop: 20 }}>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <SevBadge sev={sevOf(selFind)} />
                <CatBadge cat={selFind.category} />
                {selFind.status === 'resolved' && <span className="badge ok">resolvido — imutável</span>}
                <span className="mono faint">{selFind.id}</span>
                <span className="spacer" />
                {selSkipped && (
                  <button className="btn sm" onClick={() => void changeStatus(selFind.id, 'open')}><Icon name="refresh" /> Restaurar <kbd>S</kbd></button>
                )}
                {!selSkipped && selFind.status !== 'resolved' && (
                  <button className="btn sm danger" onClick={() => void changeStatus(selFind.id, 'skipped')}><Icon name="skip" /> Pular <kbd>S</kbd></button>
                )}
                {selFind.status !== 'resolved' && !selSkipped && (
                  <button className="btn sm primary" onClick={() => nav(`/fix/${record.id}?ids=${selFind.id}`)}><Icon name="wand" /> Corrigir <kbd>F</kbd></button>
                )}
                <button className="btn sm ghost" onClick={() => { void copyText(`Fix ${selFind.id} in the revai review of ${record.slug}`); toast('Prompt copiado', 'ok') }}>
                  <Icon name="copy" /> Copiar prompt <kbd>C</kbd>
                </button>
              </div>
              <h3 style={{ margin: '12px 0 0' }}>{selFind.title}</h3>
              <div className="mono small" style={{ color: 'var(--fg-2)' }}>{selFind.file}:{selFind.lines}</div>
              <div className="col small" style={{ gap: 8 }}>
                <b>O que é</b>
                <span>{selFind.description}</span>
              </div>
              {selFind.rationale && (
                <div className="col small" style={{ gap: 8 }}>
                  <b>Por que importa</b>
                  <span>{selFind.rationale}</span>
                </div>
              )}
              {selFind.proposedFix && (
                <div className="col small" style={{ gap: 8 }}>
                  <b>Correção proposta</b>
                  <CodeDiff before={selFind.proposedFix.before} after={selFind.proposedFix.after} maxHeight={240} />
                </div>
              )}
              {selFind.copilotSummary && (
                <div className="callout"><span className="small">{selFind.copilotSummary}</span></div>
              )}
              {selSkipped && isBlocker && (
                <div className="callout warn small">
                  Pular um bloqueador libera o Quality Gate — o registro da decisão fica no relatório.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

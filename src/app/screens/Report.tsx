// 05-report — list + detail, filters, J/K/S/C/F shortcuts and actions
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
      const labels: Record<string, string> = { open: 'restored', resolved: 'resolved', skipped: 'skipped' }
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
      if (e.key === 's' && sel && record?.skipped.includes(sel)) void changeStatus(sel, 'open') // S undoes the skip
      if (e.key === 'c' && sel && record) {
        void copyText(`Fix ${sel} in the revai review of ${record.slug}`)
        toast('Prompt copied', 'ok')
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
        <h1>Report</h1>
        <div className="callout err"><Icon name="alert" /><span><b>{err.code}</b><br /><span className="small">{err.message}</span></span></div>
        <Link className="btn" to="/">← Reviews</Link>
      </div>
    )
  }
  if (!record) {
    return (
      <div className="page narrow">
        <div className="row"><span className="spinner" /> <span className="muted">Loading report…</span></div>
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
        {openCount} open · {resolvedCount} resolved · {skippedCount} skipped ·
        {' '}{record.stats.filesChanged} file(s) +{record.stats.additions} −{record.stats.deletions} ·
        {' '}{record.harnessName}{record.model ? ` · ${record.model}` : ''} · {fmtDur(record.stats.durationMs)} · {relTime(record.createdAt)}
      </p>

      <div className="report-grid">
        <aside className="side-fill">
          <GatePanel gate={record.gate} />
          <div className="card pad col" style={{ gap: 8 }}>
            <label className="field">
              Severity
              <select className="select" value={fSev} onChange={(e) => setFSev(e.target.value as any)}>
                <option value="all">All</option>
                {(['critical', 'major', 'minor', 'trivial'] as Severity[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="field">
              Status
              <select className="select" value={fStatus} onChange={(e) => setFStatus(e.target.value as any)}>
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="skipped">Skipped</option>
              </select>
            </label>
            <label className="field">
              File
              <select className="select" value={fFile} onChange={(e) => setFFile(e.target.value)}>
                <option value="all">All</option>
                {files.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          </div>
          <div className="card pad col small">
            <b>Where the data lives</b>
            {record.artifacts.patch && <span className="mono faint small">{record.id}/review.patch</span>}
            {record.artifacts.reviewJson && <span className="mono faint small">{record.id}/review.json</span>}
            {!record.artifacts.patch && !record.artifacts.reviewJson && (
              <span className="mono faint small">{record.id}/ — no binary artifacts (full-folder review)</span>
            )}
            <div className="col" style={{ marginTop: 6, gap: 8, alignItems: 'flex-start' }}>
              {record.artifacts.patch && (
                <a className="btn sm" href={`/api/reviews/${record.id}/artifacts/patch`} download>
                  <Icon name="download" /> Download patch
                </a>
              )}
              {record.artifacts.html && (
                <button className="btn sm ghost" onClick={async () => { await post(`/reviews/${record.id}/open-report`); toast('Skill HTML opened in the browser', 'ok') }}>
                  <Icon name="external" /> View skill HTML
                </button>
              )}
            </div>
          </div>
        </aside>

        <div className="col" style={{ gap: 0 }}>
          {filtered.length === 0 && <div className="empty"><div className="small">no findings match this filter</div></div>}
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
                    {f.status === 'resolved' && <span className="badge ok">resolved</span>}
                    {skipped && <span className="badge accent">skipped</span>}
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
                {selFind.status === 'resolved' && <span className="badge ok">resolved — immutable</span>}
                <span className="mono faint">{selFind.id}</span>
                <span className="spacer" />
                {selSkipped && (
                  <button className="btn sm" onClick={() => void changeStatus(selFind.id, 'open')}><Icon name="refresh" /> Restore <kbd>S</kbd></button>
                )}
                {!selSkipped && selFind.status !== 'resolved' && (
                  <button className="btn sm danger" onClick={() => void changeStatus(selFind.id, 'skipped')}><Icon name="skip" /> Skip <kbd>S</kbd></button>
                )}
                {selFind.status !== 'resolved' && !selSkipped && (
                  <button className="btn sm primary" onClick={() => nav(`/fix/${record.id}?ids=${selFind.id}`)}><Icon name="wand" /> Fix <kbd>F</kbd></button>
                )}
                <button className="btn sm ghost" onClick={() => { void copyText(`Fix ${selFind.id} in the revai review of ${record.slug}`); toast('Prompt copied', 'ok') }}>
                  <Icon name="copy" /> Copy prompt <kbd>C</kbd>
                </button>
              </div>
              <h3 style={{ margin: '12px 0 0' }}>{selFind.title}</h3>
              <div className="mono small" style={{ color: 'var(--fg-2)' }}>{selFind.file}:{selFind.lines}</div>
              <div className="col small" style={{ gap: 8 }}>
                <b>What it is</b>
                <span>{selFind.description}</span>
              </div>
              {selFind.rationale && (
                <div className="col small" style={{ gap: 8 }}>
                  <b>Why it matters</b>
                  <span>{selFind.rationale}</span>
                </div>
              )}
              {selFind.proposedFix && (
                <div className="col small" style={{ gap: 8 }}>
                  <b>Proposed fix</b>
                  <CodeDiff before={selFind.proposedFix.before} after={selFind.proposedFix.after} maxHeight={240} />
                </div>
              )}
              {selFind.copilotSummary && (
                <div className="callout"><span className="small">{selFind.copilotSummary}</span></div>
              )}
              {selSkipped && isBlocker && (
                <div className="callout warn small">
                  Skipping a blocker releases the Quality Gate — the decision record stays in the report.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

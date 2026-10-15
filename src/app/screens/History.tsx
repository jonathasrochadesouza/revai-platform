// 07-history — list with filters (gate, repo, search)
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon, GateBadge, relTime, fmtDur } from '../ui'
import { get } from '../api'
import type { ReviewRow } from '../../shared/types'

export default function History() {
  const [rows, setRows] = useState<ReviewRow[] | null>(null)
  const [fGate, setFGate] = useState<'all' | 'failed' | 'passed'>('all')
  const [repo, setRepo] = useState('all')
  const [q, setQ] = useState('')

  const load = () => get<ReviewRow[]>('/reviews').then(setRows).catch(() => setRows([]))
  useEffect(() => {
    void load()
  }, [])

  const repos = useMemo(() => (rows ? [...new Set(rows.map((r) => r.repoLabel))] : []), [rows])
  const filtered = (rows ?? []).filter((r) => {
    if (fGate !== 'all' && r.gate !== fGate) return false
    if (repo !== 'all' && r.repoLabel !== repo) return false
    if (q && !`${r.repoLabel} ${r.head} ${r.prNumber ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })

  return (
    <div className="page">
      <h1>Reviews</h1>
      <p className="lede">Everything that has run on the platform, with its Quality Gate result.</p>

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 18 }}>
        <div className="seg">
          {(['all', 'failed', 'passed'] as const).map((g) => (
            <button key={g} aria-pressed={fGate === g} onClick={() => setFGate(g)}>
              {g === 'all' ? 'All' : g === 'failed' ? 'Failed' : 'Passed'}
            </button>
          ))}
        </div>
        <select className="select" value={repo} onChange={(e) => setRepo(e.target.value)}>
          <option value="all">All repositories</option>
          {repos.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="input" style={{ flex: 1, minWidth: 180 }}>
          <Icon name="search" />
          <input placeholder="Search repo, branch, PR…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn ghost sm" onClick={() => void load()}><Icon name="refresh" /> Refresh</button>
      </div>

      {rows === null && <div className="row"><span className="spinner" /><span className="muted">Loading…</span></div>}

      {rows !== null && filtered.length === 0 && (
        <div className="empty">
          <div className="big">No reviews yet</div>
          Start from <Link to="/new">New review</Link>.
        </div>
      )}

      <div className="list card">
        {filtered.map((r) => (
          <Link key={r.id} className="list-row" to={`/report/${r.id}`}>
            <GateBadge status={r.gate} />
            <span className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}>
              <span className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.repoLabel}{r.prNumber ? ` · PR #${r.prNumber}` : ''} · {r.head}
              </span>
              <span className="small faint">
                {r.critical > 0 && <>{r.critical} critical(s) · </>}
                {r.open} open · {r.harnessName}{r.model ? ` · ${r.model}` : ''}
              </span>
            </span>
            <span className="small muted num">{fmtDur(r.durationMs)}</span>
            <span className="small faint num">{relTime(r.createdAt)}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

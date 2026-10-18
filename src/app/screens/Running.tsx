// 04-running — 5-step stepper + live log via SSE (+ cancel)
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon, Terminal, Stepper, GatePanel, type Step, type LogLine, fmtDur } from '../ui'
import { get, post, sse } from '../api'
import type { Gate, SseEvent } from '../../shared/types'
import type { RunConfig } from '../flow'
import { loadRun } from '../flow'

const INITIAL: Step[] = [
  { id: 'clone', label: 'Prepare clone', status: 'idle' },
  { id: 'patch', label: 'Generate patch', status: 'idle' },
  { id: 'analyze', label: 'Analyze changes', status: 'idle' },
  { id: 'capture', label: 'Record findings', status: 'idle' },
  { id: 'validate', label: 'Validate schema', status: 'idle' },
  { id: 'assemble', label: 'Assemble report', status: 'idle' },
]

export default function Running() {
  const nav = useNavigate()
  const cfg = loadRun()
  const [steps, setSteps] = useState<Step[]>(INITIAL)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<'running' | 'done' | 'error' | 'cancelled'>('running')
  const [error, setError] = useState<{ code: string; message: string; detail?: string } | null>(null)
  const [cancelNote, setCancelNote] = useState<string | null>(null)
  const [gate, setGate] = useState<Gate | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [stats, setStats] = useState<{ files: number; add: number; del: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [openOnFinish, setOpenOnFinish] = useState(true)
  const started = useRef(Date.now())

  useEffect(() => {
    get<{ openReportOnFinish: boolean }>('/settings').then((s) => setOpenOnFinish(s.openReportOnFinish)).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - started.current), 500)
    return () => clearInterval(t)
  }, [status])

  useEffect(() => {
    if (!cfg) return
    const ctrl = new AbortController()
    sse<SseEvent>(
      '/reviews/stream',
      { source: cfg.source, head: cfg.head, base: cfg.base, harnessId: cfg.harnessId, model: cfg.model },
      (ev) => {
        if (ev.t === 'job') {
          setJobId(ev.id)
          return
        }
        if (ev.t === 'step') {
          setSteps((old) => old.map((s) => (s.id === ev.id ? { ...s, status: ev.status === 'running' ? 'running' : ev.status === 'done' ? 'done' : 'failed', detail: ev.detail ?? s.detail } : s)))
          return
        }
        if (ev.t === 'log') {
          setLogs((old) => [...old.slice(-1500), { stream: ev.stream, line: ev.line, cls: ev.cls }])
          return
        }
        if (ev.t === 'stats') {
          setStats({ files: ev.filesChanged, add: ev.additions, del: ev.deletions })
          return
        }
        if (ev.t === 'gate') {
          setGate(ev.gate)
          return
        }
        if (ev.t === 'done') {
          setStatus('done')
          setReviewId(ev.reviewId)
          const id = ev.reviewId
          setTimeout(() => nav(`/report/${id}`), openOnFinish ? 1400 : 0)
          return
        }
        if (ev.t === 'error') {
          setStatus('error')
          setError({ code: ev.code, message: ev.message, detail: ev.detail })
          return
        }
        if (ev.t === 'cancelled') {
          setStatus('cancelled')
          setCancelNote(ev.note ?? null)
        }
      },
      ctrl.signal,
    ).catch((e) => {
      setStatus('error')
      setError({ code: e.code ?? 'internal/fetch', message: e.message })
    })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!cfg) {
    return (
      <div className="page narrow">
        <h1>Track</h1>
        <div className="empty">
          <div className="big">No review in progress</div>
          Start from <Link to="/new">New review</Link>.
        </div>
      </div>
    )
  }

  const cancel = async () => {
    if (!jobId) return
    await post(`/jobs/${jobId}/cancel`)
  }

  return (
    <div className="page narrow">
      <div className="row" style={{ marginBottom: 8 }}>
        <h1 style={{ flex: 1 }}>Tracking</h1>
        <span className="badge num">{fmtDur(elapsed)}</span>
        {status === 'running' && (
          <button className="btn sm danger" onClick={() => void cancel()}>
            <Icon name="stop" /> Cancel
          </button>
        )}
      </div>
      <p className="lede mono small" style={{ marginTop: 0 }}>
        {cfg.source} · {cfg.head}{cfg.base ? ` → ${cfg.base}` : ' (full folder)'}
      </p>

      {stats && (
        <div className="row small muted num" style={{ marginBottom: 18 }}>
          <span>{stats.files} file(s)</span><span>·</span><span>+{stats.add}</span><span>−{stats.del}</span>
          <span>·</span><span>harness: {cfg.harnessId}{cfg.model && cfg.model !== 'auto' ? ` · ${cfg.model}` : ''}</span>
        </div>
      )}

      <Stepper steps={steps} />

      {status === 'error' && error && (
        <div className="callout err" style={{ marginTop: 20 }}>
          <Icon name="alert" />
          <span className="col" style={{ gap: 4 }}>
            <b>{error.code}</b>
            <span>{error.message}</span>
            {error.detail && <span className="mono small faint" style={{ whiteSpace: 'pre-wrap' }}>{error.detail}</span>}
          </span>
        </div>
      )}

      {status === 'cancelled' && (
        <div className="callout warn" style={{ marginTop: 20 }}>
          <Icon name="alert" />
          <span className="col" style={{ gap: 4 }}>
            <b>Review cancelled</b>
            {cancelNote && <span className="small">{cancelNote}</span>}
          </span>
        </div>
      )}

      {status === 'done' && (
        <div style={{ marginTop: 20 }}>
          {gate && <GatePanel gate={gate} />}
          <div className="row" style={{ marginTop: 12 }}>
            <span className="small muted">{openOnFinish ? 'Report ready — opening…' : 'Report ready.'}</span>
            {reviewId && <Link className="btn sm" to={`/report/${reviewId}`}>Open report</Link>}
          </div>
        </div>
      )}

      <div style={{ marginTop: 22 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="small faint">raw log (summary in the report)</span>
        </div>
        <Terminal lines={logs} />
      </div>
    </div>
  )
}

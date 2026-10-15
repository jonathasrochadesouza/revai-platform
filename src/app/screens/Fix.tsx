// 06-fix — fix queue with apply → tests → gate delta
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Icon, Terminal, Stepper, useToast, type LogLine } from '../ui'
import { get, post, sse } from '../api'
import type { FixEvent, Gate, ReviewRecord } from '../../shared/types'

interface QItem { id: string; title: string; severity?: string; category?: string; step: string; status: string; detail?: string }

export default function Fix() {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const [record, setRecord] = useState<ReviewRecord | null>(null)
  const [items, setItems] = useState<QItem[]>([])
  const [logs, setLogs] = useState<LogLine[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [applied, setApplied] = useState<string[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [gate, setGate] = useState<{ before: Gate; after: Gate } | null>(null)
  const [status, setStatus] = useState<'running' | 'done' | 'error' | 'cancelled'>('running')
  const [info, setInfo] = useState<{ code: string; message: string; detail?: string } | null>(null)
  const [patchName, setPatchName] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!id || started.current) return
    started.current = true
    get<ReviewRecord>(`/reviews/${id}`).then((r) => {
      setRecord(r)
      const ids = (sp.get('ids') ?? r.fixApplied?.join(',') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      const idsValid = ids.filter((i) => r.findings.some((f) => f.id === i && f.status === 'open'))
      if (!idsValid.length) {
        setStatus('done')
        return
      }
      setItems(idsValid.map((i) => ({ id: i, title: r.findings.find((f) => f.id === i)?.title ?? '', step: 'pending', status: 'pending' })))
      void streamFix(r, idsValid)
    }).catch((e) => {
      setStatus('error')
      setInfo({ code: e.code ?? 'internal/error', message: e.message })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const streamFix = async (r: ReviewRecord, ids: string[]) => {
    const ctrl = new AbortController()
    sse<FixEvent>(
      `/reviews/${r.id}/fix/stream`,
      { ids },
      async (ev) => {
        if (ev.t === 'job') {
          setJobId(ev.id)
          return
        }
        if (ev.t === 'queue') {
          setItems((old) => ev.items.map((q) => ({ ...q, ...(old.find((o) => o.id === q.id) ?? { step: 'pending', status: 'pending' }) } as QItem)))
          return
        }
        if (ev.t === 'item') {
          const stepLabel: Record<string, string> = { apply: 'apply', test: 'test', done: 'done', failed: 'failed' }
          setItems((old) => old.map((o) => (o.id === ev.id ? { ...o, step: stepLabel[ev.step] ?? ev.step, status: ev.status === 'running' ? 'running' : ev.status === 'ok' ? 'done' : 'failed', detail: ev.detail ?? o.detail } : o)))
          return
        }
        if (ev.t === 'log') {
          setLogs((old) => [...old.slice(-1500), { stream: ev.stream, line: ev.line }])
          return
        }
        if (ev.t === 'gate') {
          setGate({ before: ev.before, after: ev.after })
          setApplied(ev.applied)
          setFailed(ev.failed)
          return
        }
        if (ev.t === 'done') {
          setPatchName(ev.patchName ?? null)
          setStatus('done')
          return
        }
        if (ev.t === 'error') {
          setStatus('error')
          setInfo({ code: ev.code, message: ev.message, detail: ev.detail })
          return
        }
        if (ev.t === 'cancelled') {
          setStatus('cancelled')
          // the server broke the loop; the client discards the changes in the clone
          try {
            await post(`/reviews/${r.id}/reset`)
            toast('Changes discarded (git reset --hard on the clone)', 'ok')
          } catch { /* the clone may already have been cleaned up */ }
          return
        }
      },
      ctrl.signal,
    ).catch((e) => {
      setStatus('error')
      setInfo({ code: e.code ?? 'internal/fetch', message: e.message })
    })
  }

  if (!record) {
    return <div className="page narrow"><div className="row"><span className="spinner" /><span className="muted">Loading…</span></div></div>
  }

  const push = async () => {
    if (!confirm(`Create branch revai/fix-${record.slug} and push? (this creates commits on the remote)`)) return
    try {
      const r = await post<{ branch: string }>(`/reviews/${record.id}/push`)
      toast(`Push to ${r.branch} completed`, 'ok')
    } catch (e: any) {
      toast(`push failed: ${e.message}`, 'err')
    }
  }

  const discard = async () => {
    if (!confirm('Discard the fixes applied to the clone?')) return
    await post(`/reviews/${record.id}/reset`)
    toast('Changes discarded (git reset --hard)', 'ok')
    nav(`/report/${record.id}`)
  }

  return (
    <div className="page narrow">
      <h1>Fix loop</h1>
      <p className="lede mono small" style={{ marginTop: 0 }}>{record.repo.label} · {record.slug}</p>

      {status === 'running' && (
        <>
          <div className="col" style={{ gap: 8, marginBottom: 16 }}>
            {items.map((it) => (
              <div key={it.id} className="q">
                {it.status === 'done' ? <span className="dot ok" /> : it.status === 'failed' ? <span className="dot crit" /> : <span className="spinner" />}
                <b className="mono small">{it.id}</b>
                <span className="small muted" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</span>
                <span className="small faint">{it.step}{it.detail ? ` · ${it.detail}` : ''}</span>
              </div>
            ))}
          </div>
          <Stepper steps={[{ id: 'loop', label: 'Applying fixes + tests', status: 'running' }]} />
        </>
      )}

      {status === 'done' && (
        <div className="col" style={{ gap: 16 }}>
          {gate && (
            <div className="card pad col">
              <b className="small">Quality Gate delta</b>
              <div className="row">
                <GateMini label="before" gate={gate.before} />
                <span aria-hidden="true">→</span>
                <GateMini label="after" gate={gate.after} />
              </div>
              {gate.after.status === 'passed' && <div className="callout ok"><Icon name="check" /><span className="small"><b>Quality Gate passed.</b> Ready to merge.</span></div>}
            </div>
          )}
          <div className="card pad col small">
            <b>Results</b>
            <div className="row"><span className="dot ok" /> applied: <span className="mono">{applied.join(', ') || '—'}</span></div>
            <div className="row"><span className="dot crit" /> failed: <span className="mono">{failed.join(', ') || '—'}</span></div>
          </div>
        </div>
      )}

      {status === 'error' && info && (
        <div className="callout err"><Icon name="alert" /><span><b>{info.code}</b><br /><span className="small">{info.message}</span>{info.detail && <div className="mono small faint" style={{ whiteSpace: 'pre-wrap' }}>{info.detail}</div>}</span></div>
      )}
      {status === 'cancelled' && <div className="callout warn"><Icon name="alert" /><span className="small">Run interrupted — partial changes remain in the clone.</span></div>}

      <div style={{ marginTop: 18 }}>
        <Terminal lines={logs} />
        {status === 'running' && (
          <button
            className="btn danger"
            style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}
            disabled={discarding || !jobId}
            onClick={async () => {
              if (!confirm('Cancel the running fix and discard the changes already applied?')) return
              setDiscarding(true)
              try {
                if (jobId) await post(`/jobs/${jobId}/cancel`)
                // the stream emits 'cancelled' and the handler above does the reset --hard
              } catch { /* the stream may have ended before */ } finally {
                setDiscarding(false)
              }
            }}
          >
            <Icon name="trash" /> {discarding ? 'Cancelling and discarding…' : 'Cancel and discard changes in progress'}
          </button>
        )}
      </div>

      {status !== 'running' && (
        <div className="col" style={{ gap: 10, marginTop: 18 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => void push()}><Icon name="branch" /> Create branch and push revai/fix-{record.slug}</button>
            {patchName && <a className="btn" href={`/api/reviews/${record.id}/artifacts/fixpatch`}><Icon name="download" /> Download .patch</a>}
            <button className="btn" onClick={async () => { const r = await post<{ editor?: string }>(`/reviews/${record.id}/open-editor`); toast(`opened in ${r.editor ?? 'explorer'}`) }}><Icon name="terminal" /> Open clone in editor</button>
            <button className="btn danger ghost" onClick={() => void discard()}><Icon name="trash" /> Discard fixes</button>
          </div>
          <div>
            <Link className="btn primary" to={`/report/${record.id}`}>← Back to report</Link>
          </div>
        </div>
      )}
    </div>
  )
}

function GateMini({ label, gate }: { label: string; gate: Gate }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <span className="faint small">{label}</span>
      <GateBadgeInline gate={gate} />
    </div>
  )
}

function GateBadgeInline({ gate }: { gate: Gate }) {
  return gate.status === 'passed'
    ? <span className="badge ok"><span className="dot ok" />Passed</span>
    : <span className="badge crit"><span className="dot crit" />Failed · {gate.criticalOpen} critical(s)</span>
}

// 10-states — catalog of the mocked states (QA + demo of the server error keys)
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon, GatePanel, GateBadge, Stepper } from '../ui'
import { get } from '../api'
import type { Gate } from '../../shared/types'

type ErrEntry = { code: string; title: string; message: string; hint?: string }

const gateFailed: Gate = {
  status: 'failed',
  criteria: [
    { label: '2 critical finding(s) (max 0)', tone: 'err' },
    { label: '1 security hotspot(s) (max 0)', tone: 'warn' },
    { label: '3 open finding(s) in new code', tone: 'err' },
  ],
  criticalOpen: 2,
  securityOpen: 1,
  skippedBlockers: 0,
  actionableOpen: 3,
}

const gatePassed: Gate = {
  status: 'passed',
  criteria: [{ label: 'No blockers in new code', tone: 'info' }, { label: '2 open finding(s) in new code', tone: 'info' }],
  criticalOpen: 0,
  securityOpen: 0,
  skippedBlockers: 0,
  actionableOpen: 0,
}

export default function States() {
  const [errs, setErrs] = useState<ErrEntry[]>([])
  useEffect(() => {
    get<ErrEntry[]>('/errors').then(setErrs).catch(() => {})
  }, [])

  return (
    <div className="page narrow">
      <h1>Mocked states</h1>
      <p className="lede">Catalog of the 10-states: every platform screen should reproduce one of these — see the notes when running.</p>

      <div className="col" style={{ gap: 18 }}>
        <div className="card pad col">
          <b className="small">empty — no reviews</b>
          <div className="empty"><div className="big">No reviews yet</div>Start from <Link to="/new">New review</Link>.</div>
        </div>

        <div className="card pad col">
          <b className="small">loading</b>
          <div className="row"><span className="spinner" /><span className="muted">Loading report…</span></div>
        </div>

        {errs.slice(0, 10).map((e) => (
          <div key={e.code} className="card pad col">
            <div className="row"><b className="small">{e.code}</b><span className="badge">{e.title}</span></div>
            <div className="callout err"><Icon name="alert" /><span className="col" style={{ gap: 2 }}><span>{e.message}</span>{e.hint && <span className="small faint">{e.hint}</span>}</span></div>
          </div>
        ))}

        <div className="card pad col">
          <b className="small">schema validation (real message from generate-review.mjs)</b>
          <div className="terminal"><div><span className="t-err">CR-04: field "effort" must be one of quick-win | estimated | significant.</span></div></div>
        </div>

        <div className="card pad col">
          <b className="small">cancelled/partial</b>
          <div className="callout warn"><Icon name="alert" /><span><b>Review cancelled</b><br /><span className="small">partial artifacts stay in .revai/data in the clone</span></span></div>
        </div>

        <div className="card pad col">
          <b className="small">success — Quality Gate passed</b>
          <GatePanel gate={gatePassed} />
        </div>

        <div className="card pad col">
          <b className="small">failure — Gate Failed (report state)</b>
          <GatePanel gate={gateFailed} />
        </div>

        <div className="card pad col">
          <b className="small">full stepper (04-running)</b>
          <Stepper steps={[
            { id: 'clone', label: 'Prepare clone', status: 'done' },
            { id: 'patch', label: 'Generate patch', status: 'done' },
            { id: 'analyze', label: 'Analyze changes', status: 'running' },
            { id: 'capture', label: 'Record findings', status: 'idle' },
            { id: 'validate', label: 'Validate schema', status: 'idle' },
            { id: 'assemble', label: 'Assemble report', status: 'idle' },
          ]} />
        </div>

        <div className="card pad col">
          <b className="small">flow error buttons</b>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Link className="btn" to="/new">New review</Link>
            <Link className="btn" to="/">Reviews</Link>
            <GateBadge status="failed" />
            <GateBadge status="passed" />
          </div>
        </div>
      </div>
    </div>
  )
}

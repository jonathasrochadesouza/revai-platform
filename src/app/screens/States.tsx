// 10-states — catálogo dos estados desenhados (QA + demo dos error keys do servidor)
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
      <h1>Estados desenhados</h1>
      <p className="lede">Catálogo dos 10-states: cada tela da plataforma deve reproduzir um destes — ver notas ao rodar.</p>

      <div className="col" style={{ gap: 18 }}>
        <div className="card pad col">
          <b className="small">vazio — sem reviews</b>
          <div className="empty"><div className="big">Nenhum review ainda</div>Comece em <Link to="/new">Nova review</Link>.</div>
        </div>

        <div className="card pad col">
          <b className="small">carregando</b>
          <div className="row"><span className="spinner" /><span className="muted">Carregando relatório…</span></div>
        </div>

        {errs.slice(0, 10).map((e) => (
          <div key={e.code} className="card pad col">
            <div className="row"><b className="small">{e.code}</b><span className="badge">{e.title}</span></div>
            <div className="callout err"><Icon name="alert" /><span className="col" style={{ gap: 2 }}><span>{e.message}</span>{e.hint && <span className="small faint">{e.hint}</span>}</span></div>
          </div>
        ))}

        <div className="card pad col">
          <b className="small">validação do schema (mensagem real do generate-review.mjs)</b>
          <div className="terminal"><div><span className="t-err">CR-04: campo "effort" precisa ser um de quick-win | estimated | significant.</span></div></div>
        </div>

        <div className="card pad col">
          <b className="small">cancelada/parcial</b>
          <div className="callout warn"><Icon name="alert" /><span><b>Review cancelado</b><br /><span className="small">artefatos parciais ficam em .revai/data no clone</span></span></div>
        </div>

        <div className="card pad col">
          <b className="small">sucesso — Quality Gate passou</b>
          <GatePanel gate={gatePassed} />
        </div>

        <div className="card pad col">
          <b className="small">falha — Gate Failed (estado do relatório)</b>
          <GatePanel gate={gateFailed} />
        </div>

        <div className="card pad col">
          <b className="small">stepper completo (04-running)</b>
          <Stepper steps={[
            { id: 'clone', label: 'Preparar clone', status: 'done' },
            { id: 'patch', label: 'Gerar patch', status: 'done' },
            { id: 'analyze', label: 'Analisar mudanças', status: 'running' },
            { id: 'capture', label: 'Registrar findings', status: 'idle' },
            { id: 'validate', label: 'Validar schema', status: 'idle' },
            { id: 'assemble', label: 'Montar relatório', status: 'idle' },
          ]} />
        </div>

        <div className="card pad col">
          <b className="small">botões de erro do fluxo</b>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Link className="btn" to="/new">Nova review</Link>
            <Link className="btn" to="/">Reviews</Link>
            <GateBadge status="failed" />
            <GateBadge status="passed" />
          </div>
        </div>
      </div>
    </div>
  )
}

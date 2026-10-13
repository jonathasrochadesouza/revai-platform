// 09-settings — Geral / Regras globais / Dados & cache / Acesso git
import { useEffect, useState } from 'react'
import { Icon, useToast, fmtBytes } from '../ui'
import { get, post, put } from '../api'
import { setTheme } from '../App'
import type { Settings } from '../../shared/types'

type Stats = { repos: number; reposBytes: number; reviews: number }
type Tab = 'geral' | 'regras' | 'dados' | 'git'

export default function SettingsScreen() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('geral')
  const [s, setS] = useState<Settings | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    get<Settings>('/settings').then(setS).catch(() => {})
    get<Stats>('/maintenance/stats').then(setStats).catch(() => {})
  }, [])

  const upd = (patch_: Partial<Settings>) => setS((old) => (old ? { ...old, ...patch_ } : old))

  const save = async () => {
    if (!s) return
    setSaving(true)
    try {
      const saved = await put<Settings>('/settings', s)
      setS(saved)
      if (s.theme === 'dark') setTheme('dark')
      if (s.theme === 'light') setTheme('light')
      toast('Ajustes salvos', 'ok')
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!s) {
    return <div className="page narrow"><div className="row"><span className="spinner" /><span className="muted">Carregando ajustes…</span></div></div>
  }

  const retentionLabel = (v: number) => (v === 0 ? 'Nunca' : `${v} dias`)

  return (
    <div className="page narrow">
      <h1>Ajustes</h1>
      <p className="lede">Preferências locais em <span className="mono small">~/.revai/settings.json</span>.</p>

      <div className="seg" style={{ marginBottom: 24 }}>
        {(['geral', 'regras', 'dados', 'git'] as Tab[]).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {{ geral: 'Geral', regras: 'Regras globais', dados: 'Dados & cache', git: 'Acesso git' }[t]}
          </button>
        ))}
      </div>

      {tab === 'geral' && (
        <div className="card pad col" style={{ gap: 18 }}>
          <label className="field">Tema
            <div className="row">
              <div className="seg">
                {(['system', 'dark', 'light'] as const).map((t) => (
                  <button key={t} aria-pressed={s.theme === t} onClick={() => { upd({ theme: t }); setTheme(t === 'light' ? 'light' : t === 'dark' ? 'dark' : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) }}>
                    {t === 'system' ? 'Sistema' : t === 'dark' ? 'Escuro' : 'Claro'}
                  </button>
                ))}
              </div>
            </div>
          </label>
          <label className="field">Branch base padrão
            <select className="select" style={{ maxWidth: 240 }} value={s.defaultBase} onChange={(e) => upd({ defaultBase: e.target.value })}>
              {['main', 'master', 'develop'].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <span className="faint small">2ª opção automática de base quando a 1ª (origin/HEAD) falhar</span>
          </label>
          <label className="row small" style={{ gap: 10 }}>
            <input type="checkbox" checked={s.openReportOnFinish} onChange={(e) => upd({ openReportOnFinish: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
            Abrir relatório ao terminar
          </label>
          <label className="row small" style={{ gap: 10 }}>
            <input type="checkbox" checked={s.runTestsInFixLoop} onChange={(e) => upd({ runTestsInFixLoop: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
            Rodar testes no fix loop
          </label>
        </div>
      )}

      {tab === 'regras' && (
        <div className="card pad col" style={{ gap: 10 }}>
          <b className="small">Regras globais (baseline do review)</b>
          <textarea
            value={s.globalRules}
            onChange={(e) => upd({ globalRules: e.target.value })}
            placeholder={'# Minhas regras\n- Nunca logar dados de cartão.\n- Toda query com input externo deve ser parametrizada.\n- Endpoints novos precisam de teste de contrato.'}
          />
          <span className="faint small">Injetada como contexto extra em toda revisão. <span className="mono">.revai/rules.md</span> do projeto tem prioridade sobre esta baseline.</span>
        </div>
      )}

      {tab === 'dados' && (
        <div className="col" style={{ gap: 16 }}>
          {stats && (
            <div className="card pad col" style={{ gap: 10 }}>
              <div className="row"><b className="small" style={{ flex: 1 }}>Repos clonados <span className="mono">~/.revai/repos</span></b><span className="muted num small">{stats.repos} repo(s) · {fmtBytes(stats.reposBytes)}</span></div>
              <button className="btn sm danger" onClick={async () => {
                if (!confirm('Limpar TODOS os clones do cache?')) return
                await post('/maintenance/clear-repos')
                setStats(await get<Stats>('/maintenance/stats'))
                toast('Cache de clones limpo', 'ok')
              }}>
                <Icon name="trash" /> Limpar cache
              </button>
            </div>
          )}
          <div className="card pad row">
            <b className="small" style={{ flex: 1 }}>Reviews salvas <span className="mono">~/.revai/reviews</span></b>
            <span className="muted num small">{stats?.reviews ?? '…'} review(s)</span>
            <button className="btn sm" onClick={() => void post('/maintenance/open-folder', { target: 'reviews' })}>
              <Icon name="folder" /> Abrir pasta
            </button>
          </div>
          <label className="field">Apagar clones após
            <select className="select" style={{ maxWidth: 200 }} value={s.cloneRetentionDays} onChange={(e) => upd({ cloneRetentionDays: Number(e.target.value) as 0 | 7 | 30 })}>
              {[0, 7, 30].map((d) => <option key={d} value={d}>{retentionLabel(d)}</option>)}
            </select>
            <span className="faint small">Aplicado ao iniciar o servidor (mtime dos repos)</span>
          </label>
        </div>
      )}

      {tab === 'git' && (
        <div className="card pad col" style={{ gap: 12 }}>
          <div className="callout ok"><Icon name="lock" /><span className="small">Usa o <b>credential helper do sistema</b> — o revai não guarda tokens.</span></div>
          <div className="row small muted">
            Repos remotos suportados: <span className="badge">github</span><span className="badge">gitlab</span><span className="badge">other (git https/ssh)</span>
          </div>
          <div className="small faint">
            Clone, fetch, checkout, commit e push usam o git instalado na máquina. PRs de GitHub usam <span className="mono">refs/pull/N/head</span>; MRs do GitLab usam <span className="mono">refs/merge-requests/N/head</span>.
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? <span className="spinner" /> : 'Salvar alterações'}</button>
        {s && <span className="faint small">Tema também é instantâneo via <kbd>T</kbd> / botão da barra</span>}
      </div>
    </div>
  )
}

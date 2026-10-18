// 09-settings — General / Runner / Global rules / Data & cache / Git access
import { useEffect, useState } from 'react'
import { Icon, useToast, fmtBytes, relTime } from '../ui'
import { get, post, put } from '../api'
import { setTheme } from '../App'
import type { OnboardingHarness, RuntimeInfo, Settings } from '../../shared/types'

type Stats = { repos: number; reposBytes: number; reviews: number }
type Tab = 'geral' | 'runner' | 'regras' | 'dados' | 'git'
type Detect = { harnesses: OnboardingHarness[]; runtime: RuntimeInfo }

export default function SettingsScreen() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('geral')
  const [s, setS] = useState<Settings | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [saving, setSaving] = useState(false)
  const [detect, setDetect] = useState<Detect | null>(null)
  const [validating, setValidating] = useState<Record<string, boolean>>({})
  const [customModelFor, setCustomModelFor] = useState<string | null>(null)
  const [customModel, setCustomModel] = useState('')

  useEffect(() => {
    get<Settings>('/settings').then(setS).catch(() => {})
    get<Stats>('/maintenance/stats').then(setStats).catch(() => {})
    get<Detect>('/onboarding/detect').then(setDetect).catch(() => {})
  }, [])

  const reloadDetect = () => get<Detect>('/onboarding/detect').then(setDetect).catch(() => {})

  // runner actions apply immediately — they live in ~/.revai/harnesses.json, not settings.json
  const setDefaultRunner = async (id: string, name: string) => {
    try {
      await post('/harnesses', { id, isDefault: true })
      toast(`${name} is now the default runner`, 'ok')
      await reloadDetect()
    } catch (e: any) { toast(e.message, 'err') }
  }

  const validateRunner = async (id: string) => {
    setValidating((v) => ({ ...v, [id]: true }))
    try {
      const r = await post<{ ok: boolean }>('/harnesses/validate', { id })
      toast(r.ok ? `${id} validated` : `${id} validation failed`, r.ok ? 'ok' : 'err')
    } catch (e: any) { toast(e.message, 'err') } finally {
      setValidating((v) => ({ ...v, [id]: false }))
    }
    await reloadDetect()
  }

  const applyModel = async (id: string, name: string, raw: string) => {
    const model = raw.trim() || 'auto'
    try {
      await post('/harnesses', { id, model })
      toast(model === 'auto' ? `${name}: model set to auto` : `${name}: model ${model}`, 'ok')
      setCustomModelFor(null)
      setCustomModel('')
      await reloadDetect()
    } catch (e: any) { toast(e.message, 'err') }
  }

  const upd = (patch_: Partial<Settings>) => setS((old) => (old ? { ...old, ...patch_ } : old))

  const save = async () => {
    if (!s) return
    setSaving(true)
    try {
      const saved = await put<Settings>('/settings', s)
      setS(saved)
      if (s.theme === 'dark') setTheme('dark')
      if (s.theme === 'light') setTheme('light')
      toast('Settings saved', 'ok')
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  if (!s) {
    return <div className="page narrow"><div className="row"><span className="spinner" /><span className="muted">Loading settings…</span></div></div>
  }

  const retentionLabel = (v: number) => (v === 0 ? 'Never' : `${v} days`)

  return (
    <div className="page narrow">
      <h1>Settings</h1>
      <p className="lede">Local preferences in <span className="mono small">~/.revai/settings.json</span>.</p>

      <div className="seg" style={{ marginBottom: 24 }}>
        {(['geral', 'runner', 'regras', 'dados', 'git'] as Tab[]).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {{ geral: 'General', runner: 'Runner', regras: 'Global rules', dados: 'Data & cache', git: 'Git access' }[t]}
          </button>
        ))}
      </div>

      {tab === 'geral' && (
        <div className="card pad col" style={{ gap: 18 }}>
          <label className="field">Theme
            <div className="row">
              <div className="seg">
                {(['system', 'dark', 'light'] as const).map((t) => (
                  <button key={t} aria-pressed={s.theme === t} onClick={() => { upd({ theme: t }); setTheme(t === 'light' ? 'light' : t === 'dark' ? 'dark' : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) }}>
                    {t === 'system' ? 'System' : t === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </div>
          </label>
          <label className="field">Default base branch
            <select className="select" style={{ maxWidth: 240 }} value={s.defaultBase} onChange={(e) => upd({ defaultBase: e.target.value })}>
              {['main', 'master', 'develop'].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <span className="faint small">Automatic second base option when the first (origin/HEAD) fails</span>
          </label>
          <label className="row small" style={{ gap: 10 }}>
            <input type="checkbox" checked={s.openReportOnFinish} onChange={(e) => upd({ openReportOnFinish: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
            Open report when finished
          </label>
          <label className="row small" style={{ gap: 10 }}>
            <input type="checkbox" checked={s.runTestsInFixLoop} onChange={(e) => upd({ runTestsInFixLoop: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
            Run tests in the fix loop
          </label>
        </div>
      )}

      {tab === 'runner' && (
        <div className="card pad col" style={{ gap: 14 }}>
          <span className="small faint">
            The default runner and its model are used by every new review — stored in{' '}
            <span className="mono">~/.revai/harnesses.json</span>, changes apply immediately.
          </span>
          {!detect && (
            <div className="row"><span className="spinner" /><span className="muted small">Detecting harnesses…</span></div>
          )}
          {(detect?.harnesses ?? []).map((h) => {
            const isCustomOpen = customModelFor === h.id
            return (
              <div key={h.id} className="col" style={{ gap: 10, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
                <div className="row" style={{ gap: 10 }}>
                  <input
                    type="radio"
                    name="runner-default"
                    checked={!!h.isDefault}
                    disabled={h.status === 'not-found'}
                    onChange={() => void setDefaultRunner(h.id, h.name)}
                    style={{ accentColor: 'var(--accent)' }}
                    title="Set as the default runner"
                    aria-label={`Set ${h.name} as the default runner`}
                  />
                  <span className="logo-tile">{h.logo}</span>
                  <div className="col" style={{ gap: 2, flex: 1 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <b>{h.name}</b>
                      {h.version && <span className="mono num faint">{h.version}</span>}
                      {h.isDefault && <span className="badge accent">Default</span>}
                      {h.status === 'ready' && (
                        <span className="badge ok"><span className="dot ok" />validated {h.validatedAt ? relTime(h.validatedAt) : ''}</span>
                      )}
                      {h.status === 'not-found' && <span className="badge">not found in PATH</span>}
                    </span>
                    <span className="small muted mono">{h.exe ?? h.detail}</span>
                  </div>
                  {h.status !== 'not-found' && (
                    <button className="btn sm ghost" disabled={validating[h.id]} onClick={() => void validateRunner(h.id)}>
                      {validating[h.id] ? <span className="spinner" /> : <><Icon name="refresh" /> Validate</>}
                    </button>
                  )}
                </div>
                {h.status !== 'not-found' && (
                  <div className="row" style={{ gap: 10, paddingLeft: 28 }}>
                    <label className="field" style={{ flex: 1 }}>
                      Model
                      <select
                        className="select"
                        value={isCustomOpen ? '__custom__' : (h.model ?? 'auto')}
                        onChange={(e) => {
                          const v = e.target.value
                          if (v === '__custom__') {
                            setCustomModelFor(h.id)
                            setCustomModel(h.model && !(h.models ?? ['auto']).includes(h.model) ? h.model : '')
                          } else {
                            void applyModel(h.id, h.name, v)
                          }
                        }}
                      >
                        {(h.models ?? ['auto']).map((m) => <option key={m} value={m}>{m}</option>)}
                        <option value="__custom__">custom…</option>
                      </select>
                    </label>
                    {isCustomOpen && (
                      <label className="field" style={{ flex: 2 }}>
                        Custom model (provider/id)
                        <input
                          className="input"
                          style={{ height: 34 }}
                          placeholder="e.g. opencode-go/glm-5.3-flash"
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                        />
                      </label>
                    )}
                    {isCustomOpen && (
                      <button className="btn sm" style={{ alignSelf: 'flex-end' }} onClick={() => void applyModel(h.id, h.name, customModel)}>
                        Apply
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'regras' && (
        <div className="card pad col" style={{ gap: 10 }}>
          <b className="small">Global rules (review baseline)</b>
          <textarea
            value={s.globalRules}
            onChange={(e) => upd({ globalRules: e.target.value })}
            placeholder={'# My rules\n- Never log card data.\n- Every query with external input must be parameterized.\n- New endpoints need contract tests.'}
          />
          <span className="faint small">Injected as extra context in every review. The project's <span className="mono">.revai/rules.md</span> takes precedence over this baseline.</span>
        </div>
      )}

      {tab === 'dados' && (
        <div className="col" style={{ gap: 16 }}>
          {stats && (
            <div className="card pad col" style={{ gap: 10 }}>
              <div className="row"><b className="small" style={{ flex: 1 }}>Cloned repos <span className="mono">~/.revai/repos</span></b><span className="muted num small">{stats.repos} repo(s) · {fmtBytes(stats.reposBytes)}</span></div>
              <button className="btn sm danger" onClick={async () => {
                if (!confirm('Clear ALL clones from the cache?')) return
                await post('/maintenance/clear-repos')
                setStats(await get<Stats>('/maintenance/stats'))
                toast('Clone cache cleared', 'ok')
              }}>
                <Icon name="trash" /> Clear cache
              </button>
            </div>
          )}
          <div className="card pad row">
            <b className="small" style={{ flex: 1 }}>Saved reviews <span className="mono">~/.revai/reviews</span></b>
            <span className="muted num small">{stats?.reviews ?? '…'} review(s)</span>
            <button className="btn sm" onClick={() => void post('/maintenance/open-folder', { target: 'reviews' })}>
              <Icon name="folder" /> Open folder
            </button>
          </div>
          <label className="field">Delete clones after
            <select className="select" style={{ maxWidth: 200 }} value={s.cloneRetentionDays} onChange={(e) => upd({ cloneRetentionDays: Number(e.target.value) as 0 | 7 | 30 })}>
              {[0, 7, 30].map((d) => <option key={d} value={d}>{retentionLabel(d)}</option>)}
            </select>
            <span className="faint small">Applied when the server starts (repo mtimes)</span>
          </label>
        </div>
      )}

      {tab === 'git' && (
        <div className="card pad col" style={{ gap: 12 }}>
          <div className="callout ok"><Icon name="lock" /><span className="small">Uses the <b>system credential helper</b> — revai does not store tokens.</span></div>
          <div className="row small muted">
            Supported remote repos: <span className="badge">github</span><span className="badge">gitlab</span><span className="badge">other (git https/ssh)</span>
          </div>
          <div className="small faint">
            Clone, fetch, checkout, commit and push use the git installed on the machine. GitHub PRs use <span className="mono">refs/pull/N/head</span>; GitLab MRs use <span className="mono">refs/merge-requests/N/head</span>.
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 20 }}>
        <button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? <span className="spinner" /> : 'Save changes'}</button>
        {s && <span className="faint small">Theme is also instant via <kbd>T</kbd> / the toolbar button</span>}
      </div>
    </div>
  )
}

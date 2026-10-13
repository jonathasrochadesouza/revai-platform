// revai — app shell (sidebar, topbar, ⌘K, atalhos) + rotas
import { useCallback, useEffect, useState, useContext } from 'react'
import { Outlet, createBrowserRouter, useLocation, useNavigate, NavLink, Link } from 'react-router-dom'
import { Icon, ToastCtx, ToastHost, GateBadge } from './ui'
import { get } from './api'
import type { ReviewRow } from '../shared/types'
import Onboarding from './screens/Onboarding'
import NewReview from './screens/NewReview'
import Configure from './screens/Configure'
import Running from './screens/Running'
import Report from './screens/Report'
import Fix from './screens/Fix'
import History from './screens/History'
import Settings from './screens/Settings'
import States from './screens/States'

// ── tema ─────────────────────────────────────────────────────────────────
export function setTheme(mode: 'dark' | 'light') {
  document.documentElement.dataset.theme = mode
  localStorage.setItem('revai-theme', mode)
}

// ── paleta ⌘K ────────────────────────────────────────────────────────────
function Palette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [recents, setRecents] = useState<ReviewRow[]>([])
  const nav = useNavigate()
  const toast = useContext(ToastCtx)
  useEffect(() => {
    if (open) {
      setQ('')
      get<ReviewRow[]>('/reviews?limit=3').then(setRecents).catch(() => {})
    }
  }, [open])
  if (!open) return null
  const actions = [
    { icon: 'plus', label: 'Nova review', kbd: 'N', go: () => nav('/new') },
    { icon: 'list', label: 'Reviews', kbd: 'G', go: () => nav('/') },
    { icon: 'gear', label: 'Ajustes', go: () => nav('/settings') },
    {
      icon: 'moon', label: 'Alternar tema', kbd: 'T',
      go: () => {
        const cur = (document.documentElement.dataset.theme as 'dark' | 'light') ?? 'dark'
        setTheme(cur === 'dark' ? 'light' : 'dark')
        toast('Tema alternado', 'ok')
      },
    },
  ].filter((a) => a.label.toLowerCase().includes(q.toLowerCase()))
  const rec = recents.filter((r) => `${r.repoLabel} ${r.head}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="overlay open" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette">
        <div className="p-input">
          <Icon name="search" />
          <input autoFocus placeholder="Cole uma URL de repo, busque reviews ou rode um comando…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Comando" />
          <kbd>esc</kbd>
        </div>
        <div className="p-group">
          <div>Ações</div>
          {actions.map((a) => (
            <a key={a.label} onClick={(e) => { e.preventDefault(); a.go(); onClose() }} href="#">
              <Icon name={a.icon} /> {a.label} {a.kbd && <kbd>{a.kbd}</kbd>}
            </a>
          ))}
        </div>
        <div className="p-group">
          <div>Recentes</div>
          {rec.length === 0 && <div className="small faint" style={{ padding: '6px 10px' }}>nenhum review ainda</div>}
          {rec.map((r) => (
            <Link key={r.id} to={`/report/${r.id}`} onClick={onClose}>
              <Icon name="git" /> {r.repoLabel} · {r.head}
              <span style={{ marginLeft: 'auto' }}><GateBadge status={r.gate} /></span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── banner quando a API local não responde ────────────────────────────────
function ServerBanner() {
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    let alive = true
    const ping = () => {
      fetch('/api/health')
        .then((r) => { if (alive) setOffline(!r.ok) })
        .catch(() => { if (alive) setOffline(true) })
    }
    ping()
    const t = setInterval(ping, 8000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  if (!offline) return null
  return (
    <div className="callout err" style={{ margin: 0, borderRadius: 0, borderLeft: 0, borderRight: 0, borderTop: 0 }}>
      <Icon name="alert" />
      <span className="small">
        <b>Servidor local offline</b> — rode <code>npm start</code> na raiz do projeto (porta 8797) e recarregue esta página.
      </span>
    </div>
  )
}

// ── crumbs por rota ──────────────────────────────────────────────────────
function crumbsFor(pathname: string): { label: string; to?: string }[] {
  if (pathname.startsWith('/new')) return [{ label: 'Reviews', to: '/' }, { label: 'Nova review' }]
  if (pathname.startsWith('/configure')) return [{ label: 'Reviews', to: '/' }, { label: 'Nova review', to: '/new' }, { label: 'Branch + harness' }]
  if (pathname.startsWith('/running')) return [{ label: 'Reviews', to: '/' }, { label: 'Nova review', to: '/new' }, { label: 'Acompanhar' }]
  if (pathname.startsWith('/report')) return [{ label: 'Reviews', to: '/' }, { label: 'Relatório' }]
  if (pathname.startsWith('/fix')) return [{ label: 'Reviews', to: '/' }, { label: 'Fix loop' }]
  if (pathname.startsWith('/settings')) return [{ label: 'Ambiente' }, { label: 'Ajustes' }]
  return [{ label: 'Reviews' }]
}

// ── shell ────────────────────────────────────────────────────────────────
function Shell() {
  const loc = useLocation()
  const nav = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const theme = (document.documentElement.dataset.theme as 'dark' | 'light') ?? 'dark'

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
        return
      }
      if (e.key === 'Escape') setPaletteOpen(false)
      if (typing) return
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        nav('/new')
      }
      if (e.key.toLowerCase() === 't') setTheme(theme === 'dark' ? 'light' : 'dark')
    },
    [nav, theme],
  )

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  const crumbs = crumbsFor(loc.pathname)
  return (
    <div className="app">
      <aside className="side" aria-label="Navegação principal">
        <Link className="brand" to="/" title="Reviews">
          <img src="/logo.png" alt="" />revai <small>v1.0</small>
        </Link>
        <NavLink
          to="/new"
          className="nav-item"
          aria-current={loc.pathname.startsWith('/new') || loc.pathname.startsWith('/configure') || loc.pathname.startsWith('/running') ? 'page' : undefined}
        >
          <Icon name="plus" /> Nova review <kbd>N</kbd>
        </NavLink>
        <NavLink to="/" className="nav-item" aria-current={loc.pathname === '/' || loc.pathname.startsWith('/report') || loc.pathname.startsWith('/fix') ? 'page' : undefined}>
          <Icon name="list" /> Reviews <kbd>G</kbd>
        </NavLink>
        <div className="nav-sep" />
        <div className="nav-label">Ambiente</div>
        <NavLink to="/settings" className="nav-item" aria-current={loc.pathname.startsWith('/settings') ? 'page' : undefined}>
          <Icon name="gear" /> Ajustes
        </NavLink>
      </aside>
      <div className="main">
        <header className="top">
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {i > 0 && <span className="sep">/</span>}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <b>{c.label}</b>}
              </span>
            ))}
          </nav>
          <div className="spacer" />
          <button className="btn sm" onClick={() => setPaletteOpen(true)} aria-label="Abrir command palette">
            <Icon name="search" /> Buscar <kbd>Ctrl K</kbd>
          </button>
          <button className="btn ghost sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Alternar tema">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </header>
        <ServerBanner />
        <div className="content">
          <Outlet />
        </div>
      </div>
      <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}

function NotFound() {
  return (
    <div className="page">
      <h1>Página não encontrada</h1>
      <p className="lede">A rota acessada não existe nesta plataforma.</p>
      <Link className="btn" to="/">Voltar para Reviews</Link>
    </div>
  )
}

export const router = createBrowserRouter([
  {
    element: (
      <ToastHost>
        <Outlet />
      </ToastHost>
    ),
    children: [
      { path: '/onboarding', element: <Onboarding /> },
      { path: '/states', element: <States /> },
      {
        element: <Shell />,
        children: [
          { path: '/', element: <History /> },
          { path: '/new', element: <NewReview /> },
          { path: '/configure', element: <Configure /> },
          { path: '/running', element: <Running /> },
          { path: '/report/:id', element: <Report /> },
          { path: '/fix/:id', element: <Fix /> },
          { path: '/settings', element: <Settings /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])

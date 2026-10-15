// Shared components — same visual language as the prototype.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Finding, Gate, Severity } from '../shared/types'
import { PRIORITY_MAP } from '../shared/gate'

// ── Icon sprite (same paths as prototype/app.js) ────────────────────────
const P: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10c0 4-6 3-12 6"/>',
  git: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  wand: '<path d="m15 4 5 5L9 20H4v-5zM13 6l5 5"/>',
  skip: '<path d="m5 4 10 8-10 8zM19 5v14"/>',
  play: '<path d="m7 4 13 8-13 8z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V21h16"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
}

export function Icon({ name, className }: { name: string; className?: string }) {
  return <svg className={className ?? 'icon'} aria-hidden="true" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: P[name] ?? '' }} />
}

// ── Badges / sev ──────────────────────────────────────────────────────────
export function sevOf(f: { severity?: Severity; priority?: Severity }): Severity | undefined {
  return (f.severity ?? (f.priority ? PRIORITY_MAP[f.priority] : undefined)) as Severity | undefined
}

export function SevBadge({ sev, category }: { sev?: Severity | null; category?: string }) {
  if (!sev && !category) return null
  return (
    <span className={`badge ${sev ?? 'minor'}`}>
      {sev === 'critical' && <span className="dot crit" />}
      {sev === 'major' && <span className="dot major" />}
      {sev ?? 'sev?'}
      {category ? ` · ${category}` : ''}
    </span>
  )
}

export function CatBadge({ cat }: { cat?: string }) {
  if (!cat) return null
  const cls = cat === 'security' ? 'crit' : cat === 'performance' ? 'major' : cat === 'data-integrity' ? 'minor' : 'trivial'
  return <span className={`badge ${cls}`}>{cat}</span>
}

export function GateBadge({ status }: { status: 'passed' | 'failed' }) {
  return status === 'passed'
    ? <span className="badge ok"><span className="dot ok" />Passed</span>
    : <span className="badge crit"><span className="dot crit" />Failed</span>
}

// ── Buttons/seg/field ─────────────────────────────────────────────────────
export function Seg<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Terminal with auto-scroll ─────────────────────────────────────────────
export interface LogLine { stream: string; line: string; cls?: string }

export function Terminal({ lines, className }: { lines: LogLine[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])
  return (
    <div ref={ref} className={`terminal ${className ?? ''}`} style={{ minHeight: 220, maxHeight: 340, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {lines.length === 0 && <div><span className="t-dim">waiting…</span></div>}
      {lines.map((l, i) => (
        <div key={i} className={l.cls ?? (l.stream === 'git' ? 't-dim' : l.stream === 'script' ? 't-acc' : l.stream === 'tests' ? 't-ok' : '')}>
          {l.line}
        </div>
      ))}
    </div>
  )
}

// ── Code diff (proposedFix before/after) ──────────────────────────────
export function CodeDiff({ before, after, maxHeight }: { before: string[]; after: string[]; maxHeight?: number }) {
  let n = 0
  return (
    <div className="code" style={maxHeight ? { maxHeight, overflow: 'auto' } : undefined}>
      {(before ?? []).length > 0 && <div className="ln" style={{ color: 'var(--fg-3)', fontSize: 11 }}>BEFORE</div>}
      {(before ?? []).map((l) => (
        <div key={`d${n++}`} className="ln del"><i>{n - 1}</i><span>{l || ' '}</span></div>
      ))}
      {(after ?? []).length > 0 && <div className="ln" style={{ color: 'var(--fg-3)', fontSize: 11 }}>AFTER</div>}
      {(after ?? []).map((l) => (
        <div key={`a${n++}`} className="ln add"><i>{n - 1}</i><span>{l || ' '}</span></div>
      ))}
    </div>
  )
}

// ── Gate ─────────────────────────────────────────────────────────────────
export function GatePanel({ gate }: { gate: Gate }) {
  const failed = gate.status === 'failed'
  return (
    <div className={`gate-panel ${failed ? 'failed' : 'passed'}`}>
      <div className="row">
        <b>{failed ? 'Quality Gate: Failed' : 'Quality Gate: Passed'}</b>
      </div>
      <ul className="gate-crit" style={{ margin: 0, paddingLeft: 18 }}>
        {gate.criteria.map((c, i) => (
          <li key={i} style={{ color: c.tone === 'err' ? 'var(--crit)' : c.tone === 'warn' ? 'var(--major)' : 'var(--fg-2)' }}>
            {c.label}
          </li>
        ))}
      </ul>
      {!!gate.skippedBlockers && (
        <div className="small muted">You skipped a blocker — the Gate passed, but record the decision.</div>
      )}
    </div>
  )
}

// ── Steppers ─────────────────────────────────────────────────────────────
export type StepStatus = 'idle' | 'running' | 'done' | 'failed'
export interface Step { id: string; label: string; status: StepStatus; detail?: string }

export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <div className="stepper">
      {steps.map((s, i) => (
        <div key={s.id} className={`step ${s.status}`}>
          <span className="sidx">{s.status === 'failed' ? '!' : i + 1}</span>
          <span>{s.label}</span>
          {s.status === 'running' && <span className="spinner" style={{ marginLeft: 4 }} />}
          {s.status === 'done' && <Icon name="check" className="icon" />}
          {s.status === 'failed' && <Icon name="x" className="icon" />}
          {s.detail && <small className="num">{s.detail}</small>}
        </div>
      ))}
    </div>
  )
}

// ── Toasts ───────────────────────────────────────────────────────────────
interface Toast { id: number; text: string; kind: 'info' | 'ok' | 'err' }
export const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {})
export function useToast() {
  return useContext(ToastCtx)
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const toast = useMemo(
    () => (text: string, kind: Toast['kind'] = 'info') => {
      const id = Date.now() + Math.random()
      setItems((l) => [...l, { id, text, kind }])
      setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 4000)
    },
    [],
  )
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ── Formatting utilities ─────────────────────────────────────────────
export function relTime(ts: number): string {
  const d = Math.round((Date.now() - ts) / 1000)
  if (d < 60) return 'now'
  if (d < 3600) return `${Math.floor(d / 60)} min ago`
  if (d < 86400) return `${Math.round(d / 3600)} h ago`
  return `${Math.round(d / 86400)} days ago`
}

export function fmtDur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function copyText(text: string): Promise<void> {
  return navigator.clipboard?.writeText(text).catch(() => {})
}

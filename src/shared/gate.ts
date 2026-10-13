// Quality Gate — espelha computeGate() do template da skill
// (skill-version/revai/skills/revai/templates/review.html).
// Regra central: "failed = criticalCount > 0"; segurança não falha sozinha,
// mas entra na lista de criteria; blocker pulado → passa com aviso.
import type { Finding, Gate, Severity } from './types'

export const SEVERITIES: Severity[] = ['critical', 'major', 'minor', 'trivial']
export const CATEGORIES = ['security', 'performance', 'stability', 'data-integrity']
export const EFFORTS = ['quick-win', 'estimated', 'significant'] as const // schema V2: no data, not in UI
type LegacyPriority = 'critical' | 'medium' | 'low'
export const LEGACY_PRIORITIES: LegacyPriority[] = ['critical', 'medium', 'low']
export const PRIORITY_MAP: Record<string, Severity> = { critical: 'critical', medium: 'major', low: 'minor' }

/** Severidade efetiva: severity do schema V2 ou priority legado mapeada. */
export function effSev(f: Finding): Severity | undefined {
  return f.severity ?? (f.priority ? PRIORITY_MAP[f.priority] : undefined)
}

export function computeGate(findings: Finding[], skipped: string[]): Gate {
  const active = findings.filter((f) => f.status !== 'resolved' && !skipped.includes(f.id))
  const criticalOpen = active.filter((f) => effSev(f) === 'critical').length
  const securityOpen = active.filter((f) => f.category === 'security').length
  const skippedBlockers = findings.filter(
    (f) => skipped.includes(f.id) && f.status !== 'resolved' && (effSev(f) === 'critical' || f.category === 'security'),
  ).length

  const failed = criticalOpen > 0
  const criteria: Gate['criteria'] = []
  if (failed) {
    criteria.push({ label: `${criticalOpen} critical finding(s) (max 0)`, tone: 'err' })
    if (securityOpen > 0) criteria.push({ label: `${securityOpen} security hotspot(s) (max 0)`, tone: 'warn' })
  } else if (skippedBlockers > 0) {
    criteria.push({ label: `${skippedBlockers} blocker(s) marked as Skipped`, tone: 'warn' })
  } else {
    criteria.push({ label: 'No blockers in new code', tone: 'info' })
  }
  criteria.push({ label: `${active.length} open finding(s) in new code`, tone: failed ? 'err' : 'info' })

const blockers = active.filter((f) => effSev(f) === 'critical' || effSev(f) === 'major')

  return {
    status: failed ? 'failed' : 'passed',
    criteria,
    criticalOpen,
    securityOpen,
    skippedBlockers,
    actionableOpen: blockers.length,
  }
}

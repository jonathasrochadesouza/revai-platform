// Parser de origem de review — suporta os formatos da tela 02 do protótipo:
//   https://github.com/org/repo · …/tree/branch · …/pull/482 · gitlab merge_requests · git@host:org/repo · pasta local
import type { ParsedSource, ParsedRef } from './types'

function normalizeHost(rawHost: string): string {
  return rawHost.replace(/^www\./, '')
}

function providerOf(host: string): ParsedSource['provider'] {
  if (host === 'github.com') return 'github'
  if (host === 'gitlab.com' || host.endsWith('gitlab')) return 'gitlab'
  return 'other'
}

function refFromUrl(host: string, rest: string): ParsedRef | undefined {
  // github.com/org/repo/tree/branch (branch pode conter /) · gitlab .com/org/repo/-/tree/branch
  let m = rest.match(/^\/(?:-\/)?tree\/(.+)$/)
  if (m) return { value: decodeURIComponent(m[1]).replace(/\/+$/, ''), kind: 'branch', label: decodeURIComponent(m[1]).replace(/\/+$/, '') }
  m = rest.match(/^\/(?:-\/)?commits?\/([0-9a-f]{7,40})\/?$/)
  if (m) return { value: m[1], kind: 'sha', label: m[1].slice(0, 7) }
  m = rest.match(/^\/pull\/(\d+)/)
  if (m) {
    const n = Number(m[1])
    return { value: `pull/${n}/head`, kind: 'pr', prNumber: n, label: `PR #${n}` }
  }
  m = rest.match(/^\/-\/merge_requests\/(\d+)/)
  if (m) {
    const n = Number(m[1])
    return { value: `merge-requests/${n}/head`, kind: 'pr', prNumber: n, label: `MR !${n}` }
  }
  m = rest.match(/^\/branch\/(.+)$/)
  if (m) {
    const v = decodeURIComponent(m[1]).replace(/\/+$/, '')
    return { value: v, kind: 'branch', label: v }
  }
  return undefined
}

export function parseSource(rawInput: string): ParsedSource {
  const raw = rawInput.trim().replace(/\s+/g, ' ')
  if (!raw) throw new Error('source-vazia')

  // Pasta local (windows drive, UNC, ~, ./, ou caminho existente com separador)
  if (/^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\/.test(raw) || /^[~/]/.test(raw) || raw.startsWith('./') || raw.startsWith('.\\')) {
    return { kind: 'folder', provider: 'other', host: 'localhost', org: '', repo: raw.replace(/[\\/]+$/, ''), raw }
  }
  if (raw === '.' || raw.endsWith('/') || raw.endsWith('\\')) {
    return { kind: 'folder', provider: 'other', host: 'localhost', org: '', repo: raw.replace(/[\\/]+$/, ''), raw }
  }

  const isHttp = /^https?:\/\//i.test(raw)
  const isSshUrl = /^ssh:\/\/[\w@.-]+\//i.test(raw)
  const isScp = /^git@[\w.-]+:/.test(raw)

  // org/repo → github implícito
  let host: string | undefined
  let rest: string | undefined

  if (isHttp) {
    const u = new URL(raw)
    host = normalizeHost(u.hostname)
    rest = (u.pathname || '').replace(/\/+$/, '') + (u.hash ? '' : '')
  } else if (isScp) {
    const m = raw.match(/^git@([\w.-]+):(.+?)(?:\.git)?\/?$/)
    if (!m) throw new Error('ssh inválido')
    host = normalizeHost(m[1])
    rest = '/' + m[2]
  } else if (isSshUrl) {
    const u = new URL(raw)
    host = normalizeHost(u.hostname)
    rest = u.pathname.replace(/\/+$/, '')
  } else if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
    host = 'github.com'
    rest = '/' + raw.replace(/\.git$/, '')
  } else if (/^[\w.-]*$/.test(raw) && raw.includes('.')) {
    throw new Error('origem não reconhecida')
  } else {
    throw new Error('origem não reconhecida')
  }

  if (!host) throw new Error('host ausente')

  // strip .git sufixo
  if (rest && /\.git$/.test(rest) && !refFromUrl(host, rest)) rest = rest.replace(/\.git$/, '')

  const segs = (rest ?? '').split('/').filter(Boolean)
  if (segs.length < 2) throw new Error('faltando org/repo na URL')
  const org = segs[0]
  let repo = segs[1].replace(/\.git$/, '')
  if (!/^[\w.-]+$/.test(repo)) throw new Error('nome de repo inválido')

  // ref dentro da URL começa depois de /org/repo(/-)?/(tree|pull|merge_requests…)
  const afterRepo = segs.slice(2).join('/')
  const ref = refFromUrl(host, '/' + afterRepo)

  const cloneUrl = `https://${host}/${org}/${repo}.git`
  return {
    kind: 'remote',
    provider: providerOf(host),
    host,
    org,
    repo,
    url: cloneUrl,
    ref,
    raw,
  }
}

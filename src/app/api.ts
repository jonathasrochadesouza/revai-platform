// local API client + SSE (server event stream)
export class ApiError extends Error {
  constructor(public code: string, message: string, public detail?: string) {
    super(message)
  }
}

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // TypeError: Failed to fetch — local API unreachable
    throw new ApiError(
      'server/offline',
      'Local server did not respond. Run `npm start` in the project root (port 8797) and reload this page.',
    )
  }
  let data: any = {}
  try { data = await res.json() } catch { /* stream/204 */ }
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? 'internal/fetch', data?.error?.message ?? res.statusText, data?.error?.detail)
  }
  return data as T
}

export const get = <T>(path: string) => call<T>(path, 'GET')
export const post = <T>(path: string, body?: unknown) => call<T>(path, 'POST', body ?? {})
export const put = <T>(path: string, body?: unknown) => call<T>(path, 'PUT', body ?? {})
export const patch = <T>(path: string, body?: unknown) => call<T>(path, 'PATCH', body ?? {})
export const del = <T>(path: string) => call<T>(path, 'DELETE')

/** POST with SSE response — events separated by "\n\n", payload in `data: …`. */
export async function sse<T>(
  path: string,
  body: unknown,
  onEvent: (ev: T) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new ApiError(
      'server/offline',
      'Local server did not respond. Run `npm start` in the project root (port 8797) and reload this page.',
    )
  }
  if (!res.ok || !res.body) {
    let data: any = {}
    try { data = await res.json() } catch { /* foo */ }
    throw new ApiError(data?.error?.code ?? 'internal/fetch', data?.error?.message ?? res.statusText, data?.error?.detail)
  }
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as T)
      } catch { /* invalid fragment */ }
    }
  }
}

// consome o SSE de /api/reviews/stream e imprime os eventos (teste do fluxo real)
const BASE = 'http://127.0.0.1:8797'
const body = {
  source: process.argv[2] ?? 'https://github.com/httpie/httpie/tree/feature/term-headers',
  head: process.argv[3] ?? 'feature/term-headers',
  base: process.argv[4] ?? 'master',
  harnessId: process.argv[5] ?? 'codex',
}

async function main() {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/reviews/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    console.error('HTTP', res.status, await res.text())
    process.exit(1)
  }
  const dec = new TextDecoder()
  const reader = res.body.getReader()
  let buf = ''
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buf += dec.decode(chunk.value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      let ev
      try {
        ev = JSON.parse(line.slice(5))
      } catch {
        continue
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1).padStart(6)
      if (ev.t === 'step') console.log(`[${secs}s] STEP ${ev.id} → ${ev.status}${ev.detail ? ' · ' + ev.detail : ''}`)
      else if (ev.t === 'log') console.log(`[${secs}s] LOG[${ev.stream}] ${ev.line.slice(0, 120)}`)
      else if (ev.t === 'stats') console.log(`[${secs}s] STATS ${ev.filesChanged} files +${ev.additions}/-${ev.deletions} slug=${ev.slug}`)
      else if (ev.t === 'gate') console.log(`[${secs}s] GATE ${ev.gate.status} · críticos=${ev.gate.criticalOpen}`)
      else if (ev.t === 'done') {
        console.log(`[${secs}s] DONE reviewId=${ev.reviewId}`)
        console.log(ev.reviewId)
        return
      } else if (ev.t === 'error') {
        console.log(`[${secs}s] ERROR ${ev.code}: ${ev.message}`)
        if (ev.detail) console.log(ev.detail.slice(0, 300))
        process.exitCode = 2
        return
      } else if (ev.t === 'cancelled') console.log(`[${secs}s] CANCELLED ${ev.note ?? ''}`)
      else if (ev.t !== 'job') console.log(`[${secs}s] ${JSON.stringify(ev).slice(0, 160)}`)
    }
  }
}

await main()

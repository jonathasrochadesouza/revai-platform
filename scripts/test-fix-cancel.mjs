// tests the flow: fix streaming → cancel in the middle of apply → server emits 'cancelled' → client discards (reset) → clean clone
const BASE = 'http://127.0.0.1:8797'
const RID = process.argv[2] ?? 'r-mv73l94z-jfk18k'
const CLONE = process.argv[3] ?? process.env.TEMP + '\\opencode\\revai-cancel-test'
const { execSync } = await import('node:child_process')

const rec0 = await (await fetch(`${BASE}/api/reviews/${RID}`)).json()
const target = rec0.findings.find((f) => f.status === 'open')
console.log('fix target:', target.id, '-', target.title)
const recGate0 = rec0.gate.status

const t0 = Date.now()
const res = await fetch(`${BASE}/api/reviews/${RID}/fix/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ids: [target.id] }),
})
if (!res.ok) {
  console.error('HTTP', res.status, await res.text())
  process.exit(1)
}
const rd = res.body.getReader()
const dec = new TextDecoder()
let buf = ''
let jobId = null
let cancelFired = false

for (;;) {
  const c = await rd.read()
  if (c.done) break
  buf += dec.decode(c.value, { stream: true })
  const parts = buf.split('\n\n')
  buf = parts.pop() ?? ''
  for (const p of parts) {
    const line = p.split('\n').find((l) => l.startsWith('data:'))
    if (!line) continue
    let ev
    try { ev = JSON.parse(line.slice(5)) } catch { continue }
    const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(5)
    if (ev.t === 'job') { jobId = ev.id; console.log(`[${s}s] JOB ${ev.id}`) }
    else if (ev.t === 'queue') console.log(`[${s}s] QUEUE ${ev.items.map((i) => i.id).join(',')}`)
    else if (ev.t === 'item') {
      console.log(`[${s}s] ITEM ${ev.id} ${ev.step} ${ev.status}${ev.detail ? ' · ' + ev.detail : ''}`)
      if (ev.step === 'apply' && ev.status === 'running' && !cancelFired) {
        cancelFired = true
        setTimeout(async () => {
          console.log('>>> CANCEL sent to the server')
          await fetch(`${BASE}/api/jobs/${jobId}/cancel`, { method: 'POST' })
        }, 2500)
      }
    } else if (ev.t === 'log') {
      console.log(`[${s}s] LOG[${ev.stream}] ${(ev.line || '').slice(0, 100)}`)
    } else if (ev.t === 'cancelled') {
      console.log(`[${s}s] CANCELLED received — discarding the way Fix.tsx would…`)
      await fetch(`${BASE}/api/reviews/${RID}/reset`, { method: 'POST' })
      console.log('>>> RESET executed')
      const status = execSync('git -C "' + CLONE + '" status --porcelain', { encoding: 'utf8' }).trim()
      console.log('>>> git status --porcelain (expected: empty):', JSON.stringify(status))
      const rec2 = await (await fetch(`${BASE}/api/reviews/${RID}`)).json()
      const f2 = rec2.findings.find((f) => f.id === target.id)
      console.log('>>> record: gate=' + rec2.gate.status + ' (before=' + recGate0 + ') · ' + target.id + '=' + f2.status + ' (expected open) · fixApplied=' + (rec2.fixApplied || []).join(',') + ' (expected empty)')
      const ok = !status && rec2.gate.status === recGate0 && f2.status === 'open' && !(rec2.fixApplied || []).length
      console.log(ok ? '>>> ✅ CANCEL+DISCARD FLOW PASSED' : '>>> ❌ FAILED')
      process.exit(ok ? 0 : 4)
    } else if (ev.t === 'error') {
      console.log(`[${s}s] ERROR ${ev.code}: ${ev.message}`)
      process.exit(2)
    }
  }
}
console.log('stream closed without a cancelled event — did the cancel fire too early or too late?')
process.exit(3)

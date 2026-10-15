// Verificação manual da porta do app desktop (Electron não roda em `npm run test`).
// Recria a cadeia `electron/main.cjs` → `dist/server/server.cjs` contra um ocupador:
//   1. ocupa a porta no modo indicado (bind de serviço, irmão do dev backend do usuário)
//   2. replica probe()/pickPort() do main.cjs (bind 127.0.0.1)
//   3. sobe o server empacotado (serve() também em 127.0.0.1) na porta escolhida
// Vereditos esperados com a família de bind alinhada:
//   dual/v6only/v4wild → GREEN na base (bind loopback convive com ocupador não-loopback)
//   loopback           → probe sobe +1 e o server abre lá (conflito real desviado)
// Uso: node scripts/test-desktop-port.mjs <dual|v6only|v4wild|loopback> [porta-base]
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] ?? 'dual'
const BASE = Number(process.argv[3] ?? process.env.REVAI_TEST_PORT ?? 8797)

function occupy(port, m) {
  const srv = net.createServer(() => {})
  return new Promise((resolve, reject) => {
    srv.once('error', reject)
    if (m === 'dual') srv.listen(port, () => resolve(srv))
    else if (m === 'v6only') srv.listen({ port, host: '::', ipv6Only: true }, () => resolve(srv))
    else if (m === 'v4wild') srv.listen({ port, host: '0.0.0.0' }, () => resolve(srv))
    else if (m === 'loopback') srv.listen({ port, host: '127.0.0.1' }, () => resolve(srv))
    else reject(new Error(`modo desconhecido: ${m}`))
  })
}

// réplica 1:1 de probe() de electron/main.cjs
function probe(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

// réplica 1:1 de pickPort() de electron/main.cjs
async function pickPort(start, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await probe(start + i)) return start + i
  }
  return null
}

const occupier = await occupy(BASE, mode)

// janela de corrida ~idêntica ao real: probe fecha e o server sobe logo em seguida
const picked = await pickPort(BASE)

let verdict
if (picked === null) {
  verdict = 'FALHA — main.cjs não encontraria porta livre (25 tentativas)'
} else {
  verdict = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'dist', 'server', 'server.cjs')], {
      env: { ...process.env, REVAI_PORT: String(picked) },
    })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    setTimeout(() => {
      child.kill()
      if (/EADDRINUSE/.test(out)) resolve(`FALHA — EADDRINUSE na porta ${picked} (binário desatualizado? rode npm run dist:server)`)
      else if (/API \+ UI/.test(out)) resolve(`OK — server subiu na porta ${picked}`)
      else resolve(`INCONCLUSIVO — sem sinal claro:\n${out.trim()}`)
    }, 1800)
  })
}

occupier.close()
console.log(`\nmodo=${mode} base=${BASE} picked=${picked ?? '—'} => ${verdict}`)

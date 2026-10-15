// Portão de release do revai-platform — o Workflow do GitHub Actions falha se:
//   1. CHANGELOG.md não existe na raiz
//   2. CHANGELOG.md não foi alterado Nos commits enviados (bump ausente)
//   3. A seção do topo não é `## [X.Y.Z] - YYYY-MM-DD` válida (SemVer oficial)
//   4. A versão do topo não é MAIOR que a última tag `v*`
//   5. package.json divergente do CHANGELOG
// Modo CI:   node scripts/check-release.mjs --before <sha> --after <sha>
// Modo local (rode antes de dar push): node scripts/check-release.mjs
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md')

// SemVer do spec oficial (semver.org): X.Y.Z militar, sem zeros à esquerda
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

const fail = (msg) => {
  console.error(`check-release: FALHOU — ${msg}`)
  process.exit(1)
}
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })

function cmpSemver(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

const flags = {}
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i].startsWith('--')) flags[process.argv[i].slice(2)] = process.argv[i + 1]
}

if (!fs.existsSync(CHANGELOG_PATH)) {
  fail('CHANGELOG.md não existe na raiz do projeto')
}
const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8').replace(/\r\n/g, '\n')

// seção versionada do topo (a primeira depois do cabeçalho/[Unreleased])
const topMatch = changelog.match(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})/m)
if (!topMatch) {
  fail('sem seção versionada (esperado `## [X.Y.Z] - YYYY-MM-DD` perto do topo do CHANGELOG.md)')
}
const [, version, date] = topMatch
if (!SEMVER_RE.test(version)) fail(`versão no topo inválida: ${version}`)

// package.json precisa estar sincronizado com o CHANGELOG (fonte única)
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
if (pkg.version !== version) {
  fail(`package.json "version" (${pkg.version}) divergente do CHANGELOG (${version})`)
}

// bump deve ser maior que a última tag existente
let latestTag = null
const tags = git(['tag', '--list', 'v*'])
  .trim()
  .split('\n')
  .filter((t) => SEMVER_RE.test(t.replace(/^v/, '')))
  .map((t) => t.replace(/^v/, ''))
  .sort(cmpSemver)
if (tags.length > 0) latestTag = tags[tags.length - 1]
if (latestTag && cmpSemver(version, latestTag) <= 0) {
  fail(`versão ${version} não é maior que a última tag v${latestTag} — commit sem bump`)
}

// CHANGELOG.md precisa ter sido tocado no intervalo do push (bump presente no commit)
const before = flags.before
const after = flags.after
if (before && after && !/^(0{7}|$)/.test(before) && before !== after) {
  const changed = git(['diff', '--name-only', `${before}..${after}`])
    .trim()
    .split('\n')
  if (!changed.includes('CHANGELOG.md')) {
    fail('CHANGELOG.md não foi alterado nos commits enviados — inclua a nova versão no commit')
  }
}

// publica a versão como output do job (workflow usa em build/publish)
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`)
}

console.log(
  `check-release: OK — próxima release v${version} (${date})${
    latestTag ? ` · tag anterior v${latestTag}` : ' · primeira release'
  }`,
)

// --notes <versão>: imprime o corpo da seção (usado pelo job publish no body do Release)
if (flags.notes) {
  const startMarker = `## [${flags.notes}] -`
  const start = changelog.indexOf(startMarker)
  if (start < 0) fail(`seção [${flags.notes}] não encontrada para extração de notas`)
  const from = changelog.indexOf('\n', start) + 1
  const nextHead = changelog.slice(from).search(/\n## \[|\n\[Unreleased\]:/)
  const body = nextHead < 0 ? changelog.slice(from) : changelog.slice(from, from + nextHead)
  console.log(body.trim())
}

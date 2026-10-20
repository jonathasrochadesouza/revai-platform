// App version — single source of truth: package.json (kept in sync with CHANGELOG.md
// by the release flow: bump-version skill / CI release gate). Read once and cached;
// a missing file (bundled server.cjs running outside the project root) degrades to a
// placeholder instead of crashing /health.
import fs from 'node:fs'
import path from 'node:path'
import { appRoot } from './root'

let cached: string | undefined

export function appVersion(): string {
  if (cached === undefined) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(appRoot(), 'package.json'), 'utf8')) as { version?: string }
      cached = typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0'
    } catch {
      cached = '0.0.0'
    }
  }
  return cached
}

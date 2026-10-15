import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Platform root, resolving the execution context:
 * 1. `REVAI_APP_ROOT` — packaged mode (Electron main.cjs defines it before the require)
 * 2. `import.meta.url` — dev/CLI via tsx: `src/server` → repo root
 * 3. `process.cwd()` — CJS server.cjs bundle outside Electron (esbuild empties import.meta)
 */
export function appRoot(): string {
  const env = process.env.REVAI_APP_ROOT
  if (env) return path.resolve(env)
  const hereUrl = import.meta.url
  if (hereUrl) return path.resolve(path.dirname(fileURLToPath(hereUrl)), '..', '..')
  return process.cwd()
}

/** Static SPA directory: `REVAI_DIST` absolute (Electron) or `<root>/dist/app` */
export function staticDistDir(): string {
  return process.env.REVAI_DIST ? path.resolve(process.env.REVAI_DIST) : path.join(appRoot(), 'dist', 'app')
}

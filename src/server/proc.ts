// Processes: exec with output collection + stream with tree kill + timeout.
// Never uses shell:true with user-controlled content — argv is always an array; the large prompt goes via stdin.
import { spawn, type ChildProcess } from 'node:child_process'

const isWin = process.platform === 'win32'

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
}

const CAP = 2 * 1024 * 1024 // 2 MB per collected stream

function spawnOpts(extraEnv?: Record<string, string>) {
  const stdio: Array<'pipe'> = ['pipe', 'pipe', 'pipe']
  return {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', ...extraEnv },
    windowsHide: true,
    // on unix, detached lets you kill the whole process group (-pid)
    detached: !isWin,
    stdio,
  }
}

export interface ExecOptions {
  cwd?: string
  timeoutMs?: number
  /** extra environment variables merged over the base spawn env */
  env?: Record<string, string>
}

export function exec(argv: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const w = wrap(argv)
    const child = spawn(w.cmd, w.args, { ...spawnOpts(opts.env), cwd: opts.cwd, windowsVerbatimArguments: w.verbatim })
    let stdout = '', stderr = ''
    const cap = (acc: string, chunk: string) => (acc.length < CAP ? acc + chunk : acc)
    child.stdout?.on('data', (d) => { stdout = cap(stdout, d.toString()) })
    child.stderr?.on('data', (d) => { stderr = cap(stderr, d.toString()) })
    const timer = opts.timeoutMs ? setTimeout(() => child.kill(), opts.timeoutMs) : undefined
    child.on('error', (e) => { if (timer) clearTimeout(timer); resolve({ code: -1, stdout, stderr: stderr + String(e) }) })
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}

export interface RunHandle {
  pid?: number
  kill(): Promise<void>
}

export interface StreamOptions {
  cwd?: string
  stdin?: string
  /** extra environment variables merged over the base spawn env */
  env?: Record<string, string>
  onLine?: (line: string, stream: 'out' | 'err') => void
  onSpawn?: (h: RunHandle) => void
  timeoutMs?: number
}

export function stream(argv: string[], opts: StreamOptions): Promise<ExecResult> {
  return new Promise((resolve) => {
    const w = wrap(argv)
    const child: ChildProcess = spawn(w.cmd, w.args, { ...spawnOpts(opts.env), cwd: opts.cwd, windowsVerbatimArguments: w.verbatim })
    let stdout = '', stderr = '', timedOut = false

    const handle: RunHandle = {
      pid: child.pid,
      kill: async () => {
        if (!child.pid) return
        if (isWin) {
          await new Promise<void>((res) => {
            const p = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
            p.on('close', () => res())
            p.on('error', () => res())
          })
        } else {
          try { process.kill(-child.pid!, 'SIGTERM') } catch { child.kill() }
        }
      },
    }

    const cap = (acc: string, chunk: string) => (acc.length < CAP ? acc + chunk : acc)
    // output logs: no ANSI (␛[0m…) and also breaking on \r (git progress bars)
    const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*(?:\x07|\x1B\\)?|\x1B[@-Z\\-_]/g
    const feed = (buf: Buffer, which: 'out' | 'err') => {
      const text = buf.toString()
      if (which === 'out') stdout = cap(stdout, text)
      else stderr = cap(stderr, text)
      const clean = text.replace(ANSI_RE, '')
      for (const line of clean.split(/\r\n|\n|\r/)) if (line.trim()) opts.onLine?.(line, which)
    }
    child.stdout?.on('data', (d) => feed(d, 'out'))
    child.stderr?.on('data', (d) => feed(d, 'err'))

    if (opts.stdin) {
      try { child.stdin?.write(opts.stdin) } catch { /* client closed stdin */ }
    }
    child.stdin?.end()

    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs) {
      timer = setTimeout(async () => {
        timedOut = true
        await handle.kill()
      }, opts.timeoutMs)
    }

    const finish = (code: number | null) => {
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    }
    child.on('error', (e) => { stderr = cap(stderr, String(e)); finish(-1) })
    child.on('close', finish)
    opts.onSpawn?.(handle)
  })
}

const DELIMS = /[\s"&|<>^()]/

interface Wrapped {
  cmd: string
  args: string[]
  verbatim?: boolean
}

/** .cmd/.bat on Windows require cmd.exe /c — with windowsVerbatimArguments cmd receives
 *  the raw command line (individual quotes per arg), without the \" escape it cannot interpret. */
function wrap(argv: string[]): Wrapped {
  let a0 = argv[0] ?? ''
  if (isWin && !/\./.test(a0) && /^(npm|npx|pnpm|yarn)$/.test(a0)) a0 += '.cmd'
  if (isWin && /\.(cmd|bat)$/i.test(a0)) {
    const q = (a: string) => (a === '' || DELIMS.test(a) ? `"${a.replace(/"/g, '')}"` : a)
    const line = [q(a0), ...argv.slice(1).map(q)].join(' ')
    return { cmd: 'cmd.exe', args: ['/d', '/s', '/c', line], verbatim: true }
  }
  return { cmd: a0, args: argv.slice(1) }
}

export function shellOpen(target: string, cwd?: string): Promise<ExecResult> {
  if (isWin) return exec(['explorer.exe', target], { cwd })
  if (process.platform === 'darwin') return exec(['open', target])
  return exec(['xdg-open', target])
}

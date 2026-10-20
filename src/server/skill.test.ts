// Regression: skill scripts must run on a real Node runtime even when the platform
// itself runs inside Electron. In the packaged app process.execPath is the Electron
// binary — spawning it again hits the single-instance lock and silently exits 0 with
// no output, which read as "diff returned no artifacts" (the snr-lassist incident).
// The contract: every skill spawn passes ELECTRON_RUN_AS_NODE=1.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type SpawnArgs = [cmd: string, args: string[], opts: { env?: Record<string, string>; cwd?: string }]

const spawnCalls: SpawnArgs[] = []

vi.mock('node:child_process', () => ({
  spawn: (...args: SpawnArgs) => {
    spawnCalls.push(args)
    return fakeChild()
  },
}))

// exec() collects stdout via events, then resolves on 'close' — emit success with the
// key lines revai.mjs prints (enough for the callers to parse a full DiffOutput).
function fakeChild() {
  const out = [
    'Branch : feature/x (base: main)',
    'Patch  : /tmp/feature-x.patch',
    'Files  : 2 changed',
    'Lines  : +5 / -1',
    'Slug   : feature-x',
    '',
  ].join('\n')
  return {
    stdout: { on: (_: string, cb: (d: Buffer) => void) => cb(Buffer.from(out)) },
    stderr: { on: (_: string, cb: (d: Buffer) => void) => cb(Buffer.from('')) },
    on: (ev: string, cb: (code: number) => void) => {
      if (ev === 'close') setTimeout(() => cb(0), 0)
    },
    stdin: { end: () => {} },
    kill: () => {},
  }
}

describe('skill script spawns (Electron-safe node runtime)', () => {
  beforeEach(() => {
    spawnCalls.length = 0
  })

  it('runDiff spawns with ELECTRON_RUN_AS_NODE=1', async () => {
    const { runDiff } = await import('./skill')
    const diff = await runDiff('C:/tmp/repo')
    expect(diff.slug).toBe('feature-x')
    const [, args, opts] = spawnCalls[0]
    expect(args.at(-2)).toBe('diff')
    expect(args.at(-1)).toBe('--current')
    expect(opts.env?.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('generateReview spawns with ELECTRON_RUN_AS_NODE=1', async () => {
    const { generateReview } = await import('./skill')
    await generateReview('C:/tmp/repo', 'feature-x')
    const [, args, opts] = spawnCalls[0]
    expect(args.at(-2)).toBe('feature-x')
    expect(args.at(-1)).toBe('--no-open')
    expect(opts.env?.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})

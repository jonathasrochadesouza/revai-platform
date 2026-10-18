import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveSource, walkFullFolder, MAX_FULL_FILES } from './projects'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'revai-test-'))
}

function cleanup(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true })
}

describe('walkFullFolder', () => {
  it('lists nested files with line counts, excluding deps/build/binary/dotfiles', () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, 'src', 'nested'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}\n')
    fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'const a = 1\nconst b = 2\n')
    fs.writeFileSync(path.join(dir, 'src', 'nested', 'b.ts'), 'x\n')
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'i.js'), 'junk\n')
    fs.writeFileSync(path.join(dir, 'logo.png'), 'binary')
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1')

    const files = walkFullFolder(dir)
    const paths = files.map((f) => f.path).sort()

    expect(paths).toEqual(['package-lock.json', 'src/a.ts', 'src/nested/b.ts'])
    expect(files.find((f) => f.path === 'package-lock.json')?.ignored).toBe(true)
    expect(files.find((f) => f.path === 'src/a.ts')?.added).toBe(3) // 2 lines + trailing newline
    cleanup(dir)
  })

  it('respects the hard file cap', () => {
    const dir = tmpDir()
    for (let i = 0; i < MAX_FULL_FILES + 10; i++) fs.writeFileSync(path.join(dir, `f${i}.ts`), 'x')
    expect(walkFullFolder(dir).length).toBe(MAX_FULL_FILES)
    cleanup(dir)
  })
})

describe('resolveSource (non-git folder)', () => {
  it('degrades to full-folder mode with a warning instead of throwing', async () => {
    const dir = tmpDir() // no .git
    const { info } = await resolveSource(dir)
    expect(info.accessible).toBe(true)
    expect(info.warning).toMatch(/not a git repository/i)
    expect(info.defaultBranch).toBeUndefined()
    cleanup(dir)
  })
})

#!/usr/bin/env node
// make-gif.mjs — assemble PNG frames into an animated GIF. Pure JS (gifenc + pngjs),
// no ffmpeg required. Deps are self-bootstrapped into .deps/ on first run, outside the
// project's package.json.
//
// Usage:
//   node make-gif.mjs <frames-dir-or-file...> -o out.gif [--scale 0.5] [--delay 650]
//                     [--fps 2] [--hold-first 1200] [--hold-last 1500] [--colors 256]
//
// - frames: PNG files or directories (dirs are expanded to *.png, sorted by name)
// - scale:  target width = source * scale (area-average resample, 0.5 → 1440x900 → 720x450)
// - delay:  per-frame duration in ms (ignored when --fps is given)
// - hold-first / hold-last: extra ms pinned to the first/last frame
// - identical consecutive frames are collapsed (delays merged) so holds cost nothing

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEPS_DIR = path.join(__dirname, '.deps')

function loadDeps() {
  let req
  try {
    req = createRequire(path.join(DEPS_DIR, 'package.json'))
    return { gifenc: req('gifenc'), pngjs: req('pngjs') }
  } catch {
    fs.mkdirSync(DEPS_DIR, { recursive: true })
    fs.writeFileSync(
      path.join(DEPS_DIR, 'package.json'),
      JSON.stringify({ name: 'media-skill-deps', private: true, version: '1.0.0' }, null, 2) + '\n',
    )
    req = createRequire(path.join(DEPS_DIR, 'package.json'))
    execFileSync('npm', ['install', '--no-fund', '--no-audit', '--prefix', DEPS_DIR, 'gifenc', 'pngjs'], { stdio: 'inherit' })
    return { gifenc: req('gifenc'), pngjs: req('pngjs') }
  }
}

// ── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { inputs: [], out: null, scale: 0.5, delay: 650, fps: null, holdFirst: 1200, holdLast: 1500, colors: 256 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-o') args.out = argv[++i]
    else if (a === '--scale') args.scale = Number(argv[++i])
    else if (a === '--delay') args.delay = Number(argv[++i])
    else if (a === '--fps') args.fps = Number(argv[++i])
    else if (a === '--hold-first') args.holdFirst = Number(argv[++i])
    else if (a === '--hold-last') args.holdLast = Number(argv[++i])
    else if (a === '--colors') args.colors = Number(argv[++i])
    else if (a === '--help' || a === '-h') { usage(); process.exit(0) }
    else args.inputs.push(a)
  }
  if (!args.inputs.length || !args.out) { usage(); process.exit(1) }
  if (args.fps) args.delay = Math.round(1000 / args.fps)
  return args
}

function usage() {
  console.error('usage: node make-gif.mjs <frames-dir-or-file...> -o out.gif [--scale 0.5] [--delay 650] [--fps 2] [--hold-first 1200] [--hold-last 1500] [--colors 256]')
}

// ── frames ──────────────────────────────────────────────────────────────────
function collectFrames(inputs) {
  const files = []
  for (const input of inputs) {
    const abs = path.resolve(input)
    if (fs.statSync(abs).isDirectory()) {
      files.push(...fs.readdirSync(abs).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(abs, f)))
    } else {
      files.push(abs)
    }
  }
  if (!files.length) throw new Error('no PNG frames found')
  return files
}

// area-average resample (handles fractional scales cleanly)
function resample(rgba, w, h, nw, nh) {
  const out = Buffer.alloc(nw * nh * 4)
  for (let y = 0; y < nh; y++) {
    const y0 = (y * h) / nh
    const y1 = ((y + 1) * h) / nh
    for (let x = 0; x < nw; x++) {
      const x0 = (x * w) / nw
      const x1 = ((x + 1) * w) / nw
      let r = 0, g = 0, b = 0, area = 0
      for (let sy = Math.floor(y0); sy < Math.min(h, Math.ceil(y1)); sy++) {
        const covY = Math.min(y1, sy + 1) - Math.max(y0, sy)
        if (covY <= 0) continue
        for (let sx = Math.floor(x0); sx < Math.min(w, Math.ceil(x1)); sx++) {
          const covX = Math.min(x1, sx + 1) - Math.max(x0, sx)
          if (covX <= 0) continue
          const cov = covX * covY
          const i = (sy * w + sx) * 4
          r += rgba[i] * cov
          g += rgba[i + 1] * cov
          b += rgba[i + 2] * cov
          area += cov
        }
      }
      const o = (y * nw + x) * 4
      out[o] = Math.round(r / area)
      out[o + 1] = Math.round(g / area)
      out[o + 2] = Math.round(b / area)
      out[o + 3] = 255 // screenshots are opaque; force alpha to avoid fringe artifacts
    }
  }
  return out
}

// ── main ────────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2))
const { gifenc, pngjs } = loadDeps()
const { GIFEncoder, quantize, applyPalette } = gifenc
const { PNG } = pngjs

const frames = []
for (const file of collectFrames(args.inputs)) {
  const png = PNG.sync.read(fs.readFileSync(file))
  let { width: w, height: h, data } = png
  const nw = Math.round(w * args.scale)
  const nh = Math.round(h * args.scale)
  if (nw !== w || nh !== h) {
    data = resample(data, w, h, nw, nh)
    w = nw
    h = nh
  } else {
    for (let i = 3; i < data.length; i += 4) data[i] = 255
  }
  frames.push({ file, w, h, data })
}

// collapse identical consecutive frames, merging their delays
const collapsed = []
for (const f of frames) {
  const hash = crypto.createHash('sha1').update(f.data).digest('hex')
  const prev = collapsed[collapsed.length - 1]
  if (prev && prev.hash === hash) prev.delay += args.delay
  else collapsed.push({ ...f, hash, delay: args.delay })
}
if (collapsed.length) {
  collapsed[0].delay += args.holdFirst
  collapsed[collapsed.length - 1].delay += args.holdLast
}

const gif = GIFEncoder()
for (const f of collapsed) {
  const palette = quantize(f.data, Math.min(args.colors, 256), { format: 'rgb565' })
  const index = applyPalette(f.data, palette, 'rgb565')
  gif.writeFrame(index, f.w, f.h, { palette, delay: f.delay, repeat: 0, first: f === collapsed[0] })
}
gif.finish()

fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
fs.writeFileSync(args.out, gif.bytes())
const kb = (fs.statSync(args.out).size / 1024).toFixed(0)
console.log(`ok: ${args.out} — ${collapsed.length} frame(s), ${f0(collapsed)}x${f1(collapsed)}, ${kb} KB`)

function f0(list) { return list[0]?.w ?? 0 }
function f1(list) { return list[0]?.h ?? 0 }

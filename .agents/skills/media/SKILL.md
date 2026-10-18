---
name: media
description: Capture screenshots and animated GIFs of the revai-platform screens and flows for docs and the README gallery. Use when the user asks for "prints", screenshots, GIFs, screen recordings, demo media, or to refresh the README gallery. Runs the dev stack with a disposable REVAI_HOME seeded with demo reviews, drives the UI with the Playwright MCP, and assembles GIFs with scripts/make-gif.mjs (pure JS, no ffmpeg).
---

# Media

Produce honest screen media (PNG prints + GIF flows) of the running app. The captures
are of the **real UI**, driven by a real browser — nothing is drawn or edited by hand.

## Golden rules

- **Disposable data only.** Run the stack with `REVAI_HOME` pointing at a temp dir and
  seed it with `scripts/seed-demo-reviews.mjs`. Never read or write the real `~/.revai`.
- **Real screens, real states.** Capture what the app actually renders (including real
  loading and error states). Do not mock, collage or retouch frames.
- **Frames are disposable.** Keep GIF frames in a temp dir (e.g.
  `$TMPDIR/opencode/revai-media/frames/<flow>/`), never inside the repo — only the final
  PNG/GIF artifacts land in `docs/media/`.
- **Keep GIFs light.** Target < 2 MB each: 720×450 (scale 0.5 from 1440×900), ~650 ms
  per step, identical consecutive frames collapsed by `make-gif.mjs`.

## 1. Stage the environment

```bash
npm install
MEDIA_HOME="$TMPDIR/opencode/revai-media-home"   # disposable data dir
REVAI_HOME="$MEDIA_HOME" node .agents/skills/media/scripts/seed-demo-reviews.mjs
```

The seed script writes 3 demo reviews (1 featured: gate failed with a critical security
finding + proposed fix; 1 PR review failed; 1 passed) into `$MEDIA_HOME/reviews/`.

For the Configure screen you need a source that resolves and diffs. Recipe for a local
demo repo (fast, no network):

```bash
DEMO_REPO="$TMPDIR/opencode/revai-media-demo/checkout-api"
mkdir -p "$DEMO_REPO/.revai" && cd "$DEMO_REPO" && git init -q -b main
printf 'node_modules\ndist\n' > .gitignore
printf '# Checkout API\nSplit payments service used by the revai media captures.\n' > README.md
# .revai/rules.md with ~20 numbered lines, then:
git add -A && git commit -qm 'initial'
git checkout -q -b feature/PEQ-2450
# add src/orders/repository.ts, src/cart/reserve.ts … (2–3 small TS files, ~30 lines each)
git add -A && git commit -qm 'feat: split payments'
```

Start the stack with the disposable home (keep both processes alive until captures end):

```bash
REVAI_HOME="$MEDIA_HOME" npm run dev:server   # API on :8797
npm run dev:app                               # Vite on :5173 (proxy → 8797)
```

Health check before shooting: `curl -s localhost:8797/api/reviews | head` must list the
3 seeded rows; `curl -s localhost:5173` must return the SPA.

## 2. Drive the UI (Playwright MCP)

- `browser_navigate` → `http://localhost:5173/…` for each route.
- `browser_run_code_unsafe` is the workhorse: it receives the Playwright `page`, so you
  can set the viewport (`page.setViewportSize({ width: 1440, height: 900 })`), press
  shortcuts (`page.keyboard.press('Meta+k')`, `'n'`, `'t'`, `'j'`, `'s'`), type with
  delays (`page.type(sel, text, { delay: 40 })`) and take batched frame captures with
  `page.screenshot({ path })` inside one scripted flow.
- `browser_take_screenshot` with `filename: 'docs/media/xx.png'` for final prints
  (resolved against the repo root).
- Always `browser_wait_for` a text that only exists in the settled state before shooting
  (e.g. wait for "Accessible" on New review). Never shoot mid-transition.

Viewport 1440×900, dark theme (the default). Light theme only for the theme-toggle flow.

## 3. Screenshots (prints)

| File | Route | Set up with |
|---|---|---|
| `01-history.png` | `/` | seeded rows visible; optionally filter "Failed" |
| `02-new-review.png` | `/new` | paste a URL and Resolve → "Accessible" card |
| `03-configure.png` | `/configure` | resolve the demo local folder first (fills sessionStorage) |
| `04-running.png` | `/running` | empty state, or a live job if a harness CLI exists |
| `05-report.png` | `/report/<seeded-id>` | waits for the findings list; critical finding pre-selected |
| `06-fix-loop.png` | `/fix/<seeded-id>?ids=CR-01` | shoot the running queue immediately (spinner + stepper) |
| `07-settings.png` | `/settings` | straight navigation |
| `08-onboarding.png` | `/onboarding` | straight navigation (real CLI detection) |
| `09-states.png` | `/states` | straight navigation (state catalog) |

## 4. GIF flows

Capture one frame per interaction step into a temp frames dir, then assemble:

```bash
node .agents/skills/media/scripts/make-gif.mjs \
  "$TMPDIR/opencode/revai-media/frames/<flow>" \
  -o docs/media/flow-<name>.gif        # defaults: --scale 0.5 --delay 650
```

Proven flows (4–8 frames each; re-shoot a frame instead of editing it):

1. `flow-new-review` — History → press `n` → type the URL (delayed typing) → Resolve →
   "Continue → Branch + harness".
2. `flow-configure` — Resolve the demo folder → Continue → spinner → prepared screen
   (file bars + rules detected).
3. `flow-report-triage` — Report: `j` twice (next findings) → `s` (skip blocker → the
   warn callout appears) → restore with `s` again.
4. `flow-command-palette` — `Meta+k` → type "check" (filters recents) → `Escape` → `t`
   (theme toggle) → `t` (back to dark).

`make-gif.mjs` collapses identical consecutive frames and pins extra hold time on the
first/last frame, so pausing a step is free. Verify each GIF by size first (`< 2 MB`),
then by eye (open it in a browser).

### Hard-won capture details

- **Clicks stall at "waiting for element to be visible, enabled and stable"** when the
  automated browser window is occluded/backgrounded (rAF throttling). Call
  `page.bringToFront()` at the start of every scripted run.
- **Fix loop without burning real CLI quota:** the seeded review points `repo.dir` at the
  demo git repo (so the queue runs) and a shim executable registered in
  `$REVAI_HOME/harnesses.json` (`{ defId: "claude", exe: "<shim>" }`) fails the apply
  step with a real error line — the queue, per-item failure, Gate delta and Results
  render exactly as in production.
- **Screen 03 runner card:** `/onboarding/detect` runs `--version` for every harness CLI
  and is slower than the local diff — wait for the "runs this review" text before
  shooting, or the card prints "no runner".
- **History PR row** renders `prNumber` and `head` separately; seed `head: 'PR #482'`
  with `prNumber` only in the record (not the row) to avoid "PR #482 · PR #482".

## 5. Publish

- Final artifacts in `docs/media/`: `NN-<screen>.png` and `flow-<name>.gif` — nothing else.
- Refresh the README gallery section (embed the GIFs with relative paths, alt text per
  flow; keep the existing tone/emoji style).
- Never commit frames, temp homes or `.deps/` (check `git status` before staging).

## 6. Cleanup and gate

- Kill both dev processes you started (they are background shells — stop them by PID).
- The temp `REVAI_HOME`, demo repo and frames live under `$TMPDIR` — safe to leave, never
  move them into the repo.
- Docs-only change, but still run the minimum gate before handing off:
  `npm run typecheck && npm run test`.

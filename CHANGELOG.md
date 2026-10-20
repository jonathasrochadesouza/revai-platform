# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with a repo-local tens-based patch ladder — rules in
[.agents/skills/bump-version/SKILL.md](.agents/skills/bump-version/SKILL.md).

## [Unreleased]

## [1.2.0] - 2026-10-20

### Added

- full-folder review — local folders without a git repository are no longer an
  error: the review covers the entire folder (scope manifest instead of a patch,
  no base comparison) with an amber warning on New review/Configure;
  `refKind: 'folder-full'` in the schema
- empty diff vs base degrades to the same full-folder review instead of failing
  with `repo/empty-diff`; the condition is detected in `prepare` and surfaced as an
  early warning on Configure
- the revai skill is vendored at `resources/revai-skill/` (tracked in git, shipped
  in the desktop packages via `asarUnpack`) and resolves in order: `REVAI_SKILL_DIR`
  → vendored → legacy `skill-version/`; without the skill the pipeline still
  completes with a built-in `git diff` fallback + in-platform schema validation
- Runner tab in Settings — pick the default harness and its model (seeded GLM 5.3
  options for OpenCode, free-text `provider/id` for anything else, immediate
  persistence in `~/.revai/harnesses.json`); the model now actually reaches the
  review (Configure → Running → harness argv) and validation runs with the saved
  model
- media skill (`.agents/skills/media`) — the reusable recipe to capture honest screen
  media of the running app: a disposable `REVAI_HOME` seeded with demo reviews, a demo
  git repo for the Configure screen, Playwright-driven flows and `scripts/make-gif.mjs`
  (PNG frames → animated GIF, pure JS, no ffmpeg) with `scripts/seed-demo-reviews.mjs`

### Changed

- docs: rebrand — the repo-root hard-hat logo is now the official mark on every
  surface: README retitled and restructured to the current reality, the app public
  logo swapped (header, onboarding, favicon) and `build/icon.png` added so
  electron-builder stamps the brand on NSIS/dmg/AppImage/deb
- docs: README gains the "Screen flows" gallery — five real-flow GIFs (new review,
  configure, report triage, ⌘K palette, theme toggle) and the full prints set in
  `docs/media/` (01–09, every screen)

### Fixed

- release: macOS packaging had failed since the rebrand — `build/icon.png` at
  400×400 is below electron-builder's 512×512 minimum for the DMG icon, so every
  run after v1.1.30 died on the mac job and the releases stayed as drafts;
  the icon now ships at 1024×1024 and the mac job builds again
- theme toggle now switches every time (reactive theme store — the render-time DOM
  read kept a stale value, so the second click recomputed the same theme)
- `Ctrl/⌘+G` navigates to Reviews (the sidebar advertised a `G` shortcut that had
  no handler)
- the base select sits below branch (head) on Configure, full width — no more
  horizontal overflow of the card
- kiro harness template uses `kiro-cli chat --no-interactive` (kiro-cli 2.x has no
  `exec` subcommand); opencode/codex model flags follow their subcommands
- `npm run test` works again — vitest runs from the repo root (the SPA root
  `src/app` hid every test), with tests for `slugify` and the full-folder walk
- dev: the Vite proxy key `'/api'` also matched the module `/api.ts` and swallowed it
  into the backend (blank page on `npm run dev`); a `'^/api/'` regex proxy keeps the
  module local while the real API keeps being proxied

## [1.1.30] - 2026-10-15

### Changed

- docs: README gains desktop & downloads table (installer, portable, dmg,
  AppImage, deb), release badge, releases & versioning (tens ladder + gate rules)
  and the updated structure (electron/, scripts/, release workflow);
  AGENTS.md syncs the CI reality (release.yml in the validation loop,
  bump-version skill in the skills list)

## [1.1.20] - 2026-10-15

### Fixed

- Release assets were racing the freshly created release (HTTP 404 on upload):
  the three build targets now publish via electron-builder's native GitHub
  publisher (retry + draft release) and a final job waits for the draft,
  validates the asset count (>= 8) and publishes it with CHANGELOG-based notes

## [1.1.0] - 2026-10-15

### Added

- GitHub Actions release pipeline: every push to `main` validates the CHANGELOG
  gate (file exists, bump present in the pushed commits, package.json synced),
  builds Windows/macOS/Linux in parallel and publishes a GitHub Release with
  installer, portable zip (Windows), DMG, AppImage and deb assets
- `scripts/check-release.mjs` — release gate; runs in CI and locally

## [1.0.0] - 2026-10-15

### Added

- Electron desktop packaging: NSIS installer and portable build for Windows (DMG /
  AppImage / deb targets configured), with the bundled Hono server living inside the
  shell and no `node_modules` at runtime
- `npm run dist:server` (esbuild bundle) and `npm run dist:desktop` (full package)

### Fixed

- Desktop crash `EADDRINUSE :::8797`: the server now binds `127.0.0.1` — the same
  bind family as the port probe — a busy port picks the next free one, and a failed
  bind shows a clear dialog instead of a raw main-process crash
- Verified against four occupier flavors via `scripts/test-desktop-port.mjs`

### Changed

- Project translated to en-us (docs, UI strings and startup banner)

[Unreleased]: https://github.com/jonathasrochadesouza/revai-platform/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/jonathasrochadesouza/revai-platform/compare/v1.1.30...v1.2.0
[1.1.30]: https://github.com/jonathasrochadesouza/revai-platform/compare/v1.1.20...v1.1.30
[1.1.20]: https://github.com/jonathasrochadesouza/revai-platform/compare/v1.1.0...v1.1.20
[1.1.0]: https://github.com/jonathasrochadesouza/revai-platform/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jonathasrochadesouza/revai-platform/releases/tag/v1.0.0

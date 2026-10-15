# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
with a repo-local tens-based patch ladder — rules in
[.agents/skills/bump-version/SKILL.md](.agents/skills/bump-version/SKILL.md).

## [Unreleased]

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

[Unreleased]: https://github.com/jonathasrochadesouza/revai-platform/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/jonathasrochadesouza/revai-platform/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jonathasrochadesouza/revai-platform/releases/tag/v1.0.0

# AGENTS.md

Operating instructions for AI coding agents in **revai-platform**.

## Skills (do this first)

Reusable agent skills live in `.agents/skills/<skill-name>/SKILL.md`. When a request matches a skill's description, read and follow that `SKILL.md` before acting:

- Commit / push / stage tracked changes → [`.agents/skills/git-commit-push/SKILL.md`](.agents/skills/git-commit-push/SKILL.md)
- Bump the version / prepare a release → [`.agents/skills/bump-version/SKILL.md`](.agents/skills/bump-version/SKILL.md) — tens-based patch ladder (+10/+20/+30, minor, major); `CHANGELOG.md` top section is the version source of truth
- After a push, watch the GitHub Actions run → [`.agents/skills/watch-actions/SKILL.md`](.agents/skills/watch-actions/SKILL.md) — mandatory follow-up of git-commit-push (Step 8): watches the run for the pushed sha to completion and reports jobs, failed logs and, for release runs, the published release + assets
- Merge all open PRs in one batch (single bump + release) → [`.agents/skills/merge-all-prs/SKILL.md`](.agents/skills/merge-all-prs/SKILL.md) — preflight + explicit confirmation, sequential merges, one aggregated version bump, release watched via watch-actions, verified cleanup

Skill conventions (Agent Skills spec): folder name equals the `name` field (kebab-case); `description` states what the skill does and when it triggers; body in imperative voice, aiming for < 500 lines; optional `references/` (docs loaded on demand) and `scripts/` (executed, not read).

`CLAUDE.md` is a compatibility bridge containing only `@AGENTS.md`.

## Commands

| Task | Command |
|---|---|
| Install | `npm install` |
| Dev (server + app) | `npm run dev` |
| Frontend only | `npm run dev:app` |
| Server only | `npm run dev:server` |
| Typecheck | `npm run typecheck` |
| Tests | `npm run test` (Vitest) |
| Build | `npm run build` (typecheck + Vite build) |
| Desktop server bundle | `npm run dist:server` |
| Package desktop | `npm run dist:desktop` (installer + portable + dmg/AppImage/deb targets) |

Package manager is **npm** (never pnpm/yarn). Node >= 20.9. Primary dev machine is Windows — quote paths and prefer forward slashes in git paths.

## Architecture map

- `src/server/` — Hono backend and orchestration: `pipeline.ts` / `fixloop.ts` (5-step review flow), `git.ts` (clone/diff driver), `harnesses.ts` (local CLI harness registry: kiro-cli, claude, codex, opencode, copilot), `routes.ts` (HTTP + SSE), `root.ts`/`skill.ts` (execution-context resolution).
- `src/app/` — React 19 SPA (Vite). `screens/` holds route-level UI; `api.ts` is the single client→server bridge; `flow.ts` is the client state machine.
- `src/shared/` — contracts used by BOTH layers: `types.ts` (review schema V2), `gate.ts` (quality gate), `urls.ts` (URL resolver). Changes here affect server, app and tests at once.
- `electron/` + `electron-builder.yml` — desktop packaging: `main.cjs` loads the bundled server from asar (port probe + graceful failure dialog); entry path in `package.json` → `main`.
- `scripts/` — manual integration probes (`test-sse.mjs`, `test-fix-cancel.mjs`, `test-desktop-port.mjs`) and the release gate `check-release.mjs`; not part of `npm run test`.
- `.github/workflows/release.yml` — CI: every push to `main` runs validate (CHANGELOG gate) → build ×3 → publish GitHub Release.

Layer boundary (keep it): server code must not import from `src/app/`; app code reaches the server only through `src/app/api.ts`; both import freely from `src/shared/`.

## Validation loop

- Minimum gate after any change: `npm run typecheck` → `npm run test`. Use `npm run build` when touching `vite.config.ts`, `tsconfig.json` or `package.json`.
- Release gate before pushing to `main`: `node scripts/check-release.mjs` — every push to `main` is a release candidate, so the CHANGELOG must exist, be bumped inside the pushed commits (tens ladder, see `bump-version` skill) and stay in sync with `package.json`; the CI enforces the same rules and fails loudly.
- No pre-commit hooks exist; CI runs in `.github/workflows/release.yml` (release only). The typecheck+tests gate must still be run manually before every commit proposal.
- Never claim success without the actual tool output of the run.

## Boundaries

- Never force-push, rewrite history, rebase shared branches, or delete branches/tags.
- Never push unless the user explicitly asks for a push; commits are local-only by default.
- Never commit `.env*`, credentials, tokens, or anything under `~/.revai` (never read it either).
- Never hand-edit generated/vendored output (`node_modules/`, `dist/`) or ignored dirs (`skill-version/`, `prototype/`, `legacy/`, `eg-project/` — see `.gitignore`).

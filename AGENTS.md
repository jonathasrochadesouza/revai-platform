# AGENTS.md

Operating instructions for AI coding agents in **revai-platform**.

## Skills (do this first)

Reusable agent skills live in `.agents/skills/<skill-name>/SKILL.md`. When a request matches a skill's description, read and follow that `SKILL.md` before acting:

- Commit / push / stage tracked changes → [`.agents/skills/git-commit-push/SKILL.md`](.agents/skills/git-commit-push/SKILL.md)

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

- `src/server/` — Hono backend and orchestration: `pipeline.ts` / `fixloop.ts` (5-step review flow), `git.ts` (clone/diff driver), `harnesses.ts` (local CLI harness registry: kiro-cli, claude, codex, opencode, copilot), `routes.ts` (HTTP + SSE).
- `src/app/` — React 19 SPA (Vite). `screens/` holds route-level UI; `api.ts` is the single client→server bridge; `flow.ts` is the client state machine.
- `src/shared/` — contracts used by BOTH layers: `types.ts` (review schema V2), `gate.ts` (quality gate), `urls.ts` (URL resolver). Changes here affect server, app and tests at once.
- `scripts/` — manual integration probes (`test-sse.mjs`, `test-fix-cancel.mjs`); not part of `npm run test`.

Layer boundary (keep it): server code must not import from `src/app/`; app code reaches the server only through `src/app/api.ts`; both import freely from `src/shared/`.

## Validation loop

- Minimum gate after any change: `npm run typecheck` → `npm run test`. Use `npm run build` when touching `vite.config.ts`, `tsconfig.json` or `package.json`.
- No pre-commit hooks and no CI are configured: the typecheck+tests gate must be run manually before every commit proposal.
- Never claim success without the actual tool output of the run.

## Boundaries

- Never force-push, rewrite history, rebase shared branches, or delete branches/tags.
- Never push unless the user explicitly asks for a push; commits are local-only by default.
- Never commit `.env*`, credentials, tokens, or anything under `~/.revai` (never read it either).
- Never hand-edit generated/vendored output (`node_modules/`, `dist/`) or ignored dirs (`skill-version/`, `prototype/`, `legacy/`, `eg-project/` — see `.gitignore`).

---
name: git-commit-push
description: Commit and/or push the user's Git changes in this repository, preserving their staged vs. unstaged intent. This skill should be used when the user asks to "commit", "commita", "faz o commit", "create a commit", "stage and commit", "push", "push my changes", "commita e envia", "salva as alterações", or wants work-in-progress or staged changes turned into one or more commits. Runs the validation gate first, follows Conventional Commits, and never pushes unless the user explicitly asked in the same request. After a successful push, always monitors the triggered GitHub Actions run via the watch-actions skill (Step 8). Do not use for creating PRs, issues, tags, or releases.
---

# Git Commit & Push

Turn working-tree ("changes") or already-staged ("staged") Git state into well-formed commit(s), and push only when the user explicitly asked. Follow this workflow in order; do not skip the safety scan or the validation gate.

Core principles: preserve the user's staging intent, make each commit atomic and verification-backed, follow Conventional Commits, and stay local unless the user said "push". Full message-format rules live in `references/conventional-commits.md` — read it when writing any commit subject or body.

## Step 1 — Snapshot the state

Run these (safe, read-only) before touching anything:

```bash
git status --porcelain
git status
git log --oneline -10
```

Also capture `git status -sb` for the branch + upstream line. Note:

- **Staged changes** (`M `, `A `, `D ` in the first column): the user already chose what to commit. Prefer committing exactly that set.
- **Unstaged changes** (` M`, second column) and **untracked files** (`??`): part of the "changes" the user wants saved — select and stage deliberately, one logical change per commit.
- Recent log: mirror the language and style it shows. If no history exists, default to Conventional Commits in English.
- A no-op path: if `git status --porcelain` is empty, report "nothing to commit" and stop — never fabricate a commit.

## Step 2 — Safety scan (never skip)

Inspect the full diff that would be committed and screen for:

- `.env*`, `*.pem`, `*.key`, `id_rsa*`, tokens/keys (`sk_`, `ghp_`, `AKIA`, `Bearer`), hardcoded passwords or connection strings.
- Any path under `~/.revai`, `node_modules/`, `dist/`, or the ignored dirs (`skill-version/`, `prototype/`, `legacy/`, `eg-project/` — see `.gitignore`; these must never enter history).
- Vendored/generated or accidental files (logs, OS junk, editor configs).

If anything suspicious appears: stop, flag it to the user, and do not stage/commit it. If a secret is already in the index, unstage it (`git restore --staged <path>`) before proceeding. This is a hard gate — report only, and let the user decide on exceptions.

## Step 3 — Review the changes

```bash
git diff --staged   # what the user staged
git diff            # unstaged
```

Understand per file what changed and why, so the commit subject describes intent (what & why), not a file list of the diff (how). Inspect whether the changes form one logical unit or several (framework + docs + deps = split into separate commits and propose it). Reference implementations of good messages: `git log --oneline` history of this repo, e.g. `7b51351 feat: plataforma local do revai` style.

## Step 4 — Stage deliberately

- If the user staged files themselves: keep that set. Avoid adding unrelated files unless the user asked.
- If nothing is staged: stage the files matching the change's intent (`git add <paths>`), never blind `git add -A`/`git add .` — enumerate the exact paths from Step 1 instead.
- Mixed concerns: propose splitting into atomic commits (e.g. `git add src/server/x.ts` then commit, repeat). Ask the user before splitting more than one way; if the user pre-approved a single commit, proceed.

## Step 5 — Validation gate (before every commit)

Per root `AGENTS.md`, no CI/hooks exist, so run the gate manually and show real output:

```bash
npm run typecheck
npm run test
```

- Both must pass. If typecheck or tests fail, fix within the scope of the change (or, if the failure is pre-existing and unrelated, report it and ask before committing on top).
- Use `npm run build` instead of/additionally if `vite.config.ts`, `tsconfig.json`, or `package.json` changed.
- Never claim success without the actual tool output in the conversation.

## Step 6 — Commit

Format: Conventional Commits — `<type>(<optional scope>): <subject>`, imperative mood, subject ≤ 50 chars target (72 hard), no trailing period, lowercase after the colon. Body (optional, ≤ 2 short paragraphs) explains **why**, wrapped at 72, separated from subject by a blank line. Full type table and edge cases: `references/conventional-commits.md`.

Run PowerShell-safe quoting (primary machine is Windows; prefer multiple `-m` over heredocs):

```powershell
git commit -m "fix(pipeline): guard diff against empty patch" -m "resolve() can return null for revoked URLs; ... "
```

On Git Bash / macOS / Linux use the heredoc pattern to keep exact formatting instead:

```bash
git commit -m "$(cat <<'EOF'
fix(pipeline): guard diff against empty patch

resolve() can return null for revoked URLs; ...
EOF
)"
```

Rules:

- Do not add `Co-Authored-By` / "Generated with" footers unless the user explicitly asked for attribution.
- Never use `--no-verify` to skip hooks (none exist here today, but the rule holds for the future).
- After committing, show `git show --stat HEAD` (or `git log -1 --oneline`) to confirm what landed.

## Step 7 — Push (only when the user asked)

Push is opt-in, never default. Exit here if the user did not say "push" in this request.

1. Verify there is an upstream: `git status -sb` or `git rev-parse --abbrev-ref --symbolic-full-name @{u}`. If none, ask (do not guess) before `git push -u <remote> <branch>`.
2. If behind upstream (`git status -sb` shows `behind`), integrate with `git pull --rebase` first. Never merge, never force-push (`--force`, `-f`), never rewrite history. If the rebase raises real conflicts, stop and present them.
3. Push: `git push`. Confirm via command exit status/output and report:

```
✓ committed  <sha> <subject>
✓ pushed to origin/<branch>
```

## Step 8 — Watch the CI run (mandatory after every push)

A push is not done when `git push` returns: every push to `main` is a release
candidate and any push can break CI. Immediately after a successful push,
follow [`.agents/skills/watch-actions/SKILL.md`](../watch-actions/SKILL.md) —
locate the Actions run for the pushed sha, watch it to completion and report
the outcome (jobs; for release runs, the published release + assets). Never
end the turn with the run still in progress: the run report is part of the
push. If the run failed, summarize the root cause from `--log-failed` and
propose the next fix — but do not auto-fix, re-run or push again unless the
user asks.

## Failure handling

- "nothing to commit" → report and stop (step 1 no-op rule).
- Staging conflict (already-indexed secret) → unstage the path, notify, wait for the user.
- Validation gate failure → fix in-scope, or report pre-existing failure and ask.
- Push rejected (non-fast-forward) → fetch, rebase per Step 7, retry once; on a second rejection, stop and show the conflict status verbatim.
- Detached HEAD / unexpected branch → stop and ask; never commit onto an unnamed HEAD.

# Conventional Commits reference

Full message-format rules for the `git-commit-push` skill. Read selectively — use the type table for the subject and the body rules when writing anything longer than one line.

## Types

| Type | Trigger | Example subject |
|---|---|---|
| `feat` | New user-visible capability | `feat: validate remote URL before clone` |
| `fix` | Bug fix of existing behavior | `fix(app): keep gate delta after screen switch` |
| `docs` | Documentation only | `docs: document harness customArgs format` |
| `refactor` | Code change, no behavior change | `refactor(server): extract sse broadcaster` |
| `test` | Add/adjust tests, no product change | `test: cover quality-gate critical path` |
| `build` | Build system or dependencies | `build: bump vite to 7.0` |
| `ci` | CI/CD config | `ci: add windows runner for vitest` |
| `chore` | Maintenance, tooling, no src/tests impact | `chore: ignore .vite dir` |
| `perf` | Performance improvement | `perf: stream sse events without buffering` |
| `style` | Formatting, whitespace, no logic change | `style: normalize quotes in app screens` |
| `revert` | Undo a previous commit | `revert: "feat: experimental fix loop"` |

Scope is optional and should name a layer/module (`app`, `server`, `shared`, `pipeline`, `gate`, `harnesses`) — only when it communicates intent, e.g. `feat(harnesses): allow custom model args`.

## Subject

- Imperative mood, present tense: "add", not "added"/"adds" — like it completes the sentence "if applied, this commit will …".
- ≤ 50 characters as the target; hard cap 72. No trailing period, no lowercase constraint on proper nouns, lowercase after the type for the first word.
- Describe the outcome, not the file names. Bad: `update files in src/server`. Good: `fix(server): validate review.json against schema v2`.
- Match repo history style when present (`git log --oneline`), e.g. `feat: plataforma local do revai` (Portuguese history → keep Portuguese style).

## Body

- Only when the "why" is not obvious from the subject. Separate from the subject with one blank line.
- Explain the motivation or trade-off (what the change solves, why this approach over the obvious alternative), not a mechanical list of every changed file — that is what `git show --stat` is for.
- Wrap at ~72 chars. Two short paragraphs max; prefer bullet list if enumerating decisions.
- Standard trailer rules when relevant (rare): `BREAKING CHANGE: <explanation>` or `!` after the type (`feat!:`) for breaking changes; `Closes #123` on the last line for tracked issues.

## Validation rules for the agent

1. Subject is one line, correctly prefixed, and reads as an imperative instruction.
2. Body (if any) is separated by exactly one blank line — a commit whose first paragraph is 200 lines is invalid; use multiple `-m` to enforce separation.
3. One commit = one logical change. If the change set spans layers with different reasons (feature + dependency bump + docs), propose split commits before proceeding.
4. Never commit redacted/failing-state code: the validation gate (`npm run typecheck`, `npm run test`) precedes every commit — see SKILL.md Step 5.

## Anti-patterns (never do)

- `git add .`/`git add -A` as a shortcut when the user only wanted some files committed.
- subjects like `fix bug`, `update`, `changes`, `wip`, or `"misc adjustments"` that do not name what changed.
- Committing screenshots, binaries, or logs without asking — they usually don't belong in a remote repository.
- Adding attribution footers (`Co-Authored-By: Claude`, "Generated with …") unless explicitly requested by the user.
- Pushing side work, force-push, or pushing a branch the user didn't mention.

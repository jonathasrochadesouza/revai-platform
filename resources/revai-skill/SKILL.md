---
name: revai
description: Runs an interactive AI code review of a git branch and opens the interactive HTML report in the browser automatically, with a two-way fix loop. Acts as a senior architect reviewing only the changed lines of the patch. Use when the user asks to review a branch, run a code review, review changes, or says /revai.
license: MIT
compatibility: Requires Node >= 18 and Git in the environment.
---

# revai — AI Code Review

Review the changed lines of a git branch, persist structured findings, generate
an interactive HTML report, and open it in the browser; then offer the fix loop.

## Files (paths relative to this skill's base directory)

- `scripts/revai.mjs` — CLI: `diff` (create the review patch), `open-report`
- `scripts/generate-review.mjs` — validates the JSON files, injects them into the template, opens the browser
- `templates/review.html` — self-contained English report (dark/light theme, Quality Gate)
- `references/schema.md` — findings + meta JSON contract (read before writing JSON)
- `references/rubric.md` — universal review baseline for every stack
- `references/stack-playbooks.md` — per-domain extensions; read only matching sections

Invoke scripts with Node from this skill's base directory — never re-implement
their logic inline.

## Procedure

### Step 1 — Generate the patch

Ask the user which branch to review unless obvious from context, then:

```bash
node <skill-base>/scripts/revai.mjs diff --branch feature/PEQ-1234   # selected branch
node <skill-base>/scripts/revai.mjs diff --current                  # current branch
```

Writes `.revai/data/<slug>.patch` in the project root (git toplevel) and prints
the patch path, file/line stats, and the slug. Use the printed slug verbatim in
later steps. It exits non-zero on unknown branch, empty diff, or non-git
directory — surface the error and stop.

### Step 2 — Analyze the patch

1. Read the patch file. Review ONLY changed lines (`+`/`-`); use context lines
   solely to understand the change; never report pre-existing issues on
   untouched lines. If the user asks for a wider scope, confirm it first.
2. Read `references/rubric.md` (universal baseline, all stacks).
3. Read only the matching sections of `references/stack-playbooks.md` (backend,
   frontend, mobile, data engineering, ML/data science, games).
4. Load project rules when present (`.revai/rules.md`, `CODING_STANDARDS.md`,
   `CONTRIBUTING.md`) — documented project standards override the baseline.
5. Review as a senior architect: bugs, security, performance, stability, data
   integrity, design smells (judgement calls), tests. Group similar trivial
   findings; an empty findings list is a valid outcome.

### Step 3 — Write the findings JSON files

Write under `<project>/.revai/data/` using the slug from step 1:
`<slug>-review.json` (findings array) and `<slug>-meta.json` (meta object).
Meta: `author` (capitalized, from the branch's last commit), `reviewer` (from
`git config user.name`; `"Undefined"` when absent), `branch`, `walkthrough`
(2–5 sentences from the diff), `files[]` (path, summary, issues, effort).
Read `references/schema.md` first — fields, legacy aliases, and error messages.

### Step 4 — Generate and open the report

```bash
node <skill-base>/scripts/generate-review.mjs <slug>
```

Omit flags to open the report in the browser automatically (the intended UX);
use `--no-open` in headless or CI contexts. The command validates both files
and writes `.revai/reviews/<slug>-review.html` only after validation succeeds;
on failure it prints the first error with the offending field — fix the JSON
and re-run. `revai.mjs open-report <slug>` opens the report later.

### Step 5 — Offer the fix loop

Report the path and pause, then ask what to do next; support both modes:

- **Fix by ID** — "fix CR-03": read `<slug>-review.json`, apply the minimal fix
  to the code, set that finding's `status` to `"resolved"` (adjust
  `proposedFix`/`description` if now applied), then re-run generate-review.mjs.
  The regenerated report shows the item resolved and the Quality Gate
  recalculates.
- **Copy prompt (user-driven)** — the user clicks "Copy prompt" on a finding in
  the browser and pastes it into any agent session; that agent applies the fix
  the same way.

Skipped findings (UI button) stop blocking the Quality Gate but are flagged as
not best practice; critical/security skips show a warning. Keep artifacts until
the user says done, then offer to clean up `.revai/`.

## Troubleshooting

- `Review data not found` — run step 1, then write both JSON files per schema.
- Validation error — fix the named field; special characters are escaped.
- No browser — headless environment; the file path is always printed.
- No base branch — the repo needs `origin/HEAD`, `main`, or `master`.

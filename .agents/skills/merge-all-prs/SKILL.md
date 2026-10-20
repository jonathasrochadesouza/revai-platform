---
name: merge-all-prs
description: Batch-merge every open pull request into main with a single aggregated version bump and one green release, then verify the cleanup (PRs closed, branches deleted). Use when the user says "merge all PRs", "mergeia os PRs", "merge todos", "fecha os PRs e as branches", "merge and release", or wants all open PRs shipped in one version. Preflight + explicit user confirmation first; sequential merges (cosmetic red validate runs are expected), aggregate bump via bump-version, release watched via watch-actions.
---

# Merge All PRs

Ship every open pull request in one batch: sequential merges into `main`, a
single aggregated version bump, one green release run and a verified cleanup.

## Step 1 — Inventory open PRs

```bash
gh pr list --state open --json number,title,headRefName,mergeable,mergeStateStatus --limit 50
```

- No open PRs → report "nothing to merge" and stop.
- Any PR with `mergeable: CONFLICTING` or a non-clean `mergeStateStatus` →
  stop and present the list. Resolution options (never force-push): merge
  `origin/main` **into** the affected PR branch and push it, or hand it to
  the user.

## Step 2 — Confirm the batch (never skip)

Show the numbered list (number, title, branch) and get explicit user
confirmation for the whole batch, including the merge order (oldest first by
default). This skill never merges without it. The confirmation also covers
the bump push in Step 4 — no second permission round needed.

## Step 3 — Merge sequentially

```bash
gh pr merge <number> --merge --delete-branch
```

- One PR at a time, in the confirmed order; stop on the first failure.
- **Expected noise:** every merge is a push to `main` and triggers the
  release workflow, which fails `validate` in ~10s (no bump yet). These red
  runs are cosmetic — no draft, no tag, no release is created. Report them
  as expected; do not try to "fix" them and do not disable the workflow.

## Step 4 — Single aggregated bump

Fetch and check out `main` — it now carries every `[Unreleased]` CHANGELOG
entry the PRs brought — and run the bump-version skill over the aggregate:

- Classify the batch (mixed work takes the highest size present).
- Promote every `[Unreleased]` entry into the new `## [X.Y.Z] - <today>`
  section; keep `package.json` in sync.
- Run the validation gate (`npm run typecheck`, `npm run test`, plus
  `npm run build` when package.json/vite/tsconfig changed), commit
  `chore(release): X.Y.Z` and push via the git-commit-push skill — its
  Step 8 (watch-actions) watches this run and reports the published release.

## Step 5 — Verify and report

```bash
gh pr list --state open
git ls-remote --heads origin
```

- The release run must be green; the watch-actions report covers the
  published release and its asset list.
- No open PRs remain and every merged branch is gone from the remote.
- Final report: PRs merged (number + sha), version released, run URL,
  branches deleted. On any failure, stop and present the exact state —
  never force-push, never delete unmerged branches.

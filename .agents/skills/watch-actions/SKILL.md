---
name: watch-actions
description: Watch the GitHub Actions run(s) triggered by a push until they finish, then report the outcome — per-job results, failed logs and, for release runs, the published release with its full asset list. Always triggered by git-commit-push (Step 8) after a successful push; also use when the user says "watch the actions", "monitor the run", "fica de olho nas actions", "acompanha a CI", "see if the release passed", or right after any push in this repository. Read-only — never re-runs, cancels or pushes without an explicit ask.
---

# Watch Actions

Monitor the GitHub Actions run(s) triggered by a push until they finish, then
report the outcome. Pushing without watching is an incomplete job: on this repo
every push to `main` is a release candidate (`.github/workflows/release.yml`
builds win/mac/linux and publishes a GitHub Release).

## Step 1 — Identify the pushed commit

Capture the sha that was pushed — `git rev-parse HEAD` on the branch just
pushed, or the `<sha>` from the push output. Keep the branch name too.

## Step 2 — Locate the run for that sha

From the repo root:

```bash
gh run list --json databaseId,headSha,workflowName,displayTitle,status,conclusion --limit 5
```

- Match `headSha` equal to the pushed sha. Watch **every** matching run —
  today only `release` exists, but pick up new workflows the same way.
- A fresh push may not have a run yet (queue delay): retry up to ~2 minutes
  (`sleep 15` between attempts) before concluding the workflow did not trigger.

## Step 3 — Watch it to completion

```bash
gh run watch <run-id> --exit-status --interval 20
```

- Use a long timeout. A green release run takes ~3–5 min; macOS arm64 runners
  can queue longer under capacity constraints — never kill the watch early.
- `--exit-status` exits non-zero when the run fails — treat a non-zero exit
  (not missing streaming output) as the failure signal.

## Step 4 — Report success

Summarize the per-job results and durations from the watch output. For a
release run on `main`, also verify the release actually published:

```bash
gh release list --limit 3
gh release view v<version> --json isDraft,assets
```

- `version` comes from the CHANGELOG top section; `node scripts/check-release.mjs`
  prints it in its OK line.
- `isDraft` must be `false` and the asset set complete: `setup.exe` +
  blockmap + portable zip (Windows), `arm64.dmg` + `latest-mac.yml` (macOS),
  `.AppImage` + `.deb` + `latest-linux.yml` (Linux), plus `latest.yml`.
- Include the asset list in the final report.

## Step 5 — Report failure

```bash
gh run view <run-id>
gh run view <run-id> --log-failed
```

- Name the failing job + step, quote the decisive error lines and give the
  root cause in one paragraph (example: `Icon must be at least 512x512` →
  `build/icon.png` below electron-builder's macOS minimum).
- Propose the next fix, but do not implement it, re-run (`gh run rerun`) or
  push anything without the user asking.
- If the `validate` job failed on `main`, the cause is the release gate
  (`scripts/check-release.mjs`): CHANGELOG not bumped in the pushed commits,
  top version not above the last `v*` tag, or package.json divergent. Fix it
  via the bump-version skill — never work around the gate.

## Guardrails

- Read-only skill: no reruns, no cancels, no pushes, no force-pushes.
- Always match the run by sha — never report the status of an older commit's
  run as if it were the pushed one.
- If `gh auth status` fails, report it and stop.

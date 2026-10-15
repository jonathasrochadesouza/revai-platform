---
name: bump-version
description: Raise the project version for the next release step and write the matching CHANGELOG.md section. Use when the user asks to "bump", "subir/lançar versão", "bump-version", "preparar release" after finishing work, or before pushing commits meant to become a downloadable release. Reads the pending change, classifies its size, applies the tens-based patch ladder and keeps package.json in sync with CHANGELOG.md.
---

# Bump Version

Turn finished work into the next versioned release step: classify the change, raise
the version on the tens ladder, and write the CHANGELOG entry. Do not create the
commit itself — hand off to `git-commit-push` afterwards.

## Source of truth

- `CHANGELOG.md` — the **top versioned section** (`## [X.Y.Z] - <date>`) is the
  current release-under-preparation. `package.json` `version` must always match it.
- `[Unreleased]` sections keep in-flight notes; promote them into the new version
  section when bumping.

## Classify the pending change (diff vs last released tag or last commits)

| Size     | Heuristic                                                        | Bump          |
| -------- | ---------------------------------------------------------------- | ------------- |
| `micro`  | docs, comments, strings, banner text only                        | patch **+10** |
| `small`  | 1–5 files, one isolated behavior                                 | patch **+20** |
| `large`  | many files, or a fix crossing server/app/shared boundaries        | patch **+30** |
| `feature`| new backward-compatible capability                               | minor **+1**  |
| `breaking`| contract change in `src/shared/`, CLI flags, data schema         | major **+1**  |

Ladder rules:

- Patch always moves in **multiples of 10** (`1.0.0 → 1.0.10 → 1.0.30` valid;
  `1.0.35` invalid). Never produce leading zeros (`1.0.05` is invalid SemVer).
- A `feature` bump resets patch to `0`; a `breaking` bump resets minor and patch.
- Mixed work takes the **highest** size present.

## Steps

1. Read the top of `CHANGELOG.md` and `package.json` `version`; confirm they match.
   If they diverge, stop and ask.
2. Inspect the pending change (`git status --short` + diffs), classify per the table
   and state the resulting version next (e.g. `1.0.30 → 1.1.0`).
3. Edit `CHANGELOG.md`:
   - Replace the top `[Unreleased]` heading with `## [<next-version>] - <today>` when
     it has content; reorder notes under `Added` / `Changed` / `Fixed` / `Deprecated`
     / `Removed` / `Security` (ChangeLog categories). If `[Unreleased]` is empty,
     create the new section with the entry that describes this release.
   - Add a fresh empty `## [Unreleased]` heading above it.
   - Keep the bottom compare links up to date (new `[X.Y.Z]` link vs previous tag).
4. Update `version` in `package.json` to the same value.
5. Run the validation gate (`npm run typecheck`, `npm run test` — add `npm run build`
   when `package.json` changed) and hand the result to `git-commit-push`.

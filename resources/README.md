# resources/ — vendored runtime assets

## revai-skill/
The revai review skill (SKILL.md, references/, scripts/, templates/), vendored so the
platform never fails with `skill/not-found` — a fresh clone or the packaged desktop
app carries it along.

- Source of truth: the `revai` repository (`skills/revai`). To update, re-copy that
  folder here and commit the diff.
- Resolution order in `src/server/skill.ts`:
  1. `REVAI_SKILL_DIR` env (absolute path override)
  2. `resources/revai-skill/` (this vendored copy)
  3. `skill-version/revai/skills/revai/` (legacy location)
- Without the skill the pipeline still runs: built-in `git diff` fallback for the
  patch + in-platform schema validation (no skill HTML artifact).

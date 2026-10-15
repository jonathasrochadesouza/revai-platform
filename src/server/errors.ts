// Error catalog — same philosophy as the legacy: contractual {error_key, params}.
// The prototype's 10-states screen demonstrates each one.
export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public detail?: string,
    public status: number = 400,
  ) {
    super(message)
  }

  static from(e: unknown): AppError {
    return e instanceof AppError ? e : new AppError('internal/error', e instanceof Error ? e.message : String(e))
  }
}

export interface ErrorCatalogEntry {
  title: string
  message: string
  hint?: string
}

export const ERRORS: Record<string, ErrorCatalogEntry> = {
  'source/unrecognized': {
    title: 'Source not recognized',
    message: 'Paste a repo URL (github.com/org/repo, gitlab, git@), org/repo, or a local folder path',
  },
  'repo/inaccessible': {
    title: 'Repository inaccessible',
    message: 'Could not read the repository',
    hint: 'Check the URL — and, if the repo is private, whether the system credentials (git credential helper) are valid',
  },
  'repo/not-git': {
    title: 'The folder is not a git repository',
    message: 'The given path does not contain a git repository',
  },
  'repo/empty-diff': {
    title: 'Empty diff',
    message: 'There are no changes between the selected base and head',
    hint: 'Choose another base or another branch/PR',
  },
  'repo/head-not-found': {
    title: 'Branch/PR not found',
    message: 'The branch, PR or commit given does not exist in the repository',
  },
  'harness/not-found': {
    title: 'Harness not found',
    message: 'The harness CLI was not found on the PATH',
    hint: 'Set the path manually in the Harnesses screen',
  },
  'harness/login-needed': {
    title: 'Harness login required',
    message: 'The harness is not authenticated',
    hint: 'Run the CLI login (e.g. codex login, claude login) and validate again',
  },
  'harness/not-validated': {
    title: 'Harness not validated',
    message: 'Validate the harness in the Harnesses screen before starting a review',
  },
  'agent/failed': {
    title: 'The agent failed',
    message: 'The harness run finished with an error',
  },
  'agent/timeout': {
    title: 'Timed out',
    message: 'The run exceeded the configured time limit',
  },
  'schema/validation': {
    title: 'Schema validation failed',
    message: 'The review data is out of the V2 contract — nothing is generated until it passes',
  },
  'skill/not-found': {
    title: 'revai skill not found',
    message: 'Could not find the revai skill scripts',
    hint: 'Set REVAI_SKILL_DIR or keep skill-version/ at the project root',
  },
  'job/cancelled': {
    title: 'Review cancelled',
    message: 'The run was cancelled midway',
  },
  'fix/no-changes': {
    title: 'No changes applied',
    message: 'The agent made no file changes for this fix',
  },
  'test/failed': {
    title: 'Tests failed',
    message: 'The project tests failed',
  },
  'push/failed': {
    title: 'Push failed',
    message: 'Could not push the fix branch',
    hint: 'Check the system credentials and remote permissions',
  },
  'findings/already-resolved': {
    title: 'Finding already resolved',
    message: 'A resolved finding cannot be skipped',
    hint: 'Restore undoes a skip; Fix actually resolves the finding.',
  },
}

export function errEntry(code: string): ErrorCatalogEntry {
  return ERRORS[code] ?? { title: code, message: code }
}

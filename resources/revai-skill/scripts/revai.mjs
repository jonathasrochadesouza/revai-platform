#!/usr/bin/env node
// revai.mjs — zero-dependency CLI for the revai skill (Node >= 18).
// Commands:
//   diff --branch <name> | --current   Write the review patch to .revai/data/<slug>.patch
//   open-report <slug>                 Open a generated report in the default browser
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MIN_NODE_MAJOR = 18;

function ensureNodeVersion() {
  const major = Number(String(process.versions.node).split('.')[0]);
  if (!(major >= MIN_NODE_MAJOR)) {
    fail(`Node ${MIN_NODE_MAJOR} or newer is required (found Node ${process.versions.node}). Install Node >= ${MIN_NODE_MAJOR} and retry.`);
  }
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(message);
}

const HELP = `revai — code review pipeline CLI (zero dependencies, Node ${MIN_NODE_MAJOR}+)

Usage:
  node revai.mjs diff --branch <name>
  node revai.mjs diff --current
  node revai.mjs open-report <branch-slug> [--no-open]

Commands:
  diff         Generate the review patch for the current branch (--current) or a
               selected branch (--branch, merge-base diff). Written to
               .revai/data/<branch-slug>.patch in the project root.
  open-report  Open .revai/reviews/<slug>-review.html in the default browser.
               Pass --no-open to only print the path.

Options:
  -h, --help    Show this help.
`;

function parseArgs(argv) {
  const options = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--no-open') {
      options.noOpen = true;
    } else if (arg === '--current') {
      options.current = true;
    } else if (arg === '--branch') {
      i += 1;
      if (i >= argv.length || argv[i].startsWith('--')) fail('Option --branch requires a branch name. Example: node revai.mjs diff --branch feature/PEQ-1234');
      options.branch = argv[i];
    } else {
      options._.push(arg);
    }
  }
  return options;
}

// ── git helpers ─────────────────────────────────────────────────────────────

function runGit(projectRoot, args) {
  return spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
}

function findProjectRoot() {
  const probe = runGit(process.cwd(), ['rev-parse', '--show-toplevel']);
  if (probe.status !== 0 || !probe.stdout.trim()) {
    fail('Not inside a git repository. Run this command from a directory within the project you want reviewed.');
  }
  return path.resolve(probe.stdout.trim());
}

function refExists(projectRoot, ref) {
  const probe = runGit(projectRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return probe.status === 0;
}

function findBaseBranch(projectRoot) {
  const originHead = runGit(projectRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead.status === 0 && originHead.stdout.trim()) {
    const candidate = originHead.stdout.trim();
    if (refExists(projectRoot, candidate)) return candidate;
  }
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (refExists(projectRoot, candidate)) return candidate;
  }
  fail('Cannot determine the base branch. Expected origin/HEAD, main, or master to exist.');
}

// ── slug ────────────────────────────────────────────────────────────────────

function slugify(branch) {
  const slug = branch
    .replace(/[\\/:*?"<>|`'&#~^@+=%\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-. ]+$/, '');
  if (!slug || slug === '-') fail(`Branch name "${branch}" cannot be converted to a valid file slug.`);
  return slug;
}

// ── diff command ────────────────────────────────────────────────────────────

function cmdDiff(options) {
  if (!options.current && !options.branch) {
    fail('Specify what to review: node revai.mjs diff --current, or node revai.mjs diff --branch <name>.');
  }
  if (options.current && options.branch) {
    fail('Options --current and --branch are mutually exclusive.');
  }

  const projectRoot = findProjectRoot();
  const baseBranch = findBaseBranch(projectRoot);

  let targetBranch;
  if (options.current) {
    const head = runGit(projectRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const current = head.stdout.trim();
    if (head.status !== 0 || !current || current === 'HEAD') {
      fail('Detached HEAD state: there is no branch to review. Check out a branch first, or use --branch <name>.');
    }
    targetBranch = current;
  } else {
    targetBranch = options.branch;
    if (!refExists(projectRoot, targetBranch)) {
      fail(`Branch "${targetBranch}" does not exist in this repository. List branches with: git branch -a`);
    }
  }

  const mergeBase = runGit(projectRoot, ['merge-base', baseBranch, targetBranch]);
  if (mergeBase.status !== 0 || !mergeBase.stdout.trim()) {
    fail(`No common history between "${baseBranch}" and "${targetBranch}".`);
  }

  const diff = runGit(projectRoot, ['diff', '--no-color', '--no-ext-diff', '--unified=3', `${mergeBase.stdout.trim()}...${targetBranch}`]);
  if (diff.status !== 0) {
    fail(`git diff failed for "${baseBranch}...${targetBranch}": ${diff.stderr.trim()}`);
  }
  const patch = diff.stdout.replace(/\r\n/g, '\n');
  if (!patch.trim()) {
    fail(`The diff between "${baseBranch}" and "${targetBranch}" is empty — there is nothing to review.`);
  }

  const slug = slugify(targetBranch);
  const dataDir = path.join(projectRoot, '.revai', 'data');
  const patchPath = path.join(dataDir, `${slug}.patch`);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(patchPath, patch, 'utf8');
  } catch (err) {
    fail(`Could not write the patch file: ${err.message}`);
  }

  const stats = summarizePatch(patch);
  info(`Branch : ${targetBranch} (base: ${baseBranch})`);
  info(`Patch  : ${patchPath}`);
  info(`Files  : ${stats.files} changed`);
  info(`Lines  : +${stats.added} / -${stats.removed}`);
  info(`Slug   : ${slug}`);
}

function summarizePatch(patch) {
  let files = 0;
  let added = 0;
  let removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) files++;
    else if (line.startsWith('+++') || line.startsWith('---')) continue;
    else if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { files, added, removed };
}

// ── open-report command ─────────────────────────────────────────────────────

function reportPathFor(projectRoot, slug) {
  return path.join(projectRoot, '.revai', 'reviews', `${slug}-review.html`);
}

function openFileInBrowser(filePath) {
  const result = { opened: false, error: '' };
  try {
    if (process.platform === 'win32') {
      const p = spawnSync('cmd', ['/c', 'start', '', filePath], { stdio: 'ignore', windowsHide: true });
      result.opened = p.status === 0;
      if (!result.opened) result.error = `cmd /c start exited with code ${p.status}`;
    } else if (process.platform === 'darwin') {
      const p = spawnSync('open', [filePath], { stdio: 'ignore' });
      result.opened = p.status === 0;
      if (!result.opened) result.error = `open exited with code ${p.status}`;
    } else {
      const p = spawnSync('xdg-open', [filePath], { stdio: 'ignore' });
      result.opened = p.status === 0;
      if (!result.opened) result.error = `xdg-open exited with code ${p.status}`;
    }
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

function cmdOpenReport(options) {
  const slug = options._[0];
  if (!slug) fail('Usage: node revai.mjs open-report <branch-slug> [--no-open]. Example: node revai.mjs open-report feature-PEQ-1234');
  const projectRoot = findProjectRoot();
  const reportPath = reportPathFor(projectRoot, slug);
  if (!fs.existsSync(reportPath)) {
    fail(`No generated report for slug "${slug}" at: ${reportPath}\nGenerate it first with: node generate-review.mjs ${slug}`);
  }
  if (options.noOpen) {
    info(`Report ready: ${reportPath}`);
    return;
  }
  const opened = openFileInBrowser(reportPath);
  if (opened.opened) {
    info(`Opened report in browser: ${reportPath}`);
  } else {
    info(`Could not open the browser automatically (${opened.error || 'no default application for .html'}).`);
    info(`Report ready — open it manually: ${reportPath}`);
  }
}

// ── entry ───────────────────────────────────────────────────────────────────

function main() {
  ensureNodeVersion();
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    info(HELP);
    process.exit(command ? 0 : 0);
  }
  const options = parseArgs(rest);
  if (options.help) {
    info(HELP);
    process.exit(0);
  }
  if (command === 'diff') return cmdDiff(options);
  if (command === 'open-report') return cmdOpenReport(options);
  fail(`Unknown command "${command}". Available commands: diff, open-report. Run node revai.mjs --help.`);
}

main();

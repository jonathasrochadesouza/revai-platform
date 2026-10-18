#!/usr/bin/env node
// generate-review.mjs — validate review data and inject it into the report template.
// Usage:
//   node generate-review.mjs <branch-slug> [--open|--no-open]
// Reads .revai/data/<slug>-review.json and <slug>-meta.json from the project root
// (resolved via git toplevel), validates both against the V2 schema, then writes
// .revai/reviews/<slug>-review.html. Nothing is written when validation fails.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_NODE_MAJOR = 18;
const SEVERITIES = ['critical', 'major', 'minor', 'trivial'];
const LEGACY_PRIORITIES = ['critical', 'medium', 'low'];
const PRIORITY_MAP = { critical: 'critical', medium: 'major', low: 'minor' };
const CATEGORIES = ['security', 'performance', 'stability', 'data-integrity'];
const EFFORTS = ['quick-win', 'estimated', 'significant'];
const STATUSES = ['open', 'resolved'];

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

const HELP = `generate-review — build the interactive review report (Node ${MIN_NODE_MAJOR}+)

Usage:
  node generate-review.mjs <branch-slug> [--open|--no-open]

Reads:
  <project>/.revai/data/<slug>-review.json   findings array (schema V2)
  <project>/.revai/data/<slug>-meta.json     meta object (author, reviewer, branch, walkthrough, files)
Writes:
  <project>/.revai/reviews/<slug>-review.html

By default the generated report opens in the default browser. Pass --no-open to
skip opening (useful in headless environments). The report is written only when
both JSON files parse and pass schema validation.
`;

function parseArgs(argv) {
  const options = { _: [] };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--open') options.open = true;
    else if (arg === '--no-open') options.noOpen = true;
    else options._.push(arg);
  }
  return options;
}

function findProjectRoot() {
  const probe = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' });
  if (probe.status !== 0 || !probe.stdout.trim()) {
    fail('Not inside a git repository. Run this command from a directory within the project under review.');
  }
  return path.resolve(probe.stdout.trim());
}

// ── validation ──────────────────────────────────────────────────────────────

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function failField(source, index, id, field, expectation) {
  const at = index === null ? 'meta' : `finding #${index + 1} (id "${id}")`;
  fail(`Validation failed in "${source}" at ${at}: field "${field}" ${expectation}`);
}

function validateFinding(source, f, index) {
  const id = typeof f.id === 'string' ? f.id : '?';
  if (!isNonEmptyString(f.id)) failField(source, index, id, 'id', 'must be a non-empty string (recommended format CR-01, CR-02, ...) — see references/schema.md');
  if (!isNonEmptyString(f.title)) failField(source, index, id, 'title', 'must be a non-empty string');
  if (!isNonEmptyString(f.description)) failField(source, index, id, 'description', 'must be a non-empty string');
  if (!isNonEmptyString(f.file)) failField(source, index, id, 'file', 'must be a non-empty path string');
  if (!isNonEmptyString(f.lines)) failField(source, index, id, 'lines', 'must be a non-empty string (e.g. "88-94")');

  const severityPresent = 'severity' in f;
  const priorityPresent = 'priority' in f;
  if (severityPresent) {
    if (!SEVERITIES.includes(f.severity)) {
      failField(source, index, id, 'severity', `must be one of ${SEVERITIES.join('|')} (legacy "priority" accepts ${LEGACY_PRIORITIES.join('|')})`);
    }
  } else if (priorityPresent) {
    if (!LEGACY_PRIORITIES.includes(f.priority)) {
      failField(source, index, id, 'priority', `must be one of ${LEGACY_PRIORITIES.join('|')}`);
    }
  } else {
    failField(source, index, id, 'severity', `is required (one of ${SEVERITIES.join('|')}; legacy "priority" ${LEGACY_PRIORITIES.join('|')} is accepted)`);
  }

  if (!EFFORTS.includes(f.effort)) failField(source, index, id, 'effort', `must be one of ${EFFORTS.join('|')}`);
  if (!STATUSES.includes(f.status)) failField(source, index, id, 'status', `must be one of ${STATUSES.join('|')}`);
  if (!CATEGORIES.includes(f.category)) failField(source, index, id, 'category', `must be one of ${CATEGORIES.join('|')}`);

  if (f.rationale !== undefined && typeof f.rationale !== 'string') {
    failField(source, index, id, 'rationale', 'must be a string when present');
  }
  if (f.copilotSummary !== undefined && typeof f.copilotSummary !== 'string') {
    failField(source, index, id, 'copilotSummary', 'must be a string when present');
  }
  if (f.proposedFix !== undefined) {
    const fix = f.proposedFix;
    if (fix === null || typeof fix !== 'object' || Array.isArray(fix)) {
      failField(source, index, id, 'proposedFix', 'must be an object {language, before[], after[]}');
    }
    if (!isNonEmptyString(fix.language)) failField(source, index, id, 'proposedFix.language', 'must be a non-empty string (e.g. "cs", "ts", "java")');
    for (const side of ['before', 'after']) {
      if (!Array.isArray(fix[side]) || fix[side].some((l) => typeof l !== 'string')) {
        failField(source, index, id, `proposedFix.${side}`, 'must be an array of strings');
      }
    }
  }
}

function validateFindings(source, findings) {
  if (!Array.isArray(findings)) {
    fail(`Validation failed in "${source}": the root value must be an array of findings.`);
  }
  findings.forEach((f, i) => validateFinding(source, f, i));
}

function validateMeta(source, meta) {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    fail(`Validation failed in "${source}": the root value must be an object.`);
  }
  for (const field of ['author', 'reviewer', 'branch', 'walkthrough']) {
    if (!isNonEmptyString(meta[field])) failField(source, null, null, field, 'must be a non-empty string (use "Undefined" when unknown)');
  }
  if (!Array.isArray(meta.files)) {
    failField(source, null, null, 'files', 'must be an array of {path, summary, issues, effort}');
  }
  meta.files.forEach((file, i) => {
    if (!isNonEmptyString(file.path)) failField(source, null, null, `files[${i}].path`, 'must be a non-empty string');
    if (!isNonEmptyString(file.summary)) failField(source, null, null, `files[${i}].summary`, 'must be a non-empty string');
    if (!Number.isInteger(file.issues) || file.issues < 0) failField(source, null, null, `files[${i}].issues`, 'must be a non-negative integer');
    if (!EFFORTS.includes(file.effort)) failField(source, null, null, `files[${i}].effort`, `must be one of ${EFFORTS.join('|')}`);
  });
}

// ── injection ───────────────────────────────────────────────────────────────

// JSON.stringify output made safe for inline <script>: escape "</" so the HTML
// parser never terminates the script, and U+2028/U+2029 line separators.
function safeJsonLiteral(value) {
  return JSON.stringify(value)
    .replace(/<\//g, '<\\/')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function inject(template, findings, meta) {
  const slots = [
    { token: '/*__REVAI_DATA__*/', literal: safeJsonLiteral(findings) },
    { token: '/*__REVAI_META__*/', literal: safeJsonLiteral(meta) }
  ];
  let result = template;
  for (const slot of slots) {
    const count = result.split(slot.token).length - 1;
    if (count !== 1) {
      fail(`Template is invalid: expected exactly 1 occurrence of slot ${slot.token}, found ${count}. Reinstall or fix templates/review.html.`);
    }
    result = result.split(slot.token).join(slot.literal);
  }
  return result;
}

// ── browser open (shared behavior with revai.mjs open-report) ───────────────

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

// ── main ────────────────────────────────────────────────────────────────────

function readJsonFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      fail(`Review data not found: ${filePath}\nGenerate it with "node revai.mjs diff" and write the review JSON files (see references/schema.md).`);
    }
    fail(`Could not read ${filePath}: ${err.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`Malformed JSON in ${filePath}: ${err.message}`);
  }
}

function main() {
  ensureNodeVersion();
  const options = parseArgs(process.argv.slice(2));
  if (options.help || options._.length === 0) {
    info(HELP);
    process.exit(options.help ? 0 : 1);
  }
  if (options.open && options.noOpen) fail('Options --open and --no-open are mutually exclusive.');
  const slug = options._[0];
  if (options._.length > 1) fail(`Unexpected extra arguments: ${options._.slice(1).join(', ')}. Usage: node generate-review.mjs <slug> [--open|--no-open]`);
  if (/[\\/:*?"<>|]/.test(slug)) fail(`Invalid slug "${slug}": slugs come from "node revai.mjs diff" output (slashes are replaced by dashes).`);

  const projectRoot = findProjectRoot();
  const dataDir = path.join(projectRoot, '.revai', 'data');
  const findingsPath = path.join(dataDir, `${slug}-review.json`);
  const metaPath = path.join(dataDir, `${slug}-meta.json`);

  const findings = readJsonFile(findingsPath);
  validateFindings(path.basename(findingsPath), findings);
  const meta = readJsonFile(metaPath);
  validateMeta(path.basename(metaPath), meta);

  const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const templatePath = path.join(skillRoot, 'templates', 'review.html');
  let template;
  try {
    template = fs.readFileSync(templatePath, 'utf8');
  } catch (err) {
    fail(`Report template not found: ${templatePath}`);
  }

  const html = inject(template, findings, meta);

  const reviewsDir = path.join(projectRoot, '.revai', 'reviews');
  const outputPath = path.join(reviewsDir, `${slug}-review.html`);
  try {
    fs.mkdirSync(reviewsDir, { recursive: true });
    fs.writeFileSync(outputPath, html, 'utf8');
  } catch (err) {
    fail(`Could not write the report: ${err.message}`);
  }

  info(`Report written: ${outputPath}`);
  if (!options.noOpen) {
    const opened = openFileInBrowser(outputPath);
    if (opened.opened) {
      info(`Opened report in browser.`);
    } else {
      info(`Could not open the browser automatically (${opened.error || 'no default application for .html'}).`);
      info(`Open it manually: ${outputPath}`);
    }
  }
}

main();

#!/usr/bin/env node
// seed-demo-reviews.mjs — write three demo reviews (index.json + record.json + a small
// review.patch) into a DISPOSABLE REVAI_HOME so History / Report / Fix have realistic data
// to capture. It never touches the real ~/.revai: it refuses to run without REVAI_HOME
// (or --home) and aborts if the target resolves to the user's home dotdir.
//
// Usage:
//   REVAI_HOME=/path/to/tmp-home node seed-demo-reviews.mjs
//   node seed-demo-reviews.mjs --home /path/to/tmp-home

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const homeArg = argv.includes('--home') ? argv[argv.indexOf('--home') + 1] : null
const repoArg = argv.includes('--repo') ? argv[argv.indexOf('--repo') + 1] : null
const home = path.resolve(homeArg || process.env.REVAI_HOME || '')
if (!home || home === '.') {
  console.error('refusing to run: pass --home <dir> or set REVAI_HOME to a disposable dir')
  process.exit(1)
}
const realDefault = path.join(os.homedir(), '.revai')
if (home === realDefault || home === os.homedir()) {
  console.error(`refusing to run: ${home} is the real data dir — use a temp copy`)
  process.exit(1)
}

const REVIEWS = path.join(home, 'reviews')
fs.mkdirSync(REVIEWS, { recursive: true })

// when --repo is given, point the featured review's clone at a real local git repo
// (needed so the fix loop passes its "clone exists" check)
const demoRepoDir = repoArg ? path.resolve(repoArg) : '/tmp/demo/checkout-api'

const now = Date.now()
const H = 3600_000

// ── findings for the featured review (github.com/acme/checkout-api) ─────────
const findings = [
  {
    id: 'CR-01',
    title: 'SQL injection via unvalidated sort parameter',
    description:
      'The sort parameter is interpolated straight into the ORDER BY clause. A caller can append arbitrary SQL (e.g. `(SELECT CASE WHEN (1=1) THEN pg_sleep(5) ELSE pg_sleep(0) END)`) and exfiltrate or corrupt data through the public orders endpoint.',
    file: 'src/orders/repository.ts',
    lines: '42-58',
    severity: 'critical',
    effort: 'significant',
    status: 'open',
    category: 'security',
    rationale:
      'The endpoint is reachable without authentication and the database user owns every table. A whitelist turns the value into a constant and removes the whole class of attack.',
    proposedFix: {
      language: 'typescript',
      before: [
        'const sql = `SELECT * FROM orders',
        '  WHERE customer_id = $1',
        '  ORDER BY ${sortBy} ${direction}`',
      ],
      after: [
        'const SORTABLE = {',
        '  created_at: "created_at",',
        '  total: "total",',
        '} as const',
        'const column = SORTABLE[sortBy] ?? "created_at"',
        'const dir = direction === "asc" ? "asc" : "desc"',
        'const sql = `SELECT * FROM orders',
        '  WHERE customer_id = $1',
        '  ORDER BY ${sqlIdent(column)} ${sqlIdent(dir)}`',
      ],
    },
  },
  {
    id: 'CR-02',
    title: 'Stock reservation race allows oversell',
    description:
      'reserveStock() reads the available quantity, then writes the reservation in a second statement. Two concurrent checkouts read the same value and both succeed, selling stock the store does not have.',
    file: 'src/cart/reserve.ts',
    lines: '117-139',
    severity: 'critical',
    effort: 'estimated',
    status: 'open',
    category: 'data-integrity',
    rationale:
      'The read-modify-write is not atomic. A conditional UPDATE … WHERE available >= $qty returns the affected row count and serializes the decision inside the database.',
    proposedFix: {
      language: 'typescript',
      before: [
        'const item = await db.items.find(id)',
        'if (item.available < qty) throw new OutOfStock()',
        'await db.reservations.insert({ itemId: id, qty })',
        'await db.items.update(id, {',
        '  available: item.available - qty,',
        '})',
      ],
      after: [
        'const reserved = await db.query(',
        '  `UPDATE items SET available = available - $2',
        '   WHERE id = $1 AND available >= $2`,',
        '  [id, qty],',
        ')',
        'if (reserved.rowCount === 0) throw new OutOfStock()',
        'await db.reservations.insert({ itemId: id, qty })',
      ],
    },
  },
  {
    id: 'MA-01',
    title: 'N+1 queries when listing order items',
    description:
      'For each order in the list, a separate SELECT loads its items (50 orders → 51 queries). The endpoint is the one the admin dashboard hits on every page load.',
    file: 'src/orders/list.ts',
    lines: '23-47',
    severity: 'major',
    effort: 'quick-win',
    status: 'open',
    category: 'performance',
    rationale: 'A single JOIN or a `WHERE order_id = ANY($1)` fetch collapses the round-trips and keeps the dashboard under 200 ms.',
  },
  {
    id: 'MA-02',
    title: 'Webhook handler swallows rejected promises',
    description:
      'handleStripeEvent() is passed to the router without await or .catch(). A rejected handler crashes the process (unhandledRejection) after the 2xx was already returned, silently dropping the event.',
    file: 'src/webhooks/stripe.ts',
    lines: '88-102',
    severity: 'major',
    effort: 'estimated',
    status: 'open',
    category: 'stability',
    rationale: 'Persist the event id before returning 2xx and process it from the queue; a failed handler must be retryable, not lost.',
  },
  {
    id: 'MI-01',
    title: 'Tax total rounded twice on split payments',
    description:
      'roundTax() runs on each split and again on the summed total, so a 3-way split of $99.99 charges one cent more than the single-payment path.',
    file: 'src/payments/tax.ts',
    lines: '15-27',
    severity: 'minor',
    effort: 'quick-win',
    status: 'resolved',
    category: 'data-integrity',
    rationale: 'Round only once, on the final total, using banker’s rounding to match the ledger.',
  },
  {
    id: 'TR-01',
    title: 'Retry policy encoded as magic numbers',
    description: 'The retry delays (250, 1000, 4000) and attempt cap appear as literals in three call sites.',
    file: 'src/http/client.ts',
    lines: '8-14',
    severity: 'trivial',
    effort: 'quick-win',
    status: 'open',
    category: 'stability',
    rationale: 'Hoist them into a RETRY_POLICY constant so backoff changes stay one-line.',
  },
]

const gateFor = {
  failed: {
    status: 'failed',
    criteria: [
      { label: '2 critical finding(s) (max 0)', tone: 'err' },
      { label: '1 security hotspot(s) (max 0)', tone: 'warn' },
      { label: '5 open finding(s) in new code', tone: 'err' },
    ],
    criticalOpen: 2,
    securityOpen: 1,
    skippedBlockers: 0,
    actionableOpen: 4,
  },
  failedSmall: {
    status: 'failed',
    criteria: [
      { label: '1 critical finding(s) (max 0)', tone: 'err' },
      { label: '4 open finding(s) in new code', tone: 'err' },
    ],
    criticalOpen: 1,
    securityOpen: 0,
    skippedBlockers: 0,
    actionableOpen: 2,
  },
  passed: {
    status: 'passed',
    criteria: [
      { label: 'No blockers in new code', tone: 'info' },
      { label: '1 open finding(s) in new code', tone: 'info' },
    ],
    criticalOpen: 0,
    securityOpen: 0,
    skippedBlockers: 0,
    actionableOpen: 0,
  },
}

const reviews = [
  {
    record: {
      id: 'demo-7k2px9',
      createdAt: now - 2 * H,
      repo: {
        host: 'github.com',
        org: 'acme',
        name: 'checkout-api',
        url: 'https://github.com/acme/checkout-api',
        dir: demoRepoDir,
        label: 'github.com/acme/checkout-api',
      },
      head: 'feature/PEQ-2450',
      headBranch: 'feature/PEQ-2450',
      base: 'main',
      slug: 'PEQ-2450',
      harnessId: 'claude',
      harnessName: 'Claude Code',
      model: 'sonnet',
      refKind: 'branch',
      stats: { filesChanged: 7, additions: 214, deletions: 38, durationMs: 252_000 },
      rules: { rulesMd: true, rulesLines: 86, contributing: false, codingStandards: true },
      meta: {
        author: 'marina.souza@acme.dev',
        reviewer: 'Claude Code',
        branch: 'feature/PEQ-2450',
        walkthrough:
          'Adds split payments to the checkout flow. The new SplitSettlement service splits an order total across N payment methods and settles them independently. Repository and cart modules changed the most; webhooks gained a handler for `charge.succeeded` replays.',
        files: [
          { path: 'src/orders/repository.ts', summary: 'Sort whitelist missing — raw interpolation in ORDER BY.', issues: 2, effort: 'significant' },
          { path: 'src/cart/reserve.ts', summary: 'Reservation write is not atomic against concurrent checkouts.', issues: 1, effort: 'estimated' },
          { path: 'src/orders/list.ts', summary: 'Items fetched per order; dashboard does 51 queries per page.', issues: 1, effort: 'quick-win' },
          { path: 'src/webhooks/stripe.ts', summary: 'New replay handler lacks await/catch on the async path.', issues: 1, effort: 'estimated' },
          { path: 'src/payments/tax.ts', summary: 'Rounding applied per split and on the total.', issues: 1, effort: 'quick-win' },
        ],
      },
      findings,
      skipped: [],
      gate: gateFor.failed,
      artifacts: { patch: 'review.patch' },
      fixApplied: [],
    },
    row: {
      id: 'demo-7k2px9',
      createdAt: now - 2 * H,
      repoLabel: 'github.com/acme/checkout-api',
      head: 'feature/PEQ-2450',
      headBranch: 'feature/PEQ-2450',
      gate: 'failed',
      critical: 2,
      open: 5,
      harnessName: 'Claude Code',
      durationMs: 252_000,
      model: 'sonnet',
    },
  },
  {
    record: {
      id: 'demo-4m8qz1',
      createdAt: now - 26 * H,
      repo: {
        host: 'github.com',
        org: 'acme',
        name: 'checkout-api',
        url: 'https://github.com/acme/checkout-api',
        dir: demoRepoDir,
        label: 'github.com/acme/checkout-api',
      },
      head: 'PR #482',
      headBranch: 'revai-pr-482',
      base: 'main',
      slug: 'pr-482',
      prNumber: 482,
      harnessId: 'kiro',
      harnessName: 'Kiro CLI',
      refKind: 'pr',
      stats: { filesChanged: 4, additions: 61, deletions: 12, durationMs: 96_000 },
      rules: { rulesMd: true, rulesLines: 86, contributing: false, codingStandards: true },
      meta: {
        author: 'diego.martins@acme.dev',
        reviewer: 'Kiro CLI',
        branch: 'revai-pr-482',
        walkthrough: 'Bumps the payment SDK to v3 and adapts the webhook signature check to the new header names.',
        files: [{ path: 'src/webhooks/stripe.ts', summary: 'Signature header renamed; old constant still exported.', issues: 1, effort: 'quick-win' }],
      },
      findings: [
        {
          id: 'MA-01',
          title: 'PR #482 — webhook signature compared before constant-time check',
          description: 'The new SDK exposes timingSafeEqual; the hotfix path still uses === on the raw header.',
          file: 'src/webhooks/stripe.ts',
          lines: '31-38',
          severity: 'major',
          effort: 'quick-win',
          status: 'open',
          category: 'security',
          rationale: 'Timing-safe comparison removes the timing oracle on the signature endpoint.',
        },
        {
          id: 'MI-01',
          title: 'Legacy SIGNATURE_HEADER export still referenced by tests',
          description: 'Two test files import the removed constant; suite passes only because the module resolves lazily.',
          file: 'src/webhooks/stripe.test.ts',
          lines: '5-9',
          severity: 'minor',
          effort: 'quick-win',
          status: 'open',
          category: 'stability',
          rationale: 'Dropping the export keeps the surface honest with the SDK v3 rename.',
        },
      ],
      skipped: [],
      gate: gateFor.failedSmall,
      artifacts: { patch: 'review.patch' },
      fixApplied: [],
    },
    row: {
      id: 'demo-4m8qz1',
      createdAt: now - 26 * H,
      repoLabel: 'github.com/acme/checkout-api',
      head: 'PR #482',
      headBranch: 'revai-pr-482',
      gate: 'failed',
      critical: 1,
      open: 2,
      harnessName: 'Kiro CLI',
      durationMs: 96_000,
    },
  },
  {
    record: {
      id: 'demo-9t5hj3',
      createdAt: now - 3 * 24 * H,
      repo: {
        host: 'github.com',
        org: 'acme',
        name: 'billing-worker',
        url: 'https://github.com/acme/billing-worker',
        dir: '/tmp/demo/billing-worker',
        label: 'github.com/acme/billing-worker',
      },
      head: 'chore/deps-bump',
      headBranch: 'chore/deps-bump',
      base: 'main',
      slug: 'deps-bump',
      harnessId: 'codex',
      harnessName: 'Codex',
      refKind: 'branch',
      stats: { filesChanged: 3, additions: 18, deletions: 22, durationMs: 74_000 },
      rules: { rulesMd: true, rulesLines: 52, contributing: true, codingStandards: false },
      meta: {
        author: 'ana.beatriz@acme.dev',
        reviewer: 'Codex',
        branch: 'chore/deps-bump',
        walkthrough: 'Routine dependency bump; no behavior change, one trivial finding kept open.',
        files: [{ path: 'src/cron/retry.ts', summary: 'Retry literals duplicated with the shared policy.', issues: 1, effort: 'quick-win' }],
      },
      findings: [
        {
          id: 'TR-01',
          title: 'Retry delays duplicated from the shared policy',
          description: 'cron/retry.ts re-declares the backoff table that http/client.ts already exports.',
          file: 'src/cron/retry.ts',
          lines: '12-16',
          severity: 'trivial',
          effort: 'quick-win',
          status: 'open',
          category: 'stability',
          rationale: 'Importing the shared policy keeps the next backoff change single-line.',
        },
      ],
      skipped: [],
      gate: gateFor.passed,
      artifacts: { patch: 'review.patch' },
      fixApplied: [],
    },
    row: {
      id: 'demo-9t5hj3',
      createdAt: now - 3 * 24 * H,
      repoLabel: 'github.com/acme/billing-worker',
      head: 'chore/deps-bump',
      headBranch: 'chore/deps-bump',
      gate: 'passed',
      critical: 0,
      open: 1,
      harnessName: 'Codex',
      durationMs: 74_000,
    },
  },
]

const patch = `diff --git a/src/orders/repository.ts b/src/orders/repository.ts
index 3fa2c91..8b1de77 100644
--- a/src/orders/repository.ts
+++ b/src/orders/repository.ts
@@ -42,7 +42,9 @@ export async function listOrders(customerId: string, sortBy: string, direction: string) {
-  const sql = \`SELECT * FROM orders
-    WHERE customer_id = $1
-    ORDER BY \${sortBy} \${direction}\`
+  const column = SORTABLE[sortBy] ?? 'created_at'
+  const dir = direction === 'asc' ? 'asc' : 'desc'
+  const sql = \`SELECT * FROM orders
+    WHERE customer_id = $1
+    ORDER BY \${sqlIdent(column)} \${sqlIdent(dir)}\`
`

for (const r of reviews) {
  const dir = path.join(REVIEWS, r.record.id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'record.json'), JSON.stringify(r.record, null, 2) + '\n')
  fs.writeFileSync(path.join(dir, 'review.patch'), patch)
}

fs.writeFileSync(
  path.join(REVIEWS, 'index.json'),
  JSON.stringify(reviews.map((r) => r.row), null, 2) + '\n',
)

console.log(`seeded ${reviews.length} demo reviews into ${REVIEWS}`)

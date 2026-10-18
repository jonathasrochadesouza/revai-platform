# revai rubric — universal baseline

This is the review baseline that applies to **every** stack. Per-domain additions
live in `stack-playbooks.md` — load only the sections matching the diff's stacks.

## Precedence rules (binding)

1. **Consumer project rules override this baseline.** When the project provides
   `.revai/rules.md`, `CODING_STANDARDS.md`, or rules in `CONTRIBUTING.md`, load
   them first. If a project rule explicitly endorses a pattern this baseline
   would flag, **suppress the finding** — the project decides.
2. **Baseline smells are always judgement calls.** Phrase them as heuristics
   ("possible Feature Envy — the method reaches into another object's data"),
   never as hard violations. Security and data-integrity classes below are the
   exception: they are hard violations by default.
3. **Tooling wins where it runs.** If the project's lint/format/CI enforces a
   rule, do not report it again.

Each item is expressed as *what* → *why it matters* → *how to fix*, with a
default severity and effort to classify findings.

## Severity / effort scales (template enums)

- **Severity:** `critical` (security holes, data loss, bugs that break the flow) ·
  `major` (SOLID/perf/architecture violations that will hurt soon) ·
  `minor` (smells, conventions, maintainability) · `trivial` (typos, cosmetics).
- **Effort:** `quick-win` (minutes, one-line edits) · `estimated` (~an hour,
  local refactor) · `significant` (multi-hour, touches several modules).

---

## security (OWASP-driven)

Hard violations by default.

1. **Injection (SQL/command/template/LDAP)** — user-controlled input is
   concatenated into queries, shell commands, or templates.
   *Why:* the most exploited vulnerability class; payloads read or write other
   users' data.
   *Fix:* parameterized queries/ORM, prepared statements; never interpolate
   input. → default `critical` / `quick-win`.

2. **Secrets in code** — API keys, passwords, tokens, connection strings, or
   private endpoints hardcoded in the diff (including test fixtures that hit
   real services).
   *Why:* anything committed is assumed leaked and must be rotated; rotation is
   always expensive.
   *Fix:* move to env vars/secret manager; add to ignore; rotate anything
   already exposed. → `critical` / `quick-win`.

3. **Authorization gaps** — new endpoints/actions that mutate data without an
   authz check, or checks that use role names where object ownership matters
   (IDOR).
   *Why:* every new write surface without authz is open until proven closed.
   *Fix:* deny by default; check per-object ownership; centralize the guard.
   → `critical` / `estimated`.

4. **XSS sinks** — user/HTML content flows into `innerHTML`, `dangerouslySetInnerHTML`,
   `v-html`, `ng-bypass`, or templating auto-escaping is disabled.
   *Why:* one escaping miss is persistent account takeover.
   *Fix:* default to text rendering; sanitize with a maintained sanitizer when
   rich text is required. → `critical` / `estimated`.

5. **Weak crypto / randomness** — MD5/SHA1 for security purposes, `Math.random()`
   for tokens/nonces, hardcoded IVs.
   *Why:* trivially predictable; undermines the whole auth surface.
   *Fix:* SHA-256+, CSPRNG (`crypto.randomBytes`, `RandomNumberGenerator`,
   `secrets`). → `major` / `quick-win`.

6. **Missing input validation at trust boundaries** — request bodies, query
   params, headers, file uploads used without shape/size checks.
   *Why:* the failure mode is unhandled exceptions or poisoned state.
   *Fix:* validate/normalize at the boundary (schema validation); reject early
   with 400s. → `major` / `estimated`.

## performance

1. **N+1 queries / per-item remote calls** — loops issuing one query or HTTP
   call per item when a batch API exists.
   *Why:* latency grows linearly with data size and it trips rate limits first.
   *Fix:* batch (`IN (...)`, bulk API, `includes`/`JOIN`, gateway batch
   endpoints). → `major` / `estimated`.

2. **Unbounded data loading** — queries/`findAll` without pagination or limits
   on tables that grow, loading everything into memory to count/filter in code.
   *Why:* works in dev, times out in prod.
   *Fix:* paginate; filter/sort/count in the database. → `major` / `estimated`.

3. **Repeated work in loops** — string concatenation with `+=` in hot loops,
   repeated regex compilation, re-computing values that could be hoisted,
   O(n²) scans where a map/set would be O(n).
   *Why:* allocations and scans multiply per render/request; easy win when
   spotted.
   *Fix:* builders/join, hoist out of the loop, memoize, index lookups.
   → `minor` / `quick-win`.

4. **Unnecessary async serialization** — independent awaits awaited sequentially,
   or blocking I/O on the UI/main thread.
   *Why:* latency stacks up needlessly; frozen UI is a reported bug.
   *Fix:* `Promise.all`/`asyncio.gather`; move work off the main thread.
   → `minor` / `estimated`.

5. **Recomputing derived state on render** — selectors/computations inside render
   paths that belong in memoized/computed state.
   *Why:* every keystroke re-runs the whole derivation.
   *Fix:* memoization (`useMemo`, `computed`, `MemoizedMemo`), move to store.
   → `minor` / `estimated`.

## stability

1. **Unguarded null/optional access on request payloads** — `body.x.y` before the
   shape is validated.
   *Why:* the most common source of 500s on new endpoints.
   *Fix:* validate first, return 400 with a clear message. → `major` / `quick-win`.

2. **Broad exception swallowing** — `catch (Exception)`/`catch-all` without
   logging or rethrow; errors mapped to success values.
   *Why:* failures become silent state corruption; on-call has nothing to work
   with.
   *Fix:* catch narrow types, log with context, rethrow or translate to typed
   errors. → `major` / `quick-win`.

3. **Resource leaks** — streams/connections/timers/subscriptions opened without
   a guaranteed close (`finally`, `using`, `defer`, unsubscribe on teardown).
   *Why:* leaks surface as exhaustion under load, far from the cause.
   *Fix:* tie acquisition to a deterministic release in the same scope.
   → `major` / `estimated`.

4. **Wrong-variable/wrong-message logging** — log lines that reference the wrong
   variable, misspelled or misleading messages.
   *Why:* misleading logs steer incident response the wrong way.
   *Fix:* log the actual outcome with identifiers. → `trivial` / `quick-win`.

5. **Race conditions on shared state** — check-then-act on shared mutable state
   without locks/transactions, async writes to the same key.
   *Why:* lost updates are unreproducible in prod.
   *Fix:* transactions with proper isolation, atomic operations, or single-owner
   serialization. → `major` / `significant`.

## data-integrity

1. **Migrations without rollback** — `Up()` adds schema without a symmetric
   `Down()`; destructive ops (drop column/table) without backup path.
   *Why:* a failed deploy leaves the schema half-migrated and unrecoverable.
   *Fix:* write the rollback; for destructive steps, expand-migrate-contract.
   → `critical` / `estimated`.

2. **Multi-step writes without a transaction** — several writes that must succeed
   or fail together, done as independent calls.
   *Why:* partial writes are the hardest state to clean up.
   *Fix:* wrap in a transaction (or saga with compensations for cross-service).
   → `critical` / `estimated`.

3. **Broken invariants** — unique constraints, FK relations, enum domains, or
   money/decimal fields not enforced by the schema; floats used for currency.
   *Why:* the DB is the last defense; once bad data is in, cleanup is manual.
   *Fix:* add constraints; use decimal/money types. → `major` / `estimated`.

4. **Deletes without soft-delete/audit when history matters** — hard deletes on
   data referenced by other flows (orders, payments, audit).
   *Why:* forensic gaps and dangling references.
   *Fix:* soft-delete flags or archive tables. → `major` / `estimated`.

5. **Retention/magic policy values inline** — `90` days, `1000` limit inline in
   code instead of named constants connected to policy.
   *Why:* policy drifts silently; audits fail.
   *Fix:* named constants/ config with the policy reference. → `trivial` /
   `estimated`.

## design & quality (judgement calls)

1. **Duplicated code** — the same logic shape appears more than once in the diff.
   *Fix:* extract the shared shape, call it from both sites. → `minor` / `estimated`.

2. **Feature Envy** — a method reads another object's data more than its own.
   *Fix:* move the method onto the data it envies. → `minor` / `estimated`.

3. **Data clumps** — the same few params travel together everywhere.
   *Fix:* bundle into a small type. → `minor` / `estimated`.

4. **Primitive obsession** — strings/numbers standing in for domain concepts
   (ids, currencies, statuses).
   *Fix:* introduce a tiny domain type. → `minor` / `estimated`.

5. **Repeated switches** — the same switch/if-cascade recurs across the change.
   *Fix:* polymorphism or one shared map. → `minor` / `estimated`.

6. **Speculative generality** — abstractions/hooks/params with no current need.
   *Fix:* delete; inline until a real need appears. → `minor` / `quick-win`.

7. **Mysterious names** — names that don't reveal intent.
   *Fix:* rename; if no honest name comes, the design needs another look.
   → `trivial` / `quick-win`.

8. **Magic values** — unexplained literals scattered in logic.
   *Fix:* named constants with a why-comment where non-obvious. → `trivial` /
   `quick-win`.

9. **Shotgun surgery signal** — one logical change forces scattered edits
   everywhere; **Divergent change** — one module edited for unrelated reasons.
   *Fix:* gather/split modules along change axes. → `minor` / `significant`.

10. **God function / long method** — one function doing several jobs, hard to
    name.
    *Fix:* split by responsibility. → `minor` / `estimated`.

## tests

1. **New behavior without tests** — new branches/endpoints/parsers in the diff
   with no test coverage anywhere.
   *Why:* the fix loop and future refactors both rely on regression safety.
   *Fix:* add the smallest meaningful test for the new behavior (happy path +
   boundary). → `major` / `estimated`.

2. **Tests asserting nothing** — tests added that only exercise code without
   asserting outcomes, or assert on mocks only.
   *Why:* false green confidence.
   *Fix:* assert observable outcomes. → `minor` / `estimated`.

3. **Test mutation of global state / order dependence** — tests writing shared
   files/env/DB state without cleanup.
   *Why:* flaky suites cost more than the tests save.
   *Fix:* fixtures with setup/teardown; isolate per test. → `minor` / `estimated`.

4. **Skipping the failing scenario** — the diff adds a workaround whose
   corresponding regression test is missing.
   *Why:* the bug returns silently.
   *Fix:* add a test reproducing the original failure. → `major` / `estimated`.

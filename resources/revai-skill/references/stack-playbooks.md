# revai stack playbooks

Domain-specific extensions to the universal baseline (`rubric.md`). **Read only
the sections matching the stacks present in the patch** — detect them from file
extensions, imports, and framework idioms. Skip the rest to keep context lean.

Precedence is unchanged: consumer project rules (`.revai/rules.md`,
`CODING_STANDARDS.md`) override anything here; these items are detection cues,
phrased as judgement calls unless marked hard.

Each section lists *detection cues* (how to recognize the stack in a patch) and
*framework-specific checks* (what to look for, why, and how to fix).

---

## backend

**Detection cues:** `pom.xml`/`build.gradle`/`spring-boot`, ASP.NET (`*.csproj`,
`Program.cs` with `app.Map…`), Express/Fastify/NestJS (`package.json` with
server deps), FastAPI/Django/Flask (`pyproject.toml`, `manage.py`), Rails
(`Gemfile`, `config/routes.rb`), Go (`go.mod` with `net/http`, gin, echo).

**Checks:**

1. **Transactions & consistency** — multi-repo/multi-table writes without a
   transaction boundary; ORM methods that hide per-statement autocommit.
   *Fix:* explicit transactions around the unit of work; optimistic locking for
   concurrent updates. (hard class, see rubric data-integrity)
2. **Idempotency** — POST endpoints handling money/webhooks/registrations that
   accept the same request twice without an idempotency key or dedupe.
   *Why:* clients and gateways retry; duplicates cost money.
   *Fix:* idempotency keys with unique constraints; return the first result.
3. **Retry/backoff** — outbound calls with immediate single retry, or none on
   transient failures; no timeouts at all.
   *Why:* cascading failures start with an unbounded downstream call.
   *Fix:* explicit timeouts; exponential backoff with jitter; respect
   `Retry-After`.
4. **ORM N+1** — lazy relations dereferenced inside loops; missing
   `includes`/`fetch joins`/`select_related`.
5. **Migration safety** — schema migrations that lock hot tables (add column
   with default on large tables, create index without `CONCURRENTLY`/`ONLINE`).
   *Fix:* batched backfills, online DDL.
6. **Queue/event handling** — consumers without poison-message handling, no
   idempotent replay, at-least-once delivery treated as exactly-once.
7. **Config & feature flags** — env vars read at import time in a way that
   breaks tests/CI; flags that can't be toggled safely.
8. **Observability** — new flows without any logging/metrics/tracing hooks;
   errors swallowed without context.

## frontend

**Detection cues:** React/Vue/Svelte/Angular (`jsx`/`tsx`, `*.vue`, `*.svelte`,
`app.component.ts`, imports from `react`, `vue`, `@angular/core`), Vite/webpack
configs, `package.json` UI deps.

**Checks:**

1. **Unsubscription / leaks** — subscriptions/observers/sockets created without
   cleanup on unmount (`unsubscribe`, `takeUntil`, `AsyncPipe`, `AbortController`,
   effect cleanups).
   *Why:* leaked subscriptions fire after teardown — the classic "setState on
   unmounted" bug.
2. **Re-renders** — state updates in loops without batching; objects/arrays/
   functions recreated inline as props to memoized children; missing
   `useMemo`/`useCallback` where profiling matters.
3. **Keys / trackBy** — `key={index}` in React lists, `*ngFor` without `trackBy`,
   `v-for` with index keys — breaks reconciliation on reorder.
4. **`any` / weak typing** — `any` in TS diffs where interfaces are obvious;
   non-null assertions chaining into undefined behavior.
5. **XSS sinks** — `dangerouslySetInnerHTML`, `v-html`, `DomSanitizer.bypassSecurityTrust*`,
   `[innerHTML]` with untrusted strings (hard violation).
6. **Accessibility** — interactive `div`s without roles/keyboard handlers,
   missing labels on inputs, focus lost in modals, no `aria-live` for async
   updates.
7. **State management** — duplicated derived state that can desync; direct
   mutation of props/store state.
8. **Assets & i18n** — hardcoded user-facing strings where the project has an
   i18n layer; missing loading/empty/error UI states.

## mobile

**Detection cues:** Kotlin/Java Android (`Activity`, `Fragment`, `Compose`,
gradle), Swift/SwiftUI/UIKit (`*.xcodeproj`, `@main`, `View` structs), React
Native / Flutter (dart).

**Checks:**

1. **Lifecycle** — work scheduled against a destroyed activity/context
   (`this` captured in async callbacks); missing `dispose`/`onDetach` cleanup.
2. **Main-thread I/O** — network/disk/DB calls on the UI thread (hard violation);
   jank-prone layout work per frame.
3. **Permissions** — runtime permissions used without graceful denial paths;
   manifest declarations for APIs not actually used.
4. **State on rotation/backgrounding** — instance state not saved; timers/
   coroutines bound to the wrong scope.
5. **Battery/allocations** — location/polling listeners left running; large
   bitmaps un-resized; object churn in `onDraw`/`viewDidAppear`.

## data engineering

**Detection cues:** Airflow/Dagster/Prefect DAGs, dbt models (`*.sql` in
`models/`), Spark/PySpark/Flink jobs, Airbyte/Fivetran configs, `*.pipeline`
scripts, dbt `schema.yml`.

**Checks:**

1. **Idempotent pipelines** — reruns that duplicate rows (no upsert/merge,
   no partition overwrite) (hard violation).
2. **Schema evolution** — breaking changes to source schemas without
   forward/backward compatibility handling; silent type widening.
3. **Backfills & late data** — jobs reading "today" walls instead of event time;
   watermarks/window boundaries that drop late arrivals.
4. **PII masking** — new columns/exports carrying unmasked personal data into
   environments/logs (hard violation).
5. **Data quality gates** — no row-count/nullity/freshness assertions between
   stages; failures that write empty partitions downstream.
6. **Partitioning & cost** — full scans where partition pruning is available;
   shuffles that fit in one reducer.

## ML / data science

**Detection cues:** notebooks (`*.ipynb`) diffed with model code, sklearn/pytorch/
tensorflow/xgboost imports, `train.py`, experiment tracking (MLflow/W&B).

**Checks:**

1. **Data leakage** — features derived from the target, fit on the full dataset
   before splitting (scalers/encoders fitted on train+test), time-based leaks
   in time series splits (hard violation).
2. **Splits** — random splits for temporal data; no stratification for skewed
   targets; test set seen during feature engineering.
3. **Reproducibility / seeds** — unseeded RNGs; nondeterministic ops (GPU
   non-determinism) in results that decisions depend on; no pinned versions
   for models/data.
4. **Evaluation honesty** — metrics computed on training data; no baseline
   comparison; class imbalance unaccounted (accuracy on 99/1 data).
5. **Feature drift & monitoring** — no plan for feature distribution shifts;
   training/serving skew (different preprocessing in train vs inference).
6. **Notebook hygiene** — notebooks mutated as the single source of truth
   without exported functions; hidden-state cells run out of order.

## games

**Detection cues:** Unity (`MonoBehaviour`, `GameObject`, `*.unity`),
Unreal (`UCLASS`, `AActor`, blueprints compiled to source diffs),
Godot (`extends Node`), engines' frame loops (`Update`, `_process`,
`Tick`).

**Checks:**

1. **Frame budget** — heavy logic (raycasts, allocations, string ops, find-by
   calls) inside per-frame methods (`Update`, `Tick`, `_process`).
   *Why:* one hot-path offender tanks the whole frame rate.
   *Fix:* cache, throttle, event-driven updates.
2. **Allocations in hot loops** — `new`/LINQ/instantiations per frame causing
   GC spikes.
   *Fix:* object pools, scratch buffers, avoid per-frame allocations.
3. **Save versioning** — save file format changes without a version field or
   migration path (hard violation: old saves load as corrupted).
4. **Physics & fixed timestep** — variable-delta assumptions breaking
   determinism; physics work in frame-rate-dependent code.
5. **Scene/object lifecycle** — instantiations not tied to pooling; references
   to destroyed objects (`== null` vs `IsDestroyed` semantics).
6. **Input & latency** — input polling patterns that miss frames; buffering
   problems on variable refresh.

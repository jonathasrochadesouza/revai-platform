# revai data schema (V2)

The review pipeline persists two JSON files per reviewed branch, then injects them
into the report template. Both files live in `<project>/.revai/data/` and are named
after the branch slug produced by `node revai.mjs diff`:

- `<slug>-review.json` — findings array
- `<slug>-meta.json` — meta object

`<slug>` is the branch name with `/` (and other path-hostile characters) replaced
by dashes. Example: `feature/PEQ-1234` → slug `feature-PEQ-1234`.

---

## findings (array)

Each finding is an object. Required fields are mandatory; optional fields may be
omitted entirely.

| Field           | Type     | Required | Enum / shape                                   |
| --------------- | -------- | -------- | ---------------------------------------------- |
| `id`            | string   | yes      | Recommended `CR-01`, `CR-02`, … (stable IDs used by the fix loop) |
| `title`         | string   | yes      | Short problem statement, capitalized           |
| `category`      | string   | yes      | `security` \| `performance` \| `stability` \| `data-integrity` |
| `severity`      | string   | yes*     | `critical` \| `major` \| `minor` \| `trivial`  |
| `priority`      | string   | (alt)    | Legacy alias: `critical` \| `medium` \| `low`  |
| `effort`        | string   | yes      | `quick-win` \| `estimated` \| `significant`    |
| `status`        | string   | yes      | `open` \| `resolved`                           |
| `description`   | string   | yes      | Brief, objective summary (markdown supported)  |
| `rationale`     | string   | no       | Why it matters — consequences, not praise (markdown supported) |
| `proposedFix`   | object   | no       | `{ language, before: string[], after: string[] }` |
| `copilotSummary`| string   | no       | Legacy alias for the fix block when no structured `proposedFix` exists (markdown) |
| `file`          | string   | yes      | Repository-relative path of the changed file   |
| `lines`         | string   | yes      | Line range in the file, e.g. `"88-94"`         |

*Provide `severity` **or** `priority` — never both missing. `priority` is mapped
automatically: `critical → critical`, `medium → major`, `low → minor`.

### proposedFix

```json
{
  "language": "cs",
  "before": ["var sql = \"SELECT ... \" + paymentMethodId;"],
  "after": ["var sql = \"SELECT ... WHERE id = @paymentMethodId\";"]
}
```

- `language` — syntax id for the fenced code block (`cs`, `ts`, `java`, `py`, …).
- `before` / `after` — arrays of source lines rendered as `-`/`+` diff lines.
- Findings with `copilotSummary` but no `proposedFix` render the summary as
  markdown prose instead of a diff block.

### Worked example (one open critical finding)

```json
[
  {
    "id": "CR-01",
    "title": "String concatenation in SQL query allows injection",
    "category": "security",
    "severity": "critical",
    "effort": "quick-win",
    "status": "open",
    "description": "The query is built by concatenating `paymentMethodId` from the request without parameterization.",
    "rationale": "A malicious payload in `paymentMethodId` can alter the query and read or write other users' data.",
    "proposedFix": {
      "language": "cs",
      "before": ["var sql = \"SELECT * FROM payment_methods WHERE id = \" + paymentMethodId;"],
      "after": ["var sql = \"SELECT * FROM payment_methods WHERE id = @paymentMethodId\";"]
    },
    "file": "src/services/PaymentService.cs",
    "lines": "88-94"
  }
]
```

### Grouping rule

One object per problem. Similar `trivial` findings (e.g. the same typo pattern
repeated) may be merged into one finding that lists all locations in
`description`. Severity/effort describe the merged set.

---

## meta (object)

| Field        | Type    | Required | Notes                                                        |
| ------------ | ------- | -------- | ------------------------------------------------------------ |
| `author`     | string  | yes      | Capitalized name of the branch's last commit author (from `git log --format='%an' -n 1 <branch>`); `"Undefined"` when absent |
| `reviewer`   | string  | yes      | Capitalized name from `git config user.name`; `"Undefined"` when absent |
| `branch`     | string  | yes      | The reviewed branch name (original, with slashes)            |
| `walkthrough`| string  | yes      | 2–5 sentence summary of what the change does (markdown supported) |
| `files`      | array   | yes      | One entry per changed file                                   |

### files entries

| Field     | Type    | Required | Notes                                   |
| --------- | ------- | -------- | --------------------------------------- |
| `path`    | string  | yes      | Repository-relative path                |
| `summary` | string  | yes      | One line on what changed in this file   |
| `issues`  | integer | yes      | Number of findings attached to the file |
| `effort`  | string  | yes      | `quick-win` \| `estimated` \| `significant` |

Names are converted from raw git identity to `Firstname Lastname` (capitalized,
spaces, no dots/special characters). Both unknown names default to `"Undefined"`.

### Worked example

```json
{
  "author": "Sarah Chen",
  "reviewer": "Undefined",
  "branch": "feature/PEQ-2450-checkout-api",
  "walkthrough": "This change introduces the payment flow in the checkout API: it adds `PaymentService` with authorization and capture, the `POST /checkout` endpoint, a currency formatting utility, and a migration creating the payment columns. The gateway retry was simplified along the way. No existing public contract was changed.",
  "files": [
    { "path": "src/services/PaymentService.cs", "summary": "Adds payment authorization and capture with gateway timeout and retry.", "issues": 3, "effort": "significant" },
    { "path": "src/api/CheckoutController.cs", "summary": "Exposes POST /checkout with payload validation and error handling.", "issues": 2, "effort": "quick-win" }
  ]
}
```

---

## Validation error taxonomy

`generate-review.mjs` validates both files **before** writing any HTML and fails
on the first error, naming the file, the finding (or meta), the offending field,
and the expectation. Exit code is non-zero and no HTML is produced.

| Error                              | When                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| `Review data not found`            | `<slug>-review.json` or `<slug>-meta.json` missing under `.revai/data/` |
| `Malformed JSON`                   | File exists but `JSON.parse` fails (message includes parser position) |
| `the root value must be an array`  | findings root is not an array                                        |
| `the root value must be an object` | meta root is not an object                                           |
| `field "id" ...` / `"title"` / `"description"` / `"file"` / `"lines"` | required finding field missing, empty, or non-string |
| `field "severity" must be one of`  | severity outside the enum (and no valid legacy `priority`)           |
| `field "priority" must be one of`  | legacy priority outside `critical\|medium\|low`                      |
| `field "category" must be one of`  | category outside the four template categories                        |
| `field "effort" must be one of`    | effort outside the enum                                              |
| `field "status" must be one of`    | status outside `open\|resolved`                                      |
| `field "rationale"/"copilotSummary" ...` | present but not a string                                       |
| `field "proposedFix" ...`          | not an object, or `language` empty / `before`/`after` not arrays of strings |
| `field "files" ...` / `files[i].*` | meta files missing, or entries missing fields / bad types            |
| `Template is invalid`              | template slot tokens missing or duplicated (bundle corruption — reinstall) |

## Injection safety contract

Injected values are serialized with `JSON.stringify` and post-processed:

- `</` is escaped to `<\/` so hostile diff content can never terminate the page
  script (the escape is valid in both JSON and JavaScript).
- U+2028 and U+2029 line separators are escaped.

This makes every generated report parse-safe regardless of diff content.

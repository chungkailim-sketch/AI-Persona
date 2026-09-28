# Build phase status

Each phase records what was built and, separately, what was actually *verified* by running it. A
claim appears in the verified column only if a command was executed and passed.

---

## Phase 1 — Foundation · complete

### Delivered

| Area | What exists |
| --- | --- |
| Toolchain | Next.js 16.3.5 (App Router, Turbopack), React 19.3, TypeScript 5.7 in `strict` with `noUncheckedIndexedAccess`, Tailwind 3.4, Vitest 5, Playwright |
| Data model | Prisma 7 schema, 49 tables and 21 enums covering identity, projects, datasets and governance, personas, runs and jobs, findings and synthesis, exports, administration and audit |
| Migrations | `20260916211445_init`, `20260916211803_feature_flag_locked` — applied against PostgreSQL 16 |
| Seed | `prisma/seed.ts`: approved domains, first super administrator, five locked safety controls. Idempotent. Creates no demonstration content. |
| Authorization core | `src/auth/permissions.ts` — 7 system roles, 3 project roles, 30 permissions, single `can()` decision point, privilege-escalation guards, `canDisableControl()` that structurally cannot return true |
| Authentication core | `src/auth/otp.ts` — scrypt-hashed codes with per-challenge salt, constant-time verification, expiry, attempt cap, resend cooldown, hourly limit, exact-domain allowlist, session token hashing, idle and absolute expiry |
| Configuration | `src/lib/env.ts` — Zod-validated environment, production guards that refuse development adapters, integration status that reports mode without ever exposing a secret |
| App shell | Top navigation, side navigation, five-step workflow indicator, skip link, error boundary, 404 page, design-token layer with light and dark themes |
| Routes | 18 route segments. Every navigation destination resolves; unbuilt ones render an explicit "Not available in this build" panel |
| Health | `GET /api/health` with separate configuration and database checks, 503 when degraded |
| Security headers | CSP (no remote script host; `'unsafe-eval'` in development only), HSTS, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policy, `X-Powered-By` removed |

### Verified by execution

| Check | Result |
| --- | --- |
| `npm audit` | 0 vulnerabilities |
| `npm run typecheck` | pass |
| `npm run test` | 37 tests, 3 files, all pass |
| `npm run build` | pass, including full TypeScript check across 18 routes |
| `npx prisma migrate dev` | applied; 49 tables and 21 enums present in PostgreSQL |
| `npx prisma db seed` | 2 domains, 1 administrator, 5 safety controls; re-runnable |
| `GET /api/health` | `{"status":"ok","checks":{"config":{"ok":true},"database":{"ok":true}}}` |
| All 18 routes | HTTP 200; unknown path returns 404 |
| Security headers | present on every response, verified with `curl -D` |
| Production guard | `next start` with the development email adapter returns health `degraded` and refuses to treat the configuration as valid — the guard fires as designed |

### Not yet true

- No sign-in exists; the shell renders in its signed-out state.
- Authorization is implemented and unit-tested but not yet enforced on any route, because no route yet reads a session.
- Nothing is deployed.

---

## Phase 2 — Identity and access · complete

### Delivered

| Area | What exists |
| --- | --- |
| Sign-in | Two-stage passwordless flow. `POST /api/auth/request-code` and `POST /api/auth/verify-code`, plus the browser form. Codes are scrypt-hashed with a per-challenge salt; the plaintext exists only in the generating function and the email body. |
| Enumeration resistance | Unknown address, deactivated account, unapproved domain and valid address all return the identical 202 body. The real outcome is recorded in the audit log. |
| Rate limiting | Database-backed, so it is not multiplied by instance count: 60-second resend cooldown, 5 codes per address per hour, 20 per IP per hour. Only the rate-limit response differs from the generic one, because the user needs to know to wait. |
| Sessions | 256-bit token in an httpOnly cookie; only its SHA-256 hash is stored. Sliding idle expiry (8h, throttled to one write per minute) and a hard absolute expiry (7d) that never slides. Revocation is server-side, so a copied cookie stops working at once. |
| Email | Adapter interface with a development logger that writes to the *server* log only. A selected-but-unimplemented provider throws at send time rather than dropping mail silently. `loadEnv()` refuses the development adapter in production. |
| Route guard | `proxy.ts` (Next 16's replacement for `middleware.ts`) checks only for the presence of a cookie and redirects, preserving the intended destination through a validated `next` parameter. It reads no database and grants nothing. |
| Authorization | `requireUser` / `requireUserApi` / `requirePermission` / `hasPermission`. Every denial writes an `authz.denied` audit event. Server actions repeat authentication and validation, because Next exposes each one at a public URL. |
| Admin separation | `/admin` returns 404, not 403, to a user without `admin.access` — there is nothing to tell them. A platform administrator sees no project by virtue of the role. |
| Escalation guards | A role may be granted only strictly below the actor's own rank; nobody may change their own role or deactivate their own account; nobody may act on a peer. A role change or deactivation revokes that user's live sessions immediately. |
| Projects | Creation, membership-filtered listing, per-project authorization. A project is visible only to its members. |
| Settings | Active session list with server-side revocation, ownership-checked. |
| Administration | Overview with locked safety controls and the full list of permissions the actor holds; user and role management; approved domains (exact match, no implied subdomains); append-only audit log. |
| CSP | Per-request nonce generated in `proxy.ts`, with `'strict-dynamic'`; `'unsafe-eval'` in development only. |

### Verified by execution

| Check | Result |
| --- | --- |
| `npm audit` | 0 vulnerabilities |
| `npm run typecheck` | pass |
| `npm run test` | 72 tests across 8 files — unit plus integration against a real PostgreSQL database |
| `npm run test:e2e` | 16 browser tests pass, including axe scans of 11 routes |
| `npm run build` | pass across 25 routes |
| Live sign-in | Code issued, read from the development adapter's server log, exchanged for a session; replaying the same code returns 400 |
| Enumeration | Unapproved domain and valid address returned byte-identical responses |
| Rate limit | Second request within the cooldown returned 429 with `Retry-After: 54` |
| Storage inspection | `OtpChallenge.codeHash` 128 hex characters and not derivable from the row; `Session.tokenHash` 64 hex characters; no raw IP anywhere |
| Role separation | Standard user received 404 on `/admin` and `/admin/users`; super administrator reached both |
| Audit | Seven distinct action types recorded with hashed IPs across the manual run |

### Defects found and fixed during this phase

1. **Attempt cap was off by one.** The verify route incremented the counter and then compared against the incremented value, spending the last allowance on the cap check itself. Users got four guesses where `maxAttempts: 5` promised five. Found by an integration test; fixed by comparing against the pre-increment count, with the semantics now stated on the type.
2. **The Content Security Policy broke the application.** `script-src 'self'` blocked Next's inline bootstrap, so every page rendered and then never hydrated — forms did nothing when submitted. Fixed with a per-request nonce issued from `proxy.ts`.
3. **`node:crypto` reached the browser bundle.** The sign-in form imported `OTP_CONFIG` from the module that also holds the crypto helpers, which threw during hydration and dropped the page into the error boundary. Constants moved to `src/auth/config.ts`. The accessibility scan had passed this page because the error boundary is itself accessible — so the test suite now fails explicitly when a page renders the error boundary.
4. **Text contrast below AA.** `--color-ink-subtle` was 3.85:1 against the page background. Darkened to the lightest value in the same hue that clears 4.5:1 on both surfaces.
5. **`PLATFORM_ADMIN` could deactivate an account but not correct a role**, because it held `admin.users.manage` without `admin.roles.assign`. Granted, since the rank guard is what actually constrains the assignment.

### Not yet true

- No dataset can be uploaded, so no project can progress past step 1.
- Break-glass project access is modelled in the permission system and the schema, but has no interface yet.
- Notification preferences, project member management and preset administration render the "Not available in this build" panel.
- Nothing is deployed.

---

## Phase 2b — remaining identity work · not started

## Phase 3 — Data and brief · complete

### Delivered

| Area | What exists |
| --- | --- |
| Storage | Adapter interface with a local-disk implementation refused in production. Object keys are generated, never derived from a filename, so path traversal is impossible by construction. |
| Parsing | CSV parsed in-repo (quoted delimiters, escaped quotes, embedded newlines, BOM, delimiter detection); XLSX via `exceljs`. Formula *results* are kept and formulas discarded. Every cell is length-capped. Encoding is detected, and a file that is not valid UTF-8 says so rather than yielding mojibake silently. |
| Header detection | The real header row is located beneath any caption rows. Captions are captured as the file's own statement of what it contains. |
| Profiling | Per-field type inference with a stated confidence, missingness across the several ways a file says "nothing here", distinct counts, top values, and outliers by Tukey's fence with a median-absolute-deviation fallback. A short consecutive integer range is called ordinal, not numeric, so no mean is reported over rank labels. |
| Sensitivity | Detection by field name *and* by value shape. Anything flagged is excluded by default; including it requires a written justification of at least 20 characters. The interface states that detection is a floor, not a guarantee. |
| Integrity checks | Filename versus internal label (blocking, compared per token category), suppression markers, encoding, empty and constant fields, duplicate rows, period gaps, uniform drift. Each corresponds to a defect that actually occurred in supplier data. |
| Quality | Five weighted components, each with a written explanation, shown alongside the total. Carries the caveat that it describes the file, not whether the file answers the question. |
| Job queue | PostgreSQL `SELECT … FOR UPDATE SKIP LOCKED`, idempotency keys, category-aware retry with exponential backoff, heartbeat-based stall recovery, cancellation, depth reporting. |
| Worker | Separate process, bounded concurrency, graceful shutdown that finishes the job in hand. Error messages are logged and never returned to the browser. |
| Governance gate | Provenance, lawful basis, classification, retention, and `allowModelProcessing` — the single flag that decides whether any value may enter a model prompt. False by default, settable only here, recorded against a name. Confirming field sensitivity is a separate act from recording provenance. |
| Usability verdict | Four independent conditions, all reported at once rather than one at a time: ingestion finished, findings acknowledged, provenance recorded with permission granted, and no sensitive field included without justification. |
| Brief intake | Research question, decision, markets, scope, exclusions, prohibited inferences, cohort and run configuration. |
| Hypotheses | Each must state, in advance, what evidence would count as support. A brief a run has used is locked; changes create a new version. |
| Stimuli | Stored and handled as untrusted content; text inside a stimulus that reads like an instruction is data. |
| Withholding | `desiredOutcome` is stored, shown to people, and absent by construction from `briefForModelContext()` — the only function the run pipeline may use. The evidence threshold is withheld from model context too. |

### Verified by execution

| Check | Result |
| --- | --- |
| `npm audit` | 0 vulnerabilities |
| `npm run typecheck` | pass |
| `npm run test` | 177 tests across 16 files |
| `npm run test:e2e` | 27 browser tests, including axe scans of 13 routes |
| `npm run build` | pass across 24 routes |
| Live walkthrough | A project was created, a CSV with a caption row, a PII column, a suppression marker and a deliberately wrong market in its filename was uploaded through the real code path, a job was enqueued, the worker claimed and completed it, and the database held 6 rows, 6 fields with `email` flagged PII and excluded, `purchase_intent` typed ordinal, one blocking and two warning findings, and a five-component quality breakdown |
| Rendered state | The data page showed "Not yet. Outstanding:" listing the unresolved blocking finding, the unacknowledged warnings and the missing governance record |

### Defects found and fixed during this phase

1. **`\b` does not match across underscores**, so `phone_number`, `political_party` and `health_email_contact` were never flagged, and `Mintel_Germany_Q1.csv` yielded no tokens at all — meaning the filename check silently passed on exactly the filenames it exists to catch. Separators are now normalised before matching.
2. **The parser assumed row 0 was the header.** A real export with `Country: Indonesia` above the header collapsed the entire file into a single column and ingested "successfully". The header row is now located, and the captions above it are kept as the file's own label.
3. **Tukey's fence reports no outliers when the IQR is zero** — which is backwards, because in a near-constant column a single divergent value is the most conspicuous thing in it. A median-absolute-deviation fallback now covers that case.
4. **The filename check pooled market and period tokens**, so a file named `Q1_2026.csv` containing Indonesian data would have been accused of a mismatch. Tokens are now compared per category, and only a market mismatch blocks.
5. **A UTF-16 byte-order mark survived decoding** and became part of the first column name.
6. **The worker did not load `.env`** and crashed at boot locally. Next loads it for the web process; a separate process gets nothing for free.
7. **Client-side `minLength` made the server's explanatory messages unreachable.** The browser refused the submission before the server could explain *why* a threshold has to be set in advance. Presence rules stay in the markup; substance rules live on the server, where they can say something useful.
8. **The breadcrumb sat inside the "Project workflow" landmark**, conflating two different navigations.

### Not yet true

- No persona is generated and no run executes, so steps 3 to 5 still render the "Not available in this build" panel.
- No AI model call has been made anywhere in the application.
- Uploaded files are not virus-scanned; every file records `scanStatus=NOT_SCANNED`.
- Nothing is deployed.

---

## Phase 4 — Personas and simulation · complete

### Delivered

| Area | What exists |
| --- | --- |
| Model boundary | A single provider interface. The API key is read inside the Anthropic provider, never exported, never logged, never on an object that reaches the browser. Everything goes through one `callModel()`, which records a `ModelCall` for every attempt — stage, persona, provider, tokens, cost, latency, outcome, schema validity — whether it succeeded or failed. |
| Mock provider | Deterministic and seeded, producing structurally valid answers that vary by persona. Costs zero, says `[MOCK]` inside its own output, and every run it touches is labelled mock through to the synthesis and any export. |
| Determinism | `seededRandom` (mulberry32) throughout; `Math.random()` appears nowhere in a run. Per-persona, per-stage seeds are derived from the run seed with length-prefixed hashing. |
| Plan hash | Covers cohort, datasets, brief, model, seeds, prompt version and stimuli. Order-insensitive over lists, and changes when anything that decides the run changes. |
| Evidence gate | `buildEvidenceContext()` refuses outright when model processing is not permitted, the sensitivity review is unconfirmed, retention has expired, or a blocking finding is unresolved. Excluded fields contribute nothing — not values, not names. Acknowledged caveats travel with the evidence into the prompt. |
| Untrusted content | Stimulus text is wrapped in a delimited block introduced as data, with the delimiters stripped from the content first so the block cannot be closed early. |
| Cohort generation | One persona per segment, deterministic, with `AttributeOrigin` on every attribute. Repeats are labelled as repeats rather than invented as new segments. Small bases carry a note saying what they cannot support. |
| Schema validation | Every model answer is parsed against a Zod schema before use; a shape failure is retried once with a repair instruction and then recorded as invalid. It never becomes a finding. |
| Nine-stage orchestrator | Deterministic state machine. Stage 3 is isolated — no persona sees another's view — which is what makes the independent-agreement figure mean anything. At least half the panel must challenge the prevailing view. Every stage records start, end, duration and outcome. |
| Anti-herding | Entropy, raw flip rate, capitulation rate, independent agreement and final agreement, with a written interpretation attached to the synthesis. |
| Confirmation gate | A run is created in DRAFT with an estimate and makes no model call. Execution refuses a run whose `confirmedAt` is null, and a confirmation whose plan hash no longer matches what was displayed is refused rather than applied to a different run. |
| Budget | Checked before each call and tracked from the recorded calls. A run that reaches its cap stops rather than presenting a bill afterwards. |
| Cancellation | Cooperative — checked between personas and between stages. A cancelled run reports no partial results. |
| Evidence ceiling | Every finding from a panel is graded `L3_PERSONA_SIMULATION` and can never be classified `CONFIRMED`, however unanimous. Detected herding forces `CONTESTED` whatever the tally. |
| Brief locking | Creating a run locks its brief, so a completed run's account of what it tested cannot be edited afterwards. |

### Verified by execution

| Check | Result |
| --- | --- |
| `npm audit` | 0 vulnerabilities |
| `npm run typecheck` | pass |
| `npm run test` | 246 tests across 19 files |
| `npm run test:e2e` | 34 browser tests, including axe scans of 15 routes |
| `npm run build` | pass |
| Live walkthrough | A project was created, 120 rows ingested, findings acknowledged, provenance recorded with model processing permitted, a brief and hypothesis written, a 6-persona cohort generated and approved, a run planned, confirmed and executed by the worker. All eight stages completed (consumer reaction skipped — no stimulus), 15 model calls recorded, finding graded `L3_PERSONA_SIMULATION` and classified `MINORITY_RETAINED` at a consensus ratio of 0.167, anti-herding metrics written (flip rate 0.5, entropy 0.79, dissent survival 1.0), and the synthesis limitations led with the mock notice followed by the standing simulation caveat and the ingestion caveats. |

### Defects found and fixed during this phase

1. **The herding metric could not fire in the cases it exists for.** The specified threshold — flip rate above 0.8 — is structurally unreachable, because the raw flip rate cannot exceed `1 − initial majority share`. A panel where seven of ten already held the eventual view and all three dissenters capitulated shows a flip rate of 0.3: total capitulation, reported as calm. Replaced with a **capitulation rate** measured against what could actually move, so complete convergence always reads as 1.0. The inherited 0.8 threshold is kept, applied to the quantity it works on.
2. **Derived seeds overflowed their column.** `deriveSeed` returned an unsigned 32-bit value; `ModelCall.seed` is a signed Postgres `Int`. Every run failed part-way through with "value out of range". Found by the integration test, not by inspection.
3. **Seed derivation could collide across personas.** Joining the parts with a separator meant `["ab","c"]` and `["a","bc"]` hashed identically — two personas silently sharing a seed, and therefore an answer. Now length-prefixed.
4. **A literal NUL byte ended up in a source file**, from the separator above. Removed; the file is text again.
5. **`stanceEntropy` returned `-0`** for a unanimous panel — correct arithmetic, wrong thing to put in a report.

### Not yet true

- Step 5 (results) still renders the "Not available in this build" panel; findings exist in the database but have no reading surface yet.
- No export exists, so nothing can leave the application.
- No live model call has been made: `MODEL_PROVIDER` defaults to `mock` and the interface says so at the confirmation gate.
- The forecast gate is modelled in the schema but has no interface, and no forecasting model is installed.
- Nothing is deployed.

---

## Phase 5 — Results and administration · complete

### Delivered

| Area | What exists |
| --- | --- |
| Claim checker | Mechanical, and deliberately narrow. Catches figures absent from the run's evidence, language that outranks the evidence grade, generalisation past the sample, causal language over cross-sectional material, and attribution to real people. A mock run is blocked outright: no claim can rest on it. Blocked claims are shown with the reason and never silently rewritten. |
| Report assembly | One function builds the report; the screen and every export render from it. That is what makes the limitations block impossible to drop — a separate export path is a path on which someone eventually trims the caveats to make the deck fit. |
| Limitations block | Always present, never empty, never collapsible, placed above the findings. The standing simulation caveat is added at assembly time rather than trusted to have been written earlier. |
| Threshold beside result | Each hypothesis's pre-run evidence threshold is shown next to what the run found, so a reader can judge whether the bar was met rather than being told. |
| Evidence drawers | Every persona's independent position, its final position, and whether it moved — one click from each finding, with a note that the "alone" column is the only one carrying information about agreement. |
| Withdrawn evidence | If model-processing permission is withdrawn after a run, the report says the evidence can no longer be shown and that the findings cannot currently be traced — rather than rendering a silent gap. |
| Export | Markdown and JSON, both carrying the limitations. A blocked export is recorded as a row with its reason rather than failing silently. |
| Override | A reviewer may export over a block with a written reason of at least 30 characters. The override is recorded against their name *and written into the top of the exported file*, because a recipient two months later has the file and not the audit log. |
| Admin: jobs | Queue depth, stalled count, and the 60 most recent jobs with error category and message — for the people who fix things. Those messages never reach a project member's browser. |
| Admin: usage | Model calls, tokens and estimated spend over 30 days by provider, model and stage; failures by outcome; configured caps. Mock calls are counted separately and never folded into a spend total. |

### Verified by execution

| Check | Result |
| --- | --- |
| `npm audit` | 0 vulnerabilities |
| `npm run typecheck` | pass |
| `npm run test` | 286 tests across 21 files |
| `npm run test:e2e` | 44 browser tests, including axe scans of 20 routes |
| `npm run build` | pass across 26 routes |
| Live walkthrough | A completed run was assembled into a report carrying 4 limitations, 1 finding and a 6-persona panel; the claim check raised 6 blocking issues; the export was refused; an override with a written reason produced a file whose **first line** is the override notice, followed by the mock notice and the simulation caveat before any content |
| Rendered page | The limitations block renders above the findings with no interaction, leading with the mock notice, the standing caveat, the anti-herding interpretation and the ingestion caveats |

### Defects found and fixed during this phase

1. **The claim checker blocked the wording it recommends.** Its own suggestion text says to write "this is worth testing with real people" — and "people" tripped the generalisation rule, so following the advice produced a block. A checker that refuses the language it recommends teaches people to ignore it, which costs far more than the rare false negative. Population nouns immediately preceded by `real`, `actual`, `simulated`, `hypothetical` or `synthetic` are now exempt, and an unqualified occurrence elsewhere in the same sentence is still caught.
2. **`findPhrase` returned on the first match rather than the first *unexempted* match**, which would have made any exemption unreachable after the first occurrence.

### Not yet true

- No live model call has been made anywhere; the provider defaults to mock.
- Exports are Markdown and JSON only. PDF and deck formats are not built.
- Break-glass project access is modelled and permission-checked but has no interface.
- Retention policies exist in the schema with no enforcement job.
- Nothing is deployed.

---

## Phase 6 — Hardening and deployment · not started

## Phase 5b — Command-center UX changelog · complete

Outcome report: `docs/ux-command-center.md`. Traceability: `docs/traceability.md`.

### Verified by execution

| Check | Result |
| --- | --- |
| `npm run typecheck` | pass |
| `npm test` | 591 tests across 33 files |
| `npm run test:e2e` | 52 browser tests, including axe scans of the command-center screens in light and dark |
| `npm run build` | pass across 34 routes |
| Live walkthrough | A CSV upload moved through the recorded pipeline stages as the worker processed it; a paced mock run streamed stage, call and metric events over SSE to the control room, then settled; report mode printed on the light palette |

### Defects found and fixed during this phase

1. **Inline style attributes were blocked by the CSP.** With a nonce present, `'unsafe-inline'` in `style-src` is ignored, so every `style=""` (progress widths, Radix positioning) was silently dropped. `style-src-attr 'unsafe-inline'` now allows attributes only.
2. **`mergeEvents` did not sort a first batch delivered out of order.** Found by a component test using the fixture transport.
3. **The results page had an invalid definition list** (`<p>` inside `<dl>`) — found by the new axe scan with real content.
4. **Scrollable admin tables were not keyboard-focusable.**
5. **The top bar overflowed at 390px.**

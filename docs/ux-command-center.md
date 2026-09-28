# UX changelog — research command center: outcome report

Plan and impact analysis written before implementation: `docs/ux-command-center-plan.md`.
Traceability: `docs/traceability.md`.

## 1. Summary

The application now reads as a live research operations console. Every asynchronous surface is
driven by one append-only event table written at real state transitions — ingestion sub-steps,
persona generation checkpoints, run stages and every model call — streamed to the browser over
Server-Sent Events and reduced into pipelines, stage trackers, metrics and feeds. Nothing advances
on a timer. A full light / dark / system theme with server-rendered first paint, a motion token
system and a new shell complete the change. All existing authentication, authorization, audit,
governance gates, evidence lineage and Responsible-AI notices are unchanged and still tested.

## 2. Reference patterns adapted

Dense metric-card rows; pass / flag / fail states with icons and words; active-agent counts;
cohort distributions as horizontal bars; an observation → action → evaluation → result telemetry
feed; stage trackers with progress; preliminary vs final findings; segment comparison tables; a
print-oriented report mode. Nothing was copied: layout, icons, wording and data are this project's.

## 3. Components added

`src/ui/shell/`: ApplicationShell, TopNavigation, CollapsibleSideNavigation, ThemeSwitcher (+
ThemePreferenceControl), WorkflowStepper, ProjectSelector, GlobalRunIndicator, UserMenu, nav.
`src/ui/components/`: Icon, StatusBadge, LiveIndicator, MetricCard / MetricGrid, ProcessingPipeline /
PipelineNode, DataFlowVisualization, ActivityFeed / ActivityFeedRow, ConnectionStatus, LiveAnnouncer,
RunStageTracker / ProgressBar, DebateStageTracker, PersonaStateSummary, SegmentDistributionBar
(the persona distribution panel), PassFlagFailSummary, VariantComparisonTable, FindingSeverityBadge,
SimulationNotice, LiveMetricChart, PreliminaryFindingsPanel, ReportModeLayout, PrintButton,
EmptyState / ErrorState, ReducedMotionFallback.
Page-level: IngestionMonitor, CohortDashboard, SimulationControlRoom, ResultsOverview.
Hooks: `useTelemetryStream`, `useReducedMotion`; transports `SseTransport`, `PollingTransport`,
`FixtureTransport`.

## 4. Components changed

`WorkflowNav` (now breadcrumb + sticky summary + stepper), `PersonaCard` (attributes collapsible),
form inputs (`--color-line-strong` borders, `bg-input`), `BuildStatus` spacing, `SimulateStep`
(adds `RerunButton`; the 3-second `router.refresh()` poller `RunProgress` is removed).
Removed: `TopNav`, `SideNav`, `StepIndicator`, `SignOutButton` (superseded).

## 5. Routes changed

New: `/briefs`, `/runs` (was a placeholder), `/projects/[id]/results/report` (report mode, own route
group without chrome), `GET /api/projects/[id]/events` (SSE), `GET /api/projects/[id]/events/poll`,
`GET /api/projects/[id]/runs/[runId]/telemetry` (NDJSON export), `POST /api/me/theme`,
`GET /api/me/activity`. Redesigned: the five step pages, `/settings` (Appearance).

## 6. Theme implementation

Semantic tokens in `app/globals.css` for page, elevated, panel, raised, input, telemetry well, ink ×3,
code, link, line, strong line, grid, focus, brand ×3, ok / warn / danger / info / pending (+ soft),
provenance ×4, chart series ×8 + track, overlay, shadows. Dark is its own set of steps. Preference
is `light | dark | system`, stored in `User.themePreference` and a first-party cookie (plus
`localStorage`). The root layout reads the cookie — or, on a new device, the signed-in user's profile
— and renders `data-theme` on `<html>` server-side, so there is no flash and no inline script
(important under the nonce-based CSP). System renders no attribute; the stylesheet's
`prefers-color-scheme` block applies. Sign-in copies the profile preference to the cookie.

## 7. Real-time transport

Server-Sent Events. Traffic is one-way; SSE rides plain HTTP through Railway's proxy, reconnects on
its own with `Last-Event-ID`, and needs no in-process pub/sub — the worker writes events from a
separate process and the table is the source of truth. Streams are bounded (≤4 min, or ending as soon
as the subject settles) and send heartbeats; after three failed connections the client falls back to
polling `/events/poll` with back-off. WebSockets were not needed: nothing is sent upstream.

## 8. Event schema

`TelemetryEventSchema` (`src/telemetry/contract.ts`): `eventId, seq, eventType, sourceType, sourceId,
projectId, datasetVersionId, cohortId, runId, stage, status (pending|active|completed|warning|failed|
cancelled|retryable|skipped), message, progressCurrent, progressTotal, metricName, metricValue,
severity, timestamp, retryable, correlationId, isMock, safeMetadata`. `safeMetadata` is allow-listed
(43 keys), scalar-only and 240-character capped. A `StreamSnapshot` (run status, steps, call and
token totals; dataset status) is sent on every connection and every 5 seconds.

## 9. Backend changes

- Migration `20260921082404_telemetry_and_theme`: `TelemetryEvent` (append-only, `seq` bigserial cursor,
  four indexes) and `User.themePreference`.
- `emitTelemetry` / `datasetEmitter` (never throws; sanitises). Instrumented: `createDatasetWithVersion`
  (upload received, scan not performed), `runIngest` (13 stages, per-file and per-sheet events, failure
  attributed to the stage in hand), governance actions (`emitApprovalIfUsable`, once), `createCohort` /
  `approveCohort`, the orchestrator (stage begin/finish, call started/completed with verdict, the
  majority computation, anti-herding, warnings, completion / failure / cancellation), the worker (job
  failure category and retry decision — never the raw error).
- `callModel` returns attempts, tokens and latency and accepts an `onAttempt` hook.
- `retryIngestion` (failed versions only), `computeWorkflowState`, `downstreamImpact`, `activeRunsFor`,
  `resultsSummary`, `verdictsFromCalls`, `nextExperiments`.
- CSP: `style-src-attr 'unsafe-inline'` added. A nonce disables `'unsafe-inline'` for style
  *elements*; attribute styles (bar widths, Radix positioning) were silently blocked before.
- Mock provider: optional `MOCK_PROVIDER_DELAY_MS` pacing (default 0, max 5 s), recorded as real latency.

## 10. Mock versus live

Mock runs go through the same orchestrator, emit through the same function and satisfy the same
schema; every event carries `isMock: true` and every screen shows a Mock-provider chip. The
`FixtureTransport` replays given events, labels its connection "Fixture" and marks every event mock;
it is used by tests, not by any page.

## 11. Accessibility

Status never colour-only (word + icon + tone everywhere); rate-limited polite live region announcing
only stage changes, failure and completion; table view behind every chart; feed rows expandable with
`aria-expanded`; scrollable regions focusable and labelled; skip link retained; focus rings on
`--color-brand` (≥3:1 on every surface). Contrast computed for 166 token pairs in both themes; axe
(WCAG 2.1 AA tags) passes on 30+ routes including the command-center screens with real content in
light and dark. Fixed along the way: an invalid `<dl>` in the results page, unfocusable scrollable
admin tables.

## 12. Performance

Incoming events batched (250 ms) and held while the tab is hidden; browser buffer 1,000 events;
feed renders at most 400 rows with `content-visibility: auto`; memoised reducers and chart; persona
cells only for panels ≤120; server reads capped at 1,000 per request; streams end when settled.

## 13. Tests

| Suite | Files | Tests | Result |
|---|---|---|---|
| Vitest (unit + component + integration) | 33 | 591 | all pass |
| Playwright (incl. axe) | 6 | 52 | all pass |

New: `unit/theme`, `unit/telemetry-contract`, `unit/telemetry-reduce`, `unit/status`,
`unit/contrast`; `component/theme-switcher`, `component/activity-feed`, `component/command-center`;
`integration/telemetry`; `e2e/command-center` (14 scenarios) and new axe scans. A real defect found by
the new tests: `mergeEvents` did not sort a first batch that arrived out of order.

## 14. Traceability

`docs/traceability.md` — 30 changelog rows (22 met, 8 partly met) and 12 PRD rows.

## 15. Placeholders remaining

`/datasets`, `/personas`, `/reports`, `/presets` library pages and `/methodology` still render the
explicit "Not available in this build" panel. Notifications in Settings likewise.

## 16. Known limitations

- Variant (A/B) comparison, population weighting and statistical tests: not executed by the
  orchestrator; shown as unavailable.
- Pause / resume of a run: not implemented; not shown.
- Persona generation is synchronous: its record is complete on arrival rather than streamed.
- Resizable panels and tabbed tablet panels: not built.
- Browser-to-server upload progress is not measured; the pipeline starts at "received".
- No malware scanner: the safety-scan stage is honestly "Not performed".
- Throughput is a trailing 60-second count, not a forecast; no ETA is shown.

## 17. Production integration gaps

- SSE polls the database once a second per open stream; at scale, switch to Postgres
  `LISTEN/NOTIFY` behind the same route.
- Telemetry retention: the table is append-only with no retention job yet.
- Railway proxy idle timeouts should be confirmed ≥ the 15 s heartbeat.
- Brand kit: every brand token still requires owner validation.

## 18. Files changed

New: `src/telemetry/{contract,reduce,status,emit,read,scope}.ts`, `src/run/telemetry.ts`,
`src/server/{workflow,activity}.ts`, `src/report/summary.ts`, `src/ui/theme/theme.ts`,
`src/ui/cohort/stats.ts`, `src/ui/live/*`, `src/ui/components/*` (22 components + `tone.ts`), `src/ui/shell/*` (8 components + `nav.ts`),
the pages and routes listed in §5, `IngestionMonitor.tsx`, `CohortDashboard.tsx`,
`SimulationControlRoom.tsx`, `ResultsOverview.tsx`, the migration, tests listed in §13, these docs.
Changed: `prisma/schema.prisma`, `app/globals.css`, `tailwind.config.ts`, `app/layout.tsx`,
`app/(app)/layout.tsx`, `proxy.ts`, `worker.ts`, `src/ingest/pipeline.ts`, `src/server/{datasets,
governance,personas}.ts`, `src/run/orchestrator.ts`, `src/model/{client,mock}.ts`,
`app/api/auth/verify-code/route.ts`, the five step pages, settings, admin audit/jobs/usage (focusable
tables), `tests/integration/helpers.ts`, `tests/e2e/{auth,accessibility}.spec.ts`, `.env.example`.

## 19. Commands

```bash
npm run typecheck                 # tsc --noEmit
npm test                          # Vitest: unit, component, integration (needs PostgreSQL)
MOCK_PROVIDER_DELAY_MS=300 npm run worker   # in another terminal, for observable e2e runs
npm run test:e2e                  # Playwright + axe (starts next dev on :3500)
npm run build                     # production build
```

## 20. Manual QA checklist

- [ ] Toggle theme in the top bar; reload; open on another browser signed in as the same user.
- [ ] Settings → Appearance → System; change the OS theme; the app follows without reload.
- [ ] Upload a CSV with an email column: pipeline stages advance as the worker runs; Safety scan
      reads "Not performed"; the email field appears under Warnings; acknowledge a finding.
- [ ] Stop the worker, upload again: the pipeline sits at "Upload received"; nothing advances.
- [ ] Plan and confirm a run with `MOCK_PROVIDER_DELAY_MS=300`: stages, metrics, feed and persona
      activity update live; Preliminary panel appears, then gives way to Final.
- [ ] Untick Auto-scroll and Pause display mid-run: counter shows new events; the run continues.
- [ ] Kill the dev server mid-run and restart: the status reads Reconnecting, then catches up.
- [ ] Cancel a run: stages stop and read Cancelled.
- [ ] Open Results → report mode → print preview: light palette, no chrome, caveats present.
- [ ] macOS/Windows "reduce motion" on: no pulsing, no moving dashes, states still readable.
- [ ] Keyboard only: reach Auto-scroll, Pause, filters and a feed row; expand it.
- [ ] 390 px width: no horizontal scroll; navigation opens as a drawer.
- [ ] As a user outside the project, request `/api/projects/<id>/events?runId=<run>`: 404.

## Directory tree (affected parts)

```
app/
  globals.css · layout.tsx
  (app)/layout.tsx
  (app)/briefs/page.tsx · (app)/runs/page.tsx · (app)/settings/page.tsx
  (app)/projects/[projectId]/
    WorkflowNav.tsx · actions.ts
    data/{page.tsx, IngestionMonitor.tsx}
    personas/{page.tsx, CohortDashboard.tsx, PersonaStep.tsx}
    simulate/{page.tsx, SimulationControlRoom.tsx, SimulateStep.tsx}
    results/{page.tsx, ResultsOverview.tsx}
  (report)/layout.tsx
  (report)/projects/[projectId]/results/report/page.tsx
  api/me/{theme,activity}/route.ts
  api/projects/[projectId]/events/{route.ts, poll/route.ts}
  api/projects/[projectId]/runs/[runId]/telemetry/route.ts
prisma/migrations/20260921082404_telemetry_and_theme/
src/
  telemetry/{contract,reduce,status,emit,read,scope}.ts
  run/telemetry.ts · server/{workflow,activity}.ts · report/summary.ts
  ui/theme/theme.ts · ui/cohort/stats.ts
  ui/live/{transport.ts, useTelemetryStream.ts, useReducedMotion.ts}
  ui/shell/{ApplicationShell,TopNavigation,CollapsibleSideNavigation,ThemeSwitcher,
            WorkflowStepper,ProjectSelector,GlobalRunIndicator,UserMenu}.tsx · nav.ts · steps.ts
  ui/components/{ActivityFeed,ConnectionStatus,DataFlowVisualization,FindingSeverityBadge,Icon,
            LiveAnnouncer,LiveIndicator,LiveMetricChart,MetricCard,PassFlagFailSummary,
            PersonaStateSummary,PreliminaryFindingsPanel,PrintButton,ProcessingPipeline,
            ReducedMotionFallback,ReportModeLayout,RunStageTracker,SegmentDistributionBar,
            SimulationNotice,States,StatusBadge,VariantComparisonTable}.tsx · tone.ts
tests/
  unit/{theme,telemetry-contract,telemetry-reduce,status,contrast}.test.ts · telemetry-fixtures.ts
  component/{theme-switcher,activity-feed,command-center}.test.tsx · setup-dom.ts
  integration/telemetry.test.ts
  e2e/command-center.spec.ts
docs/{ux-command-center-plan.md, ux-command-center.md, traceability.md}
```

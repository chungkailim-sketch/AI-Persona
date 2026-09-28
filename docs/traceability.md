# Requirement traceability — command-center UX changelog

Scope: the changelog "frontend UX and simulation-observability" (UXC-*) and the PRD requirements it
touches. Status words are strict:

- **Met** — implemented and covered by a test that was run and passed.
- **Partly met** — implemented with a stated gap.
- **Not met** — not implemented; the gap is stated.

Test references: `unit/…`, `component/…`, `integration/…` are Vitest files under `tests/`;
`e2e/…` are Playwright specs under `tests/e2e/`.

## Changelog requirements

| ID | Requirement (changelog §) | Status | Evidence |
|---|---|---|---|
| UXC-01 | Research-infrastructure design direction: panels, metric cards, status badges, mono telemetry, technical grid (§3) | Met | `app/globals.css`, `src/ui/components/*`; screenshots reviewed in light and dark |
| UXC-02 | Top bar: logo, name, project selector + status, environment, global run status, theme switch, help, profile menu, admin (§4) | Met | `TopNavigation.tsx`; e2e/auth (account menu, admin hidden), e2e/command-center (theme) |
| UXC-03 | Collapsible side nav with icons, labels, tooltips when collapsed, keyboard, drawer on mobile, persisted (§4) | Met | `CollapsibleSideNavigation.tsx`, `ApplicationShell.tsx` (cookie `rfpi-nav`); axe scans pass |
| UXC-04 | Contextual right panel and resizable panels (§4) | Partly met | Multi-column panel layouts on every step; no resizable panels — omitted as not reliably accessible |
| UXC-05 | Five-step stepper: number, title, complete / warning / error / active / blocked, unresolved count, last saved (§5) | Met | `WorkflowStepper.tsx`, `src/server/workflow.ts`; component/command-center "WorkflowStepper" |
| UXC-06 | Show impact before an earlier-step change invalidates later work (§5) | Partly met | Data step shows cohort/run impact before upload; brief step relies on existing brief locking (a used brief is versioned, not edited) and has no separate impact panel |
| UXC-07 | Fifteen ingestion stages with seven states each (§6) | Met | `INGEST_STAGES`, `reducePipeline`; unit/telemetry-reduce; integration/telemetry; e2e/command-center ingestion |
| UXC-08 | Ingestion panels: upload, pipeline, preview, schema, quality, activity, warnings (§6) | Met | `data/page.tsx`, `IngestionMonitor.tsx`. Preview is field-level (types, missingness, top values); raw rows are not shown by design |
| UXC-09 | Truthful ingestion events with timestamp, stage, status, counts, codes, correlation id (§6) | Met | `src/ingest/pipeline.ts` instrumentation; integration/telemetry "never carries a cell value" |
| UXC-10 | Data-flow animation bound to real state; reduced-motion static; text equivalent (§6) | Met | `DataFlowVisualization.tsx`; component/command-center; e2e reduced motion |
| UXC-11 | Persona cohort dashboard: totals, approval, exclusions, weak evidence, conflicts, coverage, confidence (§7) | Met | `CohortDashboard.tsx`, `src/ui/cohort/stats.ts`; unit/status "cohort statistics" |
| UXC-12 | Persona mix distributions with count, %, evidence coverage, confidence, selection (§7) | Partly met | Segment, confidence and provenance distributions. Geography, language, attitude, need state, brand relationship and channel are shown only when the data segments on them; the screen says so |
| UXC-13 | Persona generation activity feed (§7) | Partly met | Generation record written at real checkpoints; generation is a single synchronous pass, so the record is complete on arrival rather than streamed stage by stage |
| UXC-14 | Run header with controls that exist (§8A) | Met | Cancel and "Plan a rerun" (new plan, still needs confirmation). Pause/resume not shown: not implemented in the orchestrator |
| UXC-15 | Live metric cards, only if calculable; no fabricated ETA (§8B) | Met | `aggregateRunMetrics`; "Completion" shows stage progress; throughput "Unavailable" when inactive |
| UXC-16 | Pass / flag / fail / pending / not evaluated / unavailable, with definitions and threshold source (§8C) | Met | `VERDICT_META`, `PassFlagFailSummary`; unit/status; component/command-center |
| UXC-17 | Trajectory feed: observation → action → evaluation → result; auto-scroll, pause display, search, filters, expand, copy, export, connection status, new-event counter (§8D) | Partly met | All present and tested (component/activity-feed, e2e). Filters for *role* and *variant* are absent: runs have one role type and one variant |
| UXC-18 | Aggregated persona activity map without per-node animation at scale (§8E) | Met | `PersonaStateSummary` (cells only ≤120) |
| UXC-19 | Nine-stage debate tracker (§8F) | Met | `DEBATE_STAGES` mapped to the orchestrator stage that performs each; "performed within" stated |
| UXC-20 | Preliminary findings labelled and replaced by final (§8G) | Met | `PreliminaryFindingsPanel`; e2e simulation "gives way to final results" |
| UXC-21 | SSE → WebSocket → polling, typed contract, server-side authorization, recovery, idempotency, ordering, reconciliation, no sensitive content, mock uses same schema (§9) | Met | `app/api/projects/[id]/events`, `/poll`; `TelemetryEventSchema`; `mergeEvents`; integration/telemetry; e2e non-member 404 |
| UXC-22 | Results redesign: metadata, recommendation, pass/flag/fail, distributions, segment table, findings with severity, consensus/dissent, evidence, confidence, limitations, next experiments, export (§10) | Partly met | All present. Variant comparison and population-weighted results are stated as unavailable (single-concept runs only) |
| UXC-23 | Report mode (§10) | Met | `/projects/[id]/results/report`; e2e opens it; print stylesheet forces the light palette |
| UXC-24 | Light, dark, system; toggle + settings; profile + local persistence; no flash (§11) | Met | `theme.ts`, `ThemeSwitcher.tsx`, root layout; unit/theme; component/theme-switcher; e2e theme (server HTML carries `data-theme`) |
| UXC-25 | Semantic tokens; WCAG AA in both themes; not an inversion (§11) | Met | unit/contrast (166 pairs computed from the stylesheet); axe colour-contrast on command-center screens in both themes |
| UXC-26 | Motion token system; reduced motion (§12) | Met | `--motion-*`, `--ease-*`; `.motion-live` stops with the process; e2e reduced motion finds zero running animations |
| UXC-27 | Responsive desktop / tablet / mobile (§13) | Partly met | No horizontal scroll at 390px on the step pages (checked); mobile drawer navigation. Tablet tabbed secondary panels are stacked, not tabbed |
| UXC-28 | Performance: virtualised feed, batching, throttling, buffer limits, background-tab pause (§14) | Partly met | 250ms batching, hidden-tab buffering, 1,000-event buffer, 400-row render cap, `content-visibility` windowing. No true list virtualisation library; not load-tested beyond ~600 events |
| UXC-29 | Accessibility: live-region rate limiting, keyboard monitoring, chart alternatives, status not colour-only (§15) | Met | `LiveAnnouncer`; e2e keyboard; table view on every chart; axe on 30+ routes |
| UXC-30 | No copied proprietary assets or branding from the reference (§19) | Met | Icons drawn for this project; no reference code, text, data or imagery used |

## PRD requirements touched

| ID | Requirement | Status after this changelog | Evidence |
|---|---|---|---|
| UX-01 | Persistent top navigation and step-aware context | Met | Shell + sticky project summary |
| UX-02 / FR-83 | Step indicator with states and blocking reasons | Met | `WorkflowStepper` |
| UX-03 | Six async states on every surface | Partly met | Empty, loading (server render), processing, success, warning, failure and permission-denied exist in the component set; not every legacy surface uses them yet |
| UX-04 | WCAG 2.2 AA | Partly met | Automated checks pass in both themes; manual screen-reader review not yet done |
| UX-05 | Chart text alternatives | Met | Table view on every chart |
| UX-06 | Reduced motion | Met | e2e |
| UX-07 | Responsive to tablet | Met | Layouts collapse; 390px has no overflow |
| UX-09 | Errors state cause and remedy | Met | `ErrorState` with correlation id |
| UX-10 | Evidence one interaction away | Met (unchanged) | Evidence drawers retained |
| ANA-04 | Append-only run telemetry per call and transition | Met | `TelemetryEvent` table, written by orchestrator and pipeline |
| NFR-19 | No PII in telemetry | Met | Allow-listed metadata; integration test asserts no cell values, prompts or desired outcome in the stream |
| DATA-15 / FR-44 | Progress reflects real state | Met | No timer drives any stage or progress figure |

## Enrichment integrations (TimesFM, MatrAIx methods, TypeSafe) — September 2026

Plan and experiment evidence: `docs/integration-plan-timesfm-matraix-typesafe.md`.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| ENR-01 / FR-51 | Forecast decision gate answered in code; refusal is a designed outcome with E-FC-01 wording | Met | `src/forecast/gate.ts`; unit/forecast "forecast gate"; integration/enrichment (five waves refused, telemetry message) |
| ENR-02 | Trend classification alternative with significance testing and FDR control | Met | `src/forecast/trend.ts`; unit/forecast; integration/enrichment |
| ENR-03 | Base rows never read as shares; gaps never filled | Met | `src/forecast/series.ts`; unit/forecast "series from a long survey table" |
| ENR-04 | One-step jumps flagged as possible methodology breaks | Partly met | Flag and warning shown; marking a break and re-testing from it is plan item D1 |
| ENR-05 | TimesFM 2.5 only (Apache-2.0), evaluation until approved; 3.0 refused | Met | `services/timesfm`, `src/forecast/timesfm.ts`, gate Q8; sidecar smoke-tested end to end |
| ENR-06 | Seeded, quota-exact population sample from cleared data with calibration and stated assumptions | Met | `src/population/*`; unit/population; integration/enrichment (refusal on uncleared data, audit) |
| ENR-07 | Cohort generated from a population sample, with segment-level observed attributes and cell weights | Met | `src/population/cohort.ts`, `createCohortFromPopulation`; unit/adherence "cohortFromPopulation"; integration/enrichment |
| ENR-08 | Judge second opinion can only tighten (exclude a field, add a warning), never loosen | Met | `src/judge/checks.ts`; integration/enrichment (field excluded, names only sent) |
| ENR-09 | Stimulus injection screen and stance consistency | Partly met | Implemented and fixture-tested; off by default pending DPA (G2/G3); not yet validated on a live run (S1) |
| ENR-10 | Weighted support labelled as survey-sample weighting, not census | Met | `src/report/summary.ts`, `ResultsOverview.tsx` |
| ENR-11 | No external key reaches the browser or the repository | Met | unit/env "never exposes the key"; keys read server-side only |
| ENR-12 | Persona adherence contrast test (≥80% in line on both sides); mock never passes | Partly met | `src/run/adherence*.ts`; unit/adherence; integration/enrichment (not evaluated on mock, drift fails, adherent passes). No live verdict yet: needs a model key |
| ENR-13 | Net segments excluded by base arithmetic, not only by label | Met | `partitionByBases`; unit/population "partitionByBases" (US employment, as published) |

# UX changelog — research command center: impact analysis and plan

Written before any code changed. The outcome report is `docs/ux-command-center.md`.

## What exists (inspected 2026-09-21)

| Area | Current state | Decision |
|---|---|---|
| Routes | 26 route segments; five step pages under `/projects/[id]/{data,brief,personas,simulate,results}`; admin under `/admin/*`. No `/briefs` index. | Keep every route. Add `/briefs`, `/projects/[id]/results/report`, SSE + poll event routes, theme route. |
| Shell | `TopNav` (logo slot, demo chip, methodology, admin, email, sign-out) and a static `SideNav` list, both server-rendered inside `app/(app)/layout.tsx`. | Replace with `ApplicationShell` + `TopNavigation` + `CollapsibleSideNavigation`. Auth resolution stays in the layout. |
| Step indicator | Two components: `WorkflowNav` (used) and `StepIndicator` (unused, richer state model in `steps.ts`). | Merge into one `WorkflowStepper` fed by a server-side `computeWorkflowState()`. |
| Tokens | CSS custom properties with light and dark blocks; Tailwind reads variables only; dark theme reachable via `data-theme` or the OS. No switch, no persistence. | Extend to the full semantic set; keep the one-file swap point for the brand kit. |
| Ingestion | Real job pipeline (`runIngest`) writing coarse `DatasetVersion.status`. No per-stage record, no live surface — the data page is static. | Instrument real sub-steps with persisted telemetry events. |
| Personas | Synchronous deterministic cohort generation in a server action. | Emit events at real generation checkpoints; add cohort dashboard computed from stored personas. |
| Simulation | Nine-stage deterministic orchestrator; `RunStep` rows; `ModelCall` per attempt. UI polls `router.refresh()` every 3s. | Emit events at stage begin/end and after every model call; replace polling with SSE (polling kept as fallback). |
| Results | Single assembly function (`assembleReport`) used by screen and exports; limitations block mandatory. | Keep the assembly function as the only source; redesign presentation; add report mode route. |
| Controls | Cancel is implemented. Pause, resume and in-place retry of a run are not. | Show Cancel and "Plan a rerun" (creates a new DRAFT that still needs confirmation). Do not show pause/resume. |
| Tests | 320 unit + integration, 44 e2e. `tests/component` empty. | Add unit, component, integration and e2e coverage for the new surfaces. |

## Impact

- **Schema:** one new append-only table (`TelemetryEvent`) and one column (`User.themePreference`). No existing column changes.
- **Behaviour:** instrumentation is additive and wrapped so a telemetry write failure cannot fail ingestion or a run (same rule as the audit log).
- **Authorization:** the event stream reuses `project.view`; run and dataset ids are checked to belong to the project before any event is read.
- **Risk:** long-lived SSE connections on Railway — mitigated by a bounded stream lifetime with `Last-Event-ID` resume, heartbeats, and a polling fallback.

## Plan

1. Schema + migration; telemetry contract (Zod), pure reducers, server emitter, reader.
2. Instrument ingestion, governance, persona generation, orchestrator, worker failures.
3. SSE route, poll route, telemetry export route, theme route.
4. Tokens, motion system, theme (server-read cookie → no flash), shell, stepper.
5. Shared components; data, personas, simulation, results, report mode.
6. Tests (unit, component, integration, e2e); traceability; outcome report.

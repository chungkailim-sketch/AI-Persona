# Integration plan — TimesFM, MatrAIx persona infrastructure, TypeSafe System One

Date: 22 September 2026 · Project: CBGA Outlook 2027 · Status: phase 1 integrated and tested; phase 4 (personas and simulation) completed 22 September 2026

## 1. What this is

Three external sources were reviewed. Only the parts that are useful to this product, licensed for
commercial use, and consistent with its evidence rules were taken. Each has been built into the app
at the step where it does its job, measured on this project's own Mintel data, and wrapped in the
same rule the rest of the product follows: computed things are computed in code, simulated things
are labelled as simulated, and no external model can loosen a protection.

| Source | Taken | Not taken, and why |
|---|---|---|
| **TimesFM** (google-research/timesfm) | TimesFM 2.5 200M (Apache-2.0 weights) behind a sidecar service, used for **backtest evaluation**; classical baselines, rolling-origin backtests, MASE / sMAPE / pinball, quantile bands | TimesFM 3.0 weights (non-commercial licence; the sidecar refuses to load them). Covariates / XReg (no leakage-safe covariates in the data). Any forecast shown to a user without the PRD §24.8 gate passing |
| **MatrAIx-Persona-8B** (MIT code) | Categorical dimension schema, seeded forward sampling with pins, consistency rules as data with reject-and-redraw, stratified cells weighted by product of marginals with Hamilton (largest-remainder) quotas, calibration report, section-grouped budget-trimmed rendering | The Persona-1M / "8B" dataset (research-only licence; it is persona records, not model weights). Their dependency graph (mostly schema-assumed edges, which would inject unobserved correlations). The Docker/Harbor runtime |
| **TypeSafe System One** (Jev) | Calibrated yes/no, choice and score judgements used as **advisory second opinions** in three places | Any generation. Any use where a judgement could include a sensitive field, change a recorded stance or grade evidence |

## 2. What is now in the app, by workflow step

| Step | Feature | Where | Behaviour |
|---|---|---|---|
| 1 · Data | **Trends across waves** | Data page → "Trends across waves" panel; job `trend_analysis`; `src/forecast/*` | Builds one series per statement × response × segment from the long survey table (base rows such as `Sample` dropped, gaps never filled). Classifies each as rising / falling / no detectable change / untestable using two-proportion tests on published bases (design effect 1.5), Benjamini–Hochberg FDR 0.05 and a 3 pp practical threshold. Flags **one-step jumps** (≥75% of an ≥8 pp change in a single step) as likely methodology breaks |
| 1 · Data | **Forecast decision gate** | Same panel | Ten PRD §24.8 questions answered in code. When it refuses, the E-FC-01 wording is shown ("Forecasting isn't valid here: … We can show trend classification instead") as a designed outcome. Backtest table for four baselines, plus TimesFM when the sidecar is reachable. Forecasts are produced only if the gate passes, by the method that won the backtest, with bands from its own residuals (or TimesFM quantiles if approved and better) |
| 1 · Data | **Sensitive-field second opinion** | Ingestion stage `sensitive_detection`; `src/judge/checks.ts` | TypeSafe classifies field **names only** (never values). It can only add a flag: a flagged field starts excluded with the reason shown; a judge "NONE" never clears an in-code flag. Every opinion is stored in `JudgeCheck` |
| 2 · Brief | **Stimulus injection screen** | `addStimulus`; brief page badge | Stimulus text addressed to an AI evaluator is flagged for the author, never refused (it is already wrapped as untrusted content). Off by default until a DPA is in place |
| 3 · Personas | **Population sample** | Personas page → "Population sample"; `src/population/*` | From a cleared dataset's latest wave: mutually exclusive segments chosen automatically (overlapping bands such as 18-34 and roll-ups such as "Employed (full-time, part-time, or …)" removed), optional second group crossed by product of marginals, impossible cells removed, Hamilton quotas, seeded draws from each segment's observed answer distribution, calibration table, rendered example members, stated assumptions. Spec, quotas, calibration and examples are stored in `PopulationSample`; members are rebuilt from (version, spec, seed) |
| 4 · Simulate | **Stance / rationale consistency** | Orchestrator, after votes are recorded | One fan-out call per run. A confident (≥0.9) disagreement between a persona's stated stance and what its rationale argues becomes a run warning. The stance is never rewritten. Skipped for mock runs. Off by default until a DPA is in place |
| 5 · Results | **Weighted support** | Results overview metric card | Support with each persona weighted by its segment's share of the survey sample, labelled "weighted by survey-sample segment share, not census population" |
| Cross-cutting | Integration status, env, audit | `src/lib/env.ts`, settings, audit actions `dataset.trend.requested`, `population.sample.built` | New env: `TYPESAFE_API_KEY`, `TYPESAFE_MODEL` (jev-latest), `TYPESAFE_FEATURES` (default `sensitive`), `TIMESFM_URL`, `TIMESFM_TOKEN`, `TIMESFM_APPROVED` (default false). Keys are read server-side only and never shown |

## 3. Experiment results

### 3.1 TimesFM 2.5 against baselines on CBGA wave data

Design: 10,500 complete Mintel series (29 databooks; `All` and age groups; five semi-annual waves,
March 2024 – March 2026). Hold out the last wave (h=1) or last two (h=2); forecast from the waves before.
A seeded random sample was run on CPU (see `experiments/timesfm/results.json`).

Seeded random sample of 3,000 series (CPU, 2 vCPU; ~0.11 s per series).

| Horizon | Series | MAE TimesFM | MAE last wave | MAE seasonal naive | MAE history mean | MAE drift | TimesFM beats last wave | q10–q90 coverage (target 80%) | Mean band width | Median sampling SE of a share |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 wave | 3,000 | **2.38 pp** | 2.43 pp | 2.57 pp | 2.72 pp | 3.68 pp | 49% of series | 83% | 11.1 pp | 1.6 pp |
| 2 waves | 3,000 | 2.51 pp | **2.47 pp** | 2.68 pp | 3.10 pp | 6.63 pp | 50% of series | 79% | 15.2 pp | 1.6 pp |

On the `All` segment alone, TimesFM and last wave tie at h=1 (1.57 pp each) and last wave wins at h=2
(1.65 vs 1.81 pp). A 300-series pilot gave the same picture.

What it means:

- **TimesFM is not better than "last wave".** Its edge at h=1 is 0.05 pp — thirty times smaller than
  the sampling error of a single share (1.6 pp) — and it beats the naive forecast on a coin-flip 49% of
  series. At h=2 the naive forecast wins. Three or four waves of context are too few for any model to
  learn a series' dynamics.
- **Its bands are honest but uninformative.** The q10–q90 band covers 79–83% (close to the nominal 80%),
  but it is 11–15 pp wide: roughly seven times the survey's own sampling error, so it would not support
  any decision a trend test cannot.
- This is exactly what the gate predicts: with 5 points (8 needed) and 2 backtest origins (3 needed),
  forecasting is refused and trend classification is the honest answer. The app reproduces this for
  the demonstration data: on the US databook 2,684 series tested, 264 rising, 307 falling, 2,041 no
  detectable change, 72 untestable.
- **CBGA reaches 8 waves at the September 2027 wave.** From then the gate can pass on history; whether
  TimesFM or a baseline is used will be decided by the backtest, not by preference.

### 3.2 TypeSafe System One (jev-latest), over 100 calls, p50 ≈ 440 ms

| Exp. | Question | Result | Decision |
|---|---|---|---|
| E1 | Does evidence support / contradict / not address a claim? (36 templated claims from real series) | 36/36 raw numbers; 36/36 with numbers bucketed in code first | Not wired. The in-code claim check is already exact for templated claims; keep TypeSafe for free-text claims later (P2) |
| E1b | Near-boundary numeric claims (30) | 30/30 raw; 30/30 code-first; pure code rule 100% | Arithmetic stays in code |
| E2 | Which survey statements measure a hypothesis? (3 hypotheses × all statements, Score) | Correct top-1 for all three (e.g. "wellbeing" → "Maintaining good mental health…" 0.98; "value over brand" → "worth taking the time to compare products" 1.41) | Build as a construct-mapping suggestion in step 2 (P1) |
| E3 | Sensitive field from name + sample values (24) | 22/24; both misses over-flag (gender 0.42, supplement_use 0.70) | Values are client content — not wired |
| E3b | Sensitive field from **name only** (24) | 21/24, **zero false negatives**; misses: gender and supplement_use over-flagged, comments → PII instead of special category (still excluded) | **Wired** as the second opinion |
| — | In-code regex floor on the same 24 | 18/24; **5 false negatives** (eth, vote_2024, q12_other_specify, comments, prayer_frequency) | Floor + names-only judge together: 0 false negatives, 2 reviewer-resolvable over-flags |
| E4 | Injection aimed at an AI evaluator inside stimulus copy | Recall 1.0, false positive rate 0.0 (ordinary calls to action not flagged) | **Wired** (off by default) |
| E5 | Does a rationale argue confirm / dispute / abstain? (12, one call) | 12/12, 383 ms | **Wired** (off by default) |

### 3.3 Population sample on the US databook (March 2026, age × employment, n = 1,000–2,000, seed fixed)

- 6 age bands chosen from overlapping published bands; 4 employment segments after removing one roll-up;
  1 impossible cell removed (18-24 × Retired/pensioner); 0 redraws.
- Calibration: every one of the 12 statements within 0.5–3.5 pp of its target; sampling error alone at
  n = 2,000 is about 2.2 pp. Age marginal off by ~2 pp by design, because the impossible cell's share is
  redistributed.

### 3.4 A data finding the new tooling surfaced

Many of the largest "changes" in the US databook (e.g. "Financial comparison to a year ago — I'm a lot
better-off", −35 pp for 25-34) happen almost entirely between March and September 2024 and then stay
flat. That shape is typical of a questionnaire, translation, scale or panel change, not of consumer
change. The trend panel now labels these "one-step jump". **Before any CBGA claim cites a first-to-latest
change, check Mintel's methodology notes for the September 2024 wave.** Where a break is confirmed,
compare from September 2024 onwards.

## 4. What is missing, and where it belongs

Priority: **P0** before client data or a client-facing report; **P1** next build; **P2** later.

### Governance and operations (all stages)

| # | Item | Priority | Detail / acceptance |
|---|---|---|---|
| G1 | **Rotate the TypeSafe key** | P0 | The key was pasted into a chat. Issue a new one, store it only in the host's secret store (Railway variables), never in the repo. It was used here only as a per-command environment variable and was not written to any file |
| G2 | Data-processing agreement with TypeSafe; add as a sub-processor | P0 | Needed before `stimulus` or `stance` are enabled (they send client content). `sensitive` sends field names only; confirm with legal that schema is acceptable without a DPA |
| G3 | Governance notice names each processor | P0 | The "model processing permitted" permission was written for Anthropic. Extend the wording (and ideally a per-processor toggle) so a dataset owner consents to TypeSafe separately |
| G4 | Legal approval (U3) for TimesFM 2.5 weights | P1 | Apache-2.0; record the approval, then set `TIMESFM_APPROVED=true`. 3.0 stays refused |
| G5 | TimesFM sidecar on Railway | P1 | Dockerfile in `services/timesfm`. CPU service, ~1.5 GB RAM, a volume for the ~900 MB checkpoint, private networking, bearer token. Measured: ~0.11 s per series on 2 vCPU (3,000 series ≈ 5.5 min per horizon); a full 10k-series backtest is a batch job, not a request |
| G6 | Cost and rate limits for TypeSafe | P1 | ~700 input tokens per call; names-only check is one call per 40 fields. Add a per-project monthly cap beside the existing AI budget |

### Step 1 · Data

| # | Item | Priority | Detail / acceptance |
|---|---|---|---|
| D1 | Methodology-break handling | P1 | Let a reviewer mark a wave as a break for a question (stored on the version); trend tests then start after the break. Acceptance: US "financial comparison" series reclassified when Sept 2024 is marked |
| D2 | Live refresh when a trend job finishes | P2 | Panel listens for `forecast.gate.*` on the existing SSE stream instead of asking for a refresh |
| D3 | Multi-market comparison view | P2 | Same statement across the six markets, with the FDR applied across the comparison |
| D4 | Forecasts when the gate passes (from Sept 2027) | P2 | Already implemented end to end; needs a UI table/chart for the stored `forecasts` and a report section. Re-run the backtest at 8 waves to choose TimesFM vs baseline |

### Step 2 · Brief

| # | Item | Priority | Detail / acceptance |
|---|---|---|---|
| B1 | Construct-mapping suggestions (E2) | P1 | When a hypothesis is added, score it against the dataset's statements and suggest the top 3 with scores; the researcher accepts or rejects; the grade stays human. Advisory only |
| B2 | Enable stimulus screen | P1 | After G2/G3: set `TYPESAFE_FEATURES=sensitive,stimulus` |

### Step 3 · Personas

| # | Item | Priority | Detail / acceptance |
|---|---|---|---|
| P1 | Generate a cohort from a population sample | **Done** | Personas are the sample's largest cells, each carrying its segment's published answer distributions (OBSERVED, with base) instead of whole-sample figures; weight = cell share, split between repeats. The population is rebuilt from the stored spec and must reproduce the stored quotas exactly, or the cohort is refused |
| P2 | Joint structure when respondent-level data exists | P2 | Current draws are independent per statement (databooks publish marginals only — stated on screen). With a respondent file, sample whole rows (bootstrap within cell) so correlations are real |
| P3 | Census raking | P2 | Rake cells to census age/sex marginals from a cited source; label as "census-weighted" only then |
| P4 | Persona adherence contrast test (MatrAIx method) | **Done — live evaluation pending** | Built and tested (fixture providers: an agree-with-everything panel fails, an adherent one passes). With the mock provider it reports "not evaluated", never pass. On the US demo cohort it selects "I like to stand out from the crowd" (18-24: 82% agree vs 65+: 13%). Needs `MODEL_PROVIDER=anthropic` and a key to produce a real verdict |

### Step 4 · Simulate

| # | Item | Priority | Detail / acceptance |
|---|---|---|---|
| S1 | Enable and validate stance consistency on a live run | P1 (blocked: needs live model key + G2/G3) | After G2/G3. Acceptance: a live 12-persona run records 24 `JudgeCheck` rows; any confident mismatch appears as a run warning; stances unchanged |
| S2 | Population-scale runs | P2 | Run a few hundred sampled members through a cheap model tier and roll up with Wilson intervals (`wilson()` exists). Cost cap and anti-herding still apply |

### Step 5 · Results

| # | Item | Priority | Detail / acceptance |
|---|---|---|---|
| R1 | Trend context beside findings | P1 | For a finding whose construct maps to a tracked statement, show that statement's trend classification (and any one-step jump) next to it |
| R2 | Free-text claim support second opinion (E1) | P2 | Only for claims the templated in-code check cannot parse |
| R3 | Report sections for trend classification and population assumptions | P1 | Include in PDF/PPTX export with the gate record |

### Tests and documentation

| # | Item | Priority |
|---|---|---|
| T1 | Playwright e2e for the trend and population panels (including axe) | P1 |
| T2 | Contract test against TypeSafe with a real key in CI (nightly, secret-scoped) | P2 |
| T3 | Add these features to `docs/traceability.md` | P1 |

### Phase 4 completion notes (22 September 2026)

- **Net segments detected from bases.** Mintel prints nets beside their parts ("Not employed" = retired +
  homemaker + student + unemployed + other; "Employed" = full-time + part-time + self-employed). The
  population builder now keeps the finest set of segments whose bases add up to the whole sample (exact
  within 0.3%) and says what it left out. Before this, "Not employed" and "Retired/pensioner" were both
  sampled, double-counting retirees. A sample built under the old logic no longer reproduces and is
  refused when a cohort is made from it — rebuild it.
- **Crossing two groups is a strong assumption.** Without a published cross-tab, age × employment
  cells are products of marginals: the US demo gives "65+ × Employed" 12.5% of the population, which is
  not credible. Prefer stratifying on one group; cross only when the databook publishes the cross-tab
  (plan item P2/P3).
- Weighted support in step 5 now follows cell shares automatically for population cohorts.

## 5. Suggested sequence

1. **Now (done):** code, schema, UI, tests; TypeSafe names-only check on by default when a key is set.
2. **Before client use (P0):** G1 key rotation, G2 DPA, G3 governance wording.
3. **Next build (P1):** D1 break handling, B1 construct suggestions,
   live adherence verdicts (P4) and stance validation (S1) once a model key is configured, R1/R3 reporting, G4/G5 TimesFM approval and sidecar, T1/T3.
4. **September 2027 wave:** re-run the backtest at 8 waves; the gate decides whether forecasts appear (D4).

## 6. Verification performed

- Typecheck clean; production build succeeds.
- Full Vitest suite: all files pass, including new unit tests (forecast stats, gate, trends, step
  breaks, series extraction, Hamilton, band partitions, roll-ups, rules, sampler determinism,
  calibration, TypeSafe client with fixture transport, env) and a new integration file (trend job
  refusal and classification ignoring base rows; population refusal on uncleared data and success on
  cleared data with audit; judge flag excludes a field and sends names only; stimulus flagged but saved).
- Manual check on the demonstration project in light and dark themes: trend panel and population panel
  render with real data.
- Found and fixed during integration: Mintel `Sample` base rows were being read as shares (values up to
  100,000), which produced NaN p-values that broke the FDR ordering. Base rows are now excluded, shares
  outside 0–100 rejected, and the FDR treats a non-finite p as 1.

## 7. Configuration reference

```
TYPESAFE_API_KEY=            # secret store only
TYPESAFE_MODEL=jev-latest
TYPESAFE_FEATURES=sensitive  # add stimulus,stance after the DPA
TIMESFM_URL=                 # e.g. http://timesfm.railway.internal:8080
TIMESFM_TOKEN=
TIMESFM_APPROVED=false       # true only after legal + technical sign-off
```

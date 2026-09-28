'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { startDebateAction, type FormState } from '../actions';
import { Field, FormMessages, Select, SubmitButton, TextArea, TextInput } from '@/ui/forms';

// ── View model ────────────────────────────────────────────────────────────────

export interface DebateAgentView {
  key: string;
  name: string;
  kind: string;
  role: string;
  goal: string;
  backstory: string;
  segment?: string | null;
}

export interface EvidenceItemView {
  id: string;
  market: string;
  wave: string;
  questionId: string;
  statement: string;
  response: string;
  segment: string;
  share: number;
  base: number | null;
}

export interface ComparisonView {
  segments: [string, string];
  designEffect: number;
  fdr: number;
  higherA: number;
  higherB: number;
  noDifference: number;
  rows: { market: string; wave: string; statement: string; response: string; a: { segment: string; share: number; base: number }; b: { segment: string; share: number; base: number }; diffPp: number; p: number; significant: boolean }[];
}

export interface DebateTurnView {
  seq: number;
  round: number;
  phase: string;
  agentKey: string;
  agentName: string;
  agentRole: string;
  stance: string | null;
  confidence: number | null;
  addressedTo: string[];
  content: Record<string, unknown>;
  ok: boolean;
}

export interface DebateMetricsView {
  panelSize: number;
  openingStances: Record<string, number>;
  closingStances: Record<string, number>;
  movedAgents: string[];
  concessions: number;
  replacedHandoffs: number;
  citations: number;
  invalidCitations: number;
  citationValidity: number | null;
  entropy: number;
  capitulationRate: number;
  independentAgreement: number;
  finalAgreement: number;
  herdingSuspected: boolean;
  herdingInterpretation: string;
  bySegment: { key: string; name: string; segment: string | null; opening: string; closing: string; confidence: number }[];
}

export interface VerdictView {
  answer: string;
  conclusion: string;
  confidence: string;
  segmentFindings: { segment: string; assessment: string; evidenceIds: string[] }[];
  argumentsFor: string[];
  argumentsAgainst: string[];
  consensus: string[];
  dissent: string[];
  evidenceGaps: string[];
  recommendations: string[];
}

export interface DebateView {
  id: string;
  topic: string;
  hypothesis: string | null;
  status: string;
  phase: string | null;
  isMock: boolean;
  rounds: number;
  seed: number;
  cohortName: string;
  createdAt: string;
  completedAt: string | null;
  spendUsd: number;
  failureReason: string | null;
  agents: DebateAgentView[];
  evidence: {
    sources: { name: string; used: boolean; reason: string | null }[];
    items: EvidenceItemView[];
    focus: { requested: string; matched: string | null; note: string | null }[];
    comparison: ComparisonView | null;
    notes: string[];
    statements: { questionId: string; statement: string; score: number }[];
    statementsConsidered: number;
    simulation: string | null;
  } | null;
  metrics: DebateMetricsView | null;
  conclusion: { verdict: VerdictView | null; caveats: string[]; comparison: ComparisonView | null } | null;
  turns: DebateTurnView[];
}

// ── Form ──────────────────────────────────────────────────────────────────────

const empty: FormState = {};

export function DebateForm({
  projectId,
  cohorts,
  runs,
  hypotheses,
}: {
  projectId: string;
  cohorts: { id: string; name: string; approved: number }[];
  runs: { id: string; label: string }[];
  hypotheses: string[];
}) {
  const [state, action] = useActionState(startDebateAction, empty);
  return (
    <form action={action} className="flex flex-col gap-3" aria-label="Start a swarm debate">
      <input type="hidden" name="projectId" value={projectId} />
      <Field id="debate-topic" label="Topic or motion to debate" required hint="What the persona agents argue about. Phrase it as a question or a claim.">
        <TextArea
          id="debate-topic"
          name="topic"
          rows={3}
          required
          minLength={10}
          maxLength={1000}
          placeholder="e.g. Can advertising inside AI assistants such as ChatGPT be trusted, or will it be biased towards sponsored products?"
          aria-describedby="debate-topic-hint"
        />
      </Field>
      <Field id="debate-hypothesis" label="Hypothesis to test (optional)" hint="A falsifiable claim the verdict must rule on. Pick one from the brief or write your own.">
        <TextInput
          id="debate-hypothesis"
          name="hypothesis"
          list="debate-hypotheses"
          maxLength={1000}
          placeholder="e.g. 16-24s are more susceptible to AI advertising than 25-34s"
          aria-describedby="debate-hypothesis-hint"
        />
        <datalist id="debate-hypotheses">
          {hypotheses.map((h) => <option key={h} value={h} />)}
        </datalist>
      </Field>
      <Field id="debate-focus" label="Segments to compare (optional)" hint='Two segments, comma-separated. Age ranges are matched to the closest published break ("15-24" → "16-24") and the mapping is shown. Left blank, ranges in the topic are used.'>
        <TextInput id="debate-focus" name="focusSegments" placeholder="15-24, 25-34" aria-describedby="debate-focus-hint" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="debate-cohort" label="Persona cohort" required>
          <Select id="debate-cohort" name="cohortId" required defaultValue={cohorts[0]?.id}>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.approved} approved)</option>
            ))}
          </Select>
        </Field>
        <Field id="debate-rounds" label="Rebuttal rounds">
          <Select id="debate-rounds" name="rounds" defaultValue="2">
            <option value="1">1 — quick</option>
            <option value="2">2 — standard</option>
            <option value="3">3 — thorough</option>
          </Select>
        </Field>
      </div>
      <Field id="debate-run" label="Simulation context" hint="The swarm can read a completed simulation's synthesis, labelled as simulated.">
        <Select id="debate-run" name="contextRunId" defaultValue={runs[0]?.id ?? ''} aria-describedby="debate-run-hint">
          <option value="">None</option>
          {runs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
      </Field>
      <FormMessages state={state} />
      <div>
        <SubmitButton pendingLabel="Queuing the debate…">Run the swarm debate</SubmitButton>
      </div>
    </form>
  );
}

/** Refreshes the server-rendered view every few seconds while a debate is in progress. */
export function DebateAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

// ── Display ───────────────────────────────────────────────────────────────────

const STANCE_TONE: Record<string, string> = {
  support: 'border-ok/40 bg-ok-soft text-ok',
  oppose: 'border-danger/40 bg-danger-soft text-danger',
  undecided: 'border-line bg-pending-soft text-pending',
};
const ANSWER: Record<string, { label: string; tone: string }> = {
  supported: { label: 'Supported', tone: 'border-ok/40 bg-ok-soft text-ok' },
  not_supported: { label: 'Not supported', tone: 'border-danger/40 bg-danger-soft text-danger' },
  mixed: { label: 'Mixed', tone: 'border-warn/40 bg-warn-soft text-warn' },
  insufficient_evidence: { label: 'Insufficient evidence', tone: 'border-line bg-pending-soft text-pending' },
};
const PHASE_LABEL: Record<string, string> = {
  FRAMING: 'Framing',
  OPENING: 'Opening statements (given in isolation)',
  EVIDENCE_REVIEW: 'Evidence review',
  MODERATION: 'Moderator handoff',
  REBUTTAL: 'Rebuttals',
  CHALLENGE: "Devil's advocate",
  CLOSING: 'Closing statements',
  VERDICT: 'Verdict',
};

function Stance({ stance }: { stance: string | null }) {
  if (!stance) return null;
  return <span className={`rounded-sm border px-1.5 font-mono text-[10px] uppercase ${STANCE_TONE[stance] ?? ''}`}>{stance}</span>;
}

function Evidence({ ids, items }: { ids: unknown; items: Map<string, EvidenceItemView> }) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {(ids as string[]).map((id) => {
        const e = items.get(id);
        return (
          <span
            key={id}
            className="cursor-help rounded-sm border border-info/40 bg-info-soft px-1 font-mono text-[10px] text-info"
            title={e ? `${e.market}, ${e.wave} · ${e.questionId} "${e.statement}" → "${e.response}": ${e.segment} ${e.share}%${e.base ? ` (base ${e.base})` : ''}` : id}
          >
            {id}
          </span>
        );
      })}
    </span>
  );
}

function List({ title, items, tone = 'bg-ink-subtle' }: { title: string; items: string[]; tone?: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h5 className="text-xs font-medium text-ink">{title}</h5>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((x) => (
          <li key={x} className="flex gap-2 text-xs text-ink-muted"><span aria-hidden className={`mt-[6px] h-1 w-1 shrink-0 rounded-full ${tone}`} />{x}</li>
        ))}
      </ul>
    </div>
  );
}

function turnText(t: DebateTurnView): string {
  const c = t.content;
  if (!t.ok) return `No valid answer (${String(c.error ?? 'error')}). Nothing from this turn was used.`;
  for (const k of ['argument', 'rebuttal', 'challenge', 'finalArgument', 'summary', 'conclusion', 'focus', 'motion']) {
    if (typeof c[k] === 'string') return c[k] as string;
  }
  return '';
}

function Comparison({ c }: { c: ComparisonView }) {
  const rows = [...c.rows].sort((x, y) => x.p - y.p).slice(0, 30);
  return (
    <div>
      <h4 className="text-sm font-medium text-ink">What the data says — {c.segments[0]} vs {c.segments[1]}</h4>
      <p className="text-xs text-ink-subtle">
        Computed in code, not by a model: two-proportion test on the published bases (design effect {c.designEffect}, false-discovery rate {c.fdr}) for every
        relevant figure both segments answered in the latest wave.
      </p>
      <ul className="mt-2 flex flex-wrap gap-2 text-[11px]">
        <li className="rounded-sm border border-line px-2 py-0.5 font-mono">{c.segments[0]} higher: {c.higherA}</li>
        <li className="rounded-sm border border-line px-2 py-0.5 font-mono">{c.segments[1]} higher: {c.higherB}</li>
        <li className="rounded-sm border border-line px-2 py-0.5 font-mono">No detectable difference: {c.noDifference}</li>
      </ul>
      {rows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-ink-subtle">
              <tr>
                <th className="py-1 pr-3 font-normal">Statement → response</th>
                <th className="py-1 pr-3 font-normal">Market</th>
                <th className="py-1 pr-3 font-normal">{c.segments[0]}</th>
                <th className="py-1 pr-3 font-normal">{c.segments[1]}</th>
                <th className="py-1 pr-3 font-normal">Diff (pp)</th>
                <th className="py-1 font-normal">p</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="max-w-[26rem] py-1 pr-3 text-ink">{r.statement} → <span className="text-ink-muted">{r.response}</span></td>
                  <td className="py-1 pr-3 text-ink-muted">{r.market}, {r.wave}</td>
                  <td className="py-1 pr-3 font-mono">{r.a.share}% <span className="text-ink-subtle">n={r.a.base}</span></td>
                  <td className="py-1 pr-3 font-mono">{r.b.share}% <span className="text-ink-subtle">n={r.b.base}</span></td>
                  <td className="py-1 pr-3 font-mono">{r.diffPp > 0 ? '+' : ''}{r.diffPp}</td>
                  <td className="py-1 font-mono">
                    {r.p}
                    {r.significant && <span className="ml-1 rounded-sm border border-ok/40 bg-ok-soft px-1 text-[10px] text-ok">significant</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DebateDetail({ debate }: { debate: DebateView }) {
  const items = new Map((debate.evidence?.items ?? []).map((e) => [e.id, e]));
  const running = debate.status === 'QUEUED' || debate.status === 'RUNNING';
  const verdict = debate.conclusion?.verdict ?? null;
  const comparison = debate.conclusion?.comparison ?? debate.evidence?.comparison ?? null;
  const m = debate.metrics;

  // Group the transcript by phase and round, in the order it happened.
  const groups: { key: string; label: string; turns: DebateTurnView[] }[] = [];
  for (const t of debate.turns) {
    const key = `${t.phase}:${t.round}`;
    const label = `${PHASE_LABEL[t.phase] ?? t.phase}${t.round ? ` — round ${t.round}` : ''}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.turns.push(t);
    else groups.push({ key, label, turns: [t] });
  }

  return (
    <article className="flex flex-col gap-5" data-debate-status={debate.status}>
      <DebateAutoRefresh active={running} />
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm border border-line px-1.5 font-mono text-[10px] uppercase text-ink-muted">{debate.status.toLowerCase()}</span>
          {debate.isMock && <span className="rounded-sm border border-warn/40 bg-warn-soft px-1.5 font-mono text-[10px] uppercase text-warn">mock provider</span>}
          <span className="font-mono text-[10.5px] text-ink-subtle">
            {debate.cohortName} · {debate.rounds} round(s) · seed {debate.seed} · {debate.createdAt.slice(0, 16).replace('T', ' ')} UTC
            {debate.spendUsd > 0 && ` · $${debate.spendUsd.toFixed(3)}`}
          </span>
        </div>
        <h3 className="text-base text-ink">{debate.topic}</h3>
        {debate.hypothesis && <p className="text-sm text-ink-muted">Hypothesis: {debate.hypothesis}</p>}
      </header>

      {running && (
        <p role="status" className="rounded border border-info/40 bg-info-soft px-3 py-2 text-sm text-ink">
          Debate {debate.status === 'QUEUED' ? 'queued — waiting for the worker' : `in progress: ${(PHASE_LABEL[(debate.phase ?? '').split(':')[0]!] ?? debate.phase ?? 'starting').toLowerCase()}${debate.phase?.includes(':') ? `, round ${debate.phase.split(':')[1]}` : ''}`}.
          {' '}{debate.turns.length} turn(s) so far. This page updates on its own.
        </p>
      )}
      {debate.status === 'FAILED' && (
        <p role="alert" className="rounded border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{debate.failureReason ?? 'The debate failed.'}</p>
      )}

      {/* Reference conclusion */}
      {debate.status === 'COMPLETED' && (
        <section aria-label="Reference conclusion" className="panel px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-ink">Reference conclusion</h4>
            {verdict && (
              <>
                <span className={`rounded-sm border px-1.5 font-mono text-[10.5px] uppercase ${ANSWER[verdict.answer]?.tone ?? ''}`}>{ANSWER[verdict.answer]?.label ?? verdict.answer}</span>
                <span className="font-mono text-[10.5px] text-ink-subtle">confidence {verdict.confidence}</span>
              </>
            )}
          </div>
          {verdict ? (
            <div className="mt-2 flex flex-col gap-3">
              <p className="text-sm text-ink">{verdict.conclusion}</p>
              {verdict.segmentFindings.length > 0 && (
                <ul className="grid gap-2 md:grid-cols-2">
                  {verdict.segmentFindings.map((s) => (
                    <li key={s.segment} className="rounded border border-line bg-surface px-3 py-2">
                      <p className="text-xs font-medium text-ink">{s.segment}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{s.assessment}</p>
                      <div className="mt-1"><Evidence ids={s.evidenceIds} items={items} /></div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <List title="Arguments for" items={verdict.argumentsFor} tone="bg-ok" />
                <List title="Arguments against" items={verdict.argumentsAgainst} tone="bg-danger" />
                <List title="Where the panel agreed" items={verdict.consensus} />
                <List title="Recorded dissent" items={verdict.dissent} tone="bg-warn" />
                <List title="What the evidence cannot answer" items={verdict.evidenceGaps} tone="bg-warn" />
                <List title="Recommendations" items={verdict.recommendations} tone="bg-brand" />
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">The judge produced no valid verdict. The data comparison and the transcript below still stand.</p>
          )}
          {(debate.conclusion?.caveats ?? []).length > 0 && (
            <div className="mt-3 rounded border border-warn/40 bg-warn-soft/40 px-3 py-2">
              <List title="Read this before quoting the conclusion" items={debate.conclusion!.caveats} tone="bg-warn" />
            </div>
          )}
        </section>
      )}

      {comparison && <Comparison c={comparison} />}
      {debate.evidence && debate.evidence.focus.some((f) => f.note) && (
        <ul className="flex flex-col gap-1">
          {debate.evidence.focus.filter((f) => f.note).map((f) => <li key={f.requested} className="text-xs text-ink-muted">{f.note}</li>)}
        </ul>
      )}

      {/* Movement */}
      {m && (
        <section aria-label="How positions moved">
          <h4 className="text-sm font-medium text-ink">How positions moved</h4>
          <p className="text-xs text-ink-subtle">{m.herdingInterpretation}</p>
          <ul className="mt-2 flex flex-wrap gap-2 font-mono text-[11px]">
            <li className="rounded-sm border border-line px-2 py-0.5">opening {Object.entries(m.openingStances).map(([k, v]) => `${k} ${v}`).join(' · ')}</li>
            <li className="rounded-sm border border-line px-2 py-0.5">closing {Object.entries(m.closingStances).map(([k, v]) => `${k} ${v}`).join(' · ')}</li>
            <li className="rounded-sm border border-line px-2 py-0.5">entropy {m.entropy.toFixed(2)}</li>
            <li className="rounded-sm border border-line px-2 py-0.5">capitulation {m.capitulationRate.toFixed(2)}</li>
            <li className="rounded-sm border border-line px-2 py-0.5">concessions {m.concessions}</li>
            <li className="rounded-sm border border-line px-2 py-0.5">citations valid {m.citationValidity === null ? '—' : `${Math.round(m.citationValidity * 100)}%`}</li>
            {m.herdingSuspected && <li className="rounded-sm border border-warn/40 bg-warn-soft px-2 py-0.5 text-warn">herding suspected</li>}
          </ul>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink-subtle"><tr><th className="py-1 pr-3 font-normal">Agent</th><th className="py-1 pr-3 font-normal">Segment</th><th className="py-1 pr-3 font-normal">Opening</th><th className="py-1 pr-3 font-normal">Closing</th><th className="py-1 font-normal">Confidence</th></tr></thead>
              <tbody>
                {m.bySegment.map((s) => (
                  <tr key={s.key} className="border-t border-line">
                    <td className="py-1 pr-3 text-ink"><span className="font-mono text-ink-subtle">{s.key}</span> {s.name}</td>
                    <td className="py-1 pr-3 text-ink-muted">{s.segment ?? '—'}</td>
                    <td className="py-1 pr-3"><Stance stance={s.opening} /></td>
                    <td className="py-1 pr-3"><Stance stance={s.closing} />{s.opening !== s.closing && <span className="ml-1 text-[10px] text-ink-subtle">moved</span>}</td>
                    <td className="py-1 font-mono text-ink-muted">{s.confidence.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* The crew */}
      {debate.agents.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-brand">The crew — {debate.agents.length} agents with their role, goal and backstory</summary>
          <ul className="mt-2 grid gap-2 md:grid-cols-2">
            {debate.agents.map((a) => (
              <li key={a.key} className="rounded border border-line bg-surface px-3 py-2">
                <p className="text-xs text-ink"><span className="font-mono text-ink-subtle">{a.key}</span> <span className="font-medium">{a.name}</span> <span className="text-ink-muted">— {a.role}</span></p>
                <p className="mt-1 text-[11px] text-ink-muted"><span className="text-ink-subtle">Goal:</span> {a.goal}</p>
                <p className="mt-0.5 line-clamp-3 text-[11px] text-ink-muted"><span className="text-ink-subtle">Backstory:</span> {a.backstory}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Transcript */}
      {groups.length > 0 && (
        <section aria-label="Debate transcript">
          <h4 className="text-sm font-medium text-ink">Transcript</h4>
          <ol className="mt-2 flex flex-col gap-4">
            {groups.map((g) => (
              <li key={g.key}>
                <h5 className="font-mono text-[10.5px] uppercase tracking-wide text-ink-subtle">{g.label}</h5>
                <ul className="mt-1.5 flex flex-col gap-2">
                  {g.turns.map((t) => {
                    const handoffs = Array.isArray(t.content.handoffs) ? (t.content.handoffs as { agentKey: string; respondTo: string }[]) : [];
                    return (
                      <li key={t.seq} className={`rounded border px-3 py-2 ${t.ok ? 'border-line bg-surface' : 'border-danger/30 bg-danger-soft/40'}`} data-phase={t.phase}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10.5px] text-ink-subtle">{t.agentKey}</span>
                          <span className="text-xs font-medium text-ink">{t.agentName}</span>
                          <Stance stance={t.stance} />
                          {t.confidence !== null && <span className="font-mono text-[10px] text-ink-subtle">{t.confidence.toFixed(2)}</span>}
                          {t.content.concedes === true && <span className="rounded-sm border border-info/40 bg-info-soft px-1.5 font-mono text-[10px] text-info">concedes</span>}
                          {t.phase === 'REBUTTAL' && t.addressedTo[0] && <span className="text-[11px] text-ink-subtle">→ answering {t.addressedTo[0]}</span>}
                          {t.content.changed === true && <span className="rounded-sm border border-warn/40 bg-warn-soft px-1.5 font-mono text-[10px] text-warn">moved</span>}
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">{turnText(t)}</p>
                        {handoffs.length > 0 && (
                          <p className="mt-1 text-[11px] text-ink-subtle">
                            Floor handed to: {handoffs.map((h) => `${h.agentKey} (answering ${h.respondTo})`).join(', ')}
                            {t.content.replaced === true && ` — ${String(t.content.reason ?? 'replaced')}`}
                          </p>
                        )}
                        {typeof t.content.reason === 'string' && t.phase === 'CLOSING' && <p className="mt-1 text-[11px] text-ink-subtle">Why: {t.content.reason}</p>}
                        {typeof t.content.alternativeExplanation === 'string' && <p className="mt-1 text-[11px] text-ink-subtle">Alternative explanation: {t.content.alternativeExplanation}</p>}
                        <div className="mt-1"><Evidence ids={t.content.evidenceIds ?? t.content.strongestEvidenceIds} items={items} /></div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Evidence */}
      {debate.evidence && (
        <details>
          <summary className="cursor-pointer text-xs text-brand">
            Evidence the swarm was shown — {debate.evidence.items.length} figure(s) from {debate.evidence.statements.length} relevant statement(s) of {debate.evidence.statementsConsidered.toLocaleString()}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {debate.evidence.sources.map((s) => (
              <li key={s.name} className="text-xs text-ink-muted">{s.used ? '✓' : '—'} {s.name}{s.reason ? `: ${s.reason}` : ''}</li>
            ))}
            {debate.evidence.notes.map((n) => <li key={n} className="text-xs text-warn">{n}</li>)}
          </ul>
          {debate.evidence.items.length > 0 && (
            <div className="mt-2 max-h-96 overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-bg text-ink-subtle"><tr><th className="py-1 pr-2 font-normal">Id</th><th className="py-1 pr-2 font-normal">Market, wave</th><th className="py-1 pr-2 font-normal">Statement → response</th><th className="py-1 pr-2 font-normal">Segment</th><th className="py-1 font-normal">Share</th></tr></thead>
                <tbody>
                  {debate.evidence.items.map((e) => (
                    <tr key={e.id} className="border-t border-line align-top">
                      <td className="py-1 pr-2 font-mono text-info">{e.id}</td>
                      <td className="py-1 pr-2 text-ink-muted">{e.market}, {e.wave}</td>
                      <td className="max-w-[28rem] py-1 pr-2 text-ink">{e.questionId} {e.statement} → <span className="text-ink-muted">{e.response}</span></td>
                      <td className="py-1 pr-2 text-ink-muted">{e.segment}</td>
                      <td className="py-1 font-mono">{e.share}%{e.base ? <span className="text-ink-subtle"> n={e.base}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {debate.evidence.simulation && (
            <pre className="mt-2 whitespace-pre-wrap rounded border border-line bg-code p-2 font-mono text-[10.5px] text-ink"><span className="text-simulated">SIMULATION CONTEXT · simulated, not evidence</span>{'\n'}{debate.evidence.simulation}</pre>
          )}
        </details>
      )}
    </article>
  );
}

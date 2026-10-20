'use client';

/**
 * What a strategist can do with a completed debate: put one question to the whole panel, have a
 * market-entry communications strategy written from it, and meet and interview the persona agents.
 * Everything runs on the worker; the page refreshes until queued work is done.
 */
import { useActionState, useState } from 'react';
import { debateInsightAction, type FormState } from '../actions';
import { Field, FormMessages, Select, SubmitButton, TextArea, TextInput } from '@/ui/forms';
import { PagerControls, usePage } from '@/ui/Pager';
import { fmtDateTime } from '@/lib/time';
import { DebateAutoRefresh } from './DebatePanel';

export interface InsightArtifactView {
  id: string;
  kind: 'PANEL_QUESTION' | 'COMMS_REPORT' | 'SELF_INTRO' | 'INTERVIEW';
  agentKey: string | null;
  prompt: string | null;
  status: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any;
  failureReason: string | null;
  createdAt: string;
}

export interface InsightPersonaView {
  key: string;
  name: string;
  segment: string | null;
}

const LIKELIHOOD_LABEL: Record<string, string> = { very_likely: 'Very likely', likely: 'Likely', unlikely: 'Unlikely', would_not: 'Would not' };
const DEFAULT_QUESTION = 'In the next one year, which categories would you (as a consumer) be willing to try a Chinese brand in?';
const DEFAULT_CATEGORIES = [
  'Smartphones & consumer electronics',
  'Electric vehicles & cars',
  'Home appliances',
  'Beauty & personal care',
  'Fashion & apparel',
  'Food & beverage',
  'Online shopping platforms',
  'Gaming & entertainment apps',
  'Travel & hospitality',
  'Financial services & payments',
  'Health & wellness products',
  'Toys & hobbies',
];

const empty: FormState = {};
type Tab = 'panel' | 'report' | 'personas';

export function DebateInsights({
  projectId,
  debateId,
  canRun,
  completed,
  isMock,
  personas,
  artifacts,
}: {
  projectId: string;
  debateId: string;
  canRun: boolean;
  completed: boolean;
  isMock: boolean;
  personas: InsightPersonaView[];
  artifacts: InsightArtifactView[];
}) {
  const [tab, setTab] = useState<Tab>('panel');
  const pending = artifacts.some((a) => a.status === 'QUEUED' || a.status === 'RUNNING');

  if (!completed) {
    return (
      <p className="rounded border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
        When this debate completes you can put questions to the panel, generate a communications strategy report, and interview the personas here.
      </p>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'panel', label: 'Ask the panel' },
    { key: 'report', label: 'Communications strategy report' },
    { key: 'personas', label: 'Meet and interview the personas' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DebateAutoRefresh active={pending} />
      {isMock && (
        <p className="rounded border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-warn">
          This debate ran on the mock provider, so anything made from it is placeholder text.
        </p>
      )}
      <div role="tablist" aria-label="Use this debate" className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${tab === t.key ? 'border-brand text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'panel' && <PanelTab projectId={projectId} debateId={debateId} canRun={canRun} artifacts={artifacts.filter((a) => a.kind === 'PANEL_QUESTION')} />}
      {tab === 'report' && <ReportTab projectId={projectId} debateId={debateId} canRun={canRun} artifacts={artifacts.filter((a) => a.kind === 'COMMS_REPORT')} />}
      {tab === 'personas' && <PersonaTab projectId={projectId} debateId={debateId} canRun={canRun} personas={personas} artifacts={artifacts} />}
    </div>
  );
}

function Hidden({ projectId, debateId, kind }: { projectId: string; debateId: string; kind: string }) {
  return (
    <>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="debateId" value={debateId} />
      <input type="hidden" name="kind" value={kind} />
    </>
  );
}

function Status({ a }: { a: InsightArtifactView }) {
  if (a.status === 'FAILED') return <p className="rounded border border-danger/30 bg-danger-soft/40 px-3 py-2 text-xs text-danger">{a.failureReason ?? 'This could not be completed.'}</p>;
  if (a.status !== 'COMPLETED') return <p className="text-xs text-ink-muted">{a.status === 'RUNNING' ? 'Working…' : 'Queued…'}</p>;
  return null;
}

function Ids({ ids }: { ids?: string[] }) {
  if (!ids?.length) return null;
  return <span className="ml-1 font-mono text-[10px] text-ink-subtle">[{ids.join(', ')}]</span>;
}

// ── Ask the panel ─────────────────────────────────────────────────────────────

function PanelTab({ projectId, debateId, canRun, artifacts }: { projectId: string; debateId: string; canRun: boolean; artifacts: InsightArtifactView[] }) {
  const [state, action] = useActionState(debateInsightAction, empty);
  const [selected, setSelected] = useState<string | null>(null);
  const shown = artifacts.find((a) => a.id === selected) ?? artifacts[artifacts.length - 1] ?? null;
  return (
    <div className="flex flex-col gap-4">
      {canRun && (
        <form action={action} className="panel flex flex-col gap-3 px-3.5 py-3" aria-label="Ask the panel">
          <Hidden projectId={projectId} debateId={debateId} kind="PANEL_QUESTION" />
          <Field id="panel-q" label="Question for every persona" required hint="Each persona agent answers alone, from the historical data and what it said in the debate.">
            <TextArea id="panel-q" name="prompt" defaultValue={DEFAULT_QUESTION} rows={2} required />
          </Field>
          <Field id="panel-cats" label="Categories to rate" hint="One per line. Personas rate each one so answers can be counted; they may add up to two of their own.">
            <TextArea id="panel-cats" name="categories" defaultValue={DEFAULT_CATEGORIES.join('\n')} rows={5} />
          </Field>
          <SubmitButton pendingLabel="Queuing…">Ask the panel</SubmitButton>
          <FormMessages state={state} />
        </form>
      )}
      {artifacts.length > 1 && (
        <Field id="panel-history" label="Earlier questions">
          <Select id="panel-history" value={shown?.id ?? ''} onChange={(e) => setSelected(e.target.value)}>
            {artifacts.map((a) => (
              <option key={a.id} value={a.id}>{`${fmtDateTime(a.createdAt)} · ${(a.prompt ?? '').slice(0, 80)}`}</option>
            ))}
          </Select>
        </Field>
      )}
      {shown ? <PanelResult a={shown} /> : <p className="text-sm text-ink-muted">No question has been put to the panel yet.</p>}
    </div>
  );
}

interface Tally {
  category: string;
  counts: Record<string, number>;
  willingShare: number;
  byMarket: { market: string; willing: number; answered: number }[];
}

function PanelResult({ a }: { a: InsightArtifactView }) {
  const c = a.content as { question: string; answers: Record<string, unknown>[]; tally: Tally[] } | null;
  const answers = c?.answers ?? [];
  const page = usePage(answers.length);
  if (a.status !== 'COMPLETED' || !c) return <Status a={a} />;
  const answered = answers.filter((x) => x.ok).length;
  const markets = c.tally[0]?.byMarket.map((m) => m.market) ?? [];
  return (
    <section className="flex flex-col gap-3" aria-label="Panel answers">
      <h4 className="text-sm font-medium text-ink">{c.question}</h4>
      <p className="text-xs text-ink-subtle">
        {answered} of {answers.length} personas answered. &ldquo;Willing&rdquo; counts very likely and likely, as a share of personas that answered.
        Counted in code from the personas&rsquo; ratings; the personas are simulations of published segments, not respondents.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-ink-subtle">
            <tr>
              <th className="py-1 pr-3 font-normal">Category</th>
              <th className="py-1 pr-3 font-normal">Willing</th>
              <th className="py-1 pr-3 font-normal">Very likely</th>
              <th className="py-1 pr-3 font-normal">Likely</th>
              <th className="py-1 pr-3 font-normal">Unlikely</th>
              <th className="py-1 pr-3 font-normal">Would not</th>
              {markets.map((m) => <th key={m} className="py-1 pr-3 font-normal">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {c.tally.map((t) => (
              <tr key={t.category} className="border-t border-line">
                <td className="py-1.5 pr-3 text-ink">{t.category}</td>
                <td className="py-1.5 pr-3">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-1.5 w-16 rounded bg-line"><span className="block h-1.5 rounded bg-brand" style={{ width: `${Math.round(t.willingShare * 100)}%` }} /></span>
                    <span className="font-mono">{Math.round(t.willingShare * 100)}%</span>
                  </span>
                </td>
                <td className="py-1.5 pr-3 font-mono">{t.counts.very_likely}</td>
                <td className="py-1.5 pr-3 font-mono">{t.counts.likely}</td>
                <td className="py-1.5 pr-3 font-mono">{t.counts.unlikely}</td>
                <td className="py-1.5 pr-3 font-mono">{t.counts.would_not}</td>
                {t.byMarket.map((m) => <td key={m.market} className="py-1.5 pr-3 font-mono">{`${m.willing}/${m.answered}`}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h4 className="mt-2 text-sm font-medium text-ink">What each persona said</h4>
      <ul className="flex flex-col gap-2">
        {answers.slice(page.start, page.end).map((x) => (
          <li key={String(x.agentKey)} className="rounded border border-line bg-surface px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[10.5px] text-ink-subtle">{String(x.agentKey)}</span>
              <span className="text-xs font-medium text-ink">{String(x.name)}</span>
              {typeof x.confidence === 'number' && <span className="font-mono text-[10px] text-ink-subtle">confidence {x.confidence.toFixed(2)}</span>}
            </div>
            {x.ok ? (
              <>
                <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">{String(x.answer)}</p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {(x.categories as { category: string; likelihood: string; reason: string; evidenceIds: string[] }[]).map((k) => (
                    <li key={k.category} title={k.reason} className="rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-ink-muted">
                      {k.category}: {LIKELIHOOD_LABEL[k.likelihood] ?? k.likelihood}
                      <Ids ids={k.evidenceIds} />
                    </li>
                  ))}
                </ul>
                {(x.conditions as string[]).length > 0 && <p className="mt-1 text-[11px] text-ink-subtle">Would try if: {(x.conditions as string[]).join('; ')}</p>}
                {(x.barriers as string[]).length > 0 && <p className="mt-0.5 text-[11px] text-ink-subtle">Barriers: {(x.barriers as string[]).join('; ')}</p>}
              </>
            ) : (
              <p className="mt-1 text-xs text-danger">No answer ({String(x.outcome)}).</p>
            )}
          </li>
        ))}
      </ul>
      <PagerControls {...page} total={answers.length} />
    </section>
  );
}

// ── Communications strategy report ────────────────────────────────────────────

function ReportTab({ projectId, debateId, canRun, artifacts }: { projectId: string; debateId: string; canRun: boolean; artifacts: InsightArtifactView[] }) {
  const [state, action] = useActionState(debateInsightAction, empty);
  const latest = artifacts[artifacts.length - 1] ?? null;
  return (
    <div className="flex flex-col gap-4">
      {canRun && (
        <form action={action} className="panel flex flex-col gap-3 px-3.5 py-3" aria-label="Generate a communications strategy report">
          <Hidden projectId={projectId} debateId={debateId} kind="COMMS_REPORT" />
          <p className="text-xs text-ink-subtle">
            A strategist agent writes a market-entry PR and communications strategy from this focus group: the verdict, each persona&rsquo;s final
            position, the latest panel question results, and the evidence. Ask the panel first for a richer report.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="r-brand" label="Brand"><TextInput id="r-brand" name="brand" placeholder="e.g. a Chinese consumer electronics brand" /></Field>
            <Field id="r-cat" label="Category or product"><TextInput id="r-cat" name="category" placeholder="e.g. smartphones" /></Field>
            <Field id="r-mkts" label="Target markets"><TextInput id="r-mkts" name="markets" placeholder="e.g. Indonesia, Mexico" /></Field>
            <Field id="r-obj" label="Business objective"><TextInput id="r-obj" name="objective" placeholder="e.g. build trust ahead of 2027 launch" /></Field>
          </div>
          <Field id="r-brief" label="Anything else the strategist should know"><TextArea id="r-brief" name="prompt" rows={2} /></Field>
          <SubmitButton pendingLabel="Queuing…">Generate report</SubmitButton>
          <FormMessages state={state} />
        </form>
      )}
      {latest ? <ReportView projectId={projectId} debateId={debateId} a={latest} /> : <p className="text-sm text-ink-muted">No report has been generated yet.</p>}
    </div>
  );
}

function ReportView({ projectId, debateId, a }: { projectId: string; debateId: string; a: InsightArtifactView }) {
  if (a.status !== 'COMPLETED' || !a.content) return <Status a={a} />;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = a.content as any;
  const H = ({ children }: { children: React.ReactNode }) => <h5 className="mt-4 text-sm font-medium text-ink">{children}</h5>;
  return (
    <article className="panel px-4 py-4 text-sm text-ink-muted">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className="text-base text-ink">{r.title}</h4>
        <a className="rounded border border-line px-2 py-1 text-xs text-ink hover:border-brand" href={`/api/projects/${projectId}/debates/${debateId}/artifacts/${a.id}`}>
          Download (Markdown)
        </a>
      </div>
      <p className="mt-1 font-mono text-[10.5px] text-ink-subtle">{fmtDateTime(a.createdAt)} · from a simulated focus group</p>
      <H>Executive summary</H>
      <p className="mt-1 whitespace-pre-wrap">{r.executiveSummary}</p>
      {r.situation && (<><H>Situation</H><p className="mt-1 whitespace-pre-wrap">{r.situation}</p></>)}
      {r.objectives?.length > 0 && (<><H>Objectives</H><ul className="mt-1 list-disc pl-5">{r.objectives.map((o: string) => <li key={o}>{o}</li>)}</ul></>)}
      {r.audienceInsights?.length > 0 && (
        <>
          <H>Audience insights</H>
          <ul className="mt-1 flex flex-col gap-1.5">
            {r.audienceInsights.map((x: { segment: string; insight: string; implication: string; evidenceIds: string[] }, i: number) => (
              <li key={i}><span className="font-medium text-ink">{x.segment}</span> — {x.insight} <em>Implication:</em> {x.implication}<Ids ids={x.evidenceIds} /></li>
            ))}
          </ul>
        </>
      )}
      {r.positioning && (<><H>Positioning</H><p className="mt-1 whitespace-pre-wrap">{r.positioning}</p></>)}
      {r.keyMessages?.length > 0 && (
        <>
          <H>Key messages</H>
          <ul className="mt-1 flex flex-col gap-1.5">
            {r.keyMessages.map((m: { message: string; audience: string; proofPoints: string[] }, i: number) => (
              <li key={i}><span className="font-medium text-ink">{m.message}</span> <span className="text-ink-subtle">({m.audience})</span>
                {m.proofPoints.length > 0 && <ul className="list-disc pl-5 text-xs">{m.proofPoints.map((p) => <li key={p}>{p}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </>
      )}
      {r.channels?.length > 0 && (
        <>
          <H>Channels</H>
          <ul className="mt-1 flex flex-col gap-1">{r.channels.map((c: { channel: string; role: string; rationale: string }, i: number) => <li key={i}><span className="font-medium text-ink">{c.channel}</span> — {c.role} {c.rationale}</li>)}</ul>
        </>
      )}
      {r.voices?.length > 0 && (
        <>
          <H>Voices and spokespeople</H>
          <ul className="mt-1 flex flex-col gap-1">{r.voices.map((v: { voice: string; why: string }, i: number) => <li key={i}><span className="font-medium text-ink">{v.voice}</span> — {v.why}</li>)}</ul>
        </>
      )}
      {r.phasedPlan?.length > 0 && (
        <>
          <H>Phased plan</H>
          <ol className="mt-1 flex flex-col gap-2">
            {r.phasedPlan.map((p: { phase: string; timing: string; objective: string; activities: string[] }, i: number) => (
              <li key={i}><span className="font-medium text-ink">{p.phase}</span> <span className="text-ink-subtle">({p.timing})</span> — {p.objective}
                <ul className="list-disc pl-5 text-xs">{p.activities.map((x) => <li key={x}>{x}</li>)}</ul>
              </li>
            ))}
          </ol>
        </>
      )}
      {r.risks?.length > 0 && (
        <>
          <H>Risks and issues</H>
          <ul className="mt-1 flex flex-col gap-1">{r.risks.map((x: { risk: string; likelihood: string; mitigation: string }, i: number) => <li key={i}><span className="font-medium text-ink">{x.risk}</span> <span className="font-mono text-[10px]">{x.likelihood}</span> — {x.mitigation}</li>)}</ul>
        </>
      )}
      {r.kpis?.length > 0 && (
        <>
          <H>Measures of success</H>
          <ul className="mt-1 flex flex-col gap-1">{r.kpis.map((k: { kpi: string; target: string; measurement: string }, i: number) => <li key={i}><span className="font-medium text-ink">{k.kpi}</span> — target {k.target}; measured by {k.measurement}</li>)}</ul>
        </>
      )}
      <H>Limitations</H>
      <ul className="mt-1 list-disc pl-5 text-xs">
        <li>The focus group was a simulation: persona agents built from published survey segments, not real respondents. Test these recommendations in market.</li>
        {(r.limitations ?? []).map((x: string) => <li key={x}>{x}</li>)}
      </ul>
    </article>
  );
}

// ── Meet and interview the personas ───────────────────────────────────────────

function PersonaTab({
  projectId,
  debateId,
  canRun,
  personas,
  artifacts,
}: {
  projectId: string;
  debateId: string;
  canRun: boolean;
  personas: InsightPersonaView[];
  artifacts: InsightArtifactView[];
}) {
  const [agentKey, setAgentKey] = useState(personas[0]?.key ?? '');
  const [introState, introAction] = useActionState(debateInsightAction, empty);
  const [allState, allAction] = useActionState(debateInsightAction, empty);
  const [askState, askAction] = useActionState(debateInsightAction, empty);
  const persona = personas.find((p) => p.key === agentKey);
  const intros = artifacts.filter((a) => a.kind === 'SELF_INTRO' && a.agentKey === agentKey);
  const intro = intros[intros.length - 1] ?? null;
  const thread = artifacts.filter((a) => a.kind === 'INTERVIEW' && a.agentKey === agentKey);

  if (personas.length === 0) return <p className="text-sm text-ink-muted">This debate has no persona agents.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="p-pick" label="Persona">
          <Select id="p-pick" value={agentKey} onChange={(e) => setAgentKey(e.target.value)}>
            {personas.map((p) => <option key={p.key} value={p.key}>{`${p.key} · ${p.name}`}</option>)}
          </Select>
        </Field>
        {canRun && (
          <form action={allAction} className="flex flex-col gap-1">
            <Hidden projectId={projectId} debateId={debateId} kind="SELF_INTRO" />
            <input type="hidden" name="agentKey" value="all" />
            <SubmitButton variant="secondary" pendingLabel="Queuing…">Self-introductions for all personas</SubmitButton>
            <FormMessages state={allState} />
          </form>
        )}
      </div>

      <section className="panel px-4 py-3" aria-label="Self-introduction">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-medium text-ink">Self-introduction</h4>
          {canRun && (
            <form action={introAction}>
              <Hidden projectId={projectId} debateId={debateId} kind="SELF_INTRO" />
              <input type="hidden" name="agentKey" value={agentKey} />
              <SubmitButton variant="secondary" pendingLabel="Queuing…">{intro ? 'Regenerate' : 'Generate'}</SubmitButton>
            </form>
          )}
        </div>
        <FormMessages state={introState} />
        {persona?.segment && <p className="mt-1 font-mono text-[10.5px] text-ink-subtle">{persona.segment}</p>}
        {!intro ? (
          <p className="mt-2 text-sm text-ink-muted">Not generated yet.</p>
        ) : intro.status !== 'COMPLETED' ? (
          <div className="mt-2"><Status a={intro} /></div>
        ) : (
          <div className="mt-2 flex flex-col gap-2 text-sm text-ink-muted">
            <p className="text-base text-ink">{intro.content.headline}</p>
            <p className="whitespace-pre-wrap">{intro.content.introduction}<Ids ids={intro.content.evidenceIds} /></p>
            {intro.content.aboutMe?.length > 0 && (<div><p className="text-xs font-medium text-ink">About me</p><ul className="list-disc pl-5 text-xs">{intro.content.aboutMe.map((x: string) => <li key={x}>{x}</li>)}</ul></div>)}
            {intro.content.whatIValue?.length > 0 && (<div><p className="text-xs font-medium text-ink">What I value in a brand</p><ul className="list-disc pl-5 text-xs">{intro.content.whatIValue.map((x: string) => <li key={x}>{x}</li>)}</ul></div>)}
            {intro.content.viewOnTheTopic && (<div><p className="text-xs font-medium text-ink">My view on the topic</p><p className="text-xs">{intro.content.viewOnTheTopic}</p></div>)}
            {intro.content.howToReachMe?.length > 0 && (<div><p className="text-xs font-medium text-ink">How to reach me</p><ul className="list-disc pl-5 text-xs">{intro.content.howToReachMe.map((x: string) => <li key={x}>{x}</li>)}</ul></div>)}
          </div>
        )}
      </section>

      <section className="panel px-4 py-3" aria-label="Interview">
        <h4 className="text-sm font-medium text-ink">Interview</h4>
        <p className="mt-0.5 text-xs text-ink-subtle">
          Ask market-entry questions. The persona answers in the first person, remembers this conversation and what it said in the debate,
          cites the evidence, and says when it goes beyond it.
        </p>
        <ol className="mt-3 flex flex-col gap-3">
          {thread.map((q) => (
            <li key={q.id} className="flex flex-col gap-1">
              <p className="self-end rounded bg-brand-soft/50 px-3 py-1.5 text-xs text-ink">{q.prompt}</p>
              {q.status === 'COMPLETED' ? (
                <div className="rounded border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
                  <p className="whitespace-pre-wrap">{q.content.answer}<Ids ids={q.content.evidenceIds} /></p>
                  <p className="mt-1 font-mono text-[10px] text-ink-subtle">
                    confidence {Number(q.content.confidence).toFixed(2)}{q.content.outsideEvidence ? ' · goes beyond the evidence' : ''}
                  </p>
                </div>
              ) : (
                <Status a={q} />
              )}
            </li>
          ))}
        </ol>
        {canRun && (
          <form action={askAction} className="mt-3 flex flex-col gap-2" key={thread.length}>
            <Hidden projectId={projectId} debateId={debateId} kind="INTERVIEW" />
            <input type="hidden" name="agentKey" value={agentKey} />
            <TextArea name="prompt" rows={2} required aria-label="Your question" placeholder="e.g. What would make you trust a new Chinese smartphone brand enough to switch?" />
            <SubmitButton pendingLabel="Sending…">Ask</SubmitButton>
            <FormMessages state={askState} />
          </form>
        )}
      </section>
    </div>
  );
}

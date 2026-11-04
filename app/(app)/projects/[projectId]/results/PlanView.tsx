/** One written plan, as the team reads it. */
import type { CommsPlan } from '@/roundtable/schemas';
import { KNOWLEDGE } from '@/knowledge/library';

type Content = CommsPlan & { frameworks: (CommsPlan['frameworks'][number] & { id?: string })[] };

const H = ({ children }: { children: React.ReactNode }) => <h4 className="mt-4 text-[13px] font-bold uppercase tracking-wide text-brand">{children}</h4>;

export function PlanView({ content, dataLines }: { content: Content; dataLines: string[] }) {
  const ref = (r: string) => dataLines[Number(r.slice(1)) - 1];
  return (
    <div className="text-sm text-ink">
      <p className="whitespace-pre-line text-[15px] leading-relaxed">{content.answer}</p>
      {content.situation && (<><H>Situation</H><p className="whitespace-pre-line text-ink-muted">{content.situation}</p></>)}
      {content.objectives.length > 0 && (<><H>Objectives</H><ul className="list-disc pl-5">{content.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></>)}
      {content.audienceInsights.length > 0 && (
        <>
          <H>Audience insights</H>
          <ul className="flex flex-col gap-2">
            {content.audienceInsights.map((a, i) => (
              <li key={i} className="rounded border border-line p-2">
                <p><b>{a.audience}:</b> {a.insight}</p>
                {a.refs.length > 0 && (
                  <details className="mt-1 text-xs text-ink-subtle">
                    <summary className="cursor-pointer">{`Data: ${a.refs.join(', ')}`}</summary>
                    <ul className="mt-1 list-disc pl-5">{a.refs.map((r) => <li key={r}>{ref(r)}</li>)}</ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {content.positioning && (<><H>Positioning</H><p>{content.positioning}</p></>)}
      {content.keyMessages.length > 0 && (
        <>
          <H>Key messages</H>
          <ul className="flex flex-col gap-2">{content.keyMessages.map((m, i) => <li key={i}><b>{m.message}</b> <span className="text-ink-subtle">— {m.audience}</span>{m.proofPoints.length > 0 && <ul className="list-disc pl-5 text-ink-muted">{m.proofPoints.map((p, j) => <li key={j}>{p}</li>)}</ul>}</li>)}</ul>
        </>
      )}
      {content.channels.length > 0 && (
        <>
          <H>Channels (PESO)</H>
          <table className="mt-1 w-full text-left text-sm">
            <thead><tr className="bg-brand-deep text-brand-deep-ink"><th className="px-2 py-1">Type</th><th className="px-2 py-1">Channel</th><th className="px-2 py-1">Role</th></tr></thead>
            <tbody>{content.channels.map((c, i) => <tr key={i} className="border-b border-line align-top"><td className="px-2 py-1 capitalize">{c.type}</td><td className="px-2 py-1 font-semibold">{c.channel}</td><td className="px-2 py-1 text-ink-muted">{c.role}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {content.phasedPlan.length > 0 && (
        <>
          <H>Phased plan</H>
          <ol className="flex flex-col gap-2">{content.phasedPlan.map((p, i) => <li key={i}><b>{p.phase}</b> <span className="text-ink-subtle">({p.timing})</span><ul className="list-disc pl-5 text-ink-muted">{p.activities.map((a, j) => <li key={j}>{a}</li>)}</ul></li>)}</ol>
        </>
      )}
      {content.kpis.length > 0 && (
        <>
          <H>KPIs</H>
          <ul className="list-disc pl-5">{content.kpis.map((k, i) => <li key={i}><b>{k.kpi}</b>{k.target ? ` — ${k.target}` : ''} <span className="text-ink-subtle">({k.measurement})</span></li>)}</ul>
        </>
      )}
      {content.marketNotes.length > 0 && (<><H>By market</H><ul className="list-disc pl-5">{content.marketNotes.map((m, i) => <li key={i}><b>{m.market}:</b> {m.note}</li>)}</ul></>)}
      {content.risks.length > 0 && (<><H>Risks</H><ul className="list-disc pl-5">{content.risks.map((r, i) => <li key={i}>{r.risk} <span className="text-ink-muted">→ {r.mitigation}</span></li>)}</ul></>)}
      {content.frameworks.length > 0 && (
        <>
          <H>Frameworks applied</H>
          <ul className="list-disc pl-5">
            {content.frameworks.map((f, i) => {
              const k = KNOWLEDGE.find((x) => x.id === (f as { id?: string }).id);
              return <li key={i}>{k ? <a href={k.source.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-link underline">{k.title}</a> : f.ref}: {f.howApplied}</li>;
            })}
          </ul>
        </>
      )}
      {content.dataGaps.length > 0 && (<><H>What the data cannot tell us</H><ul className="list-disc pl-5 text-ink-muted">{content.dataGaps.map((g, i) => <li key={i}>{g}</li>)}</ul></>)}
    </div>
  );
}

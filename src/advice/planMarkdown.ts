/** A written comms plan as Markdown, for download. */
import type { CommsPlan } from '@/roundtable/schemas';

export function planMarkdown(plan: CommsPlan, meta: { question: string; projectName: string; writtenOn: string; dataLines: string[] }): string {
  const out: string[] = [`# ${plan.title || meta.question}`, '', `*${meta.projectName} · ${meta.writtenOn} · RF AI Persona*`, '', `> ${meta.question}`, '', plan.answer, ''];
  const section = (title: string, lines: string[]) => {
    if (lines.length) out.push(`## ${title}`, '', ...lines, '');
  };
  section('Situation', plan.situation ? [plan.situation] : []);
  section('Objectives', plan.objectives.map((o) => `- ${o}`));
  section('Audience insights', plan.audienceInsights.map((a) => `- **${a.audience}:** ${a.insight}${a.refs.length ? ` _(data: ${a.refs.join(', ')})_` : ''}`));
  section('Positioning', plan.positioning ? [plan.positioning] : []);
  section('Key messages', plan.keyMessages.flatMap((m) => [`- **${m.message}** — ${m.audience}`, ...m.proofPoints.map((p) => `  - ${p}`)]));
  section('Channels (PESO)', plan.channels.length ? ['| Type | Channel | Role |', '|---|---|---|', ...plan.channels.map((c) => `| ${c.type} | ${c.channel} | ${c.role.replace(/\|/g, '/')} |`)] : []);
  section('Phased plan', plan.phasedPlan.flatMap((p) => [`### ${p.phase}${p.timing ? ` (${p.timing})` : ''}`, ...p.activities.map((a) => `- ${a}`), '']));
  section('KPIs', plan.kpis.map((k) => `- **${k.kpi}**${k.target ? ` — ${k.target}` : ''}${k.measurement ? ` (${k.measurement})` : ''}`));
  section('By market', plan.marketNotes.map((m) => `- **${m.market}:** ${m.note}`));
  section('Risks', plan.risks.map((r) => `- ${r.risk} → ${r.mitigation}`));
  section('Frameworks applied', plan.frameworks.map((f) => `- ${f.ref}: ${f.howApplied}`));
  section('What to validate next', plan.dataGaps.map((g) => `- ${g}`));
  section('Data referenced', meta.dataLines);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

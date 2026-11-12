/**
 * A project as Markdown context for an outside assistant (server only): the brief, the cast, the
 * latest roundtable's computed figures and the model's takeaways, the decision guidance, the latest
 * debate verdict and plan. Read-only; served by /api/context behind its own bearer token.
 *
 * Figures are the stored, computed ones; the model's words are marked as such, and the personas
 * stay labelled simulated.
 */
import { prisma } from '@/lib/prisma';
import { latestBrief, latestCast, roundtableHistory } from '@/roundtable/service';
import { roundtableView, type CastProfile, type ScoredCategory } from '@/roundtable/engine';
import type { RoundtableSummary } from '@/roundtable/schemas';
import type { DecisionAnswer } from '@/decision/client';
import { CHOICE_LABEL, QUESTION_LABEL } from '@/decision/checkpoints';

const r0 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(Math.round(n)));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '—');

/** Projects matching an id or a name (case-insensitive, whole or part), most recently updated first. */
export async function findProjects(query: string) {
  const q = query.trim();
  if (!q) return prisma.project.findMany({ where: { archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 25, select: { id: true, name: true, updatedAt: true } });
  const byId = await prisma.project.findUnique({ where: { id: q }, select: { id: true, name: true, updatedAt: true } });
  if (byId) return [byId];
  const all = await prisma.project.findMany({ where: { archivedAt: null, name: { contains: q, mode: 'insensitive' } }, orderBy: { updatedAt: 'desc' }, take: 25, select: { id: true, name: true, updatedAt: true } });
  const exact = all.filter((p) => p.name.toLowerCase() === q.toLowerCase());
  return exact.length ? exact : all;
}

export async function projectContext(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, description: true, useCase: true, updatedAt: true } });
  if (!project) return null;
  const [brief, cast, history, guidance, debate, plan] = await Promise.all([
    latestBrief(projectId),
    latestCast(projectId),
    roundtableHistory(projectId),
    prisma.decisionCheck.findMany({ where: { projectId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.debate.findFirst({ where: { projectId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } }),
    prisma.advice.findFirst({ where: { projectId, kind: 'COMMS_PLAN', status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } }),
  ]);
  const hypotheses = brief ? await prisma.hypothesis.findMany({ where: { briefId: brief.id }, orderBy: { createdAt: 'asc' }, select: { label: true, statement: true } }) : [];
  const out: string[] = [];

  out.push(`# ${project.name}`, '', `Project id: ${projectId} · use case: ${project.useCase ?? 'market_entry'} · last updated ${day(project.updatedAt)}`);
  if (project.description) out.push('', project.description);
  out.push('', '> Personas are simulated from published survey statistics. Figures below are computed in code; quotes, takeaways and advice are model-written.');

  out.push('', '## Brief');
  if (!brief) out.push('No brief yet.');
  else {
    out.push(`- Version ${brief.versionNo} (${brief.status.toLowerCase()})`);
    out.push(`- Markets: ${brief.markets.join(', ') || '—'}`);
    out.push(`- Roundtable question: ${brief.researchQuestion ?? '—'}`);
    out.push(`- Categories: ${brief.categories.join('; ') || '—'}`);
    if (brief.targetAudience) out.push(`- Audience: ${brief.targetAudience}`);
    if (brief.objective) out.push(`- Objective: ${brief.objective}`);
    if (brief.businessContext) out.push('', 'Brand and category context:', '', brief.businessContext);
    if (hypotheses.length) out.push('', 'Hypotheses:', ...hypotheses.map((h) => `- ${h.label}: ${h.statement}`));
  }

  out.push('', '## Cast');
  const people = (cast?.personas ?? []).map((p) => ({ name: p.name, approval: p.versions[0]?.approval, profile: p.versions[0]?.profile as unknown as CastProfile | null }));
  if (!cast || people.length === 0) out.push('No cast built yet.');
  else {
    const approved = people.filter((p) => p.approval === 'APPROVED').length;
    out.push(`${people.length} personas (${approved} approved), build ${(cast.buildStatus ?? 'unknown').toLowerCase()}.`, '');
    for (const p of people) {
      const pr = p.profile;
      if (!pr) {
        out.push(`- ${p.name}`);
        continue;
      }
      const id = pr.identity;
      const who = id ? `${id.age}, ${id.occupation}, ${id.city}; ${id.lifeStage}; decides on ${id.decisionLogic.join(' > ')}` : '';
      const stats = pr.stats.slice(0, 3).map((s) => `"${s.statement}" ${s.response} ${r0(s.share)}% vs ${r0(s.overall)}%`).join('; ');
      out.push(`- **${p.name}** — ${pr.market}, tier ${pr.tier} ${pr.tierLabel} (${pr.group ?? pr.basis}, base ${pr.base})${who ? ` — ${who}` : ''}`);
      if (stats) out.push(`  - Stands out on: ${stats}`);
    }
  }

  out.push('', '## Roundtable');
  const rt = history.find((r) => r.status === 'COMPLETED');
  if (!rt) out.push(history.length ? `No completed roundtable yet (latest is ${history[0]!.status.toLowerCase()}).` : 'No roundtable run yet.');
  else {
    const answers = rt.answers.filter((a) => a.ok).map((a) => ({ ...a, scores: (a.scores ?? []) as unknown as ScoredCategory[] }));
    const view = roundtableView(rt.categories, answers);
    const summary = rt.summary as unknown as RoundtableSummary | null;
    out.push(`Latest completed: ${day(rt.completedAt)} · ${answers.length} of ${rt.total} answered · language ${rt.language}${rt.isMock ? ' · MOCK MODEL (placeholder words, random scores)' : ''}`);
    out.push(`Question: ${rt.question}`, '');
    out.push(`Openness 0–100 (≥60 willing, 40–59 depends, <40 not keen). Personas: ${view.bands.willing} willing, ${view.bands.depends} depends, ${view.bands.unlikely} not keen.`, '');
    out.push(`| Category | All | ${view.markets.map((m) => m.market).join(' | ')} |`, `|---|---|${view.markets.map(() => '---').join('|')}|`);
    for (const c of rt.categories) out.push(`| ${c} | ${r0(view.categoryMeans[c])} | ${view.markets.map((m) => r0(m.categories[c])).join(' | ')} |`);
    out.push(`| **Overall** | | ${view.markets.map((m) => r0(m.overall)).join(' | ')} |`);
    if (summary) {
      if (summary.consensus) out.push('', `Consensus (model-written): ${summary.consensus}`);
      if (summary.takeaways.length) out.push('', 'Takeaways (model-written):', ...summary.takeaways.map((t) => `- ${t}`));
      if (summary.comms?.headline) out.push('', `Communications headline: ${summary.comms.headline}`);
    }
    const quotes = view.featured.map((f) => {
      const a = rt.answers.find((x) => x.personaId === f.personaId);
      return a ? `- ${a.market} (${r0(a.overall)}): “${a.quote}”` : null;
    }).filter(Boolean) as string[];
    if (quotes.length) out.push('', 'Featured voices:', ...quotes);
    const earlier = history.filter((r) => r.id !== rt.id);
    if (earlier.length) out.push('', 'Earlier roundtables:', ...earlier.slice(0, 8).map((r) => `- ${day(r.createdAt)} · ${r.status.toLowerCase()} · ${r.question}`));
  }

  out.push('', '## Decision guidance (latest per checkpoint)');
  const seen = new Set<string>();
  const latestPer = guidance.filter((g) => (seen.has(g.checkpoint) ? false : (seen.add(g.checkpoint), true)));
  if (!latestPer.length) out.push('None requested yet.');
  for (const g of latestPer) {
    const answers = (g.answers ?? []) as unknown as DecisionAnswer[];
    const parts = answers.map((a) => {
      const label = QUESTION_LABEL[a.name] ?? a.name;
      const pct = (x: number | undefined) => (x === undefined ? '' : ` (${Math.round(x * 100)}%)`);
      const value = a.refused
        ? 'declined'
        : a.choice !== undefined
          ? `${CHOICE_LABEL[a.choice] ?? a.choice}${pct(a.probabilities?.[a.choice])}`
          : a.probability !== undefined
            ? `${Math.round(a.probability * 100)}% likely`
            : a.score !== undefined
              ? `level ${a.score.toFixed(1)}`
              : '—';
      return `${label}: ${value}`;
    });
    out.push(`- ${g.checkpoint} (${day(g.createdAt)}${g.isMock ? ', local stand-in' : ''}): ${parts.join('; ') || '—'}`);
  }

  if (debate) {
    const verdict = ((debate.conclusion ?? {}) as { verdict?: { answer?: unknown; confidence?: unknown; conclusion?: unknown } }).verdict;
    out.push('', '## Latest agent swarm debate', `Motion: ${debate.topic}`);
    if (debate.hypothesis) out.push(`Hypothesis: ${debate.hypothesis}`);
    if (verdict) out.push(`Verdict: ${String(verdict.answer ?? '—')} (${String(verdict.confidence ?? '—')}) — ${String(verdict.conclusion ?? '').slice(0, 1200)}`);
  }

  if (plan) {
    const c = (plan.content ?? {}) as { title?: string; answer?: string };
    out.push('', '## Latest communications plan', `Question: ${plan.question}`);
    if (c.title) out.push(`Title: ${c.title}`);
    if (c.answer) out.push('', c.answer.slice(0, 2000));
  }
  return out.join('\n');
}

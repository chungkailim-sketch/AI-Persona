/** A swarm debate as Markdown, for download: the motion, the verdict, and the transcript. */
type Turn = { seq: number; round: number; phase: string; agentName: string; agentRole: string; stance: string | null; content: unknown; ok: boolean };
type Verdict = { answer?: string; conclusion?: string; basis?: string; inferences?: string[]; argumentsFor?: string[]; argumentsAgainst?: string[]; consensus?: string[]; dissent?: string[]; evidenceGaps?: string[]; recommendations?: string[] };

const PHASE: Record<string, string> = { FRAMING: 'Framing', OPENING: 'Opening statements', EVIDENCE_REVIEW: 'Evidence review', MODERATION: 'Moderator handoff', REBUTTAL: 'Rebuttals', CHALLENGE: "Devil's advocate", CLOSING: 'Closing statements', VERDICT: 'Verdict' };
const ANSWER: Record<string, string> = { supported: 'Supported', not_supported: 'Not supported', mixed: 'Mixed', insufficient_evidence: 'Directional' };

/** The readable text of one turn's JSON, without its ids. */
function turnText(content: unknown): string {
  if (!content || typeof content !== 'object') return String(content ?? '');
  const c = content as Record<string, unknown>;
  const keys = ['argument', 'rebuttal', 'challenge', 'finalArgument', 'summary', 'focus', 'motion', 'conclusion', 'reason', 'alternativeExplanation'];
  const parts = keys.filter((k) => typeof c[k] === 'string' && c[k]).map((k) => String(c[k]));
  for (const k of ['keyPoints', 'subQuestions', 'decisionCriteria']) if (Array.isArray(c[k]) && (c[k] as unknown[]).length) parts.push((c[k] as unknown[]).map((x) => `- ${String(x)}`).join('\n'));
  return parts.join('\n\n') || (c.error ? `(no valid answer: ${String(c.error)})` : '');
}

export function debateMarkdown(d: { topic: string; hypothesis: string | null; rounds: number; createdAt: Date; conclusion: unknown; turns: Turn[] }, projectName: string): string {
  const conclusion = (d.conclusion ?? {}) as { verdict?: Verdict | null; research?: { id: string; claim: string; source: string; url: string; year: string }[]; caveats?: string[] };
  const v = conclusion.verdict;
  const out: string[] = [`# ${d.topic}`, '', `*${projectName} · agent-swarm debate · ${d.createdAt.toISOString().slice(0, 10)} · ${d.rounds} round(s) · RF AI Persona*`, ''];
  if (d.hypothesis) out.push(`**Hypothesis:** ${d.hypothesis}`, '');
  const list = (title: string, items?: string[]) => {
    if (items?.length) out.push(`### ${title}`, '', ...items.map((x) => `- ${x}`), '');
  };
  if (v) {
    out.push(`## Conclusion: ${ANSWER[v.answer ?? ''] ?? v.answer ?? ''}`, '', v.conclusion ?? '', '');
    list('How the conclusion was inferred', v.inferences);
    list('Arguments for', v.argumentsFor);
    list('Arguments against', v.argumentsAgainst);
    list('Where the panel agreed', v.consensus);
    list('Recorded dissent', v.dissent);
    list('What to validate in market next', v.evidenceGaps);
    list('Recommendations', v.recommendations);
  }
  if (conclusion.research?.length) list('External sources (web research)', conclusion.research.map((w) => `${w.id} ${w.claim} — [${w.source || w.url}${w.year ? `, ${w.year}` : ''}](${w.url})`));
  list('Read this before quoting the conclusion', conclusion.caveats);
  out.push('## Transcript', '');
  let phase = '';
  for (const t of d.turns) {
    const head = `${PHASE[t.phase] ?? t.phase}${t.round ? ` — round ${t.round}` : ''}`;
    if (head !== phase) {
      out.push(`### ${head}`, '');
      phase = head;
    }
    out.push(`**${t.agentName}** (${t.agentRole})${t.stance ? ` · ${t.stance}` : ''}`, '', turnText(t.content), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

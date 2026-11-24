/**
 * What the numbers in a GEO audit mean, computed in code (not by the model): the gaps that decide
 * where effort pays back. The strategy prompt and the report slides both read these.
 */
import type { GeoMetrics } from './schemas';

export type TopicStanding = 'lead' | 'close' | 'behind' | 'absent';

export interface GeoAnalysis {
  leader: { name: string; mentions: number } | null;
  brandMentions: number | null;
  /** Points behind the leader on mentions (negative: ahead of the next brand). */
  mentionsGap: number | null;
  /** Mentions rate minus citation share: how often the brand is named but its own pages are not cited. */
  citationGap: number | null;
  /** Branded minus non-branded visibility: how far brand ownership carries into open questions. */
  brandedGap: number | null;
  topics: { topic: string; brand: number | null; leader: string; leaderScore: number | null; gap: number | null; standing: TopicStanding }[];
  engines: { engine: string; mentions: number }[];
  engineSpread: number | null;
  weakEngines: string[];
  sourceMix: { type: string; share: number }[];
  ownedShare: { brand: number | null; leader: number | null; leaderBrand: string | null; ratio: number | null };
  /** Plain-language facts, each with its figures, for the strategy prompt and the slides. */
  facts: string[];
}

const round = (n: number) => Math.round(n * 10) / 10;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function topicStanding(brand: number | null, leaderScore: number | null, brandLeads: boolean): TopicStanding {
  if (brand === null) return 'absent';
  if (brandLeads || leaderScore === null || brand >= leaderScore) return 'lead';
  if (brand < 10) return 'absent';
  return leaderScore - brand <= 10 ? 'close' : 'behind';
}

export function analyseGeo(m: GeoMetrics): GeoAnalysis {
  const h = m.headline;
  const ranked = m.competitors.filter((c) => c.mentions !== null).sort((a, b) => b.mentions! - a.mentions!);
  const top = ranked[0] ?? null;
  const own = ranked.find((c) => same(c.name, m.brand));
  const brandMentions = own?.mentions ?? h.mentions;
  const isLeader = Boolean(top && own && top === own);
  const next = isLeader ? ranked[1] : top;
  const mentionsGap = brandMentions !== null && next?.mentions != null ? round((isLeader ? -1 : 1) * Math.abs(next.mentions - brandMentions)) : null;
  const citationGap = h.mentions !== null && h.citationShare !== null ? round(h.mentions - h.citationShare) : null;
  const brandedGap = h.brandedVisibility !== null && h.visibility !== null ? round(h.brandedVisibility - h.visibility) : null;

  const topics = m.topicScores.map((t) => {
    const leads = same(t.leader, m.brand);
    const gap = t.brand !== null && t.leaderScore !== null && !leads ? round(t.leaderScore - t.brand) : null;
    return { topic: t.topic, brand: t.brand, leader: t.leader, leaderScore: t.leaderScore, gap, standing: topicStanding(t.brand, t.leaderScore, leads) };
  });
  const engines = m.engineScores.filter((e) => e.mentions !== null).map((e) => ({ engine: e.engine, mentions: e.mentions! })).sort((a, b) => b.mentions - a.mentions);
  const engineSpread = engines.length > 1 ? round(engines[0]!.mentions - engines[engines.length - 1]!.mentions) : null;
  const median = engines.length ? engines[Math.floor(engines.length / 2)]!.mentions : null;
  const weakEngines = median === null ? [] : engines.filter((e) => e.mentions < median).map((e) => e.engine);
  const sourceMix = m.sourceTypes.filter((s) => s.share !== null).map((s) => ({ type: s.type, share: s.share! })).sort((a, b) => b.share - a.share);
  const domains = m.ownedDomains.filter((d) => d.share !== null).sort((a, b) => b.share! - a.share!);
  const ownDomain = domains.find((d) => same(d.brand, m.brand));
  const leadDomain = domains.find((d) => !same(d.brand, m.brand)) ?? null;
  const ratio = ownDomain?.share && leadDomain?.share ? round(leadDomain.share / ownDomain.share) : null;

  const facts: string[] = [];
  const b = m.brand || 'The brand';
  if (h.visibility !== null) facts.push(`${b} is visible in ${h.visibility}% of non-branded AI answers${h.rank !== null ? `, rank #${h.rank}${h.brandsTracked ? ` of ${h.brandsTracked}` : ''}` : ''}.`);
  if (mentionsGap !== null && next) facts.push(isLeader ? `${b} leads mentions by ${Math.abs(mentionsGap)}pp over ${next.name}.` : `${b} trails ${next.name} by ${mentionsGap}pp on mentions (${brandMentions}% vs ${next.mentions}%).`);
  if (citationGap !== null) facts.push(`Named in ${h.mentions}% of answers but its own pages are cited in only ${h.citationShare}%: a ${citationGap}pp mention-to-citation gap.`);
  if (brandedGap !== null) facts.push(`Branded visibility ${h.brandedVisibility}% vs ${h.visibility}% non-branded: brand awareness does not yet carry into open category questions (${brandedGap}pp).`);
  const close = topics.filter((t) => t.standing === 'close');
  const behind = topics.filter((t) => t.standing === 'behind' || t.standing === 'absent').sort((x, y) => (y.gap ?? 99) - (x.gap ?? 99));
  const leads = topics.filter((t) => t.standing === 'lead');
  if (leads.length) facts.push(`Leads on ${leads.map((t) => `${t.topic} (${t.brand}%)`).join(', ')}.`);
  if (close.length) facts.push(`Within reach (≤10pp of the leader): ${close.map((t) => `${t.topic} (${t.brand}% vs ${t.leader} ${t.leaderScore}%)`).join(', ')}.`);
  if (behind.length) facts.push(`Weakest: ${behind.slice(0, 4).map((t) => `${t.topic} (${t.brand ?? 0}% vs ${t.leader} ${t.leaderScore ?? '—'}%)`).join(', ')}.`);
  if (engines.length) facts.push(`By AI engine: ${engines.map((e) => `${e.engine} ${e.mentions}%`).join(', ')}${engineSpread !== null ? ` (spread ${engineSpread}pp)` : ''}.`);
  if (sourceMix.length) facts.push(`AI answers cite: ${sourceMix.map((s) => `${s.type} ${s.share}%`).join(', ')}.`);
  if (m.industrySources.length) facts.push(`Most-cited industry sources: ${m.industrySources.slice(0, 6).map((s) => `${s.domain}${s.share !== null ? ` ${s.share}%` : ''}`).join(', ')}.`);
  if (ratio !== null && leadDomain && ownDomain) facts.push(`${leadDomain.domain} earns ${ratio}× the citations of ${ownDomain.domain} (${leadDomain.share}% vs ${ownDomain.share}%).`);
  return { leader: top && top.mentions !== null ? { name: top.name, mentions: top.mentions } : null, brandMentions, mentionsGap, citationGap, brandedGap, topics, engines, engineSpread, weakEngines, sourceMix, ownedShare: { brand: ownDomain?.share ?? null, leader: leadDomain?.share ?? null, leaderBrand: leadDomain?.brand ?? null, ratio }, facts };
}

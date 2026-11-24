import { describe, expect, it } from 'vitest';
import { GeoMetrics } from '@/geo/schemas';
import { analyseGeo, topicStanding } from '@/geo/analysis';

// Figures from a real AI visibility audit layout (brand #2 of 6 on mentions).
const audit = GeoMetrics.parse({
  brand: 'TCL', market: 'United Kingdom', marketBasis: 'Inferred',
  headline: { visibility: '28.3%', mentions: '26.4%', citationShare: '6.2%', avgRank: '#2.8', rank: '#2', brandsTracked: 6, brandedVisibility: '96.0%' },
  competitors: [{ name: 'Samsung', mentions: 41.5 }, { name: 'TCL', mentions: 26.4 }, { name: 'Hisense', mentions: 22.8 }],
  topicScores: [
    { topic: 'Mini LED and QLED TVs', brand: 49.8, leader: 'Samsung', leaderScore: 51.9 },
    { topic: 'Smart TVs', brand: 43.9, leader: 'Samsung', leaderScore: 55.5 },
    { topic: 'Soundbars and Home Audio', brand: 4.5, leader: 'Samsung', leaderScore: 40.6 },
  ],
  engineScores: [{ engine: 'Perplexity', mentions: 21.4 }, { engine: 'Gemini', mentions: 32.2 }, { engine: 'OpenAI', mentions: 29.4 }],
  sourceTypes: [{ type: 'Retail & price comparison', share: 13 }, { type: 'Review & tech media', share: '59%' }],
  ownedDomains: [{ brand: 'Samsung', domain: 'samsung.com', share: 2.23 }, { brand: 'TCL', domain: 'tcl.com', share: 1.06 }],
});

describe('GEO audit analysis', () => {
  it('reads figures written with %, # and pp', () => {
    expect(audit.headline.visibility).toBe(28.3);
    expect(audit.headline.rank).toBe(2);
    expect(audit.headline.avgRank).toBe(2.8);
    expect(audit.marketBasis).toBe('inferred');
  });

  it('computes the gaps that decide where effort pays back', () => {
    const a = analyseGeo(audit);
    expect(a.mentionsGap).toBe(15.1);
    expect(a.citationGap).toBe(20.2);
    expect(a.brandedGap).toBe(67.7);
    expect(a.topics.map((t) => t.standing)).toEqual(['close', 'behind', 'absent']);
    expect(a.engines[0]!.engine).toBe('Gemini');
    expect(a.engineSpread).toBe(10.8);
    expect(a.sourceMix[0]).toEqual({ type: 'Review & tech media', share: 59 });
    expect(a.ownedShare.ratio).toBe(2.1);
    expect(a.facts.some((f) => f.includes('20.2pp mention-to-citation gap'))).toBe(true);
  });

  it('classifies a topic the brand leads', () => {
    expect(topicStanding(30, 20, false)).toBe('lead');
    expect(topicStanding(10, 40, true)).toBe('lead');
    expect(topicStanding(null, 40, false)).toBe('absent');
  });
});

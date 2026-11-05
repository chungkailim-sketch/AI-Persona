import { describe, expect, it } from 'vitest';
import { HEADSHOTS, genderOf, pickHeadshot, regionOfMarket } from '@/headshots/catalog';
import { drawHeadshot } from '@/headshots/draw';

describe('headshot catalog', () => {
  it('has fifty distinct portraits across regions, both genders and a wide age range', () => {
    expect(HEADSHOTS).toHaveLength(50);
    expect(new Set(HEADSHOTS.map((h) => h.key)).size).toBe(50);
    expect(new Set(HEADSHOTS.map((h) => h.region)).size).toBe(7);
    expect(HEADSHOTS.filter((h) => h.gender === 'F').length).toBeGreaterThanOrEqual(20);
    expect(HEADSHOTS.filter((h) => h.gender === 'M').length).toBeGreaterThanOrEqual(20);
    expect(Math.min(...HEADSHOTS.map((h) => h.age))).toBeLessThan(25);
    expect(Math.max(...HEADSHOTS.map((h) => h.age))).toBeGreaterThan(65);
  });

  it('draws a valid, deterministic SVG for each', () => {
    const svgs = HEADSHOTS.map(drawHeadshot);
    for (const s of svgs) expect(s).toMatch(/^<svg [^>]*viewBox="0 0 256 256"[\s\S]*<\/svg>$/);
    expect(new Set(svgs).size).toBe(50);
    expect(drawHeadshot(HEADSHOTS[3]!)).toBe(svgs[3]);
  });
});

describe('matching a persona to a headshot', () => {
  it('reads gender in English and Chinese, and region from the market', () => {
    expect(genderOf('Female')).toBe('F');
    expect(genderOf('male')).toBe('M');
    expect(genderOf('女')).toBe('F');
    expect(genderOf('男性')).toBe('M');
    expect(genderOf('')).toBeNull();
    expect(regionOfMarket('Indonesia')).toBe('southeast_asian');
    expect(regionOfMarket('UAE')).toBe('middle_eastern');
    expect(regionOfMarket('Germany')).toBe('european');
  });

  it('prefers the same gender and region, close in age', () => {
    const h = HEADSHOTS.find((x) => x.key === pickHeadshot({ id: 'a', market: 'Japan', gender: 'female', age: 33 }))!;
    expect(h.gender).toBe('F');
    expect(h.region).toBe('east_asian');
    expect(Math.abs(h.age - 33)).toBeLessThanOrEqual(6);
  });

  it('does not repeat a face within a cast and is stable per persona', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const k = pickHeadshot({ id: `p${i}`, market: 'Brazil', gender: 'M', age: 40 }, taken);
      expect(taken.has(k)).toBe(false);
      taken.add(k);
    }
    expect(pickHeadshot({ id: 'x', market: 'India', gender: 'F', age: 30 })).toBe(pickHeadshot({ id: 'x', market: 'India', gender: 'F', age: 30 }));
  });
});

describe('photo prompts', () => {
  it('describe the person, ask for a photographic result and never name a real person', async () => {
    const { headshotPrompt } = await import('@/headshots/photos');
    const p = headshotPrompt(HEADSHOTS.find((h) => h.style === 'hijab')!);
    expect(p).toMatch(/Photorealistic/);
    expect(p).toMatch(/hijab/);
    expect(p).toMatch(/entirely fictional/);
    expect((await import('@/headshots/photos')).NEGATIVE_PROMPT).toMatch(/cartoon/);
    const q = headshotPrompt(HEADSHOTS[6]!);
    expect(q).toMatch(/East Asian man/);
  });
});

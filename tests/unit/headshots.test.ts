import { describe, expect, it } from 'vitest';
import { HEADSHOTS, genderOf, pickHeadshot, regionOfMarket } from '@/headshots/catalog';
import { drawHeadshot } from '@/headshots/draw';

describe('headshot catalog', () => {
  it('has a hundred distinct portraits across regions, both genders and a wide age range', () => {
    expect(HEADSHOTS).toHaveLength(100);
    expect(new Set(HEADSHOTS.map((h) => h.key)).size).toBe(100);
    expect(new Set(HEADSHOTS.map((h) => h.region)).size).toBe(7);
    expect(HEADSHOTS.filter((h) => h.gender === 'F').length).toBeGreaterThanOrEqual(20);
    expect(HEADSHOTS.filter((h) => h.gender === 'M').length).toBeGreaterThanOrEqual(20);
    expect(Math.min(...HEADSHOTS.map((h) => h.age))).toBeLessThan(25);
    expect(Math.max(...HEADSHOTS.map((h) => h.age))).toBeGreaterThan(65);
  });

  it('draws a valid, deterministic SVG for each', () => {
    const svgs = HEADSHOTS.map(drawHeadshot);
    for (const s of svgs) expect(s).toMatch(/^<svg [^>]*viewBox="0 0 256 256"[\s\S]*<\/svg>$/);
    expect(new Set(svgs).size).toBe(100);
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
    expect(p).toMatch(/photorealistic lifestyle/i);
    expect(p).toMatch(/hijab/);
    expect(p).toMatch(/entirely fictional/);
    expect((await import('@/headshots/photos')).NEGATIVE_PROMPT).toMatch(/cartoon/);
    const q = headshotPrompt(HEADSHOTS[6]!);
    expect(q).toMatch(/East Asian man/);
  });
});

describe('image key selection', () => {
  it('uses IMAGE_API_KEY, then OPENAI_API_KEY, for the OpenAI provider, and HF_TOKEN for a Hugging Face one', async () => {
    const { imageKey, imagesConfigured } = await import('@/lib/env');
    const base = { IMAGE_PROVIDER: 'openai', IMAGE_MODEL: 'gpt-image-1-mini' } as never;
    expect(imageKey({ ...(base as object), IMAGE_API_KEY: 'sk-image-key', OPENAI_API_KEY: 'sk-other' } as never)).toBe('sk-image-key');
    expect(imageKey({ ...(base as object), IMAGE_API_KEY: '  ', OPENAI_API_KEY: 'sk-other' } as never)).toBe('sk-other');
    expect(imageKey({ ...(base as object) } as never)).toBeNull();
    expect(imageKey({ ...(base as object), IMAGE_API_KEY: 'not-a-key' } as never)).toBeNull();
    expect(imagesConfigured({ IMAGE_PROVIDER: 'fal-ai', HF_TOKEN: 'hf_abcdefghijk' } as never)).toBe(true);
    expect(imagesConfigured({ IMAGE_PROVIDER: 'fal-ai', IMAGE_API_KEY: 'sk-x' } as never)).toBe(false);
  });
});

describe('matching a portrait to the persona’s occupation', () => {
  it('reads the occupation family from the occupation, or from age and income tier', async () => {
    const { roleOf } = await import('@/headshots/catalog');
    expect(roleOf('Staff nurse at a public hospital', 34)).toBe('healthcare');
    expect(roleOf('Software engineer', 29)).toBe('tech');
    expect(roleOf('Owner of a small bakery', 47)).toBe('entrepreneur');
    expect(roleOf('University student', 20)).toBe('student');
    expect(roleOf('Retired teacher', 68)).toBe('retired');
    expect(roleOf('', 45, 1)).toBe('executive');
    expect(roleOf('', 30, 3)).toBe('service');
  });

  it('gives a persona a face of the same gender, region and occupation where one exists', async () => {
    const { pickHeadshot, HEADSHOTS } = await import('@/headshots/catalog');
    const key = pickHeadshot({ id: 'p1', market: 'Indonesia', gender: 'Female', age: 33, occupation: 'Nurse' });
    const h = HEADSHOTS.find((x) => x.key === key)!;
    expect([h.gender, h.region]).toEqual(['F', 'southeast_asian']);
    expect(['healthcare', 'service']).toContain(h.role);
  });

  it('writes the occupation’s clothes and setting into the photo prompt', async () => {
    const { headshotPrompt } = await import('@/headshots/photos');
    const nurse = HEADSHOTS.find((h) => h.role === 'healthcare')!;
    expect(headshotPrompt(nurse)).toMatch(/scrubs|pharmacist/);
    const student = HEADSHOTS.find((h) => h.role === 'student')!;
    expect(headshotPrompt(student)).toMatch(/campus/);
  });
});

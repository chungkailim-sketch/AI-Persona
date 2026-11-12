/**
 * Replace the illustrated headshots with synthetic photographic portraits (server only).
 *
 * Each catalog entry is described to an image model (OpenAI gpt-image-1-mini by default, or a
 * Hugging Face provider) as a candid lifestyle portrait of an invented person; the result is cropped square, resized and stored in the Headshot table. These are
 * AI-generated faces of people who do not exist — never photographs of real people — and the app
 * keeps saying the personas are illustrative.
 */
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { InferenceClient } from '@huggingface/inference';
import { imageKey, imagesConfigured, env } from '@/lib/env';
import { HEADSHOTS, PHOTO_STYLE, pickHeadshot, type HeadshotSpec, type Region, type Role } from './catalog';
import type { CastProfile } from '@/roundtable/engine';
import { ensureHeadshots } from './store';

const WHO: Record<Region, string> = {
  east_asian: 'East Asian',
  southeast_asian: 'Southeast Asian',
  south_asian: 'South Asian',
  middle_eastern: 'Middle Eastern',
  african: 'Black African',
  european: 'European',
  latin: 'Latin American',
};
const HAIR_WORD: Record<string, string> = { '#1d1816': 'black', '#3a2a20': 'dark brown', '#5b3d2a': 'brown', '#7d3f24': 'auburn', '#c8a15c': 'blond', '#a9a9ae': 'grey', '#e4e4e8': 'white', '#c4c4ca': 'silver' };
const STYLE_WORD: Record<string, string> = {
  long: 'long hair', bob: 'a chin-length bob', bun: 'hair in a neat bun', pixie: 'a short cropped cut', curly: 'natural curly hair', wavy: 'wavy shoulder-length hair',
  short: 'short hair', side: 'short side-parted hair', buzz: 'very short buzzed hair', curlyshort: 'short curly hair', bald: 'a shaved head', hijab: 'a hijab',
};
/** Clothes and an everyday place that fit the person's occupation (lifestyle, never a studio shot). */
const ROLE_LOOK: Record<Role, { wear: string[]; where: string[] }> = {
  student: { wear: ['a casual hoodie with a backpack strap on one shoulder', 'a graphic t-shirt and denim jacket'], where: ['on a university campus', 'in a busy campus café'] },
  office: { wear: ['smart-casual office wear', 'a neat blouse or shirt with a lanyard'], where: ['outside a modern office building at lunchtime', 'in a bright open-plan office'] },
  executive: { wear: ['a tailored jacket with an open collar, no tie', 'refined business-casual clothes'], where: ['in a stylish hotel lobby', 'on a city terrace overlooking the skyline'] },
  tech: { wear: ['a casual shirt, laptop bag over the shoulder', 'a plain sweatshirt'], where: ['in a co-working space', 'in a tech start-up office with plants'] },
  creative: { wear: ['relaxed stylish clothes with a statement accessory', 'an artsy layered outfit'], where: ['in a bright design studio', 'in an art gallery'] },
  healthcare: { wear: ['medical scrubs', 'a pharmacist\'s white coat'], where: ['outside a clinic', 'in a pharmacy'] },
  service: { wear: ['a neat staff apron', 'a smart retail staff uniform'], where: ['in the café where they work', 'in a retail store'] },
  trades: { wear: ['a sturdy work jacket', 'a polo shirt with work trousers'], where: ['at a workshop', 'next to a delivery van on a city street'] },
  entrepreneur: { wear: ['smart casual clothes', 'a crisp shirt'], where: ['in their own small shop', 'at their market stall'] },
  homemaker: { wear: ['comfortable casual clothes', 'a relaxed cardigan'], where: ['at home in a bright kitchen', 'carrying groceries at a local market'] },
  retired: { wear: ['a relaxed polo shirt or cardigan', 'comfortable smart-casual clothes'], where: ['in a neighbourhood park', 'in a garden at home'] },
};

export const NEGATIVE_PROMPT = 'cartoon, illustration, painting, drawing, 3d render, anime, deformed, distorted face, extra fingers, blurry, low quality, text, watermark, logo, hat, sunglasses, suit and tie, corporate headshot, studio backdrop';

function look(s: HeadshotSpec): { wear: string; where: string } {
  const n = Number(s.key.replace(/\D/g, ''));
  const l = ROLE_LOOK[s.role];
  return { wear: l.wear[n % l.wear.length]!, where: l.where[(n >> 1) % l.where.length]! };
}

export function headshotPrompt(s: HeadshotSpec): string {
  const who = `${s.age} year old ${WHO[s.region]} ${s.gender === 'F' ? 'woman' : 'man'}`;
  const hair = s.style === 'hijab' ? 'wearing a hijab' : s.style === 'bald' ? 'shaved head' : `${HAIR_WORD[s.hair] ?? ''} ${STYLE_WORD[s.style]}`.trim();
  const extras = [s.beard === 'full' ? 'full beard' : s.beard === 'stubble' ? 'light stubble' : s.beard === 'mustache' ? 'moustache' : '', s.glasses ? 'glasses' : '', s.earrings ? 'small earrings' : ''].filter(Boolean);
  return [
    `Candid photorealistic lifestyle portrait photo of a ${who}`,
    hair,
    ...extras,
    `wearing ${look(s).wear}`,
    `${look(s).where}, softly blurred background`,
    'head and shoulders, relaxed genuine smile, natural daylight, shallow depth of field, sharp focus on the face, detailed natural skin texture, editorial lifestyle photography, 50mm, entirely fictional person',
  ].join(', ');
}

export interface PhotoRun {
  attempted: number;
  generated: number;
  failed: { key: string; reason: string }[];
}

const IMAGES_URL = 'https://api.openai.com/v1/images/generations';

async function generateRaw(s: HeadshotSpec, key: string): Promise<Buffer> {
  const e = env();
  if (e.IMAGE_PROVIDER === 'openai') {
    const res = await fetch(IMAGES_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: e.IMAGE_MODEL, prompt: headshotPrompt(s), size: '1024x1024', quality: 'low', n: 1 }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new Error(`Images API ${res.status}${d?.error?.code ? ` (${d.error.code})` : ''}${d?.error?.message ? `: ${d.error.message.slice(0, 160)}` : ''}`);
    }
    const body = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = body.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (item?.url) return Buffer.from(await (await fetch(item.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
    throw new Error('The Images API returned no image.');
  }
  const client = new InferenceClient(key);
  const image = await client.textToImage(
    { provider: e.IMAGE_PROVIDER as 'fal-ai', model: e.IMAGE_MODEL, inputs: headshotPrompt(s), parameters: { negative_prompt: NEGATIVE_PROMPT, width: 1024, height: 1024 } },
    { outputType: 'blob' },
  );
  return Buffer.from(await image.arrayBuffer());
}

async function generateOne(s: HeadshotSpec, key: string): Promise<Buffer> {
  // Square on the face, 512 px, compact.
  return sharp(await generateRaw(s, key)).resize(512, 512, { fit: 'cover', position: 'attention' }).webp({ quality: 84 }).toBuffer();
}

/** Generate photographs for every headshot not yet a photo (or for all with `force`). */
export async function generatePhotoHeadshots(opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<PhotoRun> {
  const e = env();
  const key = imageKey(e);
  if (!imagesConfigured(e) || !key) throw new Error(e.IMAGE_PROVIDER === 'openai' ? 'No image key is set (IMAGE_API_KEY in the deployment settings), so photographs cannot be generated.' : 'No image key is set (HF_TOKEN in the deployment settings), so photographs cannot be generated.');
  await ensureHeadshots();
  const have = new Map((await prisma.headshot.findMany({ select: { key: true, source: true, style: true } })).map((h) => [h.key, `${h.source}:${h.style ?? ''}`]));
  // Regenerate anything that is not yet a photo in the current style.
  const todo = HEADSHOTS.filter((h) => opts.force || have.get(h.key) !== `photo:${PHOTO_STYLE}`);
  const run: PhotoRun = { attempted: todo.length, generated: 0, failed: [] };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const s = todo[next++]!;
      try {
        const data = await generateOne(s, key);
        await prisma.headshot.update({ where: { key: s.key }, data: { data: new Uint8Array(data), mime: 'image/webp', source: 'photo', style: PHOTO_STYLE } });
        run.generated += 1;
      } catch (err) {
        run.failed.push({ key: s.key, reason: err instanceof Error ? err.message : 'failed' });
        // A key or quota problem will fail every call; stop early rather than make a hundred failing requests.
        if (/\b(401|402|403|429)\b|unauthorized|credit|quota|rate limit/i.test(String(err))) next = todo.length;
      }
      opts.onProgress?.(++done, todo.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return run;
}

/** Whether any portrait still needs a photo in the current style. */
export async function headshotsOutdated(): Promise<number> {
  await ensureHeadshots();
  return prisma.headshot.count({ where: { OR: [{ source: { not: 'photo' } }, { style: { not: PHOTO_STYLE } }, { style: null }] } });
}

/**
 * Give every built cast the portraits that now fit it best (gender, region, occupation, age, tier),
 * never repeating a face within a cast. Run after the catalog or the matching changes.
 */
export async function reassignHeadshots(): Promise<number> {
  const cohorts = await prisma.cohort.findMany({ where: { buildStatus: 'COMPLETED' }, select: { id: true } });
  let changed = 0;
  for (const c of cohorts) {
    const people = await prisma.persona.findMany({ where: { cohortId: c.id }, orderBy: { createdAt: 'asc' }, include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } });
    const taken = new Set<string>();
    for (const p of people) {
      const v = p.versions[0];
      const profile = (v?.profile ?? null) as CastProfile | null;
      if (!v || !profile) continue;
      const key = pickHeadshot({ id: p.id, market: profile.market, gender: profile.identity?.gender, age: profile.identity?.age, occupation: profile.identity?.occupation, tier: profile.tier }, taken);
      taken.add(key);
      if (profile.headshot !== key) {
        await prisma.personaVersion.update({ where: { id: v.id }, data: { profile: { ...profile, headshot: key } as object } });
        changed++;
      }
    }
  }
  return changed;
}

/**
 * Replace the illustrated headshots with synthetic photographic portraits (server only).
 *
 * Each catalog entry is described to an image model (OpenAI Images API) as a studio headshot of an
 * invented person; the result is cropped square, resized and stored in the Headshot table. These are
 * AI-generated faces of people who do not exist — never photographs of real people — and the app
 * keeps saying the personas are illustrative.
 */
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { decisionsConfigured, env } from '@/lib/env';
import { HEADSHOTS, type HeadshotSpec, type Region } from './catalog';
import { ensureHeadshots } from './store';

const IMAGE_API_URL = 'https://api.openai.com/v1/images/generations';
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
const OUTFIT_WORD: Record<string, string> = { tee: 'a plain crew-neck top', shirt: 'a collared shirt', blazer: 'a business blazer over a shirt', turtle: 'a smart roll-neck top' };

export function headshotPrompt(s: HeadshotSpec): string {
  const who = `a ${s.age}-year-old ${WHO[s.region]} ${s.gender === 'F' ? 'woman' : 'man'}`;
  const hair = s.style === 'hijab' ? 'wearing a hijab' : s.style === 'bald' ? 'with a shaved head' : `with ${HAIR_WORD[s.hair] ?? ''} ${STYLE_WORD[s.style]}`.replace('  ', ' ');
  const extras = [s.beard === 'full' ? 'a full beard' : s.beard === 'stubble' ? 'light stubble' : s.beard === 'mustache' ? 'a moustache' : '', s.glasses ? 'glasses' : '', s.earrings ? 'small earrings' : ''].filter(Boolean);
  return [
    `Photorealistic professional headshot photograph of ${who}, ${hair}${extras.length ? `, with ${extras.join(' and ')}` : ''}, wearing ${OUTFIT_WORD[s.outfit]}.`,
    'Head and shoulders, facing the camera, friendly natural expression, soft studio light, plain light neutral grey background, sharp focus, natural skin texture, like a corporate website portrait.',
    'The person is entirely fictional. No text, no logos, no watermark.',
  ].join(' ');
}

export interface PhotoRun {
  attempted: number;
  generated: number;
  failed: { key: string; reason: string }[];
}

async function generateOne(s: HeadshotSpec, key: string): Promise<Buffer> {
  const e = env();
  const res = await fetch(IMAGE_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: e.IMAGE_MODEL, prompt: headshotPrompt(s), size: '1024x1024', quality: 'medium', n: 1 }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const d = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new Error(`Images API ${res.status}${d?.error?.code ? ` (${d.error.code})` : ''}${d?.error?.message ? `: ${d.error.message.slice(0, 160)}` : ''}`);
  }
  const body = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
  const item = body.data?.[0];
  let raw: Buffer;
  if (item?.b64_json) raw = Buffer.from(item.b64_json, 'base64');
  else if (item?.url) raw = Buffer.from(await (await fetch(item.url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
  else throw new Error('The Images API returned no image.');
  // Square on the face (upper-centre), 512 px, compact.
  return sharp(raw).resize(512, 512, { fit: 'cover', position: 'attention' }).webp({ quality: 84 }).toBuffer();
}

/** Generate photographs for every headshot not yet a photo (or for all with `force`). */
export async function generatePhotoHeadshots(opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<PhotoRun> {
  const e = env();
  if (!decisionsConfigured(e)) throw new Error('No OpenAI key is set (OPENAI_API_KEY), so photographs cannot be generated.');
  const key = e.OPENAI_API_KEY!.trim();
  await ensureHeadshots();
  const have = new Map((await prisma.headshot.findMany({ select: { key: true, source: true } })).map((h) => [h.key, h.source]));
  const todo = HEADSHOTS.filter((h) => opts.force || have.get(h.key) !== 'photo');
  const run: PhotoRun = { attempted: todo.length, generated: 0, failed: [] };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < todo.length) {
      const s = todo[next++]!;
      try {
        const data = await generateOne(s, key);
        await prisma.headshot.update({ where: { key: s.key }, data: { data: new Uint8Array(data), mime: 'image/webp', source: 'photo' } });
        run.generated += 1;
      } catch (err) {
        run.failed.push({ key: s.key, reason: err instanceof Error ? err.message : 'failed' });
        // A key or quota problem will fail every call; stop early rather than make fifty failing requests.
        if (/\b(401|403|429)\b|insufficient_quota|invalid_api_key/.test(String(err))) next = todo.length;
      }
      opts.onProgress?.(++done, todo.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return run;
}

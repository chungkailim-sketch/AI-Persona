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
import { HEADSHOTS, type HeadshotSpec, type Region } from './catalog';
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
const OUTFIT_WORD: Record<string, string> = { tee: 'a casual t-shirt', shirt: 'a relaxed linen shirt', blazer: 'a light casual jacket', turtle: 'a cosy knit sweater' };
/** Everyday places, so the portraits read as lifestyle photographs rather than office headshots. */
const SETTINGS = [
  'at a sunny neighbourhood café', 'in a leafy city park', 'at a busy street market', 'at home in a bright living room', 'on a city street at golden hour',
  'in a small bookshop', 'on a seaside promenade', 'in a home kitchen', 'at a weekend food court', 'on a shopping street', 'on a garden terrace', 'on a rooftop at sunset',
];

export const NEGATIVE_PROMPT = 'cartoon, illustration, painting, drawing, 3d render, anime, deformed, distorted face, extra fingers, blurry, low quality, text, watermark, logo, hat, sunglasses, suit and tie, corporate headshot, studio backdrop';

export function headshotPrompt(s: HeadshotSpec): string {
  const who = `${s.age} year old ${WHO[s.region]} ${s.gender === 'F' ? 'woman' : 'man'}`;
  const hair = s.style === 'hijab' ? 'wearing a hijab' : s.style === 'bald' ? 'shaved head' : `${HAIR_WORD[s.hair] ?? ''} ${STYLE_WORD[s.style]}`.trim();
  const extras = [s.beard === 'full' ? 'full beard' : s.beard === 'stubble' ? 'light stubble' : s.beard === 'mustache' ? 'moustache' : '', s.glasses ? 'glasses' : '', s.earrings ? 'small earrings' : ''].filter(Boolean);
  return [
    `Candid photorealistic lifestyle portrait photo of a ${who}`,
    hair,
    ...extras,
    `wearing ${OUTFIT_WORD[s.outfit]}`,
    `${SETTINGS[Number(s.key.replace(/\D/g, '')) % SETTINGS.length]}, softly blurred background`,
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
        // A key or quota problem will fail every call; stop early rather than make a hundred failing requests.
        if (/\b(401|402|403|429)\b|unauthorized|credit|quota|rate limit/i.test(String(err))) next = todo.length;
      }
      opts.onProgress?.(++done, todo.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return run;
}

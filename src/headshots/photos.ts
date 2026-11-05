/**
 * Replace the illustrated headshots with synthetic photographic portraits (server only).
 *
 * Each catalog entry is described to an image model (Stable Diffusion XL through Hugging Face
 * Inference Providers, fal-ai) as a studio headshot of an invented person; the result is cropped square, resized and stored in the Headshot table. These are
 * AI-generated faces of people who do not exist — never photographs of real people — and the app
 * keeps saying the personas are illustrative.
 */
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { InferenceClient } from '@huggingface/inference';
import { imagesConfigured, env } from '@/lib/env';
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
const OUTFIT_WORD: Record<string, string> = { tee: 'a plain crew-neck top', shirt: 'a collared shirt', blazer: 'a business blazer over a shirt', turtle: 'a smart roll-neck top' };

export const NEGATIVE_PROMPT = 'cartoon, illustration, painting, drawing, 3d render, anime, deformed, distorted face, extra fingers, blurry, low quality, text, watermark, logo, hat, sunglasses';

export function headshotPrompt(s: HeadshotSpec): string {
  const who = `${s.age} year old ${WHO[s.region]} ${s.gender === 'F' ? 'woman' : 'man'}`;
  const hair = s.style === 'hijab' ? 'wearing a hijab' : s.style === 'bald' ? 'shaved head' : `${HAIR_WORD[s.hair] ?? ''} ${STYLE_WORD[s.style]}`.trim();
  const extras = [s.beard === 'full' ? 'full beard' : s.beard === 'stubble' ? 'light stubble' : s.beard === 'mustache' ? 'moustache' : '', s.glasses ? 'glasses' : '', s.earrings ? 'small earrings' : ''].filter(Boolean);
  return [
    `Photorealistic professional corporate headshot photo of a ${who}`,
    hair,
    ...extras,
    `wearing ${OUTFIT_WORD[s.outfit]}`,
    'head and shoulders, looking at camera, friendly natural smile, soft studio lighting, plain light grey background, sharp focus, detailed natural skin texture, 85mm portrait photography, entirely fictional person',
  ].join(', ');
}

export interface PhotoRun {
  attempted: number;
  generated: number;
  failed: { key: string; reason: string }[];
}

async function generateOne(s: HeadshotSpec, client: InferenceClient): Promise<Buffer> {
  const e = env();
  const image = await client.textToImage(
    {
      provider: e.IMAGE_PROVIDER as 'fal-ai',
      model: e.IMAGE_MODEL,
      inputs: headshotPrompt(s),
      parameters: { negative_prompt: NEGATIVE_PROMPT, width: 1024, height: 1024 },
    },
    { outputType: 'blob' },
  );
  const raw = Buffer.from(await image.arrayBuffer());
  // Square on the face, 512 px, compact.
  return sharp(raw).resize(512, 512, { fit: 'cover', position: 'attention' }).webp({ quality: 84 }).toBuffer();
}

/** Generate photographs for every headshot not yet a photo (or for all with `force`). */
export async function generatePhotoHeadshots(opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<PhotoRun> {
  const e = env();
  if (!imagesConfigured(e)) throw new Error('No Hugging Face token is set (HF_TOKEN), so photographs cannot be generated.');
  const client = new InferenceClient(e.HF_TOKEN!.trim());
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
        const data = await generateOne(s, client);
        await prisma.headshot.update({ where: { key: s.key }, data: { data: new Uint8Array(data), mime: 'image/webp', source: 'photo' } });
        run.generated += 1;
      } catch (err) {
        run.failed.push({ key: s.key, reason: err instanceof Error ? err.message : 'failed' });
        // A key or quota problem will fail every call; stop early rather than make fifty failing requests.
        if (/\b(401|402|403|429)\b|unauthorized|credit|quota|rate limit/i.test(String(err))) next = todo.length;
      }
      opts.onProgress?.(++done, todo.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return run;
}

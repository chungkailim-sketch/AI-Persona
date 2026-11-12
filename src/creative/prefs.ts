/**
 * Communication preferences and creative treatment for a project (the Brief step). With the
 * roundtable's key messaging they drive the AIGC creative brief (src/creative/brief.ts). Stored on
 * Project.creative; every field is optional and has a sensible default.
 */
import { z } from 'zod';

export const PLATFORMS = ['Instagram Reels', 'TikTok', 'YouTube', 'YouTube Shorts', 'Facebook', 'LinkedIn', 'Xiaohongshu (RED)', 'Douyin', 'WeChat Channels', 'Website hero', 'Event / OOH screen'] as const;
export const DELIVERABLES = ['Single clip', 'Multi-shot sequence', 'Image set', 'Seamless loop'] as const;
export const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
export const TONES = ['Warm', 'Confident', 'Premium', 'Playful', 'Inspiring', 'Authoritative', 'Down-to-earth', 'Witty'] as const;
export const MODES = ['Text to video', 'Image to video', 'Video to video', 'Image generation', 'Performance capture'] as const;
export const STYLES = ['Photoreal', 'Cinematic live-action', '3D render', 'Illustration', 'Stop-motion', 'Documentary'] as const;
export const PACING = ['Slow and cinematic', 'Rhythmic', 'Fast cuts'] as const;
export const RESOLUTIONS = ['720p native, upscale approved clips', '1080p native', '4K (upscaled)'] as const;
export const CLIP_SECONDS = [5, 10] as const;
export const FRAME_RATES = [24, 25, 30] as const;

const str = (max: number) => z.string().trim().max(max).default('');
const pick = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) => z.enum(values).catch(fallback).default(fallback);
const many = <T extends readonly [string, ...string[]]>(values: T) => z.array(z.string()).default([]).transform((xs) => xs.filter((x): x is T[number] => (values as readonly string[]).includes(x)));

export const CreativePrefs = z.object({
  // Communication preference
  brand: str(120),
  owner: str(120),
  objective: str(400),
  platforms: many(PLATFORMS),
  ratios: many(RATIOS),
  tones: many(TONES),
  languages: str(120),
  cta: str(200),
  mandatories: str(600),
  noGos: str(600),
  // Creative treatment
  mode: pick(MODES, 'Text to video'),
  deliverable: pick(DELIVERABLES, 'Multi-shot sequence'),
  style: pick(STYLES, 'Cinematic live-action'),
  mood: str(160),
  pacing: pick(PACING, 'Rhythmic'),
  lighting: str(200),
  palette: str(200),
  filmLook: str(160),
  references: str(400),
  heroPersonaId: str(40),
  runtimeSeconds: z.coerce.number().int().min(5).max(180).catch(30).default(30),
  clipSeconds: z.coerce.number().refine((n) => (CLIP_SECONDS as readonly number[]).includes(n)).catch(10).default(10),
  frameRate: z.coerce.number().refine((n) => (FRAME_RATES as readonly number[]).includes(n)).catch(24).default(24),
  resolution: pick(RESOLUTIONS, '720p native, upscale approved clips'),
});
export type CreativePrefs = z.infer<typeof CreativePrefs>;

export function readPrefs(raw: unknown): CreativePrefs {
  return CreativePrefs.parse(raw && typeof raw === 'object' ? raw : {});
}

/** Shots needed: runtime divided by clip length, plus one spare per four. */
export function shotCount(p: CreativePrefs): number {
  const n = Math.ceil(p.runtimeSeconds / p.clipSeconds);
  return n + Math.max(1, Math.round(n / 4));
}


/**
 * A client brand for the report deck, read from an uploaded PowerPoint template (server only for the
 * parsing; the style helpers are pure).
 *
 * A .pptx, .potx or .thmx carries its brand in the theme: twelve colours (dark 1/2, light 1/2,
 * accents 1–6, links) and a heading and a body font. Those become the deck's colours and type, so the
 * slides, the printed PDF and the PowerPoint export all follow the client's guideline. A logo, if
 * given, replaces the Ruder Finn and rf.AI Persona logos on the slides.
 */
import JSZip from 'jszip';

export interface BrandTheme {
  name: string;
  fileName: string;
  colors: { dark1: string; light1: string; dark2: string; light2: string; accents: string[] };
  fonts: { heading: string | null; body: string | null; eastAsian: string | null };
  /** A data: URL of the logo image, when one was uploaded. */
  logo: string | null;
  uploadedAt: string;
}

export class BrandTemplateRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrandTemplateRefused';
  }
}

const HEX = /^[0-9a-f]{6}$/i;

function colour(xml: string, tag: string): string | null {
  const block = new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`).exec(xml)?.[1];
  if (!block) return null;
  const v = /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(block)?.[1] ?? /lastClr="([0-9A-Fa-f]{6})"/.exec(block)?.[1];
  return v && HEX.test(v) ? `#${v.toLowerCase()}` : null;
}

function typeface(xml: string, kind: 'majorFont' | 'minorFont', script: 'latin' | 'ea'): string | null {
  const block = new RegExp(`<a:${kind}>([\\s\\S]*?)</a:${kind}>`).exec(xml)?.[1];
  const v = block ? new RegExp(`<a:${script} typeface="([^"]*)"`).exec(block)?.[1] : null;
  return v && v.trim() && !v.startsWith('+') ? v.trim().slice(0, 80) : null;
}

/** The theme of a PowerPoint template or theme file. */
export async function readBrandTemplate(bytes: Buffer, fileName: string): Promise<Omit<BrandTheme, 'logo' | 'uploadedAt'>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new BrandTemplateRefused('The template could not be opened. Upload a PowerPoint template (.pptx, .potx) or theme (.thmx).');
  }
  const themes = Object.keys(zip.files).filter((n) => /(^|\/)theme\/theme\d+\.xml$/.test(n)).sort();
  // The slide master's theme is the first; a .thmx keeps it at theme/theme/theme1.xml.
  const path = themes.find((n) => /ppt\/theme\/theme1\.xml$/.test(n)) ?? themes[0];
  if (!path) throw new BrandTemplateRefused('No theme was found in this file. Upload a PowerPoint template (.pptx, .potx) or theme (.thmx).');
  const xml = await zip.file(path)!.async('string');
  const accents = [1, 2, 3, 4, 5, 6].map((i) => colour(xml, `accent${i}`)).filter((c): c is string => Boolean(c));
  const dark1 = colour(xml, 'dk1') ?? '#1a1c1c';
  const light1 = colour(xml, 'lt1') ?? '#ffffff';
  if (accents.length === 0) throw new BrandTemplateRefused('The template has no theme colours to apply.');
  return {
    name: /<a:theme [^>]*name="([^"]*)"/.exec(xml)?.[1]?.slice(0, 80) || fileName,
    fileName,
    colors: { dark1, light1, dark2: colour(xml, 'dk2') ?? dark1, light2: colour(xml, 'lt2') ?? light1, accents },
    fonts: { heading: typeface(xml, 'majorFont', 'latin'), body: typeface(xml, 'minorFont', 'latin'), eastAsian: typeface(xml, 'minorFont', 'ea') ?? typeface(xml, 'majorFont', 'ea') },
  };
}

// ── Colour helpers ────────────────────────────────────────────────────────────

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const mix = (a: string, b: string, t: number) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i]! - v) * t));
/** The colour darkened (towards black) until it reads on white at 4.5:1. */
const readableOnWhite = (hex: string) => {
  let c = hex;
  for (let i = 0; i < 20 && contrast(c, '#ffffff') < 4.5; i++) c = mix(c, '#000000', 0.12);
  return c;
};
const inkOn = (bg: string) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');

/** CSS custom properties that put the deck in the client's colours and type. */
export function brandStyle(t: BrandTheme): Record<string, string> {
  const a = t.colors.accents;
  const primary = readableOnWhite(a[0]!);
  const mark = a[0]!;
  // The deep band colour: the theme's second dark if it is dark enough to carry white text, else the primary.
  const deep = contrast(t.colors.dark2, '#ffffff') >= 4.5 ? t.colors.dark2 : readableOnWhite(primary);
  const highlight = a[1] ?? a[0]!;
  const fonts = [t.fonts.body, t.fonts.eastAsian].filter(Boolean).map((f) => `'${f!.replace(/'/g, '')}'`);
  const heading = [t.fonts.heading, t.fonts.eastAsian].filter(Boolean).map((f) => `'${f!.replace(/'/g, '')}'`);
  return {
    '--color-brand': primary,
    '--color-brand-ink': inkOn(primary),
    '--color-brand-mark': mark,
    '--color-brand-soft': mix(mark, '#ffffff', 0.88),
    '--color-brand-deep': deep,
    '--color-brand-deep-ink': inkOn(deep),
    '--color-highlight': highlight,
    '--color-action': primary,
    '--color-action-ink': inkOn(primary),
    '--heat-high': primary,
    '--heat-high-ink': inkOn(primary),
    '--heat-mid': mix(highlight, '#ffffff', 0.65),
    '--heat-mid-ink': '#1a1c1c',
    '--tier-priority': deep,
    '--tier-build': mark,
    '--tier-row-1': deep,
    '--tier-row-1-ink': inkOn(deep),
    '--tier-row-2': primary,
    '--tier-row-2-ink': inkOn(primary),
    '--tier-row-3': mix(mark, '#ffffff', 0.8),
    '--tier-row-3-ink': deep,
    '--gradient-brand': `linear-gradient(100deg, ${mix(mark, '#ffffff', 0.5)} 0%, ${mark} 100%)`,
    ...(fonts.length ? { '--brand-font-body': `${fonts.join(', ')}, var(--font-sans), sans-serif` } : {}),
    ...(heading.length ? { '--brand-font-heading': `${heading.join(', ')}, var(--font-sans), sans-serif` } : {}),
  };
}

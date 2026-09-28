/**
 * WCAG 2.2 AA contrast for every text and control token, in both themes, computed from the actual
 * stylesheet. A token change that drops a pair below its threshold fails here, not in an audit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`No block ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const body = css.slice(open + 1, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = block(':root {');
const dark = { ...light, ...block(":root[data-theme='dark'] {") };

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const TEXT = ['--color-ink', '--color-ink-muted', '--color-ink-subtle', '--color-link', '--color-ok', '--color-warn', '--color-danger', '--color-info', '--color-pending', '--color-brand', '--color-observed', '--color-derived', '--color-inferred', '--color-simulated'];
const SURFACES = ['--color-bg', '--color-surface', '--color-elevated', '--color-input', '--color-surface-raised'];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, t) => {
  it.each(TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg] as const)))('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['ok', 'warn', 'danger', 'info', 'pending'])('%s text on its soft background ≥ 4.5:1', (k) => {
    expect(ratio(t[`--color-${k}`]!, t[`--color-${k}-soft`]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('brand text on brand-soft ≥ 4.5:1', () => {
    expect(ratio(t['--color-brand']!, t['--color-brand-soft']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('text on the brand fill ≥ 4.5:1', () => {
    expect(ratio(t['--color-brand-ink']!, t['--color-brand']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('telemetry ink on the telemetry well ≥ 4.5:1', () => {
    expect(ratio(t['--color-telemetry-ink']!, t['--color-telemetry']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['--color-ink-subtle']!, t['--color-telemetry']!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SURFACES)('control boundaries and the focus ring are ≥ 3:1 on %s', (bg) => {
    expect(ratio(t['--color-line-strong']!, t[bg]!)).toBeGreaterThanOrEqual(3);
    expect(ratio(t['--color-brand']!, t[bg]!)).toBeGreaterThanOrEqual(3);
  });
});

describe('the two dark blocks', () => {
  it('define identical values, so an OS preference and an explicit choice look the same', () => {
    const media = block(":root:not([data-theme='light']) {");
    const explicit = block(":root[data-theme='dark'] {");
    expect(media).toEqual(explicit);
  });
});

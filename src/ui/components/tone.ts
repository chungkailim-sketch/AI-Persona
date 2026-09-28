import type { Tone } from '@/telemetry/status';

/** Tone → classes. Text colour always comes from the matching foreground token, never the fill. */
export const TONE_BADGE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok border-ok/30',
  warn: 'bg-warn-soft text-warn border-warn/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  info: 'bg-info-soft text-info border-info/30',
  pending: 'bg-pending-soft text-pending border-pending/30',
  neutral: 'bg-bg text-ink-muted border-line',
  brand: 'bg-brand-soft text-brand border-brand/30',
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  pending: 'text-pending',
  neutral: 'text-ink-muted',
  brand: 'text-brand',
};

export const TONE_BORDER: Record<Tone, string> = {
  ok: 'border-ok/50',
  warn: 'border-warn/60',
  danger: 'border-danger/60',
  info: 'border-info/60',
  pending: 'border-line',
  neutral: 'border-line',
  brand: 'border-brand/60',
};

/** Solid fills for bars. Only used for marks, never behind text. */
export const TONE_FILL: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  pending: 'bg-pending',
  neutral: 'bg-ink-subtle',
  brand: 'bg-brand',
};

import { Icon } from './Icon';
import { TONE_BADGE } from './tone';
import { cn } from '../cn';
import type { StatusMeta } from '@/telemetry/status';

/**
 * Icon + word + tone. Never colour alone: the word is always rendered, and the description is
 * available to assistive technology and as a tooltip.
 */
export function StatusBadge({
  meta,
  label,
  size = 'sm',
  className,
  showDescription = false,
}: {
  meta: StatusMeta;
  label?: string;
  size?: 'xs' | 'sm';
  className?: string;
  showDescription?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-sm border font-mono uppercase tracking-wide',
        size === 'xs' ? 'px-1.5 py-px text-[9.5px]' : 'px-2 py-0.5 text-[10.5px]',
        TONE_BADGE[meta.tone],
        className,
      )}
      title={meta.description}
    >
      <Icon name={meta.icon} size={size === 'xs' ? 10 : 12} className={meta.live ? 'motion-live' : undefined} />
      <span>{label ?? meta.label}</span>
      {showDescription && <span className="sr-only"> — {meta.description}</span>}
    </span>
  );
}

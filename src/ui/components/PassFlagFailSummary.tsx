import { VERDICT_META, VERDICT_THRESHOLD_SOURCE, type EvaluationState } from '@/telemetry/status';
import { Icon } from './Icon';
import { TONE_BADGE, TONE_FILL } from './tone';
import { cn } from '../cn';
import { fmtTime, TZ_LABEL } from '@/lib/time';

/**
 * Pass / flag / fail, with the definition and threshold source beside the numbers rather than in
 * a footnote. Each state has an icon and a word; the stacked bar is decoration over the table-like
 * list, which carries the same figures.
 */
export function PassFlagFailSummary({
  pass,
  flag,
  fail,
  pending,
  updatedAt,
  title = 'Answer evaluation',
  unavailableReason,
}: {
  pass: number;
  flag: number;
  fail: number;
  pending?: number | null;
  updatedAt?: string | null;
  title?: string;
  unavailableReason?: string | null;
}) {
  const total = pass + flag + fail;
  const rows: { key: EvaluationState; n: number | null }[] = [
    { key: 'pass', n: pass },
    { key: 'flag', n: flag },
    { key: 'fail', n: fail },
    { key: 'pending', n: pending ?? null },
  ];
  return (
    <section className="panel" aria-labelledby="pff-title">
      <div className="panel-head">
        <h3 id="pff-title" className="font-sans text-sm font-medium text-ink">{title}</h3>
        <span className="font-mono text-[11px] text-ink-subtle">{total} evaluated{updatedAt ? ` · ${fmtTime(updatedAt)} ${TZ_LABEL}` : ''}</span>
      </div>
      <div className="p-3">
        {unavailableReason ? (
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Icon name="slash" size={13} /> {VERDICT_META.unavailable.label}: {unavailableReason}
          </p>
        ) : (
          <>
            <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-track" aria-hidden>
              {total > 0 &&
                (['pass', 'flag', 'fail'] as const).map((k) => {
                  const n = k === 'pass' ? pass : k === 'flag' ? flag : fail;
                  return n > 0 ? <span key={k} className={cn('h-full motion-progress', TONE_FILL[VERDICT_META[k].tone])} style={{ width: `${(n / total) * 100}%` }} /> : null;
                })}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {rows.map(({ key, n }) => {
                const meta = VERDICT_META[n === null ? 'not_evaluated' : key];
                return (
                  <li key={key} className="flex flex-col gap-0.5" title={VERDICT_META[key].description} data-verdict-summary={key}>
                    <span className={cn('inline-flex w-fit items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[10px] uppercase', TONE_BADGE[VERDICT_META[key].tone])}>
                      <Icon name={VERDICT_META[key].icon} size={11} />
                      {VERDICT_META[key].label}
                    </span>
                    <span className="font-mono text-lg tabular-nums text-ink">
                      {n === null ? <span className="text-sm text-ink-subtle">{meta.label}</span> : n}
                      {n !== null && total > 0 && key !== 'pending' && (
                        <span className="ml-1 text-xs text-ink-subtle">{Math.round((n / total) * 100)}%</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="mt-2 text-[11px] leading-snug text-ink-subtle">{VERDICT_THRESHOLD_SOURCE}</p>
      </div>
    </section>
  );
}

import { PERSONA_ACTIVITY_ORDER, type PersonaActivity } from '@/telemetry/reduce';
import { PERSONA_ACTIVITY_META } from '@/telemetry/status';
import { Icon } from './Icon';
import { TONE_BADGE } from './tone';
import { cn } from '../cn';

/**
 * Where every persona is. Always an aggregated count per state; individual cells are drawn only
 * for panels small enough that each one is legible (≤ 120) — a large cohort is never a thousand
 * animated DOM nodes.
 */
export function PersonaStateSummary({ states, cellLimit = 120 }: { states: Map<string, PersonaActivity>; cellLimit?: number }) {
  const counts = new Map<PersonaActivity, number>();
  for (const s of states.values()) counts.set(s, (counts.get(s) ?? 0) + 1);
  const total = states.size;
  return (
    <section className="panel" aria-labelledby="personas-live-title">
      <div className="panel-head">
        <h3 id="personas-live-title" className="font-sans text-sm font-medium text-ink">Persona activity</h3>
        <span className="font-mono text-[11px] text-ink-subtle">{total} in panel</span>
      </div>
      <div className="p-3">
        <ul className="flex flex-wrap gap-1.5" aria-label="Personas by state">
          {PERSONA_ACTIVITY_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => {
            const meta = PERSONA_ACTIVITY_META[s];
            return (
              <li key={s} className={cn('inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11.5px]', TONE_BADGE[meta.tone])} title={meta.description} data-persona-state={s}>
                <Icon name={meta.icon} size={11} className={meta.live ? 'motion-live' : undefined} />
                {meta.label}
                <span className="font-mono tabular-nums">{counts.get(s)}</span>
              </li>
            );
          })}
          {total === 0 && <li className="text-xs text-ink-subtle">No personas bound to this run yet.</li>}
        </ul>
        {total > 0 && total <= cellLimit && (
          <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1" aria-label="Each persona">
            {[...states.entries()].map(([key, s]) => {
              const meta = PERSONA_ACTIVITY_META[s];
              return (
                <li key={key} className={cn('flex items-center gap-1.5 truncate rounded-sm border px-1.5 py-1 text-[11px]', TONE_BADGE[meta.tone])} title={`${key}: ${meta.label}`}>
                  <Icon name={meta.icon} size={10} className={cn('shrink-0', meta.live && 'motion-live')} />
                  <span className="truncate">{key}</span>
                  <span className="sr-only">: {meta.label}</span>
                </li>
              );
            })}
          </ul>
        )}
        {total > cellLimit && <p className="mt-2 text-[11px] text-ink-subtle">Individual personas are listed in the activity feed; this panel aggregates panels larger than {cellLimit}.</p>}
      </div>
    </section>
  );
}

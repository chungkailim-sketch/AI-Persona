import { RUN_STAGE_CATALOGUE } from '@/telemetry/contract';
import type { DebateStageState, RunStageStates } from '@/telemetry/reduce';
import { NODE_STATUS_META } from '@/telemetry/status';
import { Icon } from './Icon';
import { TONE_BADGE, TONE_FILL } from './tone';
import { cn } from '../cn';

/** The orchestrator's eight stages, each with its recorded state and, when running, its progress. */
export function RunStageTracker({ stages }: { stages: RunStageStates }) {
  return (
    <section className="panel" aria-labelledby="stages-title">
      <div className="panel-head">
        <h3 id="stages-title" className="font-sans text-sm font-medium text-ink">Run stages</h3>
        <span className="font-mono text-[11px] text-ink-subtle">
          {RUN_STAGE_CATALOGUE.filter((s) => ['completed', 'warning', 'not_performed'].includes(stages[s.key].status)).length}/{RUN_STAGE_CATALOGUE.length}
        </span>
      </div>
      <ol className="flex flex-col p-2">
        {RUN_STAGE_CATALOGUE.map((s, i) => {
          const st = stages[s.key];
          const meta = NODE_STATUS_META[st.status];
          return (
            <li key={s.key} className="flex items-center gap-2.5 rounded px-2 py-1.5" data-stage={s.key} data-stage-status={st.status} aria-current={st.status === 'active' ? 'step' : undefined}>
              <span className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', TONE_BADGE[meta.tone])} aria-hidden>
                {st.status === 'pending' ? <span className="font-mono text-[9.5px]">{i + 1}</span> : <Icon name={meta.icon} size={12} className={meta.live ? 'motion-live' : undefined} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn('text-[13px]', st.status === 'active' ? 'font-medium text-ink' : 'text-ink-muted')}>{s.label}</span>
                  <span className="font-mono text-[10px] uppercase text-ink-subtle">{meta.label}</span>
                </span>
                {st.status === 'active' && st.count !== null && (
                  <ProgressBar current={st.count} total={null} tone="info" />
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function ProgressBar({ current, total, tone = 'brand', label }: { current: number; total: number | null; tone?: keyof typeof TONE_FILL; label?: string }) {
  if (!total) return label ? <span className="font-mono text-[10.5px] text-ink-subtle">{label}</span> : null;
  const pct = Math.max(0, Math.min(100, (current / total) * 100));
  return (
    <span className="mt-1 flex items-center gap-2">
      <span className="relative h-1.5 flex-1 rounded-full bg-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current} aria-label={label ?? 'Progress'}>
        <span className={cn('absolute inset-y-0 left-0 rounded-full motion-progress', TONE_FILL[tone])} style={{ width: `${pct}%` }} />
      </span>
      <span className="font-mono text-[10.5px] tabular-nums text-ink-subtle">{current}/{total}</span>
    </span>
  );
}

/** The nine method stages, mapped to where each is actually carried out. */
export function DebateStageTracker({ stages }: { stages: DebateStageState[] }) {
  return (
    <section className="panel" aria-labelledby="debate-title">
      <div className="panel-head">
        <h3 id="debate-title" className="font-sans text-sm font-medium text-ink">Debate method</h3>
        <span className="text-[11px] text-ink-subtle">9 stages · PRD §16.2</span>
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Debate stages table">
        <table className="w-full min-w-[34rem] text-left text-[12px]">
          <caption className="sr-only">Debate stages with state, completed tasks, warnings, participants and preliminary output</caption>
          <thead className="text-ink-subtle">
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-1.5 font-normal">Stage</th>
              <th scope="col" className="px-2 py-1.5 font-normal">State</th>
              <th scope="col" className="px-2 py-1.5 text-right font-normal">Tasks</th>
              <th scope="col" className="px-2 py-1.5 text-right font-normal">Warnings</th>
              <th scope="col" className="px-2 py-1.5 font-normal">Participating</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((d, i) => (
              <tr key={d.key} className="border-b border-line/70 align-top" data-debate-stage={d.key} data-stage-status={d.status}>
                <th scope="row" className="px-3 py-1.5 font-normal">
                  <span className="text-ink"><span className="font-mono text-ink-subtle">{i + 1}.</span> {d.label}</span>
                  {d.performedWithin && <span className="block text-[11px] text-ink-subtle">{d.performedWithin}</span>}
                  {d.preliminaryOutput && <span className="block text-[11px] text-info">Preliminary: {d.preliminaryOutput}</span>}
                </th>
                <td className="px-2 py-1.5">
                  <span className={cn('inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[9.5px] uppercase', TONE_BADGE[NODE_STATUS_META[d.status].tone])}>
                    <Icon name={NODE_STATUS_META[d.status].icon} size={10} />
                    {NODE_STATUS_META[d.status].label}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-ink-muted">{d.completedTasks}</td>
                <td className={cn('px-2 py-1.5 text-right font-mono tabular-nums', d.warnings > 0 ? 'text-warn' : 'text-ink-subtle')}>{d.warnings}</td>
                <td className="px-2 py-1.5 text-ink-muted">
                  {d.roles}
                  {d.participants > 0 && <span className="font-mono text-ink-subtle"> · {d.participants}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

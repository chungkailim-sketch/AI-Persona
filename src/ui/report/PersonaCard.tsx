/**
 * One cast persona, as on the cast slide: portrait, name and age, occupation and city, life stage,
 * decision logic and three key statistics with the tier's base. The identity is illustrative and
 * says so; the statistics are published figures.
 */
import type { ReactNode } from 'react';
import type { CastProfile } from '@/roundtable/engine';
import { cn } from '../cn';

export function initials(name: string): string {
  const parts = name.replace(/\[MOCK\]\s*/, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

export function PersonaAvatar({ name, portraitUrl, size = 56, className }: { name: string; portraitUrl?: string | null; size?: number; className?: string }) {
  if (portraitUrl) {
    return <img src={portraitUrl} alt="" width={size} height={size} className={cn('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand', className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </span>
  );
}

export function keyStats(profile: CastProfile) {
  const ids = profile.identity?.keyStatIds?.length ? profile.identity.keyStatIds : profile.stats.slice(0, 3).map((s) => s.id);
  return ids.map((id) => profile.stats.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
}

export function PersonaCard({ name, profile, portraitUrl, compact = false, footer }: { name: string; profile: CastProfile; portraitUrl?: string | null; compact?: boolean; footer?: ReactNode }) {
  const id = profile.identity;
  const stats = keyStats(profile);
  return (
    <article className="flex h-full flex-col gap-2 rounded border border-line bg-surface p-3" data-persona-card>
      <div className="flex items-start gap-3">
        <PersonaAvatar name={name} portraitUrl={portraitUrl} size={compact ? 40 : 52} />
        <div className="min-w-0">
          <h3 className="font-sans text-[15px] font-bold leading-tight text-ink">
            {name}
            {id?.age ? <span className="font-medium text-ink-muted"> • {id.age}</span> : null}
          </h3>
          {id && <p className="text-xs text-ink-muted">{[id.occupation, id.city].filter(Boolean).join(' · ')}</p>}
          {id?.lifeStage && <p className="text-xs text-ink-subtle">{id.lifeStage}</p>}
        </div>
      </div>
      {id?.decisionLogic?.length ? (
        <p className="rounded-sm bg-brand-soft px-2 py-1 text-xs font-semibold text-brand">{id.decisionLogic.join(' > ')}</p>
      ) : null}
      {!compact && (
        <ul className="flex flex-col gap-1.5">
          {stats.map((s) => (
            <li key={s.id} className="flex gap-2 text-xs">
              <span className="w-10 shrink-0 text-right font-bold text-brand">{Math.round(s.share)}%</span>
              <span className="text-ink-muted">
                {s.statement}
                {s.response && !/^agree$/i.test(s.response) ? ` — ${s.response}` : ''}
                <span className="text-ink-subtle"> (vs {Math.round(s.overall)}% all)</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto flex flex-wrap gap-x-2 text-[10.5px] text-ink-subtle">
        <span>{`Base n=${profile.base}`}</span>
        {id && <span>· Illustrative persona</span>}
      </p>
      {footer}
    </article>
  );
}

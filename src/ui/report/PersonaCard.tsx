/**
 * One persona in the format of the RF cast slide: round portrait, name • age, occupation · city,
 * life stage, then the decision logic with each driver's score — the share of the published
 * statistic that evidences it, with its difference from the market where it stands out. The
 * identity is illustrative and says so; the scores are published figures.
 */
import type { ReactNode } from 'react';
import type { CastProfile } from '@/roundtable/engine';
import { isoCode } from './markets';
import { headshotUrl, pickHeadshot } from '@/headshots/catalog';
import { cn } from '../cn';

export function initials(name: string): string {
  const parts = name.replace(/\[MOCK\]\s*/, '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

/** The persona's headshot: the one it was given, or (for a cast built before headshots) the best match. */
export function portraitOf(profile: CastProfile | null | undefined, seed: string): string | null {
  if (!profile) return null;
  const key = profile.headshot ?? pickHeadshot({ id: seed, market: profile.market, gender: profile.identity?.gender, age: profile.identity?.age });
  return headshotUrl(key);
}

export function PersonaAvatar({ name, profile, portraitUrl: given, size = 56, className }: { name: string; profile?: CastProfile | null; portraitUrl?: string | null; size?: number; className?: string }) {
  const portraitUrl = given ?? portraitOf(profile, name);
  const ring = 'shrink-0 rounded-full';
  if (portraitUrl) {
    return <img src={portraitUrl} alt="" width={size} height={size} className={cn(ring, 'object-cover', className)} style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className={cn(ring, 'inline-flex items-center justify-center bg-line font-semibold text-ink-muted', className)} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials(name)}
    </span>
  );
}

export function keyStats(profile: CastProfile) {
  const ids = profile.identity?.keyStatIds?.length ? profile.identity.keyStatIds : profile.stats.slice(0, 3).map((s) => s.id);
  return ids.map((id) => profile.stats.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
}

/** "Quality 49 (+9)" for each decision driver that cites a statistic. */
export function driverScores(profile: CastProfile): { factor: string; score: number; diff: number }[] {
  return (profile.identity?.drivers ?? [])
    .map((d) => ({ d, s: profile.stats.find((x) => x.id === d.statId) }))
    .filter((x): x is { d: { factor: string; statId: string }; s: NonNullable<typeof x.s> } => Boolean(x.s))
    .map(({ d, s }) => ({ factor: d.factor, score: Math.round(s.share), diff: Math.round(s.diff) }));
}

/** Market column head: the name in small capitals over a rule; and its ISO code. */
export function MarketHeader({ market, className }: { market: string; className?: string }) {
  const iso = isoCode(market);
  return (
    <div className={cn('border-b border-ink pb-2', className)}>
      <p className="text-[11px] font-semibold uppercase leading-tight tracking-[0.2em] text-ink">{market}</p>
      {iso && <p data-no-translate className="text-[10.5px] text-ink-subtle">{iso}</p>}
    </div>
  );
}

/** Tier row head: the tier number in small capitals over its name; the English name in the Chinese interface. */
export function TierHeader({ index, group, label, className }: { index: number; group: string; label: string; className?: string }) {
  return (
    <div className={cn('flex h-full flex-col justify-start border-t border-line pt-5', className)}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-subtle">{`Tier ${index + 1}`}</p>
      <p className="mt-1.5 text-[15px] font-medium leading-snug text-ink">{label}</p>
      {group && <p className="mt-1 text-[10.5px] text-ink-subtle">{group}</p>}
    </div>
  );
}

export function PersonaCard({ name, profile, portraitUrl, compact = false, footer }: { name: string; profile: CastProfile; portraitUrl?: string | null; compact?: boolean; footer?: ReactNode }) {
  const id = profile.identity;
  const drivers = driverScores(profile);
  const stats = keyStats(profile);
  return (
    <article className="flex h-full flex-col gap-3 border-t border-line bg-transparent pt-5" data-persona-card>
      <div className="flex flex-col items-start gap-3">
        <PersonaAvatar name={name} profile={profile} portraitUrl={portraitUrl} size={compact ? 50 : 56} />
        <div className="min-w-0">
          <h3 className={cn('font-sans font-semibold leading-tight text-ink', compact ? 'text-[14px]' : 'text-[16px]')}>
            {name}
            {id?.age ? <span className="font-normal text-ink-muted">{` ${id.age}`}</span> : null}
          </h3>
          {id && <p className="text-xs text-ink-muted">{[id.occupation, id.city].filter(Boolean).join(' · ')}</p>}
          {id?.lifeStage && <p className="text-xs text-ink-muted">{id.lifeStage}</p>}
        </div>
      </div>
      {id?.decisionLogic?.length ? (
        <div className="border-l border-line pl-2.5">
          <p className="text-xs text-ink">
            <b className="block text-[9.5px] font-semibold uppercase tracking-[0.2em] text-ink-subtle">Decision logic</b> <span className="font-medium">{id.decisionLogic.join(' > ')}</span>
          </p>
          {(drivers.length > 0 || stats.length > 0) && (
            <p className="mt-0.5 text-[11px] text-ink-muted">
              {drivers.length > 0
                ? drivers.map((d) => `${d.factor} ${d.score}${Math.abs(d.diff) >= 5 ? ` (${d.diff > 0 ? '+' : ''}${d.diff})` : ''}`).join(' · ')
                : stats.map((s) => `${Math.round(s.share)}% ${s.statement.slice(0, 32)}${s.statement.length > 32 ? '…' : ''}`).join(' · ')}
            </p>
          )}
        </div>
      ) : null}
      {!compact && (
        <ul className="flex flex-col gap-1">
          {stats.map((s) => (
            <li key={s.id} className="flex gap-2 text-[11.5px]">
              <span className="w-9 shrink-0 text-right font-semibold text-ink">{Math.round(s.share)}%</span>
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

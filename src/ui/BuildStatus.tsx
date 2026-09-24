/**
 * Honest build-status panel (prompt §32).
 *
 * Every route that exists in the navigation but is not yet functional renders this. The rule it
 * enforces: a visible destination either works or says plainly that it does not, names the phase
 * that delivers it, and lists what will be there. Nothing is presented as working when it is not,
 * and no placeholder is dressed up with fake data.
 */
export interface NotYetBuiltProps {
  title: string;
  /** Build phase that delivers this surface, as named in the approved implementation plan. */
  phase: 'P2' | 'P3' | 'P4' | 'P5' | 'P6';
  summary: string;
  /** Concrete capabilities this route will carry once built. */
  delivers: readonly string[];
}

const PHASE_LABEL: Record<NotYetBuiltProps['phase'], string> = {
  P2: 'Phase 2 — identity and access',
  P3: 'Phase 3 — data and brief',
  P4: 'Phase 4 — personas and simulation',
  P5: 'Phase 5 — results and administration',
  P6: 'Phase 6 — hardening and deployment',
};

export function NotYetBuilt({ title, phase, summary, delivers }: NotYetBuiltProps) {
  return (
    <div className="max-w-content py-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl">{title}</h1>
        <span className="rounded bg-warn-soft px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-warn">
          Not available in this build
        </span>
      </div>

      <p className="mt-4 max-w-prose text-ink-muted">{summary}</p>

      <div className="mt-6 rounded border border-line bg-surface p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-subtle">
          Delivered by {PHASE_LABEL[phase]}
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {delivers.map((d) => (
            <li key={d} className="flex gap-2 text-sm text-ink-muted">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-subtle" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-6 max-w-prose text-xs text-ink-subtle">
        This screen contains no sample output. When the capability above is implemented, this page
        is replaced by the working surface — it is never filled with illustrative results in the
        meantime.
      </p>
    </div>
  );
}

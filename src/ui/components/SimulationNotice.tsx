import { Icon } from './Icon';
import { cn } from '../cn';

/** The standing notice. Present wherever simulated output is shown; never collapsible. */
export function SimulationNotice({ isMock, compact, className }: { isMock?: boolean; compact?: boolean; className?: string }) {
  return (
    <aside
      aria-label="Simulation notice"
      className={cn('rounded border border-simulated/40 bg-surface', compact ? 'px-3 py-2' : 'px-4 py-3', className)}
    >
      <p className={cn('flex items-start gap-2 text-ink', compact ? 'text-xs' : 'text-sm')}>
        <Icon name="alert" className="mt-0.5 shrink-0 text-simulated" />
        <span>
          <strong className="font-medium">Simulated output.</strong> Decision support, not evidence of what any real
          person thinks. It does not replace research with real people.
          {isMock && (
            <>
              {' '}
              <strong className="font-medium text-warn">Mock provider:</strong> no AI model was consulted; the outputs
              exercise the pipeline and mean nothing.
            </>
          )}
        </span>
      </p>
    </aside>
  );
}

import { SEVERITY_META, SEVERITY_RULE, type FindingSeverity } from '@/telemetry/status';
import { StatusBadge } from './StatusBadge';

export function FindingSeverityBadge({ level, derived }: { level: FindingSeverity; derived?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1" title={derived ? SEVERITY_RULE : undefined}>
      <StatusBadge meta={SEVERITY_META[level]} label={`${SEVERITY_META[level].label}${derived ? ' · derived' : ''}`} />
      {derived && <span className="sr-only">Severity derived by rule: {SEVERITY_RULE}</span>}
    </span>
  );
}

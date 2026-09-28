import { MetricCard, MetricGrid } from '@/ui/components/MetricCard';
import { SegmentDistributionBar } from '@/ui/components/SegmentDistributionBar';
import { ActivityFeed } from '@/ui/components/ActivityFeed';
import { cohortStats, groundedShare, type StatPersona } from '@/ui/cohort/stats';
import type { TelemetryEvent } from '@/telemetry/contract';

const ORIGIN_WORD: Record<string, string> = {
  OBSERVED: 'Observed',
  DERIVED: 'Derived',
  INFERRED: 'Inferred',
  USER_ENTERED: 'Entered',
  SIMULATED: 'Simulated',
};

/**
 * The cohort control dashboard: counts, coverage, confidence and the distributions the data
 * supports. Dimensions the source does not segment on (geography, attitude, channel …) are named
 * as absent rather than drawn from nothing.
 */
export function CohortDashboard({ personas, segmentField, events }: { personas: StatPersona[]; segmentField: string | null; events: TelemetryEvent[] }) {
  const s = cohortStats(personas);
  const pct = (x: number | null) => (x === null ? null : `${Math.round(x * 100)}%`);

  const segmentRows = personas
    .filter((p, i, all) => all.findIndex((q) => q.segment === p.segment) === i)
    .map((p) => ({
      key: p.segment ?? p.name,
      label: p.segment ?? p.name,
      count: p.baseSize ?? 0,
      evidenceCoverage: groundedShare(p),
      confidence: p.confidence,
      selected: p.approval === 'APPROVED',
      note: `${personas.filter((q) => q.segment === p.segment).length} persona(s) · base ${p.baseSize ?? 'unknown'}`,
    }))
    .sort((a, b) => b.count - a.count);

  const confidenceRows = (['HIGH', 'MEDIUM', 'LOW'] as const).map((k) => ({ key: k, label: k.toLowerCase(), count: s.confidence[k] }));
  const provenanceRows = Object.entries(s.provenance)
    .map(([k, n]) => ({ key: k, label: ORIGIN_WORD[k] ?? k, count: n }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="flex flex-col gap-3">
      <MetricGrid label="Cohort metrics" className="lg:grid-cols-5 xl:grid-cols-9">
        <MetricCard compact label="Personas" value={s.total} definition="Personas in this cohort." />
        <MetricCard compact label="Approved" value={s.approved} tone={s.approved === s.total && s.total > 0 ? 'ok' : undefined} definition="Persona versions approved for use in a run. Approved versions are immutable." />
        <MetricCard compact label="Pending" value={s.pending} tone={s.pending > 0 ? 'warn' : undefined} definition="Candidates awaiting approval." />
        <MetricCard compact label="Excluded" value={s.excluded} definition="Personas excluded from use by a reviewer." />
        <MetricCard compact label="Weak evidence" value={s.weakEvidence} tone={s.weakEvidence > 0 ? 'warn' : undefined} definition="Personas marked low confidence — most often because the segment's base is small." />
        <MetricCard compact label="Conflicts" value={s.conflicting} definition="Personas with contradicting attributes recorded. The generator produces none; edits can." />
        <MetricCard compact label="Segments" value={s.segments} definition="Distinct segment values the cohort covers." />
        <MetricCard compact label="Sample covered" value={pct(s.sampleCoverage)} definition="Share of the sample in the segments this cohort covers, from segment weights." />
        <MetricCard compact label="Data coverage" value={pct(s.dataCoverage)} definition="Share of all persona attributes that were observed or derived from the data, not simulated." />
      </MetricGrid>

      <div className="grid gap-3 lg:grid-cols-3">
        <SegmentDistributionBar
          title={segmentField ? `Segment · ${segmentField}` : 'Segment'}
          rows={segmentRows}
          caption="Bar length is the segment's respondent base. Evidence is the share of that persona's attributes grounded in the data."
        />
        <SegmentDistributionBar title="Confidence" rows={confidenceRows} caption="Low confidence usually means a small base." />
        <SegmentDistributionBar title="Attribute provenance" rows={provenanceRows} caption="Simulated attributes measure nothing." />
      </div>
      <p className="text-[11.5px] text-ink-subtle">
        Geography, language, attitude, need state, brand relationship and channel preference are shown here only when the
        source data carries them as a segmenting field. This cohort segments on{' '}
        <span className="font-mono">{segmentField ?? 'no field'}</span>. Sensitive fields are excluded at ingestion and
        never become attributes.
      </p>

      {events.length > 0 && (
        <ActivityFeed events={events} title="Generation record" heightClass="h-64" emptyText="No generation events were recorded for this cohort." />
      )}
    </div>
  );
}

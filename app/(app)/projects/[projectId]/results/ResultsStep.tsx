'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { exportReportAction, type ExportFormState } from '../exportActions';
import { FormMessages, SubmitButton, TextArea } from '@/ui/forms';

const empty: ExportFormState = {};

const GRADE_LABEL: Record<string, { label: string; meaning: string }> = {
  L1_OBSERVED: { label: 'L1 observed', meaning: 'Measured directly in the data.' },
  L2_DERIVED: { label: 'L2 derived', meaning: 'Computed from measurements.' },
  L3_PERSONA_SIMULATION: {
    label: 'L3 simulation',
    meaning: 'Produced by simulated personas. Not an observation of anyone.',
  },
  L4_SCENARIO_INFERENCE: { label: 'L4 inference', meaning: 'Reasoned from a scenario.' },
  L5_SPECULATION: { label: 'L5 speculation', meaning: 'Neither measured nor reasoned from evidence.' },
};

export interface VoteRow {
  personaKey: string;
  independent: string | null;
  final: string | null;
  changed: boolean;
  challenge: string | null;
  citedEvidence: string | null;
}

export interface FindingRow {
  id: string;
  title: string;
  claim: string;
  evidenceGrade: string;
  classification: string | null;
  confidence: string;
  consensusRatio: number | null;
  limitations: string | null;
  votes: VoteRow[];
}

/**
 * The limitations block.
 *
 * Placed above the findings rather than below them, and not collapsible. A caveat behind a
 * disclosure triangle is a caveat that has been designed not to be read.
 */
export function LimitationsBlock({
  limitations,
  isMock,
  groupthink,
}: {
  limitations: string[];
  isMock: boolean;
  groupthink: boolean;
}) {
  return (
    <section
      aria-labelledby="limitations"
      className={`mt-6 rounded border p-5 ${
        isMock || groupthink ? 'border-danger bg-danger-soft/30' : 'border-warn bg-warn-soft/40'
      }`}
    >
      <h2 id="limitations" className="text-lg">What this cannot support</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {limitations.map((l) => (
          <li key={l} className="flex gap-2 text-sm text-ink-muted">
            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-subtle" />
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The evidence drawer.
 *
 * Every persona's independent position, its final position, and whether it moved. This is where a
 * reader checks whether a headline is one view held by many — collapsed by default because it is
 * detail, but one click away from every claim rather than in an appendix.
 */
export function EvidenceDrawer({ finding, panelSize }: { finding: FindingRow; panelSize: number }) {
  const [open, setOpen] = useState(false);
  const grade = GRADE_LABEL[finding.evidenceGrade] ?? {
    label: finding.evidenceGrade,
    meaning: '',
  };
  const changed = finding.votes.filter((v) => v.changed).length;

  return (
    <li className="rounded border border-line bg-surface p-5">
      <p className="text-base text-ink">{finding.claim}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded bg-info-soft px-2 py-0.5 font-mono text-[10px] text-info">
          {grade.label}
        </span>
        {finding.classification && (
          <span className="rounded bg-bg px-2 py-0.5 font-mono text-[10px] text-ink-muted">
            {finding.classification.toLowerCase().replace(/_/g, ' ')}
          </span>
        )}
        <span className="rounded bg-bg px-2 py-0.5 font-mono text-[10px] text-ink-muted">
          confidence {finding.confidence.toLowerCase()}
        </span>
        {finding.consensusRatio !== null && (
          <span className="font-mono text-[11px] text-ink-subtle">
            {Math.round(finding.consensusRatio * 100)}% of {panelSize} personas
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-ink-subtle">{grade.meaning}</p>
      {finding.limitations && <p className="mt-2 text-xs text-ink-muted">{finding.limitations}</p>}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-3 text-xs text-brand underline-offset-2 hover:underline"
      >
        {open ? 'Hide' : 'Show'} what each persona said ({finding.votes.length} personas,{' '}
        {changed} changed position)
      </button>

      {open && (
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Persona positions table">
          <table className="w-full min-w-[34rem] border-collapse text-xs">
            <caption className="sr-only">
              Each persona&rsquo;s position before and after the challenge round
            </caption>
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Persona</th>
                <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">
                  Alone
                  <span className="block font-normal">before seeing others</span>
                </th>
                <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">
                  After challenge
                </th>
                <th scope="col" className="py-2 font-medium text-ink-subtle">Moved</th>
              </tr>
            </thead>
            <tbody>
              {finding.votes.map((v) => (
                <tr key={v.personaKey} className="border-b border-line/60 align-top">
                  <td className="py-2 pr-4 font-mono text-ink">{v.personaKey}</td>
                  <td className="py-2 pr-4 text-ink-muted">{v.independent?.toLowerCase() ?? '—'}</td>
                  <td className="py-2 pr-4 text-ink-muted">{v.final?.toLowerCase() ?? '—'}</td>
                  <td className="py-2 text-ink-subtle">
                    {v.changed ? (
                      <span className="rounded bg-warn-soft px-2 py-0.5 font-mono text-[10px] text-warn">
                        yes
                      </span>
                    ) : (
                      'no'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-subtle">
            The &ldquo;alone&rdquo; column is the only one that carries information about agreement:
            it was recorded before any persona saw another&rsquo;s view.
          </p>
        </div>
      )}
    </li>
  );
}

export interface ClaimIssueRow {
  claim: string;
  issues: { kind: string; severity: string; excerpt: string; message: string; suggestion: string }[];
}

export function ClaimCheckPanel({
  checked,
  notice,
}: {
  checked: ClaimIssueRow[];
  notice: string;
}) {
  const blocking = checked.flatMap((c) => c.issues.filter((i) => i.severity === 'blocking'));

  return (
    <section aria-labelledby="claimcheck" className="mt-10">
      <h2 id="claimcheck" className="text-lg">Claim check</h2>
      <p className="mt-1 max-w-prose text-xs text-ink-subtle">{notice}</p>

      {checked.length === 0 ? (
        <p className="mt-3 rounded border border-ok bg-ok-soft px-4 py-3 text-sm text-ok">
          Nothing flagged. Every figure in the text appears in the evidence, and no sentence claims
          more than a simulation can support.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-ink-muted">
            {blocking.length > 0
              ? `${blocking.length} issue(s) will block an export until resolved or acknowledged.`
              : 'Nothing blocking. The notes below are carried into any export.'}
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {checked.map((c) => (
              <li key={c.claim} className="rounded border border-line bg-surface p-4">
                <p className="text-sm text-ink">&ldquo;{c.claim}&rdquo;</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {c.issues.map((i) => (
                    <li key={`${i.kind}-${i.excerpt}`} className="text-xs">
                      <span
                        className={
                          i.severity === 'blocking'
                            ? 'rounded bg-danger-soft px-2 py-0.5 font-mono text-[10px] text-danger'
                            : 'rounded bg-warn-soft px-2 py-0.5 font-mono text-[10px] text-warn'
                        }
                      >
                        {i.kind.replace(/_/g, ' ')}
                      </span>
                      <span className="ml-2 text-ink-muted">{i.message}</span>
                      <span className="mt-1 block text-ink-subtle">{i.suggestion}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function ExportPanel({
  projectId,
  runId,
  blockedCount,
  overrideMinimum,
}: {
  projectId: string;
  runId: string;
  blockedCount: number;
  overrideMinimum: number;
}) {
  const [state, action] = useActionState(exportReportAction, empty);
  const [showOverride, setShowOverride] = useState(false);

  return (
    <section aria-labelledby="export" className="mt-12 border-t border-line pt-8">
      <h2 id="export" className="text-lg">Export</h2>
      <p className="mt-1 max-w-prose text-xs text-ink-subtle">
        Every export carries its limitations block. There is no setting that removes it, because a
        document travels without the screen it was read on.
      </p>

      <form action={action} className="mt-4 flex max-w-xl flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="runId" value={runId} />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-ink">Format</legend>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="radio" name="format" value="markdown" defaultChecked /> Markdown
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="radio" name="format" value="json" /> JSON (full record, including votes)
          </label>
        </fieldset>

        {blockedCount > 0 && (
          <div className="rounded border border-danger bg-danger-soft/40 p-4">
            <p className="text-sm text-ink">
              {blockedCount} claim(s) were refused by the check. Rewrite them, or record why you are
              exporting anyway.
            </p>
            <button
              type="button"
              onClick={() => setShowOverride((o) => !o)}
              aria-expanded={showOverride}
              className="mt-2 text-xs text-brand underline-offset-2 hover:underline"
            >
              {showOverride ? 'Cancel override' : 'Export anyway, with a recorded reason'}
            </button>
            {showOverride && (
              <div className="mt-3">
                <label htmlFor="ack" className="text-sm font-medium text-ink">
                  Why is this export acceptable despite the block?
                </label>
                <p id="ack-hint" className="mt-0.5 text-xs text-ink-subtle">
                  At least {overrideMinimum} characters. Recorded against your name, in the audit log
                  and at the top of the exported file itself.
                </p>
                <TextArea
                  id="ack"
                  name="acknowledgeBlocks"
                  rows={3}
                  aria-describedby="ack-hint"
                  className="mt-1"
                />
              </div>
            )}
          </div>
        )}

        <FormMessages state={state} />
        <SubmitButton pendingLabel="Preparing…">Export</SubmitButton>
      </form>

      {state.download && (
        <p className="mt-3 text-sm">
          <a
            href={state.download}
            download={state.filename}
            className="text-brand underline-offset-2 hover:underline"
          >
            Download {state.filename}
          </a>
        </p>
      )}
    </section>
  );
}

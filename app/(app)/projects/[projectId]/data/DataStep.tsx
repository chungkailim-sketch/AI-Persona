'use client';

import { useActionState, useState } from 'react';
import {
  uploadDatasetAction,
  saveGovernanceAction,
  confirmFieldsAction,
  acknowledgeFindingAction,
  type FormState,
} from '../actions';
import { Field, FormMessages, Select, SubmitButton, TextArea, TextInput } from '@/ui/forms';

const empty: FormState = {};

export interface FieldRow {
  id: string;
  name: string;
  type: string;
  typeConfidence: number;
  scalePoints: number | null;
  missingPct: number;
  distinctCount: number;
  outlierCount: number;
  sensitivity: 'NONE' | 'PII' | 'SPECIAL_CATEGORY';
  sensitivityReason: string | null;
  excluded: boolean;
  inclusionJustification: string | null;
  constructMappingGrade: string | null;
  topValues: { value: string; count: number }[] | null;
  withheld: boolean;
}

export interface FindingRow {
  id: string;
  check: string;
  severity: string;
  message: string;
  acknowledged: boolean;
}

// ── Upload ────────────────────────────────────────────────────────────────────

const MB = 1024 * 1024;
const FILE_LIMIT = 25 * MB;
const REQUEST_LIMIT = 100 * MB;

/** Checked in the browser too, so an oversized selection is explained before anything is sent. */
function sizeProblem(files: FileList | null): string | null {
  if (!files) return null;
  const list = Array.from(files);
  const big = list.find((f) => f.size > FILE_LIMIT);
  if (big) return `${big.name} is ${(big.size / MB).toFixed(1)}MB. The limit is 25MB per file.`;
  const total = list.reduce((n, f) => n + f.size, 0);
  if (total > REQUEST_LIMIT) return `These files total ${(total / MB).toFixed(1)}MB. One upload is limited to 100MB; upload the rest as a second dataset.`;
  return null;
}

export function UploadForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(uploadDatasetAction, empty);
  const [tooBig, setTooBig] = useState<string | null>(null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const input = e.currentTarget.elements.namedItem('files') as HTMLInputElement | null;
        const problem = sizeProblem(input?.files ?? null);
        setTooBig(problem);
        if (problem) e.preventDefault();
      }}
      className="mt-4 flex max-w-xl flex-col gap-4"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <Field id="ds-name" label="Dataset name" required>
        <TextInput id="ds-name" name="name" required maxLength={120} />
      </Field>
      <Field
        id="ds-files"
        label="Files"
        required
        hint="CSV or XLSX, up to 25MB each and 100MB per upload. Every sheet in a workbook is profiled separately."
      >
        <input
          id="ds-files"
          name="files"
          type="file"
          multiple
          required
          accept=".csv,.tsv,.xlsx,.xlsm"
          aria-describedby="ds-files-hint"
          className="w-full text-sm text-ink-muted file:mr-3 file:rounded file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink"
        />
      </Field>
      <p className="rounded border border-warn bg-warn-soft px-3 py-2 text-xs text-warn">
        No malware scanner is configured in this build. Every uploaded file is recorded as
        <span className="font-mono"> NOT_SCANNED</span> so the gap is visible rather than assumed
        away.
      </p>
      {tooBig && <p role="alert" className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{tooBig}</p>}
      <FormMessages state={state} />
      <SubmitButton pendingLabel="Uploading…">Upload and ingest</SubmitButton>
    </form>
  );
}

// ── Integrity findings ────────────────────────────────────────────────────────

function SeverityChip({ severity }: { severity: string }) {
  const cls =
    severity === 'blocking'
      ? 'bg-danger-soft text-danger'
      : severity === 'warning'
        ? 'bg-warn-soft text-warn'
        : 'bg-bg text-ink-subtle';
  return (
    <span className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase ${cls}`}>{severity}</span>
  );
}

export function FindingItem({
  projectId,
  finding,
}: {
  projectId: string;
  finding: FindingRow;
}) {
  const [state, action] = useActionState(acknowledgeFindingAction, empty);
  const [open, setOpen] = useState(false);

  return (
    <li className="rounded border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start gap-2">
        <SeverityChip severity={finding.severity} />
        <span className="font-mono text-[11px] text-ink-subtle">{finding.check}</span>
        {finding.acknowledged && (
          <span className="rounded bg-ok-soft px-2 py-0.5 font-mono text-[10px] text-ok">
            acknowledged
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-ink-muted">{finding.message}</p>

      {!finding.acknowledged && finding.severity !== 'info' && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-2 text-xs text-brand underline-offset-2 hover:underline"
          >
            {open ? 'Cancel' : 'Acknowledge this finding'}
          </button>
          {open && (
            <form action={action} className="mt-3 flex flex-col gap-2">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="findingId" value={finding.id} />
              <Field
                id={`note-${finding.id}`}
                label="How was this resolved, or why is it acceptable?"
                hint="Recorded against your name and shown wherever this dataset is used."
                required
              >
                <TextArea id={`note-${finding.id}`} name="note" required minLength={10} rows={2} />
              </Field>
              <FormMessages state={state} />
              <SubmitButton variant="secondary" pendingLabel="Saving…">
                Record acknowledgement
              </SubmitButton>
            </form>
          )}
        </>
      )}
    </li>
  );
}

// ── Field review ──────────────────────────────────────────────────────────────

function FieldReviewRow({ field }: { field: FieldRow }) {
  const [include, setInclude] = useState(!field.excluded);
  const sensitive = field.sensitivity !== 'NONE';

  return (
    <li
      className={`rounded border px-4 py-3 ${
        sensitive ? 'border-warn bg-warn-soft/30' : 'border-line bg-surface'
      }`}
    >
      <input type="hidden" name="fieldId" value={field.id} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-ink">{field.name}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {field.type.toLowerCase()}
            {field.scalePoints ? ` · ${field.scalePoints}-point scale` : ''} · type confidence{' '}
            {Math.round(field.typeConfidence * 100)}% · {field.missingPct}% missing ·{' '}
            {field.distinctCount.toLocaleString()} distinct
            {field.outlierCount > 0 ? ` · ${field.outlierCount} outliers` : ''}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {sensitive && (
            <span className="rounded bg-warn-soft px-2 py-0.5 font-mono text-[10px] uppercase text-warn">
              {field.sensitivity === 'PII' ? 'personal data' : 'special category'}
            </span>
          )}
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              name={`include:${field.id}`}
              checked={include}
              onChange={(e) => setInclude(e.target.checked)}
              className="h-4 w-4 rounded border-line"
            />
            Include
          </label>
        </div>
      </div>

      {field.sensitivityReason && (
        <p className="mt-2 text-xs text-warn">{field.sensitivityReason}</p>
      )}

      {field.withheld ? (
        <p className="mt-2 text-xs text-ink-subtle">
          Sample values are withheld — viewing values from a sensitive field needs the
          <span className="font-mono"> dataset.viewSensitive </span>
          permission.
        </p>
      ) : (
        field.topValues &&
        field.topValues.length > 0 && (
          <p className="mt-2 truncate text-xs text-ink-subtle">
            Most frequent: {field.topValues.slice(0, 5).map((t) => t.value).join(', ')}
          </p>
        )
      )}

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`grade-${field.id}`}
            className="text-xs font-medium text-ink"
          >
            How well does this measure what you are asking about?
          </label>
          <Select
            id={`grade-${field.id}`}
            name={`grade:${field.id}`}
            defaultValue={field.constructMappingGrade ?? ''}
            className="w-56 py-1 text-xs"
          >
            <option value="">Not yet assessed</option>
            <option value="direct">Direct — it measures exactly that</option>
            <option value="partial">Partial — related, not the same thing</option>
            <option value="weak">Weak — a distant proxy</option>
          </Select>
        </div>

        {sensitive && include && (
          <div className="flex-1 min-w-64">
            <label htmlFor={`why-${field.id}`} className="text-xs font-medium text-ink">
              Why is this field necessary? <span className="text-danger">*</span>
            </label>
            <TextArea
              id={`why-${field.id}`}
              name={`why:${field.id}`}
              rows={2}
              minLength={20}
              defaultValue={field.inclusionJustification ?? ''}
              placeholder="At least 20 characters, saying why it is necessary and what limits apply."
              className="mt-1 text-xs"
            />
          </div>
        )}
      </div>
    </li>
  );
}

export function FieldReviewForm({
  projectId,
  datasetVersionId,
  fields,
  detectionCaveat,
}: {
  projectId: string;
  datasetVersionId: string;
  fields: FieldRow[];
  detectionCaveat: string;
}) {
  const [state, action] = useActionState(confirmFieldsAction, empty);
  const sensitiveCount = fields.filter((f) => f.sensitivity !== 'NONE').length;

  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="datasetVersionId" value={datasetVersionId} />

      <p className="max-w-prose rounded border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
        {detectionCaveat}
      </p>
      {sensitiveCount > 0 && (
        <p className="max-w-prose text-sm text-warn">
          {sensitiveCount} field(s) were detected as sensitive and are excluded until you decide
          otherwise. Including one requires a written reason.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {fields.map((f) => (
          <FieldReviewRow key={f.id} field={f} />
        ))}
      </ul>

      <FormMessages state={state} />
      <SubmitButton pendingLabel="Saving…">Confirm field review</SubmitButton>
    </form>
  );
}

// ── Governance ────────────────────────────────────────────────────────────────

export interface GovernanceDefaults {
  dataOwner: string;
  sourceName: string;
  methodology: string;
  collectionStart: string;
  collectionEnd: string;
  geography: string;
  language: string;
  sampleSize: string;
  lawfulBasis: string;
  classification: string;
  permittedUses: string;
  restrictions: string;
  retentionDays: number;
  allowModelProcessing: boolean;
}

export function GovernanceForm({
  projectId,
  datasetVersionId,
  defaults,
  notice,
}: {
  projectId: string;
  datasetVersionId: string;
  defaults: GovernanceDefaults;
  notice: string;
}) {
  const [state, action] = useActionState(saveGovernanceAction, empty);

  return (
    <form action={action} className="mt-4 flex max-w-2xl flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="datasetVersionId" value={datasetVersionId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="dataOwner" label="Accountable owner" required>
          <TextInput id="dataOwner" name="dataOwner" required defaultValue={defaults.dataOwner} />
        </Field>
        <Field id="sourceName" label="Source" required>
          <TextInput id="sourceName" name="sourceName" required defaultValue={defaults.sourceName} />
        </Field>
      </div>

      <Field
        id="methodology"
        label="Methodology"
        required
        hint="How was this collected? Sampling, mode, weighting, and anything that limits what it can support."
      >
        <TextArea
          id="methodology"
          name="methodology"
          required
          minLength={20}
          rows={3}
          defaultValue={defaults.methodology}
          aria-describedby="methodology-hint"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="collectionStart" label="Collection started">
          <TextInput
            id="collectionStart"
            name="collectionStart"
            type="date"
            defaultValue={defaults.collectionStart}
          />
        </Field>
        <Field id="collectionEnd" label="Collection ended">
          <TextInput
            id="collectionEnd"
            name="collectionEnd"
            type="date"
            defaultValue={defaults.collectionEnd}
          />
        </Field>
        <Field id="geography" label="Markets covered" hint="Comma separated.">
          <TextInput id="geography" name="geography" defaultValue={defaults.geography} />
        </Field>
        <Field id="language" label="Languages" hint="Comma separated.">
          <TextInput id="language" name="language" defaultValue={defaults.language} />
        </Field>
        <Field id="sampleSize" label="Sample size as reported by the source">
          <TextInput id="sampleSize" name="sampleSize" type="number" min={0} defaultValue={defaults.sampleSize} />
        </Field>
        <Field id="retentionDays" label="Retain for (days)" required>
          <TextInput
            id="retentionDays"
            name="retentionDays"
            type="number"
            min={1}
            max={3650}
            required
            defaultValue={defaults.retentionDays}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="lawfulBasis" label="Lawful basis" required>
          <Select id="lawfulBasis" name="lawfulBasis" required defaultValue={defaults.lawfulBasis}>
            <option value="CONSENT">Consent</option>
            <option value="CONTRACT">Contract</option>
            <option value="LEGITIMATE_INTEREST">Legitimate interest</option>
            <option value="PUBLIC_TASK">Public task</option>
            <option value="LEGAL_OBLIGATION">Legal obligation</option>
            <option value="NOT_APPLICABLE_AGGREGATE">Not applicable — aggregate data only</option>
          </Select>
        </Field>
        <Field id="classification" label="Classification" required>
          <Select
            id="classification"
            name="classification"
            required
            defaultValue={defaults.classification}
          >
            <option value="PUBLIC">Public</option>
            <option value="INTERNAL">Internal</option>
            <option value="CLIENT_CONFIDENTIAL">Client confidential</option>
            <option value="RESTRICTED">Restricted</option>
          </Select>
        </Field>
      </div>

      <Field id="permittedUses" label="Permitted uses" hint="Comma separated.">
        <TextInput id="permittedUses" name="permittedUses" defaultValue={defaults.permittedUses} />
      </Field>
      <Field id="restrictions" label="Restrictions on use">
        <TextArea id="restrictions" name="restrictions" rows={2} defaultValue={defaults.restrictions} />
      </Field>

      <fieldset className="rounded border border-warn bg-warn-soft/40 p-4">
        <legend className="px-1 text-sm font-medium text-ink">Model processing</legend>
        <p className="max-w-prose text-xs text-ink-muted">{notice}</p>
        <label className="mt-3 flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="allowModelProcessing"
            defaultChecked={defaults.allowModelProcessing}
            className="mt-0.5 h-4 w-4 rounded border-line"
          />
          <span>
            I permit values from the included fields of this dataset to be sent to the AI provider.
          </span>
        </label>
      </fieldset>

      <FormMessages state={state} />
      <SubmitButton pendingLabel="Saving…">Record provenance</SubmitButton>
    </form>
  );
}

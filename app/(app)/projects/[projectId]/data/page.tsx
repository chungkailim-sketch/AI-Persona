import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { listProjectDatasets } from '@/server/datasets';
import { autoClearProject } from '@/ingest/autoClear';
import { WorkflowNav } from '../WorkflowNav';
import { UploadForm } from './DataStep';
import { RemoveAllData, RemoveDatasetButton } from './RemoveData';
import { RefreshWhileImporting } from './RefreshWhileImporting';

export const metadata = { title: 'Data · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

const IN_PROGRESS = new Set(['AWAITING_UPLOAD', 'UPLOADING', 'SCANNING', 'PARSING', 'PROFILING', 'MAPPING', 'VALIDATING', 'DETECTING_SENSITIVE']);
const IMPORTED = new Set(['IMPORTED', 'READY_FOR_REVIEW', 'PARTIALLY_IMPORTED']);

type Row = Awaited<ReturnType<typeof listProjectDatasets>>[number];

/** What one file's state means for the user: ready, still importing, failed (and why), or needs a look. */
function statusOf(d: Row): { label: string; tone: 'ok' | 'pending' | 'danger' | 'warn'; detail?: string } {
  const v = d.latest;
  if (!v) return { label: 'Waiting for files', tone: 'pending' };
  if (v.status === 'FAILED') return { label: 'Failed', tone: 'danger', detail: v.failure ?? undefined };
  if (IN_PROGRESS.has(v.status)) return { label: 'Importing…', tone: 'pending' };
  if (IMPORTED.has(v.status) && v.modelProcessingAllowed && v.blocking === 0) return { label: 'Ready', tone: 'ok' };
  return { label: 'Needs review', tone: 'warn', detail: 'Open the data tools to see what is outstanding.' };
}

const TONE: Record<ReturnType<typeof statusOf>['tone'], string> = {
  ok: 'border-ok/40 bg-ok-soft text-ok',
  pending: 'border-line bg-pending-soft text-pending',
  danger: 'border-danger/40 bg-danger-soft text-danger',
  warn: 'border-warn/40 bg-warn-soft text-warn',
};

/**
 * Step 1 — the files the study rests on. Upload, see each file's state, remove. Field review,
 * quality, structured tables and trends live in the Advanced data tools.
 */
export default async function DataStepPage(props: PageProps<'/projects/[projectId]/data'>) {
  const { projectId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/data`);

  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  if (!project) notFound();

  const canEdit = can(ctx, 'dataset.upload', projectId);
  const canDelete = can(ctx, 'dataset.delete', projectId);
  if (canEdit) await autoClearProject(projectId);
  const datasets = await listProjectDatasets(user, projectId);
  const rows = datasets.map((d) => ({ d, s: statusOf(d) }));
  const importing = rows.some((r) => r.s.label === 'Importing…');
  const ready = rows.filter((r) => r.s.tone === 'ok').length;

  return (
    <div className="flex flex-col gap-6">
      <WorkflowNav projectId={projectId} projectName={project.name} current="DATA" />
      <RefreshWhileImporting active={importing} />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Data</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            Upload the survey databooks this study rests on. Each file becomes one dataset, named as the file.
          </p>
        </div>
        <Link href={`/projects/${projectId}/advanced/data` as Route} className="text-sm text-link underline-offset-2 hover:underline">
          Advanced data tools →
        </Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section aria-labelledby="files" className="panel min-w-0">
          <div className="panel-head">
            <h2 id="files" className="font-sans text-sm font-semibold text-ink">Your files</h2>
            <span className="text-xs text-ink-subtle">{ready} of {datasets.length} ready</span>
          </div>
          {datasets.length === 0 ? (
            <p className="px-3.5 py-6 text-sm text-ink-muted">No data attached yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map(({ d, s }) => (
                <li key={d.datasetId} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-ink">{d.name}</p>
                    {d.latest?.rowCount != null && (
                      <p className="text-xs text-ink-subtle">{d.latest.rowCount.toLocaleString()} rows</p>
                    )}
                    {s.detail && <p className={`mt-1 text-xs ${s.tone === 'danger' ? 'text-danger' : 'text-ink-muted'}`}>{s.detail}</p>}
                  </div>
                  <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-xs font-medium ${TONE[s.tone]}`}>{s.label}</span>
                  {canDelete && <RemoveDatasetButton projectId={projectId} datasetId={d.datasetId} name={d.name} />}
                </li>
              ))}
            </ul>
          )}
          {canDelete && <RemoveAllData projectId={projectId} count={datasets.length} />}
        </section>

        {canEdit ? (
          <section aria-labelledby="upload" className="panel self-start">
            <div className="panel-head">
              <h2 id="upload" className="font-sans text-sm font-semibold text-ink">Upload</h2>
            </div>
            <div className="px-3.5 pb-3.5">
              <UploadForm projectId={projectId} simple />
            </div>
          </section>
        ) : (
          <p className="panel self-start px-3.5 py-3 text-sm text-ink-muted">
            You can view this project&rsquo;s data but not change it.
          </p>
        )}
      </div>

      {ready > 0 && (
        <div className="flex justify-end">
          <Link href={`/projects/${projectId}/brief` as Route} className="rounded bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
            Next: Brief →
          </Link>
        </div>
      )}
    </div>
  );
}

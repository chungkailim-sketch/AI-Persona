'use server';

/**
 * Export action.
 *
 * The exported content is returned as a data URL rather than written to object storage: an export
 * is a snapshot of a report that is already in the database, and storing a second copy would create
 * a file that can drift from the run it claims to describe. The download is produced from the
 * current state, every time.
 */
import { requireUserApi, AuthorizationError } from '@/auth/guard';
import { exportReport, ExportBlocked, type ExportFormat } from '@/report/export';

export interface ExportFormState {
  error?: string;
  problems?: string[];
  ok?: string;
  download?: string;
  filename?: string;
}

export async function exportReportAction(
  _prev: ExportFormState,
  formData: FormData,
): Promise<ExportFormState> {
  try {
    const user = await requireUserApi();
    const projectId = String(formData.get('projectId') ?? '');
    const runId = String(formData.get('runId') ?? '');
    const formatRaw = String(formData.get('format') ?? 'markdown');
    const format: ExportFormat = formatRaw === 'json' ? 'json' : 'markdown';
    const acknowledgeBlocks = String(formData.get('acknowledgeBlocks') ?? '');

    if (!projectId || !runId) return { error: 'Invalid request.' };

    const result = await exportReport(user, projectId, runId, format, { acknowledgeBlocks });

    return {
      ok: result.overrideNote
        ? 'Exported over a blocked claim. The override is recorded and appears at the top of the file.'
        : 'Export ready.',
      download: `data:${result.contentType};base64,${Buffer.from(result.content, 'utf8').toString('base64')}`,
      filename: result.filename,
    };
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return { error: 'You do not have permission to export from this project.' };
    }
    if (e instanceof ExportBlocked) {
      return {
        problems: e.issues.flatMap((i) => i.issues.map((x) => `${x.excerpt}: ${x.message}`)),
        error:
          'The export was refused. Rewrite the claims below, or record why exporting them anyway ' +
          'is acceptable.',
      };
    }
    console.error('[export] unexpected failure', e);
    return { error: 'That export could not be produced. The failure has been recorded.' };
  }
}

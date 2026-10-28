import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { loadReport } from '@/roundtable/report';
import { SlideDeck } from '@/ui/report/Slides';
import { PrintButton } from '@/ui/components/PrintButton';

export const metadata = { title: 'Roundtable report · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

/**
 * The slide report with no application chrome. "Print or save as PDF" prints one slide per page
 * at 16:9 (13.333 × 7.5 in); in the print dialog choose "Save as PDF" and turn on background graphics.
 */
export default async function RoundtableReportPage(props: PageProps<'/projects/[projectId]/report'>) {
  const { projectId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/report`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'report.view', projectId)) notFound();
  const report = await loadReport(projectId);
  if (!report) notFound();

  return (
    <div className="min-h-dvh bg-bg">
      <div className="no-print sticky top-0 z-10 border-b border-line bg-elevated/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-5 py-2">
          <Link href={`/projects/${projectId}/results` as Route} className="text-sm text-link underline-offset-2 hover:underline">← Back to the project</Link>
          <p className="hidden text-xs text-ink-subtle sm:block">In the print dialog choose “Save as PDF” and turn on background graphics.</p>
          <PrintButton />
        </div>
      </div>
      <main id="main" className="mx-auto max-w-[1320px] px-5 py-6 print:max-w-none print:p-0">
        <SlideDeck r={report} />
      </main>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { imagesConfigured, env } from '@/lib/env';
import { HEADSHOTS, headshotUrl } from '@/headshots/catalog';
import { headshotStatus } from '@/headshots/store';
import { GenerateForm } from './GenerateForm';

export const metadata = { title: 'Headshots · Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminHeadshotsPage() {
  const user = await requireUser('/admin/headshots');
  const ctx = await authContextFor(user);
  if (!can(ctx, 'admin.models.manage')) notFound();
  const [status, job, sources] = await Promise.all([
    headshotStatus(),
    prisma.job.findFirst({ where: { kind: 'headshots' }, orderBy: { createdAt: 'desc' }, select: { status: true, createdAt: true, completedAt: true, errorMessage: true, output: true } }),
    prisma.headshot.findMany({ select: { key: true, source: true } }),
  ]);
  const photo = new Set(sources.filter((s) => s.source === 'photo').map((s) => s.key));
  const configured = imagesConfigured(env());
  const result = (job?.output ?? null) as { generated?: number; failed?: { key: string; reason: string }[] } | null;

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <header>
        <h1 className="text-2xl">Persona headshots</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          A hundred portraits are pre-loaded and matched to each persona by gender, market and age. They start as illustrations; generating photographs replaces them with synthetic photographic portraits of people who do not exist (billed to the account that owns the image key).
        </p>
      </header>
      <section className="panel flex flex-col gap-3 px-5 py-5">
        <p className="text-sm text-ink"><strong>{status.photos}</strong> of {HEADSHOTS.length} are photographs.</p>
        {!configured && <p className="text-sm text-warn">No image API key is set (IMAGE_API_KEY in Railway → Variables, on web and worker).</p>}
        <GenerateForm disabled={!configured} />
        {job && (
          <p className="text-sm text-ink-muted">
            Last run: {job.status.toLowerCase()}
            {result?.generated !== undefined ? `, ${result.generated} generated` : ''}
            {result?.failed?.length ? `, ${result.failed.length} failed (${result.failed[0]!.reason})` : ''}
            {job.errorMessage ? ` — ${job.errorMessage}` : ''}
          </p>
        )}
      </section>
      <ul className="grid grid-cols-5 gap-3 sm:grid-cols-8 md:grid-cols-10">
        {HEADSHOTS.map((h) => (
          <li key={h.key} className="flex flex-col items-center gap-1 text-[10px] text-ink-subtle">
            <img src={headshotUrl(h.key)} alt="" width={56} height={56} className="h-14 w-14 rounded-full object-cover" />
            <span>{photo.has(h.key) ? 'photo' : 'drawn'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

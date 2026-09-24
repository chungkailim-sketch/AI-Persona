import Link from 'next/link';
import { requireUser } from '@/auth/guard';
import { listProjectsForUser } from '@/server/projects';
import { NewProjectForm } from './NewProjectForm';

export const metadata = { title: 'Projects · Persona Intelligence' };
export const dynamic = 'force-dynamic';

const STEP_LABEL: Record<string, string> = {
  DATA: 'Source data',
  BRIEF: 'Brief',
  PERSONAS: 'Personas',
  SIMULATION: 'Simulation',
  RESULTS: 'Results',
};

export default async function ProjectsPage() {
  const user = await requireUser('/projects');
  const projects = await listProjectsForUser(user);

  return (
    <div className="">
      <h1 className="text-2xl">Projects</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        A project holds its own evidence, brief, personas and runs, and its own membership. You see
        only projects you belong to.
      </p>

      <section aria-labelledby="your-projects" className="mt-10">
        <h2 id="your-projects" className="text-lg">Your projects</h2>
        {projects.length === 0 ? (
          <p className="mt-3 rounded border border-line bg-surface px-4 py-6 text-sm text-ink-muted">
            You are not a member of any project yet. Create one below.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}/data`}
                  className="block rounded border border-line bg-surface p-4 transition-colors duration-fast hover:border-brand"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{p.name}</span>
                    <span className="rounded bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-ink-subtle">
                      {p.role.toLowerCase()}
                    </span>
                    {p.isDemo && (
                      <span className="rounded bg-warn-soft px-2 py-0.5 font-mono text-[10px] text-warn">
                        Demonstration data
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{p.description}</p>
                  )}
                  <p className="mt-2 text-xs text-ink-subtle">
                    {STEP_LABEL[p.currentStep] ?? p.currentStep} · {p.memberCount}{' '}
                    {p.memberCount === 1 ? 'member' : 'members'} · updated{' '}
                    <time dateTime={p.updatedAt.toISOString()}>
                      {p.updatedAt.toISOString().slice(0, 10)}
                    </time>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new-project" className="mt-12 border-t border-line pt-8">
        <h2 id="new-project" className="text-lg">New project</h2>
        <NewProjectForm />
      </section>
    </div>
  );
}

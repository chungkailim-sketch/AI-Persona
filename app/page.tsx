import Link from 'next/link';
import { loadEnv, integrationStatus } from '@/lib/env';

/**
 * Landing page. Renders without a database or a model key so the app never presents a blank
 * or broken first screen (prompt §32).
 */
export default function Home() {
  let integrations: ReturnType<typeof integrationStatus> = [];
  let configError: string | null = null;
  try {
    integrations = integrationStatus(loadEnv());
  } catch (e) {
    configError = e instanceof Error ? e.message : 'Configuration could not be read.';
  }

  return (
    <main id="main" className="mx-auto max-w-content px-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-brand">
        Evidence-grounded decision support
      </p>
      <h1 className="mt-2 max-w-prose text-4xl">Persona Intelligence</h1>
      <p className="mt-4 max-w-prose text-ink-muted">
        Ingest real audience data, state a brief, generate personas grounded in that data, run a
        structured adversarial simulation, and read findings that carry their evidence with them.
      </p>
      <p className="mt-3 max-w-prose text-sm text-ink-subtle">
        Simulated findings are decision support. They do not replace appropriately designed
        real-world research, and no result here is evidence of actual human behaviour.
      </p>

      <div className="mt-8 flex gap-3">
        <Link
          href="/sign-in"
          className="rounded bg-brand px-4 py-2 text-sm font-medium text-brand-ink transition-opacity duration-fast hover:opacity-90"
        >
          Sign in
        </Link>
        <Link href="/methodology" className="rounded border border-line px-4 py-2 text-sm text-ink-muted hover:border-brand">
          How it works
        </Link>
      </div>

      <section aria-labelledby="integrations" className="mt-14">
        <h2 id="integrations" className="text-lg">Integration status</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-subtle">
          What is genuinely connected in this build, and what runs on a local adapter. Nothing
          mocked is presented as live.
        </p>
        {configError ? (
          <p className="mt-4 rounded border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            {configError}
          </p>
        ) : (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {integrations.map((i) => (
              <li key={i.key} className="rounded border border-line bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink">{i.label}</span>
                  <span
                    className={
                      i.connected
                        ? 'rounded bg-ok-soft px-2 py-0.5 font-mono text-[10px] text-ok'
                        : 'rounded bg-warn-soft px-2 py-0.5 font-mono text-[10px] text-warn'
                    }
                  >
                    {i.connected ? 'connected' : `adapter: ${i.mode}`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-subtle">{i.note}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

'use client';

/**
 * Global error boundary.
 *
 * It shows the error digest — the identifier that appears in the server log — and nothing else
 * from the error. Messages and stack traces can carry field values from an uploaded dataset, so
 * they are never rendered to the browser (NFR-19).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-dvh bg-bg">
      <main id="main" className="mx-auto max-w-content px-6 py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-danger">
          Something went wrong
        </p>
        <h1 className="mt-2 text-2xl">This page could not be displayed</h1>
        <p className="mt-3 max-w-prose text-ink-muted">
          The failure has been recorded. Nothing you had entered has been discarded unless the page
          says so explicitly.
        </p>
        {error.digest && (
          <p className="mt-4 font-mono text-xs text-ink-subtle">
            Reference: {error.digest} — quote this when reporting the problem.
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded bg-brand px-4 py-2 text-sm font-medium text-brand-ink hover:opacity-90"
        >
          Try again
        </button>
      </main>
    </div>
  );
}

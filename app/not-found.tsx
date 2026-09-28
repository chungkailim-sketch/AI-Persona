import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-dvh bg-bg">
      <main id="main" className="mx-auto max-w-content px-6 py-20">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-subtle">Error 404</p>
        <h1 className="mt-2 text-2xl">That page does not exist</h1>
        <p className="mt-3 max-w-prose text-ink-muted">
          The address may have changed, or the project or run it referred to may have been archived
          or deleted.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-block rounded border border-line px-4 py-2 text-sm text-ink-muted hover:border-brand"
        >
          Go to Home
        </Link>
      </main>
    </div>
  );
}

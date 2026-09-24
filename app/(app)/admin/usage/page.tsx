import { notFound } from 'next/navigation';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { loadEnv } from '@/lib/env';

export const metadata = { title: 'Usage · Administration' };
export const dynamic = 'force-dynamic';

/**
 * Model usage and spend.
 *
 * Aggregated from the `ModelCall` rows the client writes for every attempt, so the figures here are
 * what was actually requested rather than what a run intended. Mock calls are shown separately and
 * never folded into a spend total: a mock run that appeared to cost something would make the whole
 * table untrustworthy.
 *
 * The cost is derived from published per-token prices. It is an estimate for planning, and the page
 * says so — the authoritative figure is the provider's own billing.
 */
export default async function AdminUsagePage() {
  const user = await requireUser('/admin/usage');
  const ctx = await authContextFor(user);
  if (!can(ctx, 'admin.usage.view')) notFound();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [byProvider, byStage, failures, budget] = await Promise.all([
    prisma.modelCall.groupBy({
      by: ['provider', 'modelId'],
      where: { createdAt: { gte: since } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true },
      _count: true,
    }),
    prisma.modelCall.groupBy({
      by: ['stage'],
      where: { createdAt: { gte: since } },
      _sum: { costUsd: true },
      _count: true,
      orderBy: { _count: { stage: 'desc' } },
    }),
    prisma.modelCall.groupBy({
      by: ['outcome'],
      where: { createdAt: { gte: since }, outcome: { not: 'ok' } },
      _count: true,
    }),
    (async () => {
      try {
        const env = loadEnv();
        return {
          perRun: env.AI_RUN_BUDGET_USD,
          perMonth: env.AI_PROJECT_MONTHLY_BUDGET_USD,
          provider: env.MODEL_PROVIDER,
        };
      } catch {
        return null;
      }
    })(),
  ]);

  const liveSpend = byProvider
    .filter((p) => p.provider !== 'mock')
    .reduce((s, p) => s + (p._sum.costUsd ?? 0), 0);
  const mockCalls = byProvider
    .filter((p) => p.provider === 'mock')
    .reduce((s, p) => s + p._count, 0);

  return (
    <>
      <h1 className="text-2xl">Usage</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Every model call in the last 30 days, aggregated from what was actually requested. Costs are
        derived from published per-token prices — an estimate for planning, not an invoice. The
        authoritative figure is the provider&rsquo;s own billing.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded border border-line bg-surface p-4">
          <dt className="text-xs text-ink-subtle">Estimated spend, 30 days</dt>
          <dd className="mt-1 font-mono text-2xl text-ink">${liveSpend.toFixed(2)}</dd>
        </div>
        <div className="rounded border border-line bg-surface p-4">
          <dt className="text-xs text-ink-subtle">Mock calls (no cost)</dt>
          <dd className="mt-1 font-mono text-2xl text-ink">{mockCalls}</dd>
        </div>
        <div className="rounded border border-line bg-surface p-4">
          <dt className="text-xs text-ink-subtle">Configured provider</dt>
          <dd className="mt-1 font-mono text-lg text-ink">{budget?.provider ?? 'unreadable'}</dd>
        </div>
      </dl>

      {budget?.provider === 'mock' && (
        <p className="mt-4 max-w-prose rounded border border-warn bg-warn-soft px-4 py-3 text-sm text-warn">
          The mock provider is configured. No AI model is being consulted anywhere in this
          deployment, and every run it produces is labelled as mock through to any export.
        </p>
      )}

      <section aria-labelledby="providers" className="mt-10">
        <h2 id="providers" className="text-lg">By provider and model</h2>
        {byProvider.length === 0 ? (
          <p className="mt-3 rounded border border-line bg-surface px-4 py-6 text-sm text-ink-muted">
            No model calls in the last 30 days.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Usage table">
            <table className="w-full min-w-[42rem] border-collapse text-sm">
              <caption className="sr-only">Model calls grouped by provider and model</caption>
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Provider</th>
                  <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Model</th>
                  <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Calls</th>
                  <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Input tokens</th>
                  <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Output tokens</th>
                  <th scope="col" className="py-2 font-medium text-ink-subtle">Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {byProvider.map((p) => (
                  <tr key={`${p.provider}-${p.modelId}`} className="border-b border-line/60">
                    <td className="py-2 pr-4 font-mono text-xs text-ink">{p.provider}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-ink-muted">{p.modelId}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-ink-muted">{p._count}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-ink-muted">
                      {(p._sum.inputTokens ?? 0).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-ink-muted">
                      {(p._sum.outputTokens ?? 0).toLocaleString()}
                    </td>
                    <td className="py-2 font-mono text-xs text-ink">
                      {p.provider === 'mock' ? '—' : `$${(p._sum.costUsd ?? 0).toFixed(4)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {byStage.length > 0 && (
        <section aria-labelledby="stages" className="mt-10">
          <h2 id="stages" className="text-lg">By stage</h2>
          <ul className="mt-3 flex flex-col gap-1.5">
            {byStage.map((s) => (
              <li key={s.stage} className="flex items-baseline justify-between gap-4 text-xs">
                <span className="font-mono text-ink-muted">
                  {s.stage.toLowerCase().replace(/_/g, ' ')}
                </span>
                <span className="font-mono text-ink-subtle">
                  {s._count} calls · ${(s._sum.costUsd ?? 0).toFixed(4)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="failures" className="mt-10">
        <h2 id="failures" className="text-lg">Calls that did not succeed</h2>
        {failures.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Every model call in the last 30 days returned a usable answer.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1.5">
            {failures.map((f) => (
              <li key={f.outcome} className="flex items-baseline justify-between gap-4 text-xs">
                <span className="font-mono text-warn">{f.outcome}</span>
                <span className="font-mono text-ink-subtle">{f._count}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 max-w-prose text-xs text-ink-subtle">
          An <span className="font-mono">invalid</span> outcome means the answer did not fit the
          required shape after a repair attempt. Those answers are never used, so they appear here
          rather than in a report.
        </p>
      </section>

      {budget && (
        <section aria-labelledby="budgets" className="mt-10">
          <h2 id="budgets" className="text-lg">Configured caps</h2>
          <dl className="mt-3 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-ink-subtle">Per run</dt>
            <dd className="font-mono text-xs text-ink">${budget.perRun.toFixed(2)}</dd>
            <dt className="text-ink-subtle">Per project, per month</dt>
            <dd className="font-mono text-xs text-ink">${budget.perMonth.toFixed(2)}</dd>
          </dl>
          <p className="mt-2 max-w-prose text-xs text-ink-subtle">
            A run that reaches its cap stops rather than finishing and presenting a bill afterwards.
            These are set in the environment, not here — a spending limit that can be raised from
            inside the application is not much of a limit.
          </p>
        </section>
      )}
    </>
  );
}

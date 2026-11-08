import Link from 'next/link';
import { loadEnv, integrationStatus } from '@/lib/env';
import { BrandLogo } from '@/ui/shell/BrandLogo';

const STEPS = [
  ['01', 'Data', 'Load the survey databooks. One file per market, kept as named.'],
  ['02', 'Brief', 'Choose the markets, the roundtable question and the categories to score.'],
  ['03', 'Personas', 'Three tiers per market, built from income, age and the parameters you pick.'],
  ['04', 'Roundtable', 'Each relevant persona answers alone and scores every category.'],
  ['05', 'Results', 'A computed heatmap, takeaways, decision guidance and a PR and marketing plan.'],
] as const;

const GET = [
  ['01', 'Personas with names', 'Each segment gets an illustrative person, a decision logic and the published figures behind it.'],
  ['02', 'A heatmap', 'Openness by market and category, computed in code from every persona’s scores.'],
  ['03', 'Decision guidance', 'A decision engine weighs each checkpoint and suggests what to do next.'],
  ['04', 'A plan', 'PR, comms and marketing recommendations grounded in the data and recognised frameworks.'],
] as const;

const pill = 'inline-block rounded-full bg-action px-7 py-3.5 text-[13px] font-medium tracking-wide text-action-ink transition-transform duration-fast hover:-translate-y-px';
const outline = 'inline-block rounded-full border border-ink px-7 py-3.5 text-[13px] font-medium tracking-wide text-ink transition-transform duration-fast hover:-translate-y-px';

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
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-elevated/85 backdrop-blur-md">
        <div className="mx-auto flex h-[68px] max-w-[1200px] items-center justify-between gap-6 px-5 lg:px-8">
          <Link href="/" aria-label="rf.AI Persona — home"><BrandLogo height={22} /></Link>
          <nav aria-label="Primary" className="hidden items-center gap-7 text-sm font-medium text-ink-muted md:flex">
            <a href="#how" className="hover:text-ink">How it works</a>
            <Link href="/methodology" className="hover:text-ink">Methodology</Link>
            <a href="#status" className="hover:text-ink">Status</a>
          </nav>
          <div className="flex items-center gap-4">
            <Link href="/sign-in" className="text-sm font-medium text-ink-muted hover:text-ink">Sign in</Link>
            <Link href="/sign-in" className="rounded-full bg-action px-5 py-2.5 text-[12.5px] font-medium tracking-wide text-action-ink">Get started</Link>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1200px] px-5 lg:px-8">
        <section className="grid items-center gap-10 py-16 lg:grid-cols-[1.15fr_1fr] lg:py-24">
          <div>
            <span className="eyebrow">Ruder Finn · AI Persona Intelligence</span>
            <h1 className="mt-5 max-w-[14ch]">Ask a question. Hear the market answer.</h1>
            <p className="mt-6 max-w-[52ch] text-lg font-light text-ink-muted">
              Simulated consumer panels built from published survey data, so a team can test a market-entry idea before it spends a budget.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/sign-in" className={pill}>Start a study</Link>
              <a href="#how" className={outline}>How it works</a>
            </div>
          </div>
          <aside className="panel p-8" aria-label="Illustration of a roundtable result">
            <span className="eyebrow">Roundtable · illustration</span>
            <ul className="mt-4">
              {[['Indonesia', 'Premium Pioneers', 82], ['Saudi Arabia', 'Premium Pioneers', 74], ['Brazil', 'Premium Pioneers', 77]].map(([m, t, n]) => (
                <li key={m as string} className="flex items-center gap-4 border-t border-line py-4">
                  <span aria-hidden className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-line text-sm font-semibold text-ink-muted">{(m as string).slice(0, 1)}</span>
                  <span><b className="block font-medium text-ink">{m}</b><span className="text-sm font-light text-ink-muted">{t}</span></span>
                  <span className="ml-auto text-lg font-medium text-brand">{n}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 h-0.5 bg-line"><div className="h-full w-[66%] bg-brand-mark" /></div>
            <p className="mt-2 text-xs text-ink-subtle">Openness to trying a foreign brand, 0 to 100. An illustration of the format, not study data.</p>
          </aside>
        </section>

        <section id="how" className="grid gap-12 py-12 lg:grid-cols-[2fr_3fr]">
          <div>
            <span className="eyebrow">How a study runs</span>
            <h2 className="mt-3 text-[2.4rem] font-light leading-[1.15] tracking-[-0.025em]">Five steps from files to findings</h2>
            <ul className="mt-10">
              {STEPS.map(([n, label, text], i) => (
                <li key={label} className="group relative cursor-default border-t border-line pb-4 pt-5">
                  <span aria-hidden className={`absolute left-0 top-[-1px] h-0.5 bg-brand-mark transition-all duration-500 group-hover:w-full ${i === 0 ? 'w-1/3' : 'w-0'}`} />
                  <h3 className="text-[19px] font-medium text-ink-muted transition-colors group-hover:text-ink">{n} · {label}</h3>
                  <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 group-hover:grid-rows-[1fr] group-focus-within:grid-rows-[1fr]">
                    <p className="overflow-hidden pr-4 pt-2 text-sm font-light text-ink-muted">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel flex flex-col justify-between p-8 lg:p-10">
            <div>
              <span className="eyebrow">What a persona is</span>
              <p className="mt-5 text-[1.7rem] font-light leading-snug tracking-[-0.02em] text-ink">
                A person who stands for a real segment of a market, described only by the published survey statistics, answering one question alone.
              </p>
            </div>
            <p className="mt-10 border-l-2 border-brand-mark pl-4 text-sm font-light text-ink-muted">
              Simulated findings are decision support. They do not replace appropriately designed real-world research, and no result here is evidence of actual human behaviour.
            </p>
          </div>
        </section>

        <section className="py-16">
          <span className="eyebrow">What you get</span>
          <h2 className="mt-3 text-[2.4rem] font-light leading-[1.15] tracking-[-0.025em]">Evidence you can act on</h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {GET.map(([n, title, text]) => (
              <div key={title} className="border-t border-line pt-5">
                <span className="text-[13px] text-ink-subtle">{n}</span>
                <h3 className="mb-3 mt-14 text-xl font-medium tracking-tight">{title}</h3>
                <p className="font-light text-ink-muted">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-6">
          <div className="panel px-6 py-16 text-center">
            <span className="eyebrow">Ready when you are</span>
            <h2 className="mx-auto mb-8 mt-4 max-w-[18ch] text-[2.4rem] font-light leading-[1.15] tracking-[-0.025em]">Start with a question and a few databooks.</h2>
            <Link href="/sign-in" className={pill}>Start a new study</Link>
          </div>
        </section>

        <section id="status" aria-labelledby="integrations" className="py-16">
          <span className="eyebrow">Status</span>
          <h2 id="integrations" className="mt-3 text-2xl">Integration status</h2>
          <p className="mt-2 max-w-prose text-sm font-light text-ink-muted">
            What is genuinely connected in this build, and what runs on a local adapter. Nothing mocked is presented as live.
          </p>
          {configError ? (
            <p className="mt-6 rounded-lg border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">{configError}</p>
          ) : (
            <ul className="mt-6 grid gap-x-8 sm:grid-cols-2">
              {integrations.map((i) => (
                <li key={i.key} className="border-t border-line py-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">{i.label}</span>
                    <span className={i.connected ? 'rounded-full bg-ok-soft px-2.5 py-0.5 text-[11px] text-ok' : 'rounded-full bg-warn-soft px-2.5 py-0.5 text-[11px] text-warn'}>
                      {i.connected ? 'connected' : `adapter: ${i.mode}`}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-light text-ink-subtle">{i.note}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-2 px-5 py-7 text-xs text-ink-subtle lg:px-8">
          <span>© Ruder Finn. Personas are illustrative and built from published survey statistics.</span>
          <span><Link href="/methodology" className="hover:text-ink">Methodology</Link></span>
        </div>
      </footer>
    </div>
  );
}

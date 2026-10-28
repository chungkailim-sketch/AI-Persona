/**
 * The roundtable report as 16:9 slides, in the order of the RF sample report:
 *
 *   cover → about the engine → market potential (map) → market entry (heatmap) → the cast →
 *   the roundtable → openness heatmap and takeaways → one profile per persona → communications
 *   recommendation → method and limits.
 *
 * Every figure is computed in code (src/roundtable/report.ts); the model's words (quotes, takeaways,
 * advice) are shown as written and the personas are labelled illustrative. Interface wording is
 * English and goes through the interface translation like the rest of the app.
 */
import type { ReactNode } from 'react';
import { BrandLogo } from '../shell/BrandLogo';
import { cn } from '../cn';
import { band, ENTRY_WEIGHTS, GEO_GATE, PILLAR_LABEL, PILLAR_SHORT, POTENTIAL_WEIGHTS, TIERS, type Pillar, type TierKey } from '@/roundtable/marketIndex';
import type { Report, ReportPersona } from '@/roundtable/report';
import { MarketMap, TIER_FILL } from './MarketMap';
import { PersonaAvatar, PersonaCard, keyStats } from './PersonaCard';
import { ScaledSlide } from './ScaledSlide';

const TIER_LABEL = Object.fromEntries(TIERS.map((t) => [t.key, t.label])) as Record<TierKey, string>;
const BAND_TEXT = { willing: 'Willing', depends: 'Depends', unlikely: 'Not keen' } as const;
const SOURCE = 'Source: Mintel Global Consumer survey data; simulated RF AI Persona roundtable.';

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out.length ? out : [[]];
}

function heatClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'bg-[var(--slide-paper)] text-ink-subtle';
  const b = band(score);
  return b === 'willing' ? 'bg-[var(--heat-high)] text-[var(--heat-high-ink)]' : b === 'depends' ? 'bg-[var(--heat-mid)] text-[var(--heat-mid-ink)]' : 'bg-[var(--heat-low)] text-[var(--heat-low-ink)]';
}

function Slide({ section, title, source = SOURCE, page, children, className }: { section: string; title: ReactNode; source?: string | null; page: number; children: ReactNode; className?: string }) {
  return (
    <ScaledSlide>
      <div className="flex h-full flex-col px-14 pb-6 pt-10">
        <header className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-brand-mark">{section}</p>
            <h2 className="mt-1 text-[30px] font-extrabold leading-tight text-ink">{title}</h2>
          </div>
          <BrandLogo height={20} className="mt-1 shrink-0" />
        </header>
        <div className={cn('mt-5 min-h-0 flex-1', className)}>{children}</div>
        <footer className="mt-3 flex items-end justify-between gap-6 border-t border-line pt-2 text-[10.5px] text-ink-subtle">
          <span>{source}</span>
          <span className="shrink-0">Ruder Finn · {page}</span>
        </footer>
      </div>
    </ScaledSlide>
  );
}

function MockBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="no-print mb-3 rounded border border-warn bg-warn-soft px-3 py-2 text-sm text-warn">Produced with the mock model provider: the words below are placeholders and the scores are random.</p>;
}

// ── 1 Cover ───────────────────────────────────────────────────────────────────

function Cover({ r }: { r: Report }) {
  const date = (r.roundtable.completedAt ?? new Date()).toISOString().slice(0, 10);
  return (
    <ScaledSlide>
      <div className="grid h-full grid-cols-[1fr_380px]">
        <div className="flex flex-col justify-between px-16 py-14">
          <BrandLogo height={40} />
          <div>
            <p className="text-[15px] font-bold uppercase tracking-[0.16em] text-brand-mark">AI Persona Roundtable</p>
            <h1 className="mt-3 text-[50px] font-extrabold leading-[1.05] text-ink">{r.projectName}</h1>
            <p className="mt-6 max-w-[640px] text-[22px] font-semibold leading-snug text-ink-muted">“{r.roundtable.question}”</p>
            {r.audience && <p className="mt-4 text-[15px] text-ink-subtle">{r.audience}</p>}
          </div>
          <p className="text-[13px] text-ink-subtle">RF AI Persona Intelligence · {date}</p>
        </div>
        <div className="flex flex-col justify-end gap-3 bg-brand-deep px-10 py-14 text-brand-deep-ink">
          <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-[var(--color-highlight)]">Markets</p>
          <ul className="flex flex-col gap-1 text-[22px] font-bold">{r.castMarkets.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="mt-6 text-[14px] opacity-90">{`${r.cast.length} illustrative personas · ${r.roundtable.categories.length} categories`}</p>
        </div>
      </div>
    </ScaledSlide>
  );
}

// ── 2 About the engine ────────────────────────────────────────────────────────

const CYCLE = [
  { n: 1, title: 'Data foundation', body: 'Licensed consumer survey data (Mintel), read as published shares with their bases.' },
  { n: 2, title: 'Generate personas', body: 'Markets × income tiers, each described by where its tier differs from the market.' },
  { n: 3, title: 'Simulate reactions', body: 'A roundtable: every persona answers the question alone and scores each category.' },
  { n: 4, title: 'Decision output', body: 'Openness heatmaps, market indices and communications recommendations.' },
];
const BENEFITS = [
  { title: 'Better results', body: 'Messages tested against grounded audiences before money is spent.' },
  { title: 'Faster decisions', body: 'From databook to recommendation in a day, not a fieldwork cycle.' },
  { title: 'Lower research cost', body: 'Focus real fieldwork on the questions the simulation cannot settle.' },
];
const USERS = ['CMOs and brand leads', 'PR and communications', 'Strategy and planning', 'Market entry teams', 'Issues and crisis'];

function About({ page }: { page: number }) {
  return (
    <Slide section="About" title="rf.AI Persona — how the engine works" source={null} page={page}>
      <div className="grid h-full grid-cols-[1.25fr_1fr] gap-8">
        <div className="flex flex-col gap-4">
          <ol className="grid grid-cols-2 gap-3">
            {CYCLE.map((c) => (
              <li key={c.n} className="rounded border border-line bg-brand-soft p-4">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-deep text-[15px] font-extrabold text-brand-deep-ink">{c.n}</span>
                <p className="mt-2 text-[17px] font-bold text-ink">{c.title}</p>
                <p className="mt-1 text-[13px] leading-snug text-ink-muted">{c.body}</p>
              </li>
            ))}
          </ol>
          <div className="rounded border-l-4 border-[var(--color-highlight)] bg-[var(--slide-paper)] p-4 shadow-[0_0_0_1px_var(--color-line)]">
            <p className="text-[13px] font-bold uppercase tracking-wide text-brand">Core differentiator</p>
            <p className="mt-1 text-[14px] leading-snug text-ink">
              Every persona is built from published survey statistics with their base, and every number in this report is computed from the data and the panel's scores — the model writes the words, never the figures.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-[13px] font-bold uppercase tracking-wide text-brand">Benefits</p>
            <ul className="mt-2 flex flex-col gap-2">
              {BENEFITS.map((b) => (
                <li key={b.title} className="rounded bg-brand-deep px-4 py-3 text-brand-deep-ink">
                  <p className="text-[16px] font-bold">{b.title}</p>
                  <p className="text-[12.5px] opacity-90">{b.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-bold uppercase tracking-wide text-brand">Who it is for</p>
            <ul className="mt-2 flex flex-wrap gap-2">{USERS.map((u) => <li key={u} className="rounded-full border border-brand px-3 py-1 text-[13px] font-semibold text-brand">{u}</li>)}</ul>
          </div>
        </div>
      </div>
    </Slide>
  );
}

// ── 3 Market potential ────────────────────────────────────────────────────────

function weightList(w: Partial<Record<Pillar, number>>): string {
  return (Object.entries(w) as [Pillar, number][]).map(([p, x]) => `${PILLAR_LABEL[p]} ${(x * 100).toFixed(1).replace(/\.0$/, '')}%`).join(' · ');
}

function Potential({ r, page }: { r: Report; page: number }) {
  const missing = r.potential.filter((p) => p.missing.length > 0);
  return (
    <Slide section="Market potential · Priority markets" title="Where Chinese brands have the most room to grow" page={page}
      source={`Index: ${weightList(POTENTIAL_WEIGHTS)}. Policy gate: geopolitics & trade ≤ ${GEO_GATE} caps a market at Selective entry. ${SOURCE}`}>
      <div className="grid h-full grid-cols-[1fr_330px] gap-6">
        <div className="flex min-h-0 flex-col">
          <MarketMap rows={r.potential} width={820} height={430} />
          <ul className="mt-2 flex flex-wrap gap-4 text-[12px] text-ink-muted">
            {TIERS.map((t) => (
              <li key={t.key} className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: TIER_FILL[t.key] }} />
                {`${t.label} ${t.key === 'priority' ? '≥65' : t.key === 'build' ? '50–65' : t.key === 'selective' ? '40–50' : '<40'}`}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-brand-deep text-left text-brand-deep-ink">
                <th className="px-2 py-1.5">Market</th><th className="px-2 py-1.5 text-right">Index</th><th className="px-2 py-1.5">Tier</th>
              </tr>
            </thead>
            <tbody>
              {r.potential.slice(0, 12).map((p) => (
                <tr key={p.market} className="border-b border-line">
                  <td className="px-2 py-1 font-semibold">{p.market}</td>
                  <td className="px-2 py-1 text-right font-bold">{p.score === null ? '–' : Math.round(p.score)}</td>
                  <td className="px-2 py-1">{p.tier ? TIER_LABEL[p.tier] : '—'}{p.gated ? ' *' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.potential.some((p) => p.gated) && <p className="text-[11px] text-ink-subtle">* Capped by the policy gate.</p>}
          <div className="rounded bg-brand-soft p-3">
            <p className="text-[12px] font-bold uppercase tracking-wide text-brand">Reading the data</p>
            <ul className="mt-1 flex flex-col gap-1 text-[12.5px] leading-snug text-ink">{(r.summary?.marketReading.potential ?? []).slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          {missing.length > 0 && (
            <p className="text-[11px] leading-snug text-ink-subtle">
              {`Not entered yet: ${missing.slice(0, 4).map((m) => `${m.market} (${m.missing.map((p) => PILLAR_LABEL[p]).join(', ')})`).join('; ')}. Weights are rescaled over the pillars present.`}
            </p>
          )}
        </div>
      </div>
    </Slide>
  );
}

// ── 4 Market entry ────────────────────────────────────────────────────────────

const ENTRY_PILLARS = Object.keys(ENTRY_WEIGHTS) as Pillar[];

function Entry({ r, page }: { r: Report; page: number }) {
  const cats = r.roundtable.categories;
  return (
    <Slide section="Market entry · Category barriers" title="How open each market is, category by category" page={page}
      source={`Entry index: ${weightList(ENTRY_WEIGHTS)}. A category score is the entry index with that category's openness as category demand. ${SOURCE}`}>
      <div className="grid h-full grid-cols-[1fr_260px] gap-5">
        <div className="min-h-0 overflow-hidden">
          <table className="w-full table-fixed border-separate border-spacing-[2px] text-[11px]">
            <thead>
              <tr className="text-brand-deep-ink">
                <th className="w-[92px] rounded-sm bg-brand-deep px-1.5 py-1 text-left">Market</th>
                {ENTRY_PILLARS.map((p) => <th key={p} className="rounded-sm bg-brand px-1 py-1 text-[10px] font-semibold leading-tight">{PILLAR_SHORT[p]}<span className="block font-normal opacity-90">{`${Math.round(ENTRY_WEIGHTS[p]! * 100)}%`}</span></th>)}
                <th className="rounded-sm bg-brand-deep px-1 py-1">Entry index</th>
                <th className="w-[74px] rounded-sm bg-brand-deep px-1 py-1">Tier</th>
                {cats.map((c) => <th key={c} className="rounded-sm bg-brand-mark px-1 py-1 text-[10px] font-semibold leading-tight [hyphens:auto] [overflow-wrap:anywhere]">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.entry.slice(0, 14).map((e) => (
                <tr key={e.market}>
                  <th className="truncate px-1.5 py-1 text-left font-bold">{e.market}</th>
                  {ENTRY_PILLARS.map((p) => (
                    <td key={p} className={cn('rounded-sm px-1 py-1 text-center', heatClass(e.values[p] ?? null))}>
                      {e.values[p] == null ? '–' : Math.round(e.values[p]!)}{e.fromRoundtable.includes(p) ? '†' : ''}
                    </td>
                  ))}
                  <td className={cn('rounded-sm px-1 py-1 text-center text-[12px] font-extrabold', heatClass(e.score))}>{e.score === null ? '–' : Math.round(e.score)}</td>
                  <td className="px-1 py-1 text-center font-semibold">{e.tier ? TIER_LABEL[e.tier] : '—'}</td>
                  {cats.map((c) => (
                    <td key={c} className={cn('rounded-sm px-1 py-1 text-center', heatClass(e.categories[c]), e.lead === c && 'font-extrabold underline')}>
                      {e.categories[c] == null ? '–' : Math.round(e.categories[c]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10.5px] text-ink-subtle">† From the roundtable (not entered). Underlined: lead category. – : not entered or not in the cast.</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded bg-brand-soft p-3">
            <p className="text-[12px] font-bold uppercase tracking-wide text-brand">Interpretation</p>
            <ul className="mt-1 flex flex-col gap-1 text-[12px] leading-snug">{(r.summary?.marketReading.entry ?? []).slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
          <div className="rounded bg-brand-deep p-3 text-brand-deep-ink">
            <p className="text-[12px] font-bold uppercase tracking-wide text-[var(--color-highlight)]">Entry strategy</p>
            <ul className="mt-1 flex flex-col gap-1 text-[12px] leading-snug">{(r.summary?.marketReading.strategy ?? []).slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        </div>
      </div>
    </Slide>
  );
}

// ── 5 The cast ────────────────────────────────────────────────────────────────

function CastSlides({ r, start }: { r: Report; start: number }) {
  return (
    <>
      {chunk(r.castMarkets, 5).map((markets, i) => (
        <Slide key={i} section="The cast" title={`${r.cast.length} personas across ${r.castMarkets.length} markets and three income tiers`} page={start + i}
          source={`Identities are illustrative; statistics are the tier's published shares against all adults in the market. ${SOURCE}`}>
          <div className="grid h-full gap-2" style={{ gridTemplateColumns: `120px repeat(${markets.length}, minmax(0, 1fr))`, gridTemplateRows: 'auto repeat(3, minmax(0, 1fr))' }}>
            <span />
            {markets.map((m) => <p key={m} className="rounded-sm bg-brand-deep px-2 py-1 text-[14px] font-bold text-brand-deep-ink">{m}</p>)}
            {[1, 2, 3].map((tier) => (
              <Row key={tier} tier={tier} markets={markets} r={r} />
            ))}
          </div>
        </Slide>
      ))}
    </>
  );
}

function Row({ tier, markets, r }: { tier: number; markets: string[]; r: Report }) {
  const label = r.cast.find((p) => p.profile.tier === tier)?.profile.tierLabel ?? '';
  return (
    <>
      <div className="flex flex-col justify-center">
        <p className="text-[11px] font-bold uppercase tracking-wide text-brand-mark">Tier {tier}</p>
        <p className="text-[14px] font-bold leading-tight">{label}</p>
      </div>
      {markets.map((m) => {
        const p = r.cast.find((x) => x.profile.market === m && x.profile.tier === tier);
        return (
          <div key={m} className="min-h-0 overflow-hidden text-[12px]">
            {p ? <PersonaCard name={p.name} profile={p.profile} compact /> : <span className="text-ink-subtle">—</span>}
          </div>
        );
      })}
    </>
  );
}

// ── 6 The roundtable ──────────────────────────────────────────────────────────

function Roundtable({ r, page }: { r: Report; page: number }) {
  const byId = new Map(r.cast.map((p) => [p.id, p]));
  return (
    <Slide section="Roundtable" title={`“${r.roundtable.question}”`} page={page}>
      <div className="flex h-full flex-col gap-4">
        <ul className="grid flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, r.view.featured.length)}, minmax(0, 1fr))` }}>
          {r.view.featured.map((a) => {
            const p = byId.get(a.personaId);
            const b = band(a.overall ?? 0);
            return (
              <li key={a.personaId} className="flex flex-col gap-2 rounded border border-line p-3">
                <div className="flex items-center gap-2">
                  <PersonaAvatar name={p?.name ?? '?'} size={44} />
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-bold">{p?.name}</p>
                    <p className="text-[11px] text-ink-subtle">{`${a.market} · Tier ${a.tier}`}</p>
                  </div>
                </div>
                <p className="flex-1 text-[14px] leading-snug text-ink">“{a.quote}”</p>
                <p className="flex items-center justify-between">
                  <span className={cn('rounded-sm px-2 py-0.5 text-[12px] font-bold', heatClass(a.overall))}>{BAND_TEXT[b]}</span>
                  <span className="text-[12px] text-ink-muted">Openness <b className="text-ink">{Math.round(a.overall ?? 0)}</b></span>
                </p>
              </li>
            );
          })}
        </ul>
        <div className="grid grid-cols-[1fr_auto] items-center gap-6 rounded bg-brand-deep px-5 py-3 text-brand-deep-ink">
          <p className="text-[16px] font-semibold leading-snug"><span className="mr-2 text-[12px] font-bold uppercase tracking-wide text-[var(--color-highlight)]">Consensus</span>{r.summary?.consensus ?? '—'}</p>
          <p className="text-[12px] opacity-90">{`${r.view.bands.willing} willing · ${r.view.bands.depends} depends · ${r.view.bands.unlikely} not keen`}</p>
        </div>
        <ul className="flex flex-wrap gap-1.5">{r.roundtable.categories.map((c) => <li key={c} className="rounded-sm border border-line px-2 py-0.5 text-[11.5px] text-ink-muted">{c}</li>)}</ul>
      </div>
    </Slide>
  );
}

// ── 7 Heatmap ─────────────────────────────────────────────────────────────────

function Heatmaps({ r, start }: { r: Report; start: number }) {
  const rows = r.cast.filter((p) => p.answer);
  const pages = chunk(rows, 15);
  return (
    <>
      {pages.map((ps, i) => (
        <Slide key={i} section="Openness heatmap" title="Openness to trying a Chinese brand, by persona and category (0–100)" page={start + i}>
          <div className="grid h-full grid-cols-[1fr_280px] gap-5">
            <table className="w-full table-fixed border-separate border-spacing-[2px] self-start text-[11.5px]">
              <thead>
                <tr>
                  <th className="w-[200px] rounded-sm bg-brand-deep px-2 py-1 text-left text-brand-deep-ink">Persona</th>
                  {r.roundtable.categories.map((c) => <th key={c} className="rounded-sm bg-brand-deep px-1 py-1 font-semibold leading-tight text-brand-deep-ink">{c}</th>)}
                  <th className="w-[64px] rounded-sm bg-brand px-1 py-1 text-brand-ink">Overall</th>
                </tr>
              </thead>
              <tbody>
                {ps.map((p, j) => {
                  const newMarket = j === 0 || ps[j - 1]!.profile.market !== p.profile.market;
                  return (
                    <tr key={p.id} className={newMarket ? '[&>*]:border-t-2 [&>*]:border-brand-mark' : undefined}>
                      <th className="truncate px-2 py-0.5 text-left font-semibold">
                        {p.name} <span className="font-normal text-ink-subtle">{`${p.profile.market} T${p.profile.tier}`}</span>
                      </th>
                      {r.roundtable.categories.map((c) => {
                        const s = p.answer!.scores.find((x) => x.category === c)?.score;
                        return <td key={c} className={cn('rounded-sm py-0.5 text-center', heatClass(s))}>{s ?? '–'}</td>;
                      })}
                      <td className={cn('rounded-sm py-0.5 text-center font-extrabold', heatClass(p.answer!.overall))}>{Math.round(p.answer!.overall ?? 0)}</td>
                    </tr>
                  );
                })}
                {i === pages.length - 1 && (
                  <tr>
                    <th className="px-2 py-1 text-left font-extrabold">All personas</th>
                    {r.roundtable.categories.map((c) => <td key={c} className={cn('rounded-sm py-1 text-center font-extrabold', heatClass(r.view.categoryMeans[c]))}>{r.view.categoryMeans[c] === undefined ? '–' : Math.round(r.view.categoryMeans[c]!)}</td>)}
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col gap-1 text-[11.5px]">
                <li className="flex items-center gap-2"><span className="inline-block h-3 w-5 rounded-sm bg-[var(--heat-high)]" /> ≥60 willing</li>
                <li className="flex items-center gap-2"><span className="inline-block h-3 w-5 rounded-sm bg-[var(--heat-mid)]" /> 40–59 depends</li>
                <li className="flex items-center gap-2"><span className="inline-block h-3 w-5 rounded-sm bg-[var(--heat-low)]" /> &lt;40 not keen</li>
              </ul>
              <div className="rounded bg-brand-soft p-3">
                <p className="text-[12px] font-bold uppercase tracking-wide text-brand">Key takeaways</p>
                <ol className="mt-1 flex list-decimal flex-col gap-1.5 pl-4 text-[12.5px] leading-snug">{(r.summary?.takeaways ?? []).slice(0, 5).map((t, k) => <li key={k}>{t}</li>)}</ol>
              </div>
            </div>
          </div>
        </Slide>
      ))}
    </>
  );
}

// ── 8 Persona profiles ────────────────────────────────────────────────────────

function Profile({ p, r, page }: { p: ReportPersona; r: Report; page: number }) {
  const id = p.profile.identity;
  const a = p.answer!;
  const stats = keyStats(p.profile);
  const sorted = [...a.scores].sort((x, y) => y.score - x.score);
  return (
    <Slide section={`Persona profile · ${p.profile.market} · Tier ${p.profile.tier} ${p.profile.tierLabel}`} title={`${p.name}${id ? `, ${id.age}` : ''}`} page={page}>
      <div className="grid h-full grid-cols-[300px_1fr_300px] gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <PersonaAvatar name={p.name} size={72} />
            <div className="text-[13px] text-ink-muted">
              {id && <p className="font-semibold text-ink">{[id.occupation, id.city].filter(Boolean).join(' · ')}</p>}
              {id?.lifeStage && <p>{id.lifeStage}</p>}
              {id?.decisionLogic?.length ? <p className="mt-1 font-bold text-brand">{id.decisionLogic.join(' > ')}</p> : null}
            </div>
          </div>
          <blockquote className="rounded bg-brand-deep p-4 text-[16px] font-semibold leading-snug text-brand-deep-ink">“{a.quote}”</blockquote>
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-brand">Mindset</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
              {(a.profile?.mindset ?? []).map((m) => (
                <div key={m.label}><dt className="text-ink-subtle">{m.label}</dt><dd className="font-bold">{m.value}</dd></div>
              ))}
            </dl>
          </div>
          <p className="mt-auto text-[12px] font-bold uppercase tracking-wide text-brand">Key statistics</p>
          <ul className="flex flex-col gap-1 text-[11.5px]">
            {stats.map((s) => <li key={s.id}><b className="text-brand">{Math.round(s.share)}%</b> {s.statement} <span className="text-ink-subtle">(vs {Math.round(s.overall)}%)</span></li>)}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <Box title="How to reach them" items={a.profile?.howToReach ?? []} />
          <Box title="What holds them back" items={a.profile?.holdsBack?.length ? a.profile.holdsBack : a.barriers} />
          <Box title="Brand communications advice" items={a.profile?.commsAdvice ?? a.conditions} accent />
        </div>
        <div>
          <p className="text-[12px] font-bold uppercase tracking-wide text-brand">Openness by category</p>
          <ul className="mt-2 flex flex-col gap-2">
            {sorted.map((s) => (
              <li key={s.category} className="text-[12px]">
                <div className="flex justify-between"><span>{s.category}</span><b>{s.score}</b></div>
                <div className="mt-0.5 h-2 rounded-full bg-track"><div className={cn('h-2 rounded-full', band(s.score) === 'willing' ? 'bg-[var(--heat-high)]' : band(s.score) === 'depends' ? 'bg-[var(--color-highlight)]' : 'bg-[var(--tier-watch)]')} style={{ width: `${s.score}%` }} /></div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-ink-subtle">{`Overall openness ${Math.round(a.overall ?? 0)} · base n=${p.profile.base} · illustrative persona`}</p>
        </div>
      </div>
    </Slide>
  );
}

function Box({ title, items, accent = false }: { title: string; items: string[]; accent?: boolean }) {
  return (
    <div className={cn('rounded p-3', accent ? 'border-l-4 border-[var(--color-highlight)] bg-brand-soft' : 'border border-line')}>
      <p className="text-[12px] font-bold uppercase tracking-wide text-brand">{title}</p>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-[13px] leading-snug">{items.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
}

// ── 9 Communications ──────────────────────────────────────────────────────────

function Comms({ r, page }: { r: Report; page: number }) {
  const c = r.summary?.comms;
  return (
    <Slide section="Communications recommendation" title={c?.headline || 'What to say, where'} page={page}>
      <div className="grid h-full grid-cols-[1fr_1.1fr] gap-6">
        <ul className="flex flex-col gap-3">
          {(c?.pillars ?? []).map((p, i) => (
            <li key={i} className="rounded border border-line p-3">
              <p className="text-[15px] font-bold text-brand">{p.title}</p>
              <p className="mt-1 text-[13px] leading-snug">{p.detail}</p>
            </li>
          ))}
        </ul>
        <table className="w-full self-start text-[12.5px]">
          <thead>
            <tr className="bg-brand-deep text-left text-brand-deep-ink"><th className="px-2 py-1.5">Market</th><th className="px-2 py-1.5">Message</th><th className="px-2 py-1.5">Channels</th></tr>
          </thead>
          <tbody>
            {(c?.byMarket ?? []).slice(0, 10).map((m) => (
              <tr key={m.market} className="border-b border-line align-top">
                <td className="px-2 py-1.5 font-bold">{m.market}</td>
                <td className="px-2 py-1.5">{m.message}</td>
                <td className="px-2 py-1.5 text-ink-muted">{m.channels.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Slide>
  );
}

// ── 10 Method ─────────────────────────────────────────────────────────────────

function Method({ r, page }: { r: Report; page: number }) {
  return (
    <Slide section="Method and limits" title="How to read this report" page={page} source={null}>
      <div className="grid h-full grid-cols-2 gap-8 text-[14px] leading-snug">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>Each market is split into three tiers of its published household-income bands (or age groups where no income break is published). A persona stands for a tier and is described by the statements on which the tier differs most from the market.</li>
          <li>Names, ages, occupations and cities are illustrative, written to make each tier easy to picture. They are not real people.</li>
          <li>{`Each persona answered alone and scored ${r.roundtable.categories.length} categories from 0 to 100. Means, bands (≥60 willing, 40–59 depends, <40 not keen) and the featured voices are computed in code.`}</li>
        </ul>
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li>Market indices combine pillars entered by the team (with their sources) and, where not entered, brand friendliness and category demand from the roundtable. Missing pillars are left out and the weights rescaled.</li>
          <li>The roundtable is a simulation for decision support. Treat its results as hypotheses to test in market, not as evidence of what real consumers will do.</li>
          {r.inputs.some((i) => i.source) && <li>{`Market input sources: ${[...new Set(r.inputs.map((i) => i.source).filter(Boolean))].join('; ')}.`}</li>}
          {r.roundtable.isMock && <li className="font-semibold text-warn">This report was produced with the mock model provider and carries no meaning.</li>}
        </ul>
      </div>
    </Slide>
  );
}

/** The whole deck. Page numbers are worked out first, since the cast and heatmap may run to several slides. */
export function SlideDeck({ r }: { r: Report }) {
  const profiled = r.cast.filter((p) => p.answer);
  const castStart = 5;
  const roundtablePage = castStart + chunk(r.castMarkets, 5).length;
  const heatStart = roundtablePage + 1;
  const profileStart = heatStart + chunk(profiled, 15).length;
  const commsPage = profileStart + profiled.length;
  return (
    <div className="slide-deck flex flex-col gap-6">
      <MockBanner show={r.roundtable.isMock} />
      <Cover r={r} />
      <About page={2} />
      <Potential r={r} page={3} />
      <Entry r={r} page={4} />
      <CastSlides r={r} start={castStart} />
      <Roundtable r={r} page={roundtablePage} />
      <Heatmaps r={r} start={heatStart} />
      {profiled.map((p, i) => <Profile key={p.id} p={p} r={r} page={profileStart + i} />)}
      <Comms r={r} page={commsPage} />
      <Method r={r} page={commsPage + 1} />
    </div>
  );
}

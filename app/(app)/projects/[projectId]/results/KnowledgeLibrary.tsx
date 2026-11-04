'use client';

import { useState } from 'react';
import type { KnowledgeEntry } from '@/knowledge/library';

const TABS = [
  { key: 'COMMS_SKILLS', label: 'PR, comms and marketing skills' },
  { key: 'MARKET_ENTRY', label: 'Market entry knowledge' },
] as const;

/** The curated knowledge bases, filterable by industry and searchable. */
export function KnowledgeLibrary({ entries, industries }: { entries: KnowledgeEntry[]; industries: readonly string[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('COMMS_SKILLS');
  const [industry, setIndustry] = useState('All industries');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = entries.filter(
    (k) =>
      k.base === tab &&
      (industry === 'All industries' || k.industries.includes('All industries') || k.industries.includes(industry as KnowledgeEntry['industries'][number])) &&
      (!q || `${k.title} ${k.summary} ${k.tags.join(' ')}`.toLowerCase().includes(q)),
  );
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Knowledge bases" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} role="tab" type="button" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`rounded px-3 py-1.5 text-sm font-semibold ${tab === t.key ? 'bg-brand text-brand-ink' : 'border border-line text-ink-muted hover:border-brand'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className="rounded border border-line-strong bg-input px-2 py-1.5 text-sm">
          {industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <input aria-label="Search the knowledge base" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="min-w-48 flex-1 rounded border border-line-strong bg-input px-2 py-1.5 text-sm" />
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((k) => (
          <li key={k.id} className="flex flex-col gap-2 rounded border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-[15px] font-bold text-ink">{k.title}</h4>
              <span className="shrink-0 rounded-sm bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-brand">{k.kind}</span>
            </div>
            <p className="text-sm text-ink-muted">{k.summary}</p>
            <p className="text-xs text-ink"><b>When to use:</b> {k.whenToUse}</p>
            <ol className="list-decimal pl-5 text-xs text-ink-muted">{k.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            <a href={k.source.url} target="_blank" rel="noopener noreferrer" className="mt-auto text-xs text-link underline-offset-2 hover:underline">
              {`${k.source.publisher} — ${k.source.title}${k.source.year ? ` (${k.source.year})` : ''} ↗`}
            </a>
          </li>
        ))}
        {shown.length === 0 && <li className="text-sm text-ink-muted">Nothing matches.</li>}
      </ul>
    </div>
  );
}

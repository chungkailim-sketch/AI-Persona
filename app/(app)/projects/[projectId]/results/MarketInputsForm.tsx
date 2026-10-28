'use client';

import { useActionState, useState } from 'react';
import { saveMarketInputsAction } from '../journeyActions';
import { FormMessages, SubmitButton, TextInput } from '@/ui/forms';
import type { FormState } from '../actions';

const empty: FormState = {};

export const PILLAR_COLUMNS = [
  { key: 'brand', label: 'Brand friendliness', hint: 'e.g. Pew favourability of China' },
  { key: 'geoTrade', label: 'Geopolitics & trade', hint: '≤30 caps the tier' },
  { key: 'spending', label: 'Spending power', hint: '' },
  { key: 'categoryDemand', label: 'Category demand', hint: '' },
  { key: 'scrutiny', label: 'Consumer scrutiny', hint: '100 = least resistant' },
  { key: 'digital', label: 'Digital readiness', hint: '' },
] as const;

export interface MarketInputView {
  market: string;
  values: Record<string, number | null>;
  source: string;
}

/**
 * The market pillars behind the potential and entry indices, 0–100 (higher = easier entry). Blank
 * means "not entered": brand friendliness and category demand then come from the roundtable.
 */
export function MarketInputsForm({ projectId, rows, canEdit }: { projectId: string; rows: MarketInputView[]; canEdit: boolean }) {
  const [state, action] = useActionState(saveMarketInputsAction, empty);
  const [extra, setExtra] = useState<string[]>([]);
  const [newMarket, setNewMarket] = useState('');
  const all: MarketInputView[] = [...rows, ...extra.map((market) => ({ market, values: {}, source: '' }))];
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-subtle">
              <th className="px-2 py-1 font-semibold">Market</th>
              {PILLAR_COLUMNS.map((c) => (
                <th key={c.key} className="px-1 py-1 font-semibold">
                  {c.label}
                  {c.hint && <span className="block font-normal">{c.hint}</span>}
                </th>
              ))}
              <th className="px-2 py-1 font-semibold">Source</th>
            </tr>
          </thead>
          <tbody>
            {all.map((r) => (
              <tr key={r.market} className="border-t border-line">
                <td className="px-2 py-1 font-medium text-ink">
                  {r.market}
                  <input type="hidden" name="market" value={r.market} />
                </td>
                {PILLAR_COLUMNS.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    <TextInput
                      name={c.key}
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      defaultValue={r.values[c.key] ?? ''}
                      aria-label={`${r.market}: ${c.label}`}
                      disabled={!canEdit}
                      className="w-20 px-2 py-1"
                    />
                  </td>
                ))}
                <td className="px-2 py-1">
                  <TextInput name="source" defaultValue={r.source} maxLength={500} aria-label={`${r.market}: source`} disabled={!canEdit} className="min-w-48 px-2 py-1" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <TextInput value={newMarket} onChange={(e) => setNewMarket(e.target.value)} placeholder="Another market" aria-label="Another market" className="w-48 px-2 py-1" />
          <button
            type="button"
            className="rounded border border-line-strong px-3 py-1.5 text-sm text-ink-muted hover:border-brand"
            onClick={() => {
              const m = newMarket.trim();
              if (m && !all.some((r) => r.market.toLowerCase() === m.toLowerCase())) setExtra([...extra, m]);
              setNewMarket('');
            }}
          >
            Add market
          </button>
          <span className="ml-auto"><SubmitButton pendingLabel="Saving…">Save market inputs</SubmitButton></span>
        </div>
      )}
      <FormMessages state={state} />
    </form>
  );
}

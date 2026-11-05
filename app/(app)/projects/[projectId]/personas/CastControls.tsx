'use client';

import { useActionState, useState } from 'react';
import { approveCastAction, buildCastAction, renamePersonaAction } from '../journeyActions';
import { FormMessages, SubmitButton, TextInput } from '@/ui/forms';
import type { FormState } from '../actions';

const empty: FormState = {};

export interface ParameterView {
  name: string;
  kind: string;
  ordered: boolean;
  recommended: boolean;
  datasets: number;
}

/**
 * Build the personas: which markets, and which parameters (segment groups from the data) to cut them
 * on. An ordered parameter (income, age, spending) gives three tiers per market; any other gives one
 * persona per published segment.
 */
export function BuildPersonasForm({
  projectId,
  markets,
  chosenMarkets,
  parameters,
  chosenParameters,
  label,
  fileCount,
}: {
  projectId: string;
  markets: string[];
  chosenMarkets: string[];
  parameters: ParameterView[];
  chosenParameters: string[];
  label: string;
  fileCount: number;
}) {
  const [state, action] = useActionState(buildCastAction, empty);
  const [picked, setPicked] = useState<string[]>(chosenParameters);
  const [marketPick, setMarketPick] = useState<string[]>(chosenMarkets);
  const perMarket = picked.reduce((n, g) => n + (parameters.find((p) => p.name === g)?.ordered ? 3 : 4), 0) || 3;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <p className="text-xs text-ink-subtle">{`Source: all ${fileCount} file(s) uploaded in step 1.`}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink">Markets</legend>
        <div className="flex flex-wrap gap-2">
          {markets.map((m) => (
            <label key={m} className="flex cursor-pointer items-center gap-2 border-t border-line px-3 py-1.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="checkbox" name="markets" value={m} checked={marketPick.includes(m)} onChange={() => setMarketPick(toggle(marketPick, m))} />
              <span>{m}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-ink">Parameters</legend>
        <p className="text-xs text-ink-subtle">Proposed from the segment breaks published in the data. Recommended ones are marked. With none ticked, personas are cut on household income.</p>
        {parameters.length === 0 ? (
          <p className="text-sm text-ink-muted">No segment breaks were found in the data yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {parameters.map((p) => (
              <label key={p.name} className="flex cursor-pointer items-center gap-2 border-t border-line px-3 py-1.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="checkbox" name="groups" value={p.name} checked={picked.includes(p.name)} onChange={() => setPicked(toggle(picked, p.name))} />
                <span>{p.name}</span>
                {p.recommended && <span className="rounded-sm bg-[var(--color-highlight)] px-1 text-[10px] font-bold uppercase text-ink">Recommended</span>}
                <span className="text-[11px] text-ink-subtle">{p.ordered ? '3 tiers' : 'by segment'}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <p className="text-xs text-ink-subtle">{`About ${perMarket * Math.max(1, marketPick.length)} personas · one short model call each to write their identity.`}</p>
      <FormMessages state={state} />
      <SubmitButton pendingLabel="Starting…">{label}</SubmitButton>
    </form>
  );
}

export function ApproveCastButton({ projectId, cohortId }: { projectId: string; cohortId: string }) {
  const [state, action] = useActionState(approveCastAction, empty);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="cohortId" value={cohortId} />
      <SubmitButton pendingLabel="Approving…">Approve personas</SubmitButton>
      <FormMessages state={state} />
    </form>
  );
}

/** Rename one persona in place; the illustrative name is the team's to choose. */
export function RenamePersona({ projectId, personaId, name }: { projectId: string; personaId: string; name: string }) {
  const [state, action] = useActionState(renamePersonaAction, empty);
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-[11px] text-ink-subtle underline hover:text-ink">
        Rename
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="personaId" value={personaId} />
      <TextInput name="name" defaultValue={name.replace(/^\[MOCK\]\s*/, '')} maxLength={60} aria-label="Persona name" className="py-1 text-xs" />
      <div className="flex gap-2">
        <SubmitButton pendingLabel="Saving…" variant="secondary">Save</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-muted underline">Cancel</button>
      </div>
      <FormMessages state={state} />
    </form>
  );
}

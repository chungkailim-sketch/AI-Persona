'use client';

import { useActionState } from 'react';
import { saveCreativePrefsAction } from '../journeyActions';
import { Field, FormMessages, Select, SubmitButton, TextArea, TextInput } from '@/ui/forms';
import type { FormState } from '../actions';
import { CLIP_SECONDS, DELIVERABLES, FRAME_RATES, MODES, PACING, PLATFORMS, RATIOS, RESOLUTIONS, STYLES, TONES, type CreativePrefs } from '@/creative/prefs';

const empty: FormState = {};

function Checks({ name, values, chosen, disabled }: { name: string; values: readonly string[]; chosen: string[]; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((v) => (
        <label key={v} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:text-ink">
          <input type="checkbox" name={name} value={v} defaultChecked={chosen.includes(v)} disabled={disabled} className="accent-[var(--color-brand)]" />
          {v}
        </label>
      ))}
    </div>
  );
}

/**
 * Communication preference and creative treatment: with the roundtable's key messaging they make the
 * AIGC creative brief on the Results step.
 */
export function CreativeForm({ projectId, prefs, personas, canEdit }: { projectId: string; prefs: CreativePrefs; personas: { id: string; label: string }[]; canEdit: boolean }) {
  const [state, action] = useActionState(saveCreativePrefsAction, empty);
  const off = !canEdit;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <details className="panel" open>
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-ink">
          Communication preference <span className="font-normal text-ink-subtle">— where, to whom and how the content speaks</span>
        </summary>
        <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-2">
          <Field id="cp-brand" label="Client / brand"><TextInput id="cp-brand" name="brand" defaultValue={prefs.brand} maxLength={120} disabled={off} /></Field>
          <Field id="cp-owner" label="Brief owner" hint="One accountable person for approvals."><TextInput id="cp-owner" name="owner" defaultValue={prefs.owner} maxLength={120} disabled={off} /></Field>
          <div className="sm:col-span-2">
            <Field id="cp-objective" label="Business objective" hint="What the content must achieve. Left blank, the brief's objective is used.">
              <TextInput id="cp-objective" name="objective" defaultValue={prefs.objective} maxLength={400} disabled={off} />
            </Field>
          </div>
          <div className="sm:col-span-2"><Field id="cp-platforms" label="Platforms and placements"><Checks name="platforms" values={PLATFORMS} chosen={prefs.platforms} disabled={off} /></Field></div>
          <Field id="cp-ratios" label="Aspect ratios"><Checks name="ratios" values={RATIOS} chosen={prefs.ratios} disabled={off} /></Field>
          <Field id="cp-tones" label="Tone of voice"><Checks name="tones" values={TONES} chosen={prefs.tones} disabled={off} /></Field>
          <Field id="cp-languages" label="Languages (voice-over, captions)"><TextInput id="cp-languages" name="languages" defaultValue={prefs.languages} maxLength={120} disabled={off} placeholder="e.g. Bahasa Indonesia, English" /></Field>
          <Field id="cp-cta" label="Call to action"><TextInput id="cp-cta" name="cta" defaultValue={prefs.cta} maxLength={200} disabled={off} placeholder="e.g. Discover the range online" /></Field>
          <Field id="cp-mand" label="Mandatories" hint="Logo, legal lines, claims that must appear (added in editing)."><TextArea id="cp-mand" name="mandatories" rows={2} defaultValue={prefs.mandatories} maxLength={600} disabled={off} /></Field>
          <Field id="cp-nogo" label="No-gos" hint="Topics, imagery or claims to avoid."><TextArea id="cp-nogo" name="noGos" rows={2} defaultValue={prefs.noGos} maxLength={600} disabled={off} /></Field>
        </div>
      </details>
      <details className="panel" open>
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-ink">
          Creative treatment <span className="font-normal text-ink-subtle">— the look, feel and format for AI image and video generation</span>
        </summary>
        <div className="grid gap-4 border-t border-line px-5 py-4 sm:grid-cols-2">
          <Field id="ct-mode" label="Generation mode"><Select id="ct-mode" name="mode" defaultValue={prefs.mode} disabled={off}>{MODES.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          <Field id="ct-del" label="Final deliverable"><Select id="ct-del" name="deliverable" defaultValue={prefs.deliverable} disabled={off}>{DELIVERABLES.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          <Field id="ct-style" label="Overall style"><Select id="ct-style" name="style" defaultValue={prefs.style} disabled={off}>{STYLES.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          <Field id="ct-pacing" label="Pacing"><Select id="ct-pacing" name="pacing" defaultValue={prefs.pacing} disabled={off}>{PACING.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          <Field id="ct-mood" label="Mood / emotion" hint="Two or three specific feelings."><TextInput id="ct-mood" name="mood" defaultValue={prefs.mood} maxLength={160} disabled={off} placeholder="e.g. optimistic, curious, proud" /></Field>
          <Field id="ct-light" label="Lighting"><TextInput id="ct-light" name="lighting" defaultValue={prefs.lighting} maxLength={200} disabled={off} placeholder="e.g. warm golden-hour daylight" /></Field>
          <Field id="ct-pal" label="Colour palette" hint="Three to five colours or hex values."><TextInput id="ct-pal" name="palette" defaultValue={prefs.palette} maxLength={200} disabled={off} placeholder="e.g. brand green #2DA44A, warm white, sand" /></Field>
          <Field id="ct-film" label="Film look"><TextInput id="ct-film" name="filmLook" defaultValue={prefs.filmLook} maxLength={160} disabled={off} placeholder="e.g. warm analog, soft contrast" /></Field>
          <div className="sm:col-span-2"><Field id="ct-ref" label="Tone references" hint="Films, campaigns or photographers, described in words."><TextArea id="ct-ref" name="references" rows={2} defaultValue={prefs.references} maxLength={400} disabled={off} /></Field></div>
          <Field id="ct-hero" label="Hero persona" hint="The persona the content is cast on. Left to the brief, the most open persona is used.">
            <Select id="ct-hero" name="heroPersonaId" defaultValue={prefs.heroPersonaId} disabled={off}>
              <option value="">Chosen from the roundtable</option>
              {personas.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </Field>
          <Field id="ct-res" label="Resolution"><Select id="ct-res" name="resolution" defaultValue={prefs.resolution} disabled={off}>{RESOLUTIONS.map((m) => <option key={m} value={m}>{m}</option>)}</Select></Field>
          <Field id="ct-run" label="Total runtime (seconds)"><TextInput id="ct-run" name="runtimeSeconds" type="number" min={5} max={180} defaultValue={prefs.runtimeSeconds} disabled={off} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="ct-clip" label="Clip length"><Select id="ct-clip" name="clipSeconds" defaultValue={String(prefs.clipSeconds)} disabled={off}>{CLIP_SECONDS.map((n) => <option key={n} value={n}>{`${n} s`}</option>)}</Select></Field>
            <Field id="ct-fps" label="Frame rate"><Select id="ct-fps" name="frameRate" defaultValue={String(prefs.frameRate)} disabled={off}>{FRAME_RATES.map((n) => <option key={n} value={n}>{`${n} fps`}</option>)}</Select></Field>
          </div>
        </div>
      </details>
      <FormMessages state={state} />
      {canEdit && <div><SubmitButton pendingLabel="Saving…">Save communication and creative settings</SubmitButton></div>}
    </form>
  );
}

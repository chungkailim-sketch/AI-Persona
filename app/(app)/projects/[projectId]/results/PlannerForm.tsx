'use client';

import { localize } from '@/ui/i18n/translate';
import { useActionState } from 'react';
import { requestPlanAction } from '../journeyActions';
import { Field, FormMessages, Select, SubmitButton, TextArea } from '@/ui/forms';
import type { FormState } from '../actions';

const empty: FormState = {};

const EXAMPLES = [
  'How should we launch our brand in the priority market in the first six months?',
  'Which messages and channels will win over price-led consumers?',
  'How do we build trust in a Chinese brand where favourability towards China is low?',
  'What should our influencer and earned-media programme look like?',
];

export function PlannerForm({ projectId, industries }: { projectId: string; industries: readonly string[] }) {
  const [state, action] = useActionState(requestPlanAction, empty);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Field id="plan-q" label="Your comms or marketing question" required hint="The plan answers it from the survey data, the personas and the roundtable, using recognised PR, communications and marketing frameworks.">
        <TextArea id="plan-q" name="question" rows={3} required minLength={10} maxLength={2000} placeholder={EXAMPLES[0]} />
      </Field>
      <ul className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => (
          <li key={e}>
            <button
              type="button"
              className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted hover:border-brand hover:text-ink"
              onClick={(ev) => {
                const el = (ev.currentTarget.form?.elements.namedItem('question') ?? null) as HTMLTextAreaElement | null;
                if (el) el.value = localize(e);
              }}
            >
              {e}
            </button>
          </li>
        ))}
      </ul>
      <Field id="plan-industry" label="Industry">
        <Select id="plan-industry" name="industry" defaultValue="All industries" className="max-w-xs">
          {industries.map((i) => <option key={i} value={i}>{i}</option>)}
        </Select>
      </Field>
      <FormMessages state={state} />
      <SubmitButton pendingLabel="Starting…">Write the plan</SubmitButton>
    </form>
  );
}

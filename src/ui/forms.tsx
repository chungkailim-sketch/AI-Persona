'use client';

/**
 * Small form primitives shared across the workflow steps.
 *
 * Two rules they encode, so that every form gets them without remembering to:
 *  - A field's error is announced, associated with the input by `aria-describedby`, and never
 *    conveyed by colour alone.
 *  - Submit buttons are disabled only while a submission is in flight, never to express "you have
 *    not filled this in". A disabled control tells the user nothing about what is wrong and is
 *    skipped by a screen reader's forms mode.
 */
import { useFormStatus } from 'react-dom';
import { cn } from './cn';

/** What a field is for, with an example of a good answer — shown from an "i" beside the label. */
export interface FieldInfo {
  definition: string;
  example: string;
}

/**
 * The "i" beside a label. Opens on hover and on keyboard focus (never only on hover, which a
 * keyboard or touch user cannot reach), and the text is also the button's accessible description.
 */
export function InfoTip({ id, info }: { id: string; info: FieldInfo }) {
  return (
    <span className="group relative ml-1.5 inline-flex align-middle">
      <button
        type="button"
        aria-label="What goes here?"
        aria-describedby={`${id}-info`}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-strong font-serif text-[10px] italic leading-none text-ink-muted hover:border-brand hover:text-brand focus-visible:border-brand focus-visible:text-brand"
      >
        i
      </button>
      <span
        id={`${id}-info`}
        role="tooltip"
        className="invisible absolute left-0 top-6 z-40 w-72 rounded border border-line bg-elevated p-3 text-left text-xs font-normal leading-relaxed text-ink shadow-lg opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <span className="block">{info.definition}</span>
        <span className="mt-2 block text-ink-muted">
          <span className="font-medium text-ink">Good example: </span>
          {info.example}
        </span>
      </span>
    </span>
  );
}

export function Field({
  id,
  label,
  hint,
  info,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  info?: FieldInfo;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
          {required && (
            <span className="ml-1 text-danger" aria-hidden>
              *
            </span>
          )}
          {required && <span className="sr-only"> (required)</span>}
        </label>
        {info && <InfoTip id={id} info={info} />}
      </span>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink-subtle">
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

const INPUT =
  'w-full rounded border border-line-strong bg-input px-3 py-2 text-sm text-ink outline-none ' +
  'focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(INPUT, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(INPUT, 'min-h-20', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(INPUT, props.className)} />;
}

export function SubmitButton({
  children,
  pendingLabel,
  variant = 'primary',
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'self-start rounded px-4 py-2 text-sm font-medium disabled:opacity-50',
        variant === 'primary'
          ? 'bg-brand text-brand-ink hover:opacity-90'
          : 'border border-line-strong text-ink-muted hover:border-brand',
      )}
    >
      {pending ? (pendingLabel ?? 'Working…') : children}
    </button>
  );
}

export function FormMessages({
  state,
}: {
  state: { error?: string; problems?: string[]; ok?: string };
}) {
  if (!state.error && !state.ok && !state.problems?.length) return null;
  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      {state.error && (
        <p className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.problems && state.problems.length > 0 && (
        <ul className="flex flex-col gap-1 rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {state.ok && !state.error && (
        <p className="rounded border border-ok bg-ok-soft px-3 py-2 text-sm text-ok">{state.ok}</p>
      )}
    </div>
  );
}

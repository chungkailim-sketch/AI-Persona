'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { OTP_CONFIG } from '@/auth/config';

type Stage = 'email' | 'code';

/**
 * Two-stage sign-in.
 *
 * The form never learns whether an address exists — the server answers identically either way, and
 * this component simply moves to the code stage after any accepted request. The code field is
 * `inputMode="numeric"` with `autoComplete="one-time-code"` so a phone offers the code from the
 * notification rather than making the user retype it.
 */
export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (stage === 'code') codeRef.current?.focus();
  }, [stage]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    // Validated here rather than by disabling the button. A disabled control tells the user
    // nothing about what is wrong, and cannot be reached by a screen reader's forms mode.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (res.status === 429) {
        setError(body.message ?? 'Too many requests. Try again shortly.');
        setCooldown(Number(res.headers.get('Retry-After') ?? 60));
        return;
      }
      if (!res.ok) {
        setError(body.error ?? 'That request could not be completed.');
        return;
      }
      setMessage(body.message ?? null);
      setStage('code');
      setCooldown(OTP_CONFIG.resendCooldownMs / 1000);
    } catch {
      setError('The server could not be reached. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== OTP_CONFIG.codeLength) {
      setError(`The code is ${OTP_CONFIG.codeLength} digits.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const body = (await res.json()) as { error?: string; redirectTo?: string };
      if (!res.ok) {
        setError(body.error ?? 'That code is not valid.');
        setCode('');
        codeRef.current?.focus();
        return;
      }
      router.replace(next as never);
      router.refresh();
    } catch {
      setError('The server could not be reached. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm px-6 py-20">
      <h1 className="text-2xl">Sign in</h1>
      <p className="mt-2 text-sm text-ink-muted">
        {stage === 'email'
          ? 'Enter your work email address. We will send a one-time code — there is no password.'
          : `Enter the ${OTP_CONFIG.codeLength}-digit code sent to ${email}.`}
      </p>

      {stage === 'email' ? (
        <form onSubmit={requestCode} className="mt-8 flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-ink">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-describedby={error ? 'signin-error' : undefined}
              className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-brand-ink disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-8 flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-ink">
              Sign-in code
            </label>
            <input
              ref={codeRef}
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={OTP_CONFIG.codeLength}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-describedby={error ? 'signin-error' : undefined}
              className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 font-mono text-lg tracking-[0.3em] text-ink outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand-soft"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-brand-ink disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => { setStage('email'); setCode(''); setError(null); }}
              className="text-ink-muted underline-offset-2 hover:underline"
            >
              Use a different address
            </button>
            <button
              type="button"
              onClick={() => requestCode()}
              disabled={busy || cooldown > 0}
              className="text-ink-muted underline-offset-2 hover:underline disabled:opacity-50"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      <div aria-live="polite" className="mt-4 min-h-[1.5rem]">
        {message && !error && <p className="text-sm text-ink-muted">{message}</p>}
        {error && (
          <p id="signin-error" className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

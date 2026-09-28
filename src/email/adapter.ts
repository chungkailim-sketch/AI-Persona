/**
 * Email delivery (prompt §8).
 *
 * The development adapter writes the sign-in code to the *server* log. It never returns the code
 * to the caller, so the code cannot reach the browser even by accident, and `loadEnv()` refuses
 * `EMAIL_PROVIDER=dev` in production — so this path cannot be reached from a production deploy.
 *
 * Postmark and SendGrid are wired (EMAIL_API_KEY, EMAIL_FROM). Any failure to hand a message to the
 * provider throws, rather than silently dropping mail: a user who never receives a code, with no
 * error anywhere, is the worst possible failure for a passwordless system.
 */
import { env } from '@/lib/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailAdapter {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

class DevLogAdapter implements EmailAdapter {
  readonly name = 'dev';
  async send(message: EmailMessage): Promise<void> {
    console.warn(
      [
        '',
        '─── DEVELOPMENT EMAIL ADAPTER ─────────────────────────────────────────',
        ' No message was sent. This output exists only in local development and',
        ' is refused in production by the environment guard.',
        `  to:      ${message.to}`,
        `  subject: ${message.subject}`,
        '',
        message.text.split('\n').map((l) => `  ${l}`).join('\n'),
        '───────────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}

class UnconfiguredAdapter implements EmailAdapter {
  constructor(readonly name: string) {}
  async send(): Promise<void> {
    throw new Error(
      `EMAIL_PROVIDER="${this.name}" is selected but no client for it is implemented in this build. ` +
        'Implement the adapter before deploying, or the sign-in code will never be delivered.',
    );
  }
}

/** Transactional email over the provider's HTTPS API. The provider's error body is never passed on. */
class HttpEmailAdapter implements EmailAdapter {
  constructor(readonly name: 'postmark' | 'sendgrid') {}

  async send(message: EmailMessage): Promise<void> {
    const e = env();
    if (!e.EMAIL_API_KEY) throw new Error(`EMAIL_PROVIDER=${this.name} requires EMAIL_API_KEY.`);
    const response =
      this.name === 'postmark'
        ? await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json', 'X-Postmark-Server-Token': e.EMAIL_API_KEY },
            body: JSON.stringify({ From: e.EMAIL_FROM, To: message.to, Subject: message.subject, TextBody: message.text, MessageStream: 'outbound' }),
          })
        : await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${e.EMAIL_API_KEY}` },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: message.to }] }],
              from: { email: e.EMAIL_FROM },
              subject: message.subject,
              content: [{ type: 'text/plain', value: message.text }],
            }),
          });
    if (!response.ok) throw new Error(`${this.name} refused the message (HTTP ${response.status}).`);
  }
}

let adapter: EmailAdapter | null = null;

export function emailAdapter(): EmailAdapter {
  if (adapter) return adapter;
  const provider = env().EMAIL_PROVIDER;
  adapter =
    provider === 'dev'
      ? new DevLogAdapter()
      : provider === 'postmark' || provider === 'sendgrid'
        ? new HttpEmailAdapter(provider)
        : new UnconfiguredAdapter(provider);
  return adapter;
}

/** Test seam. */
export function setEmailAdapter(a: EmailAdapter | null): void {
  adapter = a;
}

export function signInEmail(code: string, ttlMinutes: number): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Your Persona Intelligence sign-in code',
    text: [
      `Your sign-in code is ${code}`,
      '',
      `It expires in ${ttlMinutes} minutes and can be used once.`,
      '',
      'If you did not request this code, you can ignore this message. Nobody can sign in',
      'without it.',
    ].join('\n'),
  };
}

/**
 * Authentication constants, deliberately free of Node imports.
 *
 * These values are needed by client components (the sign-in form shows the code length and the
 * resend cooldown) and by server code alike. They live in their own module because importing them
 * from `otp.ts` would drag `node:crypto` into the browser bundle, where it throws at load and the
 * page falls into the error boundary — a failure that looks like a broken page rather than a bad
 * import, and which a DOM-only test can easily pass straight through.
 *
 * Nothing secret belongs here. These are parameters, not keys.
 */
export const OTP_CONFIG = {
  /** Six digits: enough entropy given the attempt limit and expiry, short enough to retype. */
  codeLength: 6,
  ttlMs: 10 * 60 * 1000,
  maxAttempts: 5,
  resendCooldownMs: 60 * 1000,
  maxPerAddressPerHour: 5,
  scryptKeyLength: 64,
} as const;

export const SESSION_CONFIG = {
  idleTimeoutMs: 8 * 60 * 60 * 1000,
  absoluteTimeoutMs: 7 * 24 * 60 * 60 * 1000,
  cookieName: 'rfpi_session',
} as const;

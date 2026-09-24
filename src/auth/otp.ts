/**
 * Passwordless email OTP (SEC-01, SEC-02).
 *
 * The plaintext code exists only in the function that generates it and in the email body.
 * What is persisted is a scrypt hash with a per-challenge salt, so a database disclosure
 * cannot yield a usable code. Verification is constant-time.
 *
 * Node's built-in crypto is used deliberately: no native module, no supply-chain surface,
 * and scrypt is memory-hard, which is what this needs.
 */
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { OTP_CONFIG, SESSION_CONFIG } from '@/auth/config';

// Re-exported so server modules keep a single import site for the whole OTP surface. Client
// components must import from '@/auth/config' instead — this module pulls in node:crypto.
export { OTP_CONFIG, SESSION_CONFIG };

const scrypt = promisify(scryptCb);


export type OtpFailureReason =
  | 'DOMAIN_NOT_ALLOWED'
  | 'EXPIRED'
  | 'ALREADY_USED'
  | 'TOO_MANY_ATTEMPTS'
  | 'INVALID_CODE'
  | 'COOLDOWN_ACTIVE'
  | 'HOURLY_LIMIT'
  | 'USER_DEACTIVATED';

export interface OtpChallengeRecord {
  id: string;
  email: string;
  codeHash: string;
  salt: string;
  expiresAt: Date;
  consumedAt: Date | null;
  /** Attempts made BEFORE this one. The caller increments durably, then verifies with this value. */
  attempts: number;
  maxAttempts: number;
}

export function generateCode(length: number = OTP_CONFIG.codeLength): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(randomInt(0, 10));
  return out;
}

export async function hashCode(code: string, salt: string): Promise<string> {
  const derived = (await scrypt(code, salt, OTP_CONFIG.scryptKeyLength)) as Buffer;
  return derived.toString('hex');
}

export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

export async function createChallengeMaterial(): Promise<{
  code: string;
  codeHash: string;
  salt: string;
  expiresAt: Date;
}> {
  const code = generateCode();
  const salt = newSalt();
  const codeHash = await hashCode(code, salt);
  return { code, codeHash, salt, expiresAt: new Date(Date.now() + OTP_CONFIG.ttlMs) };
}

/**
 * Challenge material for a caller-supplied code, used only by the development demonstration
 * credential (`DEMO_SIGN_IN_*`).
 *
 * It differs from `createChallengeMaterial` in exactly one respect: the code is predictable. It is
 * still salted and scrypt-hashed before it goes anywhere near the database, so the property that
 * "no plaintext code is ever stored" holds here too — what is lost is secrecy, not protection, and
 * the environment loader refuses to start a production process that configures it.
 */
export async function createFixedChallengeMaterial(code: string): Promise<{
  code: string;
  codeHash: string;
  salt: string;
  expiresAt: Date;
}> {
  const salt = newSalt();
  const codeHash = await hashCode(code, salt);
  return { code, codeHash, salt, expiresAt: new Date(Date.now() + OTP_CONFIG.ttlMs) };
}

/**
 * Verify a submitted code. Returns a discriminated result rather than throwing, because every
 * branch has a distinct audit event and a distinct (deliberately vague) user-facing message.
 */
export async function verifyCode(
  challenge: OtpChallengeRecord,
  submitted: string,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: OtpFailureReason }> {
  if (challenge.consumedAt) return { ok: false, reason: 'ALREADY_USED' };
  if (challenge.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'EXPIRED' };
  if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };

  const candidate = await hashCode(submitted, challenge.salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(challenge.codeHash, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'INVALID_CODE' };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'INVALID_CODE' };
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** Exact-domain allowlist. Subdomains are not implied — `rf.com` does not admit `x.rf.com`. */
export function isDomainAllowed(email: string, allowed: readonly string[]): boolean {
  const domain = domainOf(normaliseEmail(email));
  if (!domain) return false;
  return allowed.some((d) => d.trim().toLowerCase() === domain);
}

export function canResend(lastRequestAt: Date | null, now: Date = new Date()): boolean {
  if (!lastRequestAt) return true;
  return now.getTime() - lastRequestAt.getTime() >= OTP_CONFIG.resendCooldownMs;
}

export function withinHourlyLimit(requestTimestamps: readonly Date[], now: Date = new Date()): boolean {
  const cutoff = now.getTime() - 60 * 60 * 1000;
  const recent = requestTimestamps.filter((t) => t.getTime() >= cutoff);
  return recent.length < OTP_CONFIG.maxPerAddressPerHour;
}

/**
 * The response shown to the user is identical whether or not the address exists or is
 * allowlisted, to limit account enumeration (prompt §7). The distinction is recorded in the
 * audit log, not surfaced in the UI.
 */
export const GENERIC_OTP_RESPONSE =
  'If that address is eligible, a sign-in code is on its way. It expires in 10 minutes.';

/** IP addresses are hashed before storage — the raw value is never persisted (NFR-19). */
export function hashIp(ip: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${ip}`).digest('hex');
}

// ── Session tokens ────────────────────────────────────────────────────────────


export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiries(now: Date = new Date()): {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
} {
  return {
    idleExpiresAt: new Date(now.getTime() + SESSION_CONFIG.idleTimeoutMs),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_CONFIG.absoluteTimeoutMs),
  };
}

export function isSessionValid(
  s: { revokedAt: Date | null; idleExpiresAt: Date; absoluteExpiresAt: Date },
  now: Date = new Date(),
): boolean {
  if (s.revokedAt) return false;
  if (s.idleExpiresAt.getTime() <= now.getTime()) return false;
  if (s.absoluteExpiresAt.getTime() <= now.getTime()) return false;
  return true;
}

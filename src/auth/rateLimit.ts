/**
 * Rate limiting for the sign-in flow (SEC-01).
 *
 * Counted in the database rather than in memory: the application runs more than one instance in
 * production, and an in-memory counter would let an attacker multiply their allowance by the
 * number of instances.
 *
 * Two independent limits, because they stop different things:
 *  - per address: stops one mailbox being flooded, and stops code-guessing by re-request.
 *  - per IP: stops one client enumerating many addresses.
 */
import { prisma } from '@/lib/prisma';
import { OTP_CONFIG } from '@/auth/otp';

export const IP_LIMIT_PER_HOUR = 20;

export interface RateDecision {
  allowed: boolean;
  reason?: 'COOLDOWN_ACTIVE' | 'HOURLY_LIMIT' | 'IP_LIMIT';
  retryAfterSeconds?: number;
}

export async function checkRequestRate(
  email: string,
  ipHash: string | null,
  now: Date = new Date(),
): Promise<RateDecision> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const recent = await prisma.otpChallenge.findMany({
    where: { email, createdAt: { gte: hourAgo } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const last = recent[0];
  if (last) {
    const since = now.getTime() - last.createdAt.getTime();
    if (since < OTP_CONFIG.resendCooldownMs) {
      return {
        allowed: false,
        reason: 'COOLDOWN_ACTIVE',
        retryAfterSeconds: Math.ceil((OTP_CONFIG.resendCooldownMs - since) / 1000),
      };
    }
  }

  if (recent.length >= OTP_CONFIG.maxPerAddressPerHour) {
    return { allowed: false, reason: 'HOURLY_LIMIT', retryAfterSeconds: 3600 };
  }

  if (ipHash) {
    const fromIp = await prisma.otpChallenge.count({
      where: { requestIpHash: ipHash, createdAt: { gte: hourAgo } },
    });
    if (fromIp >= IP_LIMIT_PER_HOUR) {
      return { allowed: false, reason: 'IP_LIMIT', retryAfterSeconds: 3600 };
    }
  }

  return { allowed: true };
}

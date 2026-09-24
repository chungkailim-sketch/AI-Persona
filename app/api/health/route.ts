import { NextResponse } from 'next/server';
import { loadEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Liveness + readiness for Railway health checks (NFR-10). Readiness includes the database. */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  let env;
  try {
    env = loadEnv();
    checks.config = { ok: true };
  } catch (e) {
    checks.config = { ok: false, detail: e instanceof Error ? e.name : 'invalid' };
  }

  try {
    const { prisma } = await import('@/lib/prisma');
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true };
  } catch {
    checks.database = { ok: false, detail: 'unreachable' };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', version: env?.APP_VERSION ?? 'unknown', checks, time: new Date().toISOString() },
    { status: ok ? 200 : 503 },
  );
}

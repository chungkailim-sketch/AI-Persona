import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { env } from '@/lib/env';

/**
 * Lazily-constructed singleton client.
 *
 * The laziness is not an optimisation. `next build` evaluates every route module to collect its
 * configuration, on a machine that legitimately has no production database URL and no production
 * email provider. Constructing the client at module scope would run the environment guard during
 * that pass and fail the build — turning a *runtime* safety check into a build-time obstacle. The
 * proxy defers construction to the first actual query, which only ever happens while serving a
 * request.
 *
 * A single client per process still holds: Next's dev server re-executes modules on hot reload,
 * which would otherwise open a new pool on every edit until Postgres refuses connections.
 *
 * Query logging is limited to warnings and errors: query text can carry field values from an
 * uploaded dataset, and those must not reach application logs (NFR-19).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

function client(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const c = createClient();
    // In production a module reload cannot happen, so the cache is only needed in development —
    // but caching in both keeps a single code path and a single pool either way.
    globalForPrisma.prisma = c;
  }
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(client() as object, property, receiver);
  },
  has(_target, property) {
    return Reflect.has(client() as object, property);
  },
});

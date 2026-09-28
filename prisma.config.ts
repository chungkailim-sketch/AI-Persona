/**
 * Prisma 7 CLI configuration.
 *
 * Prisma 7 moved CLI configuration out of package.json and moved the connection URL out of the
 * schema. The URL below is read from the environment at CLI invocation time only — it is never
 * bundled into application code, and `prisma.config.ts` is not imported by the runtime.
 */
import 'dotenv/config';
import path from 'node:path';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
});

/**
 * Bootstrap seed.
 *
 * Scope is deliberately narrow: the minimum required to sign in and reach the application.
 * It creates approved email domains and the first super administrator, both taken from the
 * environment. It creates no projects, datasets, personas or findings — demonstration content is
 * a separate, explicitly labelled fixture (Phase 3) so that seeded material can never be mistaken
 * for a client's real data.
 *
 * The script is idempotent: running it twice leaves the same state.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { loadEnv, approvedDomainsFromEnv, demoSignIn } from '../src/lib/env';

async function main(): Promise<void> {
  const env = loadEnv();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

  try {
    const domains = approvedDomainsFromEnv(env);
    for (const domain of domains) {
      await prisma.approvedDomain.upsert({
        where: { domain },
        update: {},
        create: { domain, note: 'Seeded from BOOTSTRAP_APPROVED_DOMAINS' },
      });
    }
    console.log(`approved domains ensured: ${domains.length ? domains.join(', ') : '(none configured)'}`);

    const adminEmail = env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    if (!adminEmail) {
      console.log('BOOTSTRAP_SUPER_ADMIN_EMAIL not set — no administrator created.');
    } else {
      const domain = adminEmail.slice(adminEmail.lastIndexOf('@') + 1);
      if (!domains.includes(domain)) {
        // Refuse rather than silently widening the allowlist: an administrator on a domain nobody
        // approved is exactly the configuration mistake this check exists to catch.
        throw new Error(
          `BOOTSTRAP_SUPER_ADMIN_EMAIL domain "${domain}" is not in BOOTSTRAP_APPROVED_DOMAINS. ` +
            'Add the domain explicitly, or change the address.',
        );
      }
      const user = await prisma.user.upsert({
        where: { email: adminEmail },
        update: {},
        create: { email: adminEmail, systemRole: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      console.log(`super administrator ensured: ${user.email}`);
    }

    // The demonstration account, when one is configured. It is created here rather than by hand
    // so that the address, its domain and its fixed code always agree; `demoSignIn` returns null
    // in production and `loadEnv` refuses to start a production process that sets these at all.
    const demo = demoSignIn(env);
    if (demo) {
      const demoDomain = demo.email.slice(demo.email.lastIndexOf('@') + 1);
      await prisma.approvedDomain.upsert({
        where: { domain: demoDomain },
        update: { active: true },
        create: { domain: demoDomain, note: 'Demonstration account (development only)' },
      });
      const demoUser = await prisma.user.upsert({
        where: { email: demo.email },
        update: { systemRole: 'SUPER_ADMIN', status: 'ACTIVE' },
        create: { email: demo.email, systemRole: 'SUPER_ADMIN', status: 'ACTIVE' },
      });
      console.log(
        `demonstration account ensured: ${demoUser.email} — fixed sign-in code, development only`,
      );
    }

    // Immutable safety controls are recorded as feature flags so the admin console can show them
    // as present and locked, rather than as absent (PRD §10.2).
    for (const key of [
      'evidence_labelling',
      'confidence_indicators',
      'limitations_block',
      'simulation_disclaimer',
      'unsupported_claim_check',
    ]) {
      await prisma.featureFlag.upsert({
        where: { key },
        update: {},
        create: {
          key,
          enabled: true,
          locked: true,
          description: 'Safety control. Always on; cannot be disabled by any role.',
        },
      });
    }
    console.log('immutable safety controls ensured: 5');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

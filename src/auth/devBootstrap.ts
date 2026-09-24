/**
 * Reconcile development sign-in accounts from the environment, once per process.
 *
 * The approved-domain allowlist and the administrator account live in the database, and are
 * normally created by `prisma/seed.ts`. That is correct for a deployment — an allowlist the
 * application can widen for itself is not an allowlist — but in local development it produces a
 * failure that is almost impossible to read: `.env` names an address, the address is refused
 * because nobody ran the seed, and the sign-in endpoint says the same uninformative thing it says
 * for every other cause. Being told to "just run the seed" is not a fix; needing to is the bug.
 *
 * So in development, and ONLY in development, the addresses the environment names are treated as
 * configuration rather than as data to be seeded separately, and are reconciled on first use.
 *
 * Three properties keep this from leaking anywhere it shouldn't:
 *
 *  1. It returns immediately when NODE_ENV is 'production'. `loadEnv` additionally refuses to
 *     return a production environment that configures a demonstration credential at all, so the
 *     demonstration branch is unreachable there twice over.
 *  2. It only ever creates what the environment already names. It cannot widen the allowlist
 *     beyond BOOTSTRAP_APPROVED_DOMAINS and the demonstration address.
 *  3. It never promotes or reactivates an existing account. An administrator who deactivates a
 *     user must not find them active again after a restart, so an existing row is left exactly as
 *     it is — only genuinely absent rows are created.
 */
import { prisma } from '@/lib/prisma';
import { env, approvedDomainsFromEnv, demoSignIn } from '@/lib/env';

let reconciled: Promise<void> | null = null;

/** Cleared between tests. */
export function resetDevBootstrap(): void {
  reconciled = null;
}

export function ensureDevelopmentSignIn(): Promise<void> {
  if (!reconciled) reconciled = run();
  return reconciled;
}

async function run(): Promise<void> {
  let e;
  try {
    e = env();
  } catch {
    // A broken environment is reported far more clearly elsewhere; this is not the place.
    return;
  }
  if (e.NODE_ENV === 'production') return;

  const demo = demoSignIn(e);
  const created: string[] = [];

  try {
    // ── Domains ──────────────────────────────────────────────────────────────
    const domains = new Set(approvedDomainsFromEnv(e));
    if (demo) domains.add(demo.email.slice(demo.email.lastIndexOf('@') + 1));
    const adminEmail = e.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
    if (adminEmail) domains.add(adminEmail.slice(adminEmail.lastIndexOf('@') + 1));

    for (const domain of domains) {
      if (!domain) continue;
      const existing = await prisma.approvedDomain.findUnique({ where: { domain } });
      if (!existing) {
        await prisma.approvedDomain.create({
          data: { domain, note: 'Reconciled from the environment (development only)' },
        });
        created.push(`domain ${domain}`);
      } else if (!existing.active) {
        // Deliberately not reactivated: an administrator switched it off, and a restart is not
        // an argument. Named here so the reason for a refusal is visible.
        console.warn(
          `[auth] The domain "${domain}" is in your environment but is DEACTIVATED in the database. ` +
            'No code will be sent to it. Reactivate it under Admin → Approved domains.',
        );
      }
    }

    // ── Accounts ─────────────────────────────────────────────────────────────
    for (const email of [demo?.email, adminEmail].filter((x): x is string => Boolean(x))) {
      const existing = await prisma.user.findUnique({ where: { email } });
      if (!existing) {
        await prisma.user.create({
          data: { email, systemRole: 'SUPER_ADMIN', status: 'ACTIVE' },
        });
        created.push(`account ${email}`);
      } else if (existing.status === 'DEACTIVATED') {
        console.warn(
          `[auth] The account "${email}" is in your environment but is DEACTIVATED. ` +
            'No code will be sent to it. Reactivate it under Admin → Users.',
        );
      }
    }

    if (created.length > 0) {
      console.warn(
        `\n[auth] Development sign-in reconciled from .env — created: ${created.join(', ')}.\n` +
          '       This happens only when NODE_ENV is not production.\n',
      );
    }
  } catch (err) {
    // Never block a sign-in attempt because a convenience failed. The request proceeds and the
    // ordinary refusal path reports whatever is actually wrong.
    console.warn(
      '[auth] Could not reconcile development sign-in accounts:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

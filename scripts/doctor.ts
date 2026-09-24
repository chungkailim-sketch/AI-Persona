/**
 * `npm run doctor` — why can't I sign in?
 *
 * The sign-in endpoints are deliberately uninformative: every failure returns the same message so
 * that nobody can use them to discover which addresses exist. That protection is right, and it
 * makes a local misconfiguration almost impossible to diagnose from the browser.
 *
 * This script is the other side of that trade. It runs against the same database and the same
 * environment the application reads, and it says plainly which of the preconditions for signing in
 * are not met, in the order they are checked at runtime. It reads; it never writes.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { loadEnv, approvedDomainsFromEnv, demoSignIn, EnvironmentError } from '../src/lib/env';

const tick = (ok: boolean) => (ok ? '  ok  ' : ' FAIL ');
let failures = 0;

function report(ok: boolean, label: string, detail?: string, remedy?: string): void {
  if (!ok) failures += 1;
  console.log(`[${tick(ok)}] ${label}`);
  if (detail) console.log(`         ${detail}`);
  if (!ok && remedy) console.log(`         → ${remedy}`);
}

async function main(): Promise<void> {
  console.log('\nPersona Intelligence — sign-in diagnostics\n');

  // 1. Environment -----------------------------------------------------------
  let env;
  try {
    env = loadEnv();
    report(true, 'Environment loads', `NODE_ENV=${env.NODE_ENV}, EMAIL_PROVIDER=${env.EMAIL_PROVIDER}`);
  } catch (e) {
    const issues = e instanceof EnvironmentError ? e.issues.join('; ') : String(e);
    report(false, 'Environment loads', issues, 'Fix .env, then run this again. Nothing below could be checked.');
    process.exit(1);
  }

  const demo = demoSignIn(env);
  const bothSet = Boolean(env.DEMO_SIGN_IN_EMAIL) && Boolean(env.DEMO_SIGN_IN_CODE);
  const eitherSet = Boolean(env.DEMO_SIGN_IN_EMAIL) || Boolean(env.DEMO_SIGN_IN_CODE);

  if (eitherSet) {
    report(
      bothSet,
      'Demonstration credential is fully configured',
      bothSet
        ? `${env.DEMO_SIGN_IN_EMAIL} with a fixed ${env.DEMO_SIGN_IN_CODE?.length}-digit code`
        : 'Only one of DEMO_SIGN_IN_EMAIL / DEMO_SIGN_IN_CODE is set, so the fixed code is OFF.',
      'Set BOTH DEMO_SIGN_IN_EMAIL and DEMO_SIGN_IN_CODE in .env, then restart the dev server.',
    );
  } else {
    // Not an error in itself — but if someone is running this script, they are probably typing a
    // code that isn't working, and "the fixed code is switched off" is the single most likely
    // reason. Saying it plainly here is the whole point of the script.
    report(
      false,
      'Demonstration credential is configured',
      'DEMO_SIGN_IN_EMAIL and DEMO_SIGN_IN_CODE are not set, so EVERY code is random. ' +
        'If you are typing a fixed code such as 010101, it cannot work.',
      'Add both lines to .env (or re-run local/setup.ps1, which adds them), then RESTART the dev server — .env is read at boot.',
    );
  }

  // 2. Database --------------------------------------------------------------
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  try {
    await prisma.$queryRaw`SELECT 1`;
    report(true, 'Database reachable', env.DATABASE_URL.replace(/:[^:@/]*@/, ':***@'));
  } catch (e) {
    report(
      false,
      'Database reachable',
      e instanceof Error ? e.message : String(e),
      'Start it: docker compose -f local/docker-compose.yml up -d',
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  // 3. The addresses that are supposed to work -------------------------------
  // Every address that is supposed to be able to sign in: the two the environment names, plus any
  // administrator already in the database. The last part matters — an account seeded by an earlier
  // configuration is invisible to the environment, and is exactly the one someone is typing.
  const admins = await prisma.user.findMany({
    where: {
      systemRole: { in: ['SUPER_ADMIN', 'PLATFORM_ADMIN'] },
      // Accounts the browser test suite creates and abandons. Listing a dozen of them buries the
      // one line that matters.
      email: { not: { startsWith: 'e2e-' } },
    },
    select: { email: true },
    orderBy: { createdAt: 'asc' },
    take: 3,
  });

  const candidates = [
    demo?.email,
    env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase(),
    ...admins.map((a) => a.email),
  ].filter((e): e is string => Boolean(e));

  if (candidates.length === 0) {
    report(
      false,
      'At least one sign-in address is configured',
      'Neither DEMO_SIGN_IN_EMAIL nor BOOTSTRAP_SUPER_ADMIN_EMAIL is set.',
      'Set one in .env and run "npm run db:seed".',
    );
  }

  for (const email of [...new Set(candidates)]) {
    console.log(`\n  Address: ${email}`);
    const domain = email.slice(email.lastIndexOf('@') + 1);

    const approved = await prisma.approvedDomain.findFirst({ where: { domain, active: true } });
    report(
      Boolean(approved),
      `Domain "${domain}" is approved and active`,
      approved ? undefined : 'A code is never issued for an unapproved domain — the browser still says "if that address is eligible".',
      `In development this row is created automatically the first time a code is requested, so simply request one. ` +
        `If it still does not appear, "${domain}" is in neither BOOTSTRAP_APPROVED_DOMAINS nor DEMO_SIGN_IN_EMAIL, or it exists and was deactivated.`,
    );

    const user = await prisma.user.findUnique({ where: { email } });
    report(
      Boolean(user),
      'Account exists',
      user ? `role ${user.systemRole}, status ${user.status}` : undefined,
      'In development this is created automatically on the first code request. Request one, then run this again.',
    );
    if (user) {
      report(
        user.status !== 'DEACTIVATED',
        'Account is not deactivated',
        undefined,
        'Reactivate it under Admin → Users.',
      );
    }

    const outstanding = await prisma.otpChallenge.count({
      where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    });
    console.log(`[${tick(true)}] Outstanding unexpired codes: ${outstanding}`);

    const recentFailures = await prisma.auditEvent.findMany({
      where: { actorEmail: email, action: { in: ['auth.code.failed', 'auth.code.request_refused'] } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { action: true, reason: true, createdAt: true },
    });
    if (recentFailures.length > 0) {
      console.log('         Most recent refusals, newest first:');
      for (const f of recentFailures) {
        console.log(
          `           ${f.createdAt.toISOString().replace('T', ' ').slice(0, 19)}  ${f.action}  ${f.reason ?? ''}`,
        );
      }
    }
  }

  // 4. The demonstration workspace -------------------------------------------
  if (demo) {
    console.log('\n  Demonstration workspace');

    const dir = env.DEMO_DATASET_DIR?.trim();
    if (!dir) {
      report(
        true,
        'Preloaded data is switched off',
        'DEMO_DATASET_DIR is not set, so the demonstration starts on an empty project. That is a valid choice.',
      );
    } else {
      let books = 0;
      let readable = true;
      try {
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(dir);
        books = entries.filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$')).length;
      } catch {
        readable = false;
      }
      report(
        readable,
        'The databook folder can be read',
        readable ? `${books} .xlsx file(s) in ${dir}` : dir,
        'Fix DEMO_DATASET_DIR in .env — the folder has moved or the path is wrong — then restart the app.',
      );
      if (readable) {
        report(
          books > 0,
          'The folder contains databooks',
          undefined,
          'It is readable but holds no .xlsx files. Point DEMO_DATASET_DIR at the Mintel "Final Data" folder.',
        );
      }
    }

    const project = await prisma.project.findFirst({
      where: { name: { startsWith: 'CBGA Outlook 2027' } },
      select: { id: true, name: true, isDemo: true, _count: { select: { datasetLinks: true } } },
    });
    const job = await prisma.job.findFirst({
      where: { kind: 'demo_provision' },
      orderBy: { createdAt: 'desc' },
      select: { status: true, errorMessage: true, createdAt: true },
    });

    if (project) {
      report(
        true,
        'The demonstration project exists',
        `${project.name} — ${project._count.datasetLinks} dataset(s)` +
          (project.isDemo ? ', flagged as demonstration data' : ''),
      );
    } else if (!job) {
      report(
        false,
        'The demonstration project exists',
        'No project, and no provisioning job was ever created. Either nobody has signed in as the ' +
          'demonstration account since this feature was installed, or the app is running older code.',
        'Run "npm run demo:load" to build it now, without waiting for a sign-in or a worker.',
      );
    } else if (job.status === 'PENDING' || job.status === 'RUNNING') {
      report(
        false,
        'The demonstration project exists',
        `Provisioning is ${job.status.toLowerCase()} (queued ${job.createdAt.toISOString().slice(0, 19).replace('T', ' ')}). ` +
          'If it has been pending for more than a few minutes, no worker is running to pick it up.',
        'Make sure the second PowerShell window (the worker) is running, or just run "npm run demo:load".',
      );
    } else {
      report(
        false,
        'The demonstration project exists',
        `Provisioning ${job.status.toLowerCase()}: ${job.errorMessage ?? 'no reason recorded'}`,
        'Run "npm run demo:load" to see the failure directly, or "npm run demo:load -- --force" to start over.',
      );
    }
  }

  // 5. Verdict ---------------------------------------------------------------
  console.log('');
  if (failures === 0) {
    console.log('Nothing is wrong with the configuration.');
    if (demo) {
      console.log(`Sign in at ${env.APP_BASE_URL}/sign-in with ${demo.email} and code ${demo.code}.`);
      console.log('If that still fails, the dev server is running with an older environment — restart it.');
    } else {
      console.log('Request a code and read it from the terminal running the application.');
    }
  } else {
    console.log(`${failures} problem(s) above. Each one names what to do about it.`);
  }
  console.log('');

  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * `npm run demo:load` — build the demonstration workspace now, in this process.
 *
 * Signing in enqueues this work as a background job, which is right: reading twenty-nine databooks
 * takes minutes and a sign-in that hangs for minutes is not a demonstration of anything good. But
 * a queued job depends on a worker running, and on the job not having already failed once — and
 * when either is untrue, the only symptom is a project that never appears.
 *
 * This is the direct route. It needs no worker, no sign-in and no queue: it runs the same function
 * the job runs, prints what happened, and says plainly why not when it declines.
 *
 *   npm run demo:load            build it, or report why it cannot
 *   npm run demo:load -- --force delete the existing demonstration project and rebuild it
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { loadEnv, demoSignIn, EnvironmentError } from '../src/lib/env';
import { provisionDemoWorkspace, DEMO_PROJECT_NAME } from '../src/demo/provision';

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  let env;
  try {
    env = loadEnv();
  } catch (e) {
    console.error(
      '\nThe environment is not valid, so nothing could be loaded:\n' +
        (e instanceof EnvironmentError ? ` - ${e.issues.join('\n - ')}` : String(e)) +
        '\n',
    );
    process.exit(1);
  }

  const demo = demoSignIn(env);
  if (!demo) {
    console.error(
      '\nNo demonstration credential is configured, so there is no account to load data for.\n' +
        'Set DEMO_SIGN_IN_EMAIL and DEMO_SIGN_IN_CODE in .env.\n',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });

  try {
    // The account must exist before the project can be owned by it. The application creates it on
    // the first sign-in request; doing it here means this command works on a database nobody has
    // signed in to yet.
    const account = await prisma.user.upsert({
      where: { email: demo.email },
      update: {},
      create: { email: demo.email, systemRole: 'SUPER_ADMIN', status: 'ACTIVE' },
    });
    const domain = demo.email.slice(demo.email.lastIndexOf('@') + 1);
    await prisma.approvedDomain.upsert({
      where: { domain },
      update: {},
      create: { domain, note: 'Created by demo:load (development only)' },
    });
    console.log(`Demonstration account: ${account.email} (${account.systemRole})`);

    if (force) {
      const removed = await prisma.project.deleteMany({ where: { name: DEMO_PROJECT_NAME } });
      // A failed job would otherwise keep its idempotency key and stop sign-in ever retrying.
      const jobs = await prisma.job.deleteMany({ where: { kind: 'demo_provision' } });
      console.log(
        `--force: removed ${removed.count} existing demonstration project(s) and ${jobs.count} provisioning job(s).`,
      );
    }

    console.log(`Reading databooks from: ${env.DEMO_DATASET_DIR ?? '(DEMO_DATASET_DIR is not set)'}`);
    console.log('This takes a couple of minutes. Nothing is written until the databooks are read.\n');

    const outcome = await provisionDemoWorkspace();

    switch (outcome.status) {
      case 'created':
        console.log('Done.');
        console.log(`  project   ${DEMO_PROJECT_NAME}`);
        console.log(`  datasets  ${outcome.datasets}`);
        console.log(`  files     ${outcome.files}`);
        console.log(`  rows      ${outcome.rows?.toLocaleString()}`);
        console.log(`  cohort    ${outcome.cohortId ? 'approved' : 'not built'}`);
        if (outcome.warnings?.length) {
          console.log(`\n  ${outcome.warnings.length} warning(s):`);
          for (const w of outcome.warnings.slice(0, 10)) console.log(`    - ${w}`);
        }
        console.log(`\nSign in as ${demo.email} with code ${demo.code} and open it from Projects.\n`);
        break;

      case 'already-present':
        console.log('The demonstration project already exists; nothing was changed.');
        console.log('Run "npm run demo:load -- --force" to delete it and build it again.\n');
        break;

      case 'skipped':
        console.error(`\nNothing was loaded: ${outcome.reason}\n`);
        process.exitCode = 1;
        break;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e, '\n');
  process.exit(1);
});

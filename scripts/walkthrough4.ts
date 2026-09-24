import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { createProject } from '../src/server/projects';
import { createDatasetWithVersion } from '../src/server/datasets';
import { recordGovernance, confirmFieldReview, acknowledgeFinding } from '../src/server/governance';
import { getOrCreateBrief, saveBrief, addHypothesis } from '../src/server/brief';
import { createCohort, approveCohort } from '../src/server/personas';
import { planRun, createRun, confirmRun } from '../src/server/runs';
import { runIngest } from '../src/ingest/pipeline';
import type { SessionUser } from '../src/auth/session';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const admin = await db.user.findUniqueOrThrow({ where: { email: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? 'admin@example.com' } });
  const user: SessionUser = {
    userId: admin.id, email: admin.email, displayName: null,
    systemRole: 'SUPER_ADMIN', sessionId: 'script',
  };

  const { id: projectId } = await createProject(user, { name: 'Phase 4 walkthrough' });

  const rows = ['market,age_band,purchase_intent,brand_awareness'];
  for (let i = 0; i < 120; i += 1) {
    const market = ['Indonesia', 'Germany', 'Mexico'][i % 3];
    rows.push(`${market},${['25-34','35-44'][i % 2]},${(i % 5) + 1},${(i % 4) + 1}`);
  }

  const ds = await createDatasetWithVersion(user, projectId, {
    name: 'Consumer panel Q1',
    files: [{ originalName: 'Indonesia_Germany_Mexico_Q1_2026.csv', mimeType: 'text/csv', bytes: Buffer.from(rows.join('\n'), 'utf8') }],
  });
  await runIngest(ds.datasetVersionId);

  for (const f of await db.integrityFinding.findMany({ where: { datasetVersionId: ds.datasetVersionId } })) {
    if (f.severity !== 'info') {
      await acknowledgeFinding(user, projectId, f.id, 'Checked against the source export; expected.');
    }
  }
  await recordGovernance(user, projectId, ds.datasetVersionId, {
    dataOwner: 'Research', sourceName: 'Consumer panel',
    methodology: 'Online panel, quota sampled to census on age and region, weighted.',
    geography: ['Indonesia', 'Germany', 'Mexico'], language: ['en'],
    lawfulBasis: 'CONSENT', classification: 'CLIENT_CONFIDENTIAL',
    permittedUses: ['internal_analysis'], retentionDays: 90, allowModelProcessing: true,
  });
  const fields = await db.datasetField.findMany({ where: { datasetVersionId: ds.datasetVersionId } });
  await confirmFieldReview(user, projectId, ds.datasetVersionId,
    fields.map((f) => ({ fieldId: f.id, excluded: false, constructMappingGrade: 'direct' as const })));

  const brief = await getOrCreateBrief(user, projectId);
  await saveBrief(user, projectId, brief!.id, {
    researchQuestion: 'Which market should launch first?',
    objective: 'compare',
    decisionSupported: 'Which market to launch the premium tier in first next quarter.',
    markets: ['Indonesia', 'Germany', 'Mexico'], competitors: [],
    desiredOutcome: 'We are hoping this proves Indonesia should go first.',
    exclusions: [], prohibitedInferences: ['Anything about health'],
    personaCount: 6, runCount: 1, simulationDepth: 'standard',
  });
  await addHypothesis(user, projectId, brief!.id, {
    label: 'H1',
    statement: 'Purchase intent is higher in Indonesia than in Germany.',
    minimumEvidenceThreshold: 'Two thirds of the panel confirm, independent agreement above 0.7, no herding flagged.',
    alternativeExplanations: ['Response-style differences between markets'],
  });

  const cohort = await createCohort(user, projectId, { datasetVersionId: ds.datasetVersionId, personaCount: 6, seed: 42 });
  await approveCohort(user, projectId, cohort.cohortId);

  const plan = await planRun(user, projectId, cohort.cohortId);
  const { runId } = await createRun(user, projectId, plan);
  await confirmRun(user, projectId, runId, plan.planHash);

  console.log(JSON.stringify({ projectId, cohortId: cohort.cohortId, runId, plan: {
    personaCount: plan.personaCount, estimatedCalls: plan.estimatedCalls,
    estimatedCostUsd: plan.estimatedCostUsd, isMock: plan.isMock, planHash: plan.planHash.slice(0, 16),
  } }, null, 2));
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

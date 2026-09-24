/**
 * Integration-test harness.
 *
 * These tests run against a real PostgreSQL database, not a mock. A mocked Prisma client would
 * verify that the code calls the methods the test expects — which is a restatement of the code,
 * not a check of it. Unique constraints, transactions, cascades and the actual SQL that Prisma
 * emits are precisely what can be wrong, so they are exercised for real.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const url =
  process.env.DATABASE_URL_TEST ??
  'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';

export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

/** Order matters: children before parents, because these are hard deletes rather than cascades. */
export async function resetDatabase(): Promise<void> {
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      "JudgeCheck", "PopulationSample", "ForecastAnalysis", "TelemetryEvent", "AuditEvent", "Session", "OtpChallenge",
      "ReportExport", "Recommendation", "Dissent", "Synthesis", "AntiHerdMetric", "PersonaVote", "EvidenceRef",
      "Finding", "SimulatedResponse", "ModelCall", "RunStep", "RunConfigDataset", "RunConfig", "Run",
      "PersonaAttribute", "PersonaVersion", "Persona", "Cohort",
      "EvidenceChunk", "QualityComponent", "IntegrityFinding", "GovernanceRecord",
      "DatasetField", "SourceFile", "DatasetVersion", "ProjectDataset", "Dataset",
      "Stimulus", "Hypothesis", "Brief", "Job",
      "ProjectMember", "Project", "Workspace", "User", "ApprovedDomain", "FeatureFlag"
    RESTART IDENTITY CASCADE
  `);
}

export async function seedDomain(domain: string, active = true): Promise<void> {
  await db.approvedDomain.create({ data: { domain, active } });
}

export async function seedUser(
  email: string,
  systemRole:
    | 'SUPER_ADMIN'
    | 'PLATFORM_ADMIN'
    | 'RESEARCH_ADMIN'
    | 'PRESET_MANAGER'
    | 'AUDITOR'
    | 'SUPPORT'
    | 'STANDARD_USER' = 'STANDARD_USER',
  status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED' = 'ACTIVE',
) {
  return db.user.create({ data: { email, systemRole, status } });
}

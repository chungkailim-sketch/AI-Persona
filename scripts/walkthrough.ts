import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { setStorageAdapter } from '../src/storage/adapter';
import { createProject } from '../src/server/projects';
import { createDatasetWithVersion } from '../src/server/datasets';
import type { SessionUser } from '../src/auth/session';

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const admin = await db.user.findUniqueOrThrow({ where: { email: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? 'admin@example.com' } });
  const user: SessionUser = {
    userId: admin.id, email: admin.email, displayName: null,
    systemRole: 'SUPER_ADMIN', sessionId: 'script',
  };

  const { id: projectId } = await createProject(user, {
    name: 'Phase 3 walkthrough',
    description: 'Created by the verification script',
  });

  const csv = [
    'Country: Indonesia',
    'market,age_band,email,purchase_intent,brand_awareness,empty_col',
    'Indonesia,25-34,ada@example.com,4,3,',
    'Indonesia,35-44,bob@example.com,5,4,',
    'Germany,25-34,cat@example.com,2,3,',
    'Germany,35-44,dan@example.com,3,*,',
    'Mexico,25-34,eve@example.com,4,4,',
    'Mexico,35-44,fay@example.com,5,5,',
  ].join('\n');

  const result = await createDatasetWithVersion(user, projectId, {
    name: 'Consumer panel Q1',
    files: [{
      originalName: 'Mintel_Germany_Q1_2026.csv',
      mimeType: 'text/csv',
      bytes: Buffer.from(csv, 'utf8'),
    }],
  });

  console.log(JSON.stringify({ projectId, ...result }, null, 2));
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

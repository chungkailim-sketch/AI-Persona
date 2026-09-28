import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { assembleReport, renderMarkdown } from '../src/report/assemble';
import { checkReport, exportReport, ExportBlocked } from '../src/report/export';
import type { SessionUser } from '../src/auth/session';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

async function main() {
  const admin = await db.user.findUniqueOrThrow({ where: { email: process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? 'admin@example.com' } });
  const user: SessionUser = { userId: admin.id, email: admin.email, displayName: null, systemRole: 'SUPER_ADMIN', sessionId: 's' };
  const run = await db.run.findFirstOrThrow({ where: { status: { in: ['COMPLETED','COMPLETED_WITH_WARNINGS'] } }, orderBy: { completedAt: 'desc' } });

  const report = await assembleReport(user, run.projectId, run.id);
  const checked = checkReport(report);
  console.log('limitations:', report.limitations.length, '| findings:', report.findings.length, '| panel:', report.panelSize);
  console.log('claim issues:', checked.flatMap(c => c.issues).length,
              '| blocking:', checked.flatMap(c => c.issues.filter(i => i.severity === 'blocking')).length);

  try {
    await exportReport(user, run.projectId, run.id, 'markdown');
    console.log('EXPORT: allowed (unexpected for a mock run)');
  } catch (e) {
    if (e instanceof ExportBlocked) console.log('EXPORT: refused —', e.issues[0]?.issues[0]?.message.slice(0, 80));
    else throw e;
  }

  const ok = await exportReport(user, run.projectId, run.id, 'markdown', {
    acknowledgeBlocks: 'Internal methodology review of the pipeline only; nobody will read these as findings.',
  });
  console.log('OVERRIDE export:', ok.filename, '| first line:', ok.content.split('\n')[0]?.slice(0, 70));
  console.log('--- report head ---');
  console.log(renderMarkdown(report).split('\n').slice(0, 24).join('\n'));
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

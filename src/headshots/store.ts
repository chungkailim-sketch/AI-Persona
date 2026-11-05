/** Loading the headshot catalog into the database, and reading one back (server only). */
import { prisma } from '@/lib/prisma';
import { HEADSHOTS } from './catalog';
import { drawHeadshot } from './draw';

/**
 * Make sure every catalog entry has a row. Only missing ones are created (with the drawn
 * illustration): a row already holding a generated photo is never overwritten.
 */
export async function ensureHeadshots(): Promise<number> {
  const have = new Set((await prisma.headshot.findMany({ select: { key: true } })).map((h) => h.key));
  for (const h of HEADSHOTS) {
    if (have.has(h.key)) continue;
    await prisma.headshot.create({ data: { key: h.key, region: h.region, gender: h.gender, age: h.age, data: Buffer.from(drawHeadshot(h)) } });
  }
  return HEADSHOTS.length;
}

export async function loadHeadshot(key: string): Promise<{ mime: string; data: Buffer } | null> {
  const row = await prisma.headshot.findUnique({ where: { key }, select: { mime: true, data: true } });
  if (row) return { mime: row.mime, data: Buffer.from(row.data) };
  const spec = HEADSHOTS.find((h) => h.key === key);
  return spec ? { mime: 'image/svg+xml', data: Buffer.from(drawHeadshot(spec)) } : null;
}

export async function headshotStatus(): Promise<{ total: number; photos: number }> {
  const [total, photos] = await Promise.all([prisma.headshot.count(), prisma.headshot.count({ where: { source: 'photo' } })]);
  return { total, photos };
}

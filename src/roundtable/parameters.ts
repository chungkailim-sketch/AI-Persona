/**
 * The parameters personas can be built on, proposed from the data itself (server only).
 *
 * A Mintel databook publishes every figure for a set of segment groups — household income, age,
 * gender, employment, region, children at home… — and a persona is one segment of one of those
 * groups in one market. The groups on offer are read from the profiled `segment_group` field of
 * every ready dataset (no file is read), named without their wave suffix, sorted by what tends to
 * matter for a market-entry or communications brief, and the most useful ones are recommended.
 */
import { prisma } from '@/lib/prisma';
import { assessUsability } from '@/ingest/pipeline';

import { proposeFromGroups, type ParameterOption } from './parameterNames';

export type { ParameterOption };

export async function proposeParameters(projectId: string): Promise<ParameterOption[]> {
  const links = await prisma.projectDataset.findMany({
    where: { projectId, dataset: { deletedAt: null } },
    include: { dataset: { include: { versions: { orderBy: { versionNo: 'desc' }, take: 1, include: { fields: { where: { name: { equals: 'segment_group', mode: 'insensitive' } } } } } } } },
  });
  const counts = new Map<string, number>();
  for (const l of links) {
    const v = l.dataset.versions[0];
    if (!v || !(await assessUsability(v.id)).usable) continue;
    const names = new Set<string>();
    for (const f of v.fields) {
      const p = f.profile as { withheld?: boolean; topValues?: { value: string }[] } | null;
      for (const t of p?.withheld ? [] : (p?.topValues ?? [])) if (t.value?.trim()) names.add(t.value.trim());
    }
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return proposeFromGroups([...counts.entries()].map(([name, datasets]) => ({ name, datasets })));
}

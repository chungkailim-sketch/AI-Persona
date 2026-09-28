/**
 * `npx tsx scripts/extractSeries.ts <databook folder> <out.json>`
 *
 * Turns the Mintel Global Consumer databooks into wave-over-wave series — one series per
 * market × question × statement × response × segment — for forecasting and experiments.
 *
 * Kept: segment groups "all" and "age groups" (enough to test population and segment series
 * without a 100 MB file). A series is kept only when every wave for its market has a value; gaps
 * are never filled. Shares are stored as recorded (0..1), with each wave's base.
 */
import { readdir } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { monthIndex, parseFileName, readMintelWorkbook } from '../src/demo/mintel';

const KEEP = new Set(['all', 'age groups']);

async function main() {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) throw new Error('usage: extractSeries <dir> <out.json>');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.xlsx') && parseFileName(f));
  const points = new Map<string, { wave: string; t: number; share: number; base: number | null }[]>();
  const meta = new Map<string, { market: string; question_id: string; statement: string; response: string; segment_group: string; segment: string }>();
  const questions: Record<string, string> = {};
  const wavesByMarket = new Map<string, Set<string>>();

  for (const f of files) {
    const wb = await readMintelWorkbook(join(dir, f), f);
    if (!wb) continue;
    for (const [k, v] of wb.questionText) questions[k] = questions[k] ?? v;
    for (const r of wb.rows) {
      if (!KEEP.has(r.segment_group.toLowerCase())) continue;
      const t = r.wave_year * 12 + monthIndex(r.wave_month);
      const key = [r.market, r.question_id, r.statement, r.response, r.segment_group, r.segment].join('␟');
      if (!points.has(key)) {
        points.set(key, []);
        meta.set(key, { market: r.market, question_id: r.question_id, statement: r.statement, response: r.response, segment_group: r.segment_group, segment: r.segment });
      }
      points.get(key)!.push({ wave: r.wave, t, share: r.share, base: r.sample_base === '' ? null : r.sample_base });
      const w = wavesByMarket.get(r.market) ?? new Set<string>();
      w.add(`${t}`);
      wavesByMarket.set(r.market, w);
    }
  }

  const series = [];
  for (const [key, pts] of points) {
    const m = meta.get(key)!;
    const need = wavesByMarket.get(m.market)!.size;
    const uniq = new Map(pts.map((p) => [p.t, p]));
    if (uniq.size !== need) continue; // a wave is missing — never filled
    const ordered = [...uniq.values()].sort((a, b) => a.t - b.t);
    series.push({ ...m, waves: ordered.map((p) => p.wave), values: ordered.map((p) => p.share), bases: ordered.map((p) => p.base) });
  }
  await writeFile(out, JSON.stringify({ generatedAt: new Date().toISOString(), files: files.length, questions, series }));
  console.log(`${files.length} files → ${series.length} complete series (${points.size - series.length} dropped for missing waves)`);
}
main().catch((e) => { console.error(e); process.exit(1); });

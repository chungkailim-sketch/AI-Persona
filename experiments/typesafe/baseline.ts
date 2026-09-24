/**
 * The app's own detectors on the same labelled cases, for comparison with TypeSafe:
 * - E3: `classifyField` (name + value-shape rules in src/ingest/sensitivity.ts)
 * `npx tsx experiments/typesafe/baseline.ts`
 */
import { readFileSync } from 'node:fs';
import { classifyField } from '../../src/ingest/sensitivity';

const src = readFileSync(new URL('./cases.py', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('E3_FIELDS = ['), src.indexOf(']\n\n# E4'));
const rows = [...block.matchAll(/\("([^"]+)", \[([^\]]*)\], "([A-Z_]+)"\)/g)].map((m) => ({
  name: m[1]!,
  values: [...m[2]!.matchAll(/"([^"]*)"/g)].map((v) => v[1]!),
  label: m[3]!,
}));
let ok = 0;
const misses: unknown[] = [];
for (const r of rows) {
  const v = classifyField(r.name, r.values);
  if (v.sensitivity === r.label) ok += 1;
  else misses.push({ field: r.name, label: r.label, got: v.sensitivity });
}
console.log(JSON.stringify({ n: rows.length, accuracy: +(ok / rows.length).toFixed(3), misses }, null, 2));

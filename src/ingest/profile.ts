/**
 * Field profiling and type inference.
 *
 * Inference here is explicitly *inference*: every field carries a confidence, and the interface
 * shows it, because a column typed wrongly silently changes what every later statistic means. A
 * five-point Likert column read as free text produces no mean; read as numeric without noticing it
 * is ordinal, it produces a mean that looks authoritative and is not.
 */
import { UPLOAD_LIMITS } from '@/ingest/limits';

export type FieldType =
  | 'TEXT'
  | 'NUMERIC'
  | 'ORDINAL'
  | 'CATEGORICAL'
  | 'BOOLEAN'
  | 'DATE'
  | 'IDENTIFIER'
  | 'UNKNOWN';

export interface FieldProfile {
  name: string;
  sourceName: string;
  type: FieldType;
  typeConfidence: number;
  scalePoints: number | null;
  missingCount: number;
  missingPct: number;
  distinctCount: number;
  outlierCount: number;
  /** Up to 12 most frequent values, for the reviewer to eyeball. Never the whole column. */
  topValues: { value: string; count: number }[];
  numeric: { min: number; max: number; mean: number; median: number; sd: number } | null;
  notes: string[];
}

const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'null', 'none', '-', '--', '.', 'nan', '#n/a']);
const TRUE_TOKENS = new Set(['true', 'yes', 'y', '1']);
const FALSE_TOKENS = new Set(['false', 'no', 'n', '0']);

function isMissing(v: string): boolean {
  return MISSING_TOKENS.has(v.trim().toLowerCase());
}

function asNumber(v: string): number | null {
  const t = v.trim().replace(/,/g, '').replace(/%$/, '');
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function asDate(v: string): boolean {
  const t = v.trim();
  if (t.length < 6 || t.length > 32) return false;
  if (!/[-/.]/.test(t) && !/^\d{8}$/.test(t)) return false;
  return !Number.isNaN(Date.parse(t));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

export function profileField(name: string, values: string[]): FieldProfile {
  const notes: string[] = [];
  const total = values.length;
  const present = values.filter((v) => !isMissing(v));
  const missingCount = total - present.length;

  const counts = new Map<string, number>();
  for (const v of present) {
    const k = v.trim();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const distinctCount = counts.size;
  const topValues = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([value, count]) => ({ value, count }));

  const numbers = present.map(asNumber).filter((n): n is number => n !== null);
  const numericShare = present.length === 0 ? 0 : numbers.length / present.length;

  const lowered = present.map((v) => v.trim().toLowerCase());
  const booleanShare =
    present.length === 0
      ? 0
      : lowered.filter((v) => TRUE_TOKENS.has(v) || FALSE_TOKENS.has(v)).length / present.length;
  const dateShare =
    present.length === 0 ? 0 : present.filter(asDate).length / present.length;

  let type: FieldType = 'UNKNOWN';
  let typeConfidence = 0;
  let scalePoints: number | null = null;

  const uniqueShare = present.length === 0 ? 0 : distinctCount / present.length;
  const looksLikeId =
    /(^|_)(id|uuid|guid|respondent|record|key)($|_)/i.test(name) && uniqueShare > 0.95;

  if (looksLikeId) {
    type = 'IDENTIFIER';
    typeConfidence = 0.9;
    notes.push('Treated as an identifier: near-unique values and an identifying name.');
  } else if (booleanShare > 0.95 && distinctCount <= 3) {
    type = 'BOOLEAN';
    typeConfidence = booleanShare;
  } else if (numericShare > 0.9) {
    const ints = numbers.every((n) => Number.isInteger(n));
    // A small set of consecutive integers is a rating scale, not a measurement. Calling it ordinal
    // is what stops a mean being computed over rank labels later on.
    if (ints && distinctCount >= 2 && distinctCount <= 11) {
      const min = Math.min(...numbers);
      const max = Math.max(...numbers);
      if (max - min + 1 <= 11 && max - min + 1 >= distinctCount) {
        type = 'ORDINAL';
        scalePoints = max - min + 1;
        typeConfidence = 0.75;
        notes.push(
          `Looks like a ${scalePoints}-point scale (${min}–${max}). Confirm before any mean is ` +
            'reported over it.',
        );
      }
    }
    if (type === 'UNKNOWN') {
      type = 'NUMERIC';
      typeConfidence = numericShare;
    }
  } else if (dateShare > 0.85) {
    type = 'DATE';
    typeConfidence = dateShare;
  } else if (distinctCount > 0 && distinctCount <= Math.max(25, present.length * 0.05)) {
    type = 'CATEGORICAL';
    typeConfidence = 0.7;
  } else {
    type = 'TEXT';
    typeConfidence = 0.6;
  }

  let numeric: FieldProfile['numeric'] = null;
  let outlierCount = 0;
  if ((type === 'NUMERIC' || type === 'ORDINAL') && numbers.length > 0) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const mean = numbers.reduce((s, n) => s + n, 0) / numbers.length;
    const variance =
      numbers.length > 1
        ? numbers.reduce((s, n) => s + (n - mean) ** 2, 0) / (numbers.length - 1)
        : 0;
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const med = quantile(sorted, 0.5);

    // Tukey's fence, reported and never removed: an outlier in survey data is often the finding.
    if (iqr > 0) {
      outlierCount = numbers.filter((n) => n < q1 - 1.5 * iqr || n > q3 + 1.5 * iqr).length;
    } else {
      // A near-constant column has an IQR of zero, and Tukey's fence then collapses to "nothing is
      // ever an outlier" — which is exactly backwards, because in that column a single divergent
      // value is the most conspicuous thing in it. The median absolute deviation handles this case;
      // when the MAD is zero too, every value that differs from the median at all is an outlier.
      const deviations = numbers.map((n) => Math.abs(n - med)).sort((a, b) => a - b);
      const mad = quantile(deviations, 0.5);
      outlierCount =
        mad > 0
          ? numbers.filter((n) => Math.abs(n - med) / (1.4826 * mad) > 3.5).length
          : numbers.filter((n) => n !== med).length;
    }
    numeric = {
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      mean,
      median: quantile(sorted, 0.5),
      sd: Math.sqrt(variance),
    };
  }

  if (missingCount / Math.max(total, 1) > 0.4) {
    notes.push(
      `${Math.round((missingCount / Math.max(total, 1)) * 100)}% of values are missing. Anything ` +
        'computed from this field rests on a much smaller base than the row count suggests.',
    );
  }
  if (type === 'NUMERIC' && numericShare < 1) {
    notes.push(
      `${present.length - numbers.length} value(s) could not be read as numbers and are excluded ` +
        'from the statistics above.',
    );
  }

  return {
    name: name.trim() || 'unnamed',
    sourceName: name,
    type,
    typeConfidence: Math.round(typeConfidence * 100) / 100,
    scalePoints,
    missingCount,
    missingPct: total === 0 ? 0 : Math.round((missingCount / total) * 1000) / 10,
    distinctCount,
    outlierCount,
    topValues,
    numeric,
    notes,
  };
}

export function profileTable(headers: string[], rows: string[][]): FieldProfile[] {
  const sample = rows.slice(0, UPLOAD_LIMITS.profileSampleRows);
  return headers.map((h, col) => profileField(h, sample.map((r) => r[col] ?? '')));
}

/**
 * Automated integrity checks (DATA-15..DATA-19).
 *
 * These are the checks that earned their place during the Mintel analysis that preceded this
 * platform — each corresponds to a defect actually found in real supplier data, and each would
 * have silently corrupted a conclusion:
 *
 *  - `filename_vs_internal_label`: one wave's files were labelled with the wrong market in the
 *    filename while the label inside the file was right. Trusting the filename mis-assigned a
 *    whole market's responses.
 *  - `period_gap`: one market had no data for a wave. A trend line drawn straight through the gap
 *    looks smooth and is wrong.
 *  - `uniform_drift`: one market shifted by the same amount on every question in a battery, which
 *    is a response-style artefact, not a change of opinion.
 *  - `suppression`: cells with a zero base, or a suppression marker, read as 0 unless caught —
 *    turning "not reportable" into "nobody agreed".
 *  - `encoding`: mojibake becomes a spurious category.
 *
 * A blocking finding stops the dataset being used. A warning must be acknowledged by a named
 * person. Neither can be dismissed silently.
 */
export interface IntegrityFindingResult {
  check:
    | 'filename_vs_internal_label'
    | 'period_gap'
    | 'uniform_drift'
    | 'suppression'
    | 'encoding'
    | 'duplicate_rows'
    | 'empty_field'
    | 'constant_field';
  severity: 'blocking' | 'warning' | 'info';
  message: string;
  detail?: Record<string, unknown>;
}

export interface IntegrityInput {
  originalName: string;
  encoding: string;
  headers: string[];
  rows: string[][];
  fields: { name: string; missingPct: number; distinctCount: number; type: string }[];
  /** Labels found inside the file that name a market, period or source. */
  internalLabels: string[];
}

/**
 * Market and period tokens, kept in separate groups.
 *
 * They must be compared like with like. Pooling them produces false accusations: a file named
 * `Q1_2026.csv` whose contents say "Indonesia" has a period in the filename and a market inside,
 * which looks like a disagreement and is not one.
 */
const MARKET_TOKENS =
  /\b(indonesia|germany|saudi arabia|saudi|usa|united states|mexico|china|india|japan|singapore|france|italy|spain|brazil|uk|united kingdom)\b/gi;
const PERIOD_TOKENS =
  /\b(q[1-4]|h[12]|fy\d{2,4}|20\d\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/gi;

/**
 * Separators are turned into spaces before matching: `\b` does not fire between `_` and a letter,
 * so `Mintel_Germany_Q1.csv` would otherwise yield no tokens at all and the check would pass
 * silently on exactly the filenames it exists to catch.
 */
function tokensOf(s: string, pattern: RegExp): Set<string> {
  const normalised = s.toLowerCase().replace(/[_\-.]+/g, ' ');
  return new Set((normalised.match(pattern) ?? []).map((t) => t.trim()));
}

function collect(values: string[], pattern: RegExp): Set<string> {
  const out = new Set<string>();
  for (const v of values) for (const t of tokensOf(v, pattern)) out.add(t);
  return out;
}

const ROW_KEY_SEPARATOR = String.fromCharCode(1);

export function checkIntegrity(input: IntegrityInput): IntegrityFindingResult[] {
  const findings: IntegrityFindingResult[] = [];

  // ── Encoding ──────────────────────────────────────────────────────────────
  if (input.encoding.includes('assumed')) {
    findings.push({
      check: 'encoding',
      severity: 'warning',
      message:
        'The file is not valid UTF-8 and was read with an assumed encoding. Non-Latin characters ' +
        'may be corrupted, which would show up below as extra categories.',
      detail: { encoding: input.encoding },
    });
  }
  // Literal escapes rather than the characters themselves: the byte pairs that indicate UTF-8
  // read as Latin-1 are invisible in a source file and easy to mangle in an edit.
  const MOJIBAKE = new RegExp('[\\u00c2\\u00c3][\\u0080-\\u00bf]|\\ufffd');
  const mojibake = input.headers.filter((h) => MOJIBAKE.test(h));
  if (mojibake.length > 0) {
    findings.push({
      check: 'encoding',
      severity: 'warning',
      message: `${mojibake.length} column name(s) contain characters that look mis-decoded.`,
      detail: { columns: mojibake.slice(0, 10) },
    });
  }

  // ── Filename versus internal label ────────────────────────────────────────
  // Compared per category. A disagreement is only a disagreement when both sides named something
  // of the same kind and named it differently.
  for (const [kind, pattern] of [
    ['market', MARKET_TOKENS],
    ['period', PERIOD_TOKENS],
  ] as const) {
    const fromFilename = tokensOf(input.originalName, pattern);
    const fromInside = collect(input.internalLabels, pattern);
    if (fromFilename.size === 0 || fromInside.size === 0) continue;

    const onlyInFilename = [...fromFilename].filter((t) => !fromInside.has(t));
    const onlyInside = [...fromInside].filter((t) => !fromFilename.has(t));
    if (onlyInFilename.length === 0 || onlyInside.length === 0) continue;

    findings.push({
      check: 'filename_vs_internal_label',
      // A market mismatch mis-assigns every row and blocks. A period mismatch is usually a naming
      // convention rather than an error, so it is raised for a human to settle.
      severity: kind === 'market' ? 'blocking' : 'warning',
      message:
        `The filename names the ${kind} "${onlyInFilename.join(', ')}" but labels inside the file ` +
        `say "${onlyInside.join(', ')}". One of them is wrong, and taking the filename on trust ` +
        `would mis-assign every row in this file.`,
      detail: { kind, filename: [...fromFilename], internal: [...fromInside] },
    });
  }

  // ── Suppression ───────────────────────────────────────────────────────────
  const suppressionMarks = new Set(['*', '**', 'n/a*', 'suppressed', 'low base', '<30', '[c]']);
  let suppressed = 0;
  for (const row of input.rows.slice(0, 5000)) {
    for (const cell of row) {
      if (suppressionMarks.has(cell.trim().toLowerCase())) suppressed += 1;
    }
  }
  if (suppressed > 0) {
    findings.push({
      check: 'suppression',
      severity: 'warning',
      message:
        `${suppressed} cell(s) carry a suppression marker. These mean "not reportable", not zero — ` +
        'reading them as zero would understate every figure computed from them.',
      detail: { count: suppressed },
    });
  }

  // ── Empty and constant fields ─────────────────────────────────────────────
  const empty = input.fields.filter((f) => f.missingPct >= 100).map((f) => f.name);
  if (empty.length > 0) {
    findings.push({
      check: 'empty_field',
      severity: 'warning',
      message: `${empty.length} field(s) contain no values at all.`,
      detail: { fields: empty.slice(0, 20) },
    });
  }
  const constant = input.fields
    .filter((f) => f.distinctCount === 1 && f.missingPct < 100)
    .map((f) => f.name);
  if (constant.length > 0) {
    findings.push({
      check: 'constant_field',
      severity: 'info',
      message:
        `${constant.length} field(s) hold a single repeated value. They carry no information for ` +
        'comparison, though they may correctly record a constant such as the wave or the market.',
      detail: { fields: constant.slice(0, 20) },
    });
  }

  // ── Duplicate rows ────────────────────────────────────────────────────────
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of input.rows.slice(0, 20_000)) {
    const key = row.join(ROW_KEY_SEPARATOR);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  if (duplicates > 0) {
    findings.push({
      check: 'duplicate_rows',
      severity: duplicates > input.rows.length * 0.05 ? 'warning' : 'info',
      message:
        `${duplicates} row(s) are exact duplicates of an earlier row. If these are genuine repeat ` +
        'responses they inflate every count; if they are an export artefact they should be removed.',
      detail: { count: duplicates },
    });
  }

  return findings;
}

/**
 * Gaps in a set of collection periods.
 *
 * Passed the periods a dataset claims to cover, per market. A market missing a wave that its peers
 * have is the case that matters: a trend computed across it interpolates over nothing.
 */
export function checkPeriodGaps(
  coverage: { group: string; periods: string[] }[],
): IntegrityFindingResult | null {
  if (coverage.length < 2) return null;
  const all = new Set<string>();
  for (const c of coverage) for (const p of c.periods) all.add(p);
  if (all.size < 2) return null;

  const gaps = coverage
    .map((c) => ({ group: c.group, missing: [...all].filter((p) => !c.periods.includes(p)) }))
    .filter((c) => c.missing.length > 0);

  if (gaps.length === 0) return null;
  return {
    check: 'period_gap',
    severity: 'warning',
    message:
      gaps
        .map((g) => `${g.group} has no data for ${g.missing.join(', ')}`)
        .join('; ') +
      '. A trend drawn across a missing period interpolates over nothing and will look smoother ' +
      'than the evidence supports.',
    detail: { periods: [...all], gaps },
  };
}

/**
 * Uniform drift across a battery of related fields.
 *
 * Needs two comparable measurements of the same questions. When every item in a battery moves by
 * nearly the same amount in the same direction, the likeliest explanation is that a group changed
 * how it used the scale — not that it changed its mind about everything at once.
 */
export function checkUniformDrift(
  label: string,
  deltas: { field: string; delta: number }[],
): IntegrityFindingResult | null {
  if (deltas.length < 5) return null;
  const values = deltas.map((d) => d.delta);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (Math.abs(mean) < 2) return null;

  const sd = Math.sqrt(
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1),
  );
  const sameDirection =
    values.filter((v) => Math.sign(v) === Math.sign(mean)).length / values.length;

  // A large consistent shift with a small spread is the signature of a response-style artefact.
  if (sameDirection >= 0.9 && sd < Math.abs(mean) * 0.5) {
    return {
      check: 'uniform_drift',
      severity: 'warning',
      message:
        `Every item in ${label} moved by about ${mean.toFixed(1)} points in the same direction ` +
        `(spread ${sd.toFixed(1)}). That pattern usually means the group changed how it used the ` +
        'scale, not that it changed its view on every question at once. Comparisons involving this ' +
        'group should be made relative to the battery before being reported.',
      detail: { mean, sd, sameDirectionShare: sameDirection, items: deltas.length },
    };
  }
  return null;
}

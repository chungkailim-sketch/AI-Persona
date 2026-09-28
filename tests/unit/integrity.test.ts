import { describe, it, expect } from 'vitest';
import { checkIntegrity, checkUniformDrift, checkPeriodGaps } from '@/ingest/integrity';

function baseInput(overrides: Partial<Parameters<typeof checkIntegrity>[0]> = {}) {
  return {
    originalName: 'data.csv',
    encoding: 'utf-8',
    headers: ['market', 'score'],
    rows: [
      ['Indonesia', '4'],
      ['Germany', '2'],
    ],
    fields: [
      { name: 'market', missingPct: 0, distinctCount: 2, type: 'CATEGORICAL' },
      { name: 'score', missingPct: 0, distinctCount: 2, type: 'ORDINAL' },
    ],
    internalLabels: ['market', 'score'],
    ...overrides,
  };
}

describe('filename versus internal label', () => {
  it('blocks when the filename names a different market from the file contents', () => {
    // The defect that mis-assigned a whole market's responses in real supplier data.
    const findings = checkIntegrity(
      baseInput({
        originalName: 'Mintel_Germany_Q1_2026.csv',
        internalLabels: ['Country: Indonesia', 'Wave: Q1 2026'],
      }),
    );
    const f = findings.find((x) => x.check === 'filename_vs_internal_label');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('blocking');
    expect(f?.message).toMatch(/germany/i);
    expect(f?.message).toMatch(/indonesia/i);
  });

  it('stays quiet when they agree', () => {
    const findings = checkIntegrity(
      baseInput({
        originalName: 'Mintel_Indonesia_Q1_2026.csv',
        internalLabels: ['Country: Indonesia', 'Wave: Q1 2026'],
      }),
    );
    expect(findings.find((x) => x.check === 'filename_vs_internal_label')).toBeUndefined();
  });
});

describe('suppression', () => {
  it('flags suppression markers so they are not read as zero', () => {
    const findings = checkIntegrity(
      baseInput({
        rows: [
          ['Saudi Arabia', '*'],
          ['Germany', '2'],
          ['Mexico', 'low base'],
        ],
      }),
    );
    const f = findings.find((x) => x.check === 'suppression');
    expect(f?.severity).toBe('warning');
    expect(f?.message).toMatch(/not reportable.*not zero/i);
  });
});

describe('encoding', () => {
  it('flags an assumed encoding', () => {
    const findings = checkIntegrity(baseInput({ encoding: 'latin1 (assumed)' }));
    expect(findings.find((x) => x.check === 'encoding')).toBeDefined();
  });

  it('flags mis-decoded column names', () => {
    const findings = checkIntegrity(baseInput({ headers: ['marchÃ©', 'score'] }));
    const f = findings.find((x) => x.check === 'encoding');
    expect(f?.message).toMatch(/mis-decoded/);
  });
});

describe('structural checks', () => {
  it('flags an entirely empty field', () => {
    const findings = checkIntegrity(
      baseInput({
        fields: [{ name: 'notes', missingPct: 100, distinctCount: 0, type: 'TEXT' }],
      }),
    );
    expect(findings.find((x) => x.check === 'empty_field')?.severity).toBe('warning');
  });

  it('notes a constant field without treating it as a problem', () => {
    const findings = checkIntegrity(
      baseInput({
        fields: [{ name: 'wave', missingPct: 0, distinctCount: 1, type: 'CATEGORICAL' }],
      }),
    );
    const f = findings.find((x) => x.check === 'constant_field');
    expect(f?.severity).toBe('info');
    expect(f?.message).toMatch(/may correctly record a constant/);
  });

  it('counts exact duplicate rows', () => {
    const findings = checkIntegrity(
      baseInput({
        rows: [
          ['Indonesia', '4'],
          ['Indonesia', '4'],
          ['Germany', '2'],
        ],
      }),
    );
    expect(findings.find((x) => x.check === 'duplicate_rows')).toBeDefined();
  });
});

describe('uniform drift', () => {
  it('flags a battery that moved together by about the same amount', () => {
    const deltas = [
      { field: 'q1', delta: 5.2 },
      { field: 'q2', delta: 5.4 },
      { field: 'q3', delta: 5.1 },
      { field: 'q4', delta: 5.6 },
      { field: 'q5', delta: 5.3 },
      { field: 'q6', delta: 5.0 },
    ];
    const f = checkUniformDrift('the US attitude battery', deltas);
    expect(f).not.toBeNull();
    expect(f?.severity).toBe('warning');
    expect(f?.message).toMatch(/how it used the scale/i);
  });

  it('stays quiet when items move in different directions', () => {
    const deltas = [
      { field: 'q1', delta: 6 },
      { field: 'q2', delta: -4 },
      { field: 'q3', delta: 5 },
      { field: 'q4', delta: -7 },
      { field: 'q5', delta: 2 },
      { field: 'q6', delta: 8 },
    ];
    expect(checkUniformDrift('battery', deltas)).toBeNull();
  });

  it('stays quiet when the shift is small enough to be noise', () => {
    const deltas = Array.from({ length: 8 }, (_, i) => ({ field: `q${i}`, delta: 0.4 }));
    expect(checkUniformDrift('battery', deltas)).toBeNull();
  });

  it('needs enough items to tell a pattern from a coincidence', () => {
    expect(
      checkUniformDrift('battery', [
        { field: 'q1', delta: 5 },
        { field: 'q2', delta: 5 },
      ]),
    ).toBeNull();
  });
});

describe('period gaps', () => {
  it('flags a market missing a wave its peers have', () => {
    const f = checkPeriodGaps([
      { group: 'Indonesia', periods: ['Q1', 'Q2', 'Q3'] },
      { group: 'Germany', periods: ['Q1', 'Q2', 'Q3'] },
      { group: 'USA', periods: ['Q1', 'Q3'] },
    ]);
    expect(f).not.toBeNull();
    expect(f?.message).toMatch(/USA has no data for Q2/);
    expect(f?.message).toMatch(/interpolates over nothing/);
  });

  it('stays quiet when coverage matches', () => {
    expect(
      checkPeriodGaps([
        { group: 'Indonesia', periods: ['Q1', 'Q2'] },
        { group: 'Germany', periods: ['Q1', 'Q2'] },
      ]),
    ).toBeNull();
  });
});

describe('filename check compares like with like', () => {
  it('does not accuse a file whose name carries only a period', () => {
    // Filename has a period, contents name a market. Pooling the token kinds would read this as a
    // disagreement; it is not one.
    const findings = checkIntegrity(
      baseInput({
        originalName: 'export_Q1_2026.csv',
        internalLabels: ['Country: Indonesia'],
      }),
    );
    expect(findings.find((x) => x.check === 'filename_vs_internal_label')).toBeUndefined();
  });

  it('treats a period mismatch as a warning, not a block', () => {
    const findings = checkIntegrity(
      baseInput({
        originalName: 'Indonesia_Q1_2026.csv',
        internalLabels: ['Country: Indonesia', 'Wave: Q2 2026'],
      }),
    );
    const f = findings.find((x) => x.check === 'filename_vs_internal_label');
    expect(f?.severity).toBe('warning');
    expect(f?.message).toMatch(/period/);
  });

  it('still blocks on a market mismatch and names only the markets', () => {
    const findings = checkIntegrity(
      baseInput({
        originalName: 'Mintel_Germany_Q1_2026.csv',
        internalLabels: ['Country: Indonesia', 'Wave: Q1 2026'],
      }),
    );
    const f = findings.find((x) => x.check === 'filename_vs_internal_label');
    expect(f?.severity).toBe('blocking');
    expect(f?.message).toMatch(/names the market "germany"/);
    expect(f?.message).toMatch(/"indonesia"/);
    // The period agreed, so it is not dragged into the accusation.
    expect(f?.message).not.toMatch(/q1/);
  });
});

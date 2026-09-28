import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateTime, fmtTime, TZ_LABEL } from '../../src/lib/time';

describe('display time zone', () => {
  it('shows times in GMT+8 whatever the machine zone', () => {
    // 20:30 UTC on 27 September is 04:30 on 28 September in Singapore and Shanghai.
    const d = new Date('2026-09-27T20:30:15Z');
    expect(fmtDate(d)).toBe('2026-09-28');
    expect(fmtDateTime(d)).toBe('2026-09-28 04:30');
    expect(fmtDateTime(d, { seconds: true })).toBe('2026-09-28 04:30:15');
    expect(fmtTime('2026-09-27T20:30:15Z')).toBe('04:30:15');
    expect(TZ_LABEL).toBe('GMT+8');
  });

  it('uses a 24-hour clock, with midnight as 00', () => {
    expect(fmtDateTime(new Date('2026-01-01T16:00:00Z'))).toBe('2026-01-02 00:00');
  });
});

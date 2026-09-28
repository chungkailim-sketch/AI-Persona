import { describe, it, expect } from 'vitest';
import { classifyField } from '@/ingest/sensitivity';

describe('sensitive-field detection by name', () => {
  it('flags directly identifying columns as personal data', () => {
    for (const name of ['email', 'e-mail', 'phone_number', 'full_name', 'postcode', 'ip_address', 'date_of_birth']) {
      expect(classifyField(name, ['x']).sensitivity, name).toBe('PII');
    }
  });

  it('flags special-category topics', () => {
    for (const name of ['ethnicity', 'religion', 'political_party', 'health_condition', 'sexual_orientation', 'union_membership', 'criminal_record']) {
      expect(classifyField(name, ['x']).sensitivity, name).toBe('SPECIAL_CATEGORY');
    }
  });

  it('leaves ordinary analysis columns alone', () => {
    for (const name of ['market', 'purchase_intent', 'brand_awareness', 'wave', 'score']) {
      expect(classifyField(name, ['3']).sensitivity, name).toBe('NONE');
    }
  });
});

describe('sensitive-field detection by value', () => {
  it('catches identifying values in an innocuously named column', () => {
    // The case a name-only detector misses entirely.
    const v = classifyField('notes', [
      'ada@example.com',
      'bob@example.com',
      'carol@example.com',
      'dan@example.com',
    ]);
    expect(v.sensitivity).toBe('PII');
    expect(v.signal).toBe('value');
    expect(v.reason).toMatch(/whatever the column is called/i);
  });

  it('catches IP addresses and long digit strings', () => {
    expect(classifyField('source', ['192.168.1.1', '10.0.0.4', '172.16.0.9']).sensitivity).toBe('PII');
    expect(
      classifyField('ref', ['4111111111111111', '4012888888881881', '5555555555554444']).sensitivity,
    ).toBe('PII');
  });

  it('does not flag ordinary numbers as account numbers', () => {
    expect(classifyField('score', ['1', '2', '3', '4', '5']).sensitivity).toBe('NONE');
  });
});

describe('precedence', () => {
  it('prefers special category over personal data when both could match', () => {
    // "health" wins over any value-shape signal, because the stronger class governs.
    const v = classifyField('health_email_contact', ['a@b.com', 'c@d.com', 'e@f.com']);
    expect(v.sensitivity).toBe('SPECIAL_CATEGORY');
    expect(v.signal).toBe('name');
  });
});

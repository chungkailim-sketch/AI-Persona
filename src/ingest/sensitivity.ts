/**
 * Sensitive-field detection (DATA-09, DATA-10).
 *
 * Detection is by field name *and* by value shape, because either alone misses the common cases: a
 * column called `notes` holding email addresses, and a column called `ethnicity` holding codes.
 *
 * The important behaviour is not the detection but what follows it: anything flagged is **excluded
 * by default**. Including it is a deliberate act that requires a written justification, which is
 * then attached to the field and shown wherever that field is used. The default is the protection;
 * the detector only decides where the default applies.
 *
 * Detection is a floor, never a guarantee. The reviewer is told so, and is asked to confirm rather
 * than to rubber-stamp.
 */
export type SensitivityClass = 'NONE' | 'PII' | 'SPECIAL_CATEGORY';

export interface SensitivityVerdict {
  sensitivity: SensitivityClass;
  reason: string | null;
  /** Which signal fired, so the reviewer can judge whether it is a false positive. */
  signal: 'name' | 'value' | null;
}

const NAME_PII = [
  /\b(e[-_ ]?mail|email)\b/i,
  /\b(phone|mobile|tel|telephone|msisdn)\b/i,
  /\b(first|last|full|given|family|sur)[-_ ]?name\b/i,
  /^name$/i,
  /\b(address|street|postcode|post[-_ ]?code|zip|zipcode)\b/i,
  /\b(ip[-_ ]?address|device[-_ ]?id|advertising[-_ ]?id|imei|mac[-_ ]?address)\b/i,
  /\b(passport|national[-_ ]?id|nric|ssn|social[-_ ]?security|tax[-_ ]?id|licen[cs]e[-_ ]?no)\b/i,
  /\b(dob|date[-_ ]?of[-_ ]?birth|birth[-_ ]?date|birthday)\b/i,
  /\b(account[-_ ]?number|iban|card[-_ ]?number|bank)\b/i,
  /\b(latitude|longitude|geo[-_ ]?location|precise[-_ ]?location)\b/i,
];

const NAME_SPECIAL = [
  /\b(race|ethnic(ity)?|colour|color)\b/i,
  /\b(religio(n|us)|faith|denomination)\b/i,
  /\b(political|party[-_ ]?affiliation|vote[d]?[-_ ]?for)\b/i,
  /\b(union[-_ ]?member(ship)?|trade[-_ ]?union)\b/i,
  /\b(health|medical|diagnos(is|es)|condition|disabilit(y|ies)|illness|medication|therapy)\b/i,
  /\b(sexual[-_ ]?orientation|sexuality|gender[-_ ]?identity|trans(gender)?)\b/i,
  /\b(biometric|genetic|dna|fingerprint)\b/i,
  /\b(immigration|citizenship[-_ ]?status|visa[-_ ]?status|asylum)\b/i,
  /\b(criminal|conviction|offence|offense|arrest)\b/i,
];

/**
 * Normalise a field name before matching.
 *
 * `\b` does not match between `e` and `_`, because both are word characters — so `\bphone\b`
 * silently fails to match `phone_number`, which is how most real column names are written. Turning
 * separators into spaces first is what makes the word-boundary patterns mean what they read as.
 */
function normaliseName(name: string): string {
  return name.replace(/[_\-.]+/g, ' ').trim();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE = /^[+(]?\d[\d\s().-]{7,}\d$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const CARDISH = /^\d{13,19}$/;

function valueSignal(values: readonly string[]): { klass: SensitivityClass; what: string } | null {
  const sample = values.filter((v) => v.trim() !== '').slice(0, 200);
  if (sample.length === 0) return null;
  const share = (pred: (v: string) => boolean) =>
    sample.filter((v) => pred(v.trim())).length / sample.length;

  if (share((v) => EMAIL.test(v)) > 0.3) return { klass: 'PII', what: 'email addresses' };
  if (share((v) => IPV4.test(v)) > 0.3) return { klass: 'PII', what: 'IP addresses' };
  if (share((v) => PHONE.test(v)) > 0.3) return { klass: 'PII', what: 'telephone numbers' };
  if (share((v) => CARDISH.test(v)) > 0.3) {
    return { klass: 'PII', what: 'long digit strings that may be account or card numbers' };
  }
  return null;
}

export function classifyField(
  fieldName: string,
  values: readonly string[],
): SensitivityVerdict {
  const name = normaliseName(fieldName);

  for (const re of NAME_SPECIAL) {
    if (re.test(name)) {
      return {
        sensitivity: 'SPECIAL_CATEGORY',
        reason: `The field name matches a special-category topic (${re.source.replace(/\\b|\(|\)|\?|\||\[|\]/g, '').slice(0, 40)}…).`,
        signal: 'name',
      };
    }
  }
  for (const re of NAME_PII) {
    if (re.test(name)) {
      return {
        sensitivity: 'PII',
        reason: 'The field name indicates directly identifying information.',
        signal: 'name',
      };
    }
  }
  const v = valueSignal(values);
  if (v) {
    return {
      sensitivity: v.klass,
      reason: `The values look like ${v.what}, whatever the column is called.`,
      signal: 'value',
    };
  }
  return { sensitivity: 'NONE', reason: null, signal: null };
}

/**
 * Detection is not a guarantee, and the reviewer must be told that in the interface rather than in
 * a document nobody opens.
 */
export const DETECTION_CAVEAT =
  'Automatic detection catches common patterns only. It will miss identifying information in free ' +
  'text, coded values, and combinations of fields that identify someone together. Review every ' +
  'field yourself before confirming.';

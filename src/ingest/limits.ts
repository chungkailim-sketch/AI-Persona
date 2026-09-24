/**
 * Upload limits.
 *
 * These exist to bound work, not to be generous. A file that exceeds them is refused at the door
 * with a message that says which limit it hit, rather than being accepted and then failing halfway
 * through parsing with the user's time already spent.
 */
export const UPLOAD_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  /**
   * All files in one upload together. `next.config.ts` sets the server-action and proxy body limits
   * from this value; if the two disagree, a legitimate upload fails before it reaches the checks
   * that would explain why.
   */
  maxRequestBytes: 100 * 1024 * 1024,
  maxFilesPerVersion: 20,
  maxRows: 250_000,
  maxColumns: 2_000,
  maxCellChars: 32_000,
  /** Rows sampled for type inference and profiling; the full file is still counted. */
  profileSampleRows: 5_000,
} as const;

export const ACCEPTED_MIME = new Map<string, 'csv' | 'xlsx'>([
  ['text/csv', 'csv'],
  ['application/csv', 'csv'],
  ['text/plain', 'csv'],
  ['application/vnd.ms-excel', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
]);

export function kindFromName(name: string): 'csv' | 'xlsx' | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  return null;
}

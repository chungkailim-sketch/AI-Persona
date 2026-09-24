/** Parse the stream scope from a request URL. Ids are opaque; they are validated against the project later. */
import type { StreamScope } from './read';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function scopeFromUrl(projectId: string, url: URL): StreamScope | null {
  if (!ID.test(projectId)) return null;
  const pick = (k: string) => {
    const v = url.searchParams.get(k);
    if (v === null || v === '') return null;
    return ID.test(v) ? v : undefined;
  };
  const runId = pick('runId');
  const datasetVersionId = pick('datasetVersionId');
  const cohortId = pick('cohortId');
  if (runId === undefined || datasetVersionId === undefined || cohortId === undefined) return null;
  return { projectId, runId, datasetVersionId, cohortId };
}

export function cursorFrom(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

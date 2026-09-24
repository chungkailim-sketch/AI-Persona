/**
 * Client for the TimesFM sidecar (services/timesfm). Server-only; the URL and token never reach
 * the browser. Returns null rather than throwing when the service is absent, so the gate can
 * record "not reachable" instead of failing the analysis.
 */
export interface ModelForecast {
  model: string;
  point: number[][];
  q10: number[][];
  q90: number[][];
}

function config() {
  const url = process.env.TIMESFM_URL?.replace(/\/$/, '') || null;
  return { url, token: process.env.TIMESFM_TOKEN || null, approved: process.env.TIMESFM_APPROVED === 'true' };
}

export function timesfmConfigured(): boolean {
  return Boolean(config().url);
}

export function timesfmApproved(): boolean {
  return config().approved;
}

export async function timesfmHealthy(timeoutMs = 3000): Promise<boolean> {
  const { url } = config();
  if (!url) return false;
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

export async function timesfmForecast(inputs: number[][], horizon: number, timeoutMs = 120_000): Promise<ModelForecast | null> {
  const { url, token } = config();
  if (!url || inputs.length === 0) return null;
  try {
    const res = await fetch(`${url}/forecast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ inputs, horizon }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as ModelForecast;
  } catch {
    return null;
  }
}

// Outbound HTTP for the pipeline: per-source spacing, daily ceilings, timeouts,
// bounded retries, in-run cache and a log that is published with the site.

export const SOURCE_POLICIES: Record<string, { minIntervalMs: number; maxPerRun: number }> = {
  nse: { minIntervalMs: 400, maxPerRun: 2500 },
  bse: { minIntervalMs: 1000, maxPerRun: 20 },
  gdelt: { minIntervalMs: 5500, maxPerRun: 300 }, // GDELT asks for ≤ 1 request / 5 s
  fred: { minIntervalMs: 600, maxPerRun: 100 },
  worldbank: { minIntervalMs: 500, maxPerRun: 20 },
  imf: { minIntervalMs: 1000, maxPerRun: 10 },
  gemini: { minIntervalMs: 6500, maxPerRun: 120 },
  tejhq: { minIntervalMs: 1000, maxPerRun: 100 },
  sec: { minIntervalMs: 300, maxPerRun: 50 }, // SEC fair access: ≤ 10 requests/second
  gnews: { minIntervalMs: 1200, maxPerRun: 95 }, // free plan: 100 requests/day, 1 request/second
};

export class QuotaExceededError extends Error {
  name = "QuotaExceededError";
  constructor(public source: string) {
    super(`Per-run quota for ${source} reached`);
  }
}
export class HttpError extends Error {
  constructor(public status: number, public url: string) {
    super(`HTTP ${status}`);
  }
}

export interface LogEntry { source: string; url: string; status: number; ok: boolean; ms: number; message?: string; at: string }
export const httpLog: LogEntry[] = [];
export const usage: Record<string, number> = {};

const last = new Map<string, number>();
const cache = new Map<string, unknown>();
const redact = (u: string) => u.replace(/(api_key|apikey|key)=[^&]+/gi, "$1=***");

async function throttle(source: string) {
  const p = SOURCE_POLICIES[source];
  if (!p) return;
  if ((usage[source] ?? 0) >= p.maxPerRun) throw new QuotaExceededError(source);
  const wait = (last.get(source) ?? 0) + p.minIntervalMs - Date.now();
  last.set(source, Date.now() + Math.max(0, wait));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  usage[source] = (usage[source] ?? 0) + 1;
}

export interface FetchOpts {
  source: string;
  as?: "json" | "text" | "binary";
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
  timeoutMs?: number;
  retries?: number;
  cache?: boolean;
  cacheKey?: string;
  ttlSeconds?: number; // accepted for compatibility; the run cache lives for one run
}

export async function fetchSource<T = unknown>(url: string, o: FetchOpts): Promise<{ data: T; cached: boolean; retrievedAt: string }> {
  const key = o.cacheKey ?? `${o.method ?? "GET"} ${url} ${o.body ?? ""}`;
  if (o.cache !== false && cache.has(key)) return cache.get(key) as { data: T; cached: boolean; retrievedAt: string };
  const retries = o.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(o.source);
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 30_000);
    try {
      const res = await fetch(url, {
        method: o.method ?? "GET",
        body: o.body,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; StockPilotAI/1.0; personal research)", Accept: "*/*", ...o.headers },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const bodyText = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 300);
        httpLog.push({ source: o.source, url: redact(url), status: res.status, ok: false, ms: Date.now() - t0, message: `${res.statusText} ${bodyText}`.trim(), at: new Date().toISOString() });
        if (res.status === 429 || res.status >= 500) throw Object.assign(new HttpError(res.status, url), { message: `HTTP ${res.status} ${bodyText.slice(0, 160)}` });
        throw Object.assign(new HttpError(res.status, url), { fatal: true, message: `HTTP ${res.status} ${bodyText.slice(0, 160)}` });
      }
      const data = (o.as === "text" ? await res.text() : o.as === "binary" ? await res.arrayBuffer() : await res.json()) as T;
      httpLog.push({ source: o.source, url: redact(url), status: res.status, ok: true, ms: Date.now() - t0, at: new Date().toISOString() });
      const v = { data, cached: false, retrievedAt: new Date().toISOString() };
      if (o.cache !== false) cache.set(key, v);
      return v;
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal || e instanceof QuotaExceededError) break;
      if (!(e instanceof HttpError)) httpLog.push({ source: o.source, url: redact(url), status: 0, ok: false, ms: Date.now() - t0, message: String((e as Error).message), at: new Date().toISOString() });
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

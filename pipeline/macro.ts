import type { MacroIndicator } from "../src/lib/types";
import { env } from "./env";
import { fetchSource } from "./http";

// FRED (free API key), World Bank Open Data (no key), IMF DataMapper (no key).

export const FRED_SERIES: { id: string; name: string; unit: string; global?: boolean }[] = [
  { id: "SP500", name: "S&P 500", unit: "index", global: true },
  { id: "NASDAQCOM", name: "NASDAQ Composite", unit: "index", global: true },
  { id: "DJIA", name: "Dow Jones Industrial Average", unit: "index", global: true },
  { id: "DEXINUS", name: "INR per USD", unit: "₹/$" },
  { id: "DCOILBRENTEU", name: "Brent crude", unit: "$/bbl" },
  { id: "DGS10", name: "US 10-year Treasury yield", unit: "%" },
  { id: "DFF", name: "US Fed funds effective rate", unit: "%" },
  { id: "VIXCLS", name: "CBOE VIX", unit: "index" },
];

export async function fetchFred(): Promise<{ items: (MacroIndicator & { prev: number | null })[]; error?: string }> {
  if (!env.fredKey) return { items: FRED_SERIES.map((s) => ({ id: `FRED:${s.id}`, name: s.name, value: null, date: null, unit: s.unit, source: "FRED", sourceUrl: `https://fred.stlouisfed.org/series/${s.id}`, status: "unavailable" as const, prev: null })), error: "FRED_API_KEY not set (free key: fred.stlouisfed.org/docs/api/api_key.html)" };
  const items = await Promise.all(
    FRED_SERIES.map(async (s) => {
      const base = { id: `FRED:${s.id}`, name: s.name, unit: s.unit, source: "FRED, Federal Reserve Bank of St. Louis", sourceUrl: `https://fred.stlouisfed.org/series/${s.id}` };
      try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}&api_key=${env.fredKey}&file_type=json&sort_order=desc&limit=10`;
        const r = await fetchSource<{ observations: { date: string; value: string }[] }>(url, { source: "fred", ttlSeconds: 60 * 60 * 6, cacheKey: `fred:${s.id}` });
        const obs = r.data.observations.filter((o) => o.value !== ".");
        return { ...base, value: obs[0] ? Number(obs[0].value) : null, date: obs[0]?.date ?? null, prev: obs[1] ? Number(obs[1].value) : null, status: obs[0] ? ("ok" as const) : ("unavailable" as const) };
      } catch {
        return { ...base, value: null, date: null, prev: null, status: "error" as const };
      }
    }),
  );
  return { items };
}

const WB = [
  { id: "NY.GDP.MKTP.KD.ZG", name: "India GDP growth", unit: "% y/y" },
  { id: "FP.CPI.TOTL.ZG", name: "India CPI inflation", unit: "% y/y" },
];

export async function fetchWorldBank(): Promise<MacroIndicator[]> {
  return Promise.all(
    WB.map(async (w) => {
      const base = { id: `WB:${w.id}`, name: w.name, unit: w.unit, source: "World Bank Open Data", sourceUrl: `https://data.worldbank.org/indicator/${w.id}?locations=IN` };
      try {
        const r = await fetchSource<[unknown, { date: string; value: number | null }[]]>(`https://api.worldbank.org/v2/country/IND/indicator/${w.id}?format=json&per_page=8`, { source: "worldbank", ttlSeconds: 86400 * 3 });
        const o = (r.data[1] ?? []).find((x) => x.value != null);
        return { ...base, value: o?.value ?? null, date: o?.date ?? null, status: o ? ("ok" as const) : ("unavailable" as const) };
      } catch {
        return { ...base, value: null, date: null, status: "error" as const };
      }
    }),
  );
}

export async function fetchImf(): Promise<MacroIndicator[]> {
  const base = { id: "IMF:NGDP_RPCH:IND", name: "India real GDP growth (IMF WEO)", unit: "% y/y", source: "IMF DataMapper", sourceUrl: "https://www.imf.org/external/datamapper/NGDP_RPCH@WEO/IND" };
  try {
    const r = await fetchSource<{ values?: { NGDP_RPCH?: { IND?: Record<string, number> } } }>("https://www.imf.org/external/datamapper/api/v1/NGDP_RPCH/IND", { source: "imf", ttlSeconds: 86400 * 7 });
    const series = r.data.values?.NGDP_RPCH?.IND ?? {};
    const year = String(new Date().getUTCFullYear());
    const v = series[year];
    return [{ ...base, name: `${base.name}, ${year} (projection where applicable)`, value: v ?? null, date: v != null ? year : null, status: v != null ? "ok" : "unavailable" }];
  } catch {
    return [{ ...base, value: null, date: null, status: "error" }];
  }
}

// Official fundamentals for NIFTY 50 companies that also file Form 20-F with the US SEC
// (SEC EDGAR XBRL "company facts" API — free, documented, requires a contact User-Agent).

import type { Financials, FinancialsBundle } from "../src/lib/types";
import { fetchSource } from "./http";
import { dataPath, readJson, writeJson } from "./store";

// NSE symbol → SEC CIK (20-F filers)
export const SEC_FILERS: Record<string, { cik: string; adr: string }> = {
  INFY: { cik: "0001067491", adr: "INFY" },
  WIPRO: { cik: "0001123799", adr: "WIT" },
  HDFCBANK: { cik: "0001144967", adr: "HDB" },
  // ICICIBANK (CIK 0001103838) files 20-F without XBRL company facts on EDGAR — not available here.
  DRREDDY: { cik: "0001135951", adr: "RDY" },
};

type Unit = { end: string; val: number; fy: number; fp: string; form: string; filed: string; start?: string };
type Facts = { facts?: Record<string, Record<string, { units: Record<string, Unit[]> }>> };

/** Among all candidate tags/units, use the series with the most recent fiscal year (companies change tags over time). */
function annual(f: Facts, tags: string[]): { unit: string; byYear: Map<string, number> } | null {
  let best: { unit: string; byYear: Map<string, number> } | null = null;
  const latest = (m: Map<string, number>) => [...m.keys()].sort().at(-1) ?? "";
  for (const ns of ["ifrs-full", "us-gaap"]) {
    for (const t of tags) {
      const units = f.facts?.[ns]?.[t]?.units;
      if (!units) continue;
      for (const [unit, arr] of Object.entries(units)) {
        const m = new Map<string, number>();
        for (const o of arr.filter((x) => (x.form === "20-F" || x.form === "10-K") && x.fp === "FY").sort((a, b) => b.filed.localeCompare(a.filed))) {
          // duration facts: keep ~1-year periods only
          if (o.start && (new Date(o.end).getTime() - new Date(o.start).getTime()) / 86400000 < 300) continue;
          const fy = `FY${o.end.slice(0, 4)}`;
          if (!m.has(fy)) m.set(fy, o.val);
        }
        if (m.size && (!best || latest(m) > latest(best.byYear))) best = { unit, byYear: m };
      }
    }
  }
  return best;
}

export async function refreshSecFundamentals(symbol: string, log: (s: string) => void): Promise<boolean> {
  const f = SEC_FILERS[symbol];
  if (!f) return false;
  const file = dataPath("fundamentals", `${symbol}.json`);
  const cur = await readJson<FinancialsBundle | null>(file, null);
  if (cur && cur.source.startsWith("SEC EDGAR") && Date.now() - new Date(cur.retrievedAt).getTime() < 7 * 86400000) return false;
  const r = await fetchSource<Facts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${f.cik}.json`, { source: "sec", headers: { "User-Agent": process.env.SEC_USER_AGENT || "StockPilot personal research kundan4789@users.noreply.github.com", Accept: "application/json", "Accept-Encoding": "gzip, deflate" } });
  const rev = annual(r.data, ["Revenue", "RevenueFromContractsWithCustomers", "InterestRevenueCalculatedUsingEffectiveInterestMethod", "Revenues"]);
  const np = annual(r.data, ["ProfitLossAttributableToOwnersOfParent", "ProfitLoss", "NetIncomeLoss"]);
  const eps = annual(r.data, ["BasicEarningsLossPerShare", "EarningsPerShareBasic"]);
  const eq = annual(r.data, ["EquityAttributableToOwnersOfParent", "Equity", "StockholdersEquity"]);
  const ocf = annual(r.data, ["CashFlowsFromUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivities"]);
  const cash = annual(r.data, ["CashAndCashEquivalents", "CashAndCashEquivalentsAtCarryingValue"]);
  const op = annual(r.data, ["ProfitLossFromOperatingActivities", "OperatingIncomeLoss"]);
  if (!rev || !np) {
    log(`${symbol}: SEC facts lack revenue/profit tags`);
    return false;
  }
  const currency = rev.unit; // e.g. INR or USD
  const years = [...rev.byYear.keys()].sort().reverse().slice(0, 5);
  const crore = (x: number | undefined) => (x == null ? null : currency === "INR" ? x / 1e7 : x / 1e6); // INR → ₹ crore, USD → $ million
  const annualRows: Financials[] = years.map((y) => {
    const n = np.byYear.get(y);
    const e = eq?.byYear.get(y);
    const epsV = eps?.unit.startsWith(currency) ? eps.byYear.get(y) : undefined;
    return {
      period: y, revenue: crore(rev.byYear.get(y)), ebitda: null, operatingProfit: crore(op?.byYear.get(y)), netProfit: crore(n),
      eps: epsV ?? null, roe: n != null && e ? (n / e) * 100 : null, roce: null, debtToEquity: null,
      operatingCashFlow: crore(ocf?.byYear.get(y)), freeCashFlow: null, cash: crore(cash?.byYear.get(y)), dividendYield: null,
      pe: null, pb: null, marketCap: null,
    };
  });
  // P/E from NSE price needs EPS in INR per equity share; only INR filers qualify.
  if (currency !== "INR") for (const a of annualRows) a.eps = null;
  const bundle: FinancialsBundle & { citations: { uri: string; title?: string }[] } = {
    source: `SEC EDGAR Form 20-F (${f.adr} ADR filer, IFRS, consolidated)`,
    sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}&type=20-F`,
    retrievedAt: r.retrievedAt,
    reportingPeriod: annualRows[0]?.period,
    status: "ok",
    quality: "high",
    note: `Official annual figures from the company's SEC filings (fiscal years ending ${years[0]?.slice(2)}). Amounts in ${currency === "INR" ? "₹ crore" : `${currency} million`}${currency !== "INR" ? "; EPS-based P/E not computed because filings are not in INR" : ""}.`,
    currency: currency === "INR" ? "INR (₹ crore)" : `${currency} (million)`,
    annual: annualRows,
    quarterly: [],
    industryPe: null,
    citations: [{ uri: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${f.cik}&type=20-F`, title: "SEC EDGAR 20-F filings" }],
  };
  await writeJson(file, bundle);
  log(`${symbol}: SEC 20-F fundamentals ${years.join("/")} (${currency})`);
  return true;
}

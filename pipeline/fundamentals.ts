import type { Financials, FinancialsBundle, ShareholdingBundle } from "../src/lib/types";
import { env } from "./env";
import { col, num, parseCsv, safeUrl, sanitizeText } from "../src/lib/util/parse";

// Indian company fundamentals.
//
// There is no free, documented, licence-clear JSON API for NSE/BSE company
// financials and shareholding. StockPilot therefore supports:
//   1. CSV import (Settings → Data import) of figures you have the right to use,
//      e.g. from company annual reports / exchange XBRL filings you downloaded.
//   2. A TejHQ adapter slot. TejHQ's endpoints and terms could not be verified
//      when this was built, so the adapter refuses to run until it is mapped to
//      the documented response format (see README → "TejHQ").
// Missing fundamentals are reported as unavailable; they are never estimated.

export function tejhqStatus(): { configured: boolean; note: string } {
  if (!env.tejhqKey || !env.tejhqBaseUrl) return { configured: false, note: "TejHQ not configured (TEJHQ_API_KEY / TEJHQ_BASE_URL)." };
  return { configured: false, note: "TejHQ credentials present, but the response mapping has not been implemented against their documented schema yet — see README." };
}

export const FINANCIALS_CSV_HEADER = "symbol,period_type,period,revenue,ebitda,operating_profit,net_profit,eps,roe,roce,debt_to_equity,operating_cash_flow,free_cash_flow,cash,dividend_yield,pe,pb,market_cap,industry_pe,currency,source,source_url";
export const SHAREHOLDING_CSV_HEADER = "symbol,period,promoter,fii,dii,mutual_funds,promoter_pledged,source,source_url";

export function parseFinancialsCsv(text: string): { bySymbol: Record<string, FinancialsBundle>; errors: string[] } {
  const errors: string[] = [];
  const by: Record<string, FinancialsBundle> = {};
  parseCsv(text).forEach((r, i) => {
    const symbol = (col(r, "SYMBOL") ?? "").toUpperCase();
    const type = (col(r, "PERIOD_TYPE") ?? "").toLowerCase();
    const period = col(r, "PERIOD");
    const source = sanitizeText(col(r, "SOURCE"), 200);
    if (!symbol || !period || !["annual", "quarterly"].includes(type)) return errors.push(`row ${i + 2}: symbol, period and period_type (annual|quarterly) are required`);
    if (!source) return errors.push(`row ${i + 2}: source is required (where did this figure come from?)`);
    const f: Financials = {
      period, revenue: num(col(r, "REVENUE")), ebitda: num(col(r, "EBITDA")), operatingProfit: num(col(r, "OPERATING_PROFIT")), netProfit: num(col(r, "NET_PROFIT")), eps: num(col(r, "EPS")),
      roe: num(col(r, "ROE")), roce: num(col(r, "ROCE")), debtToEquity: num(col(r, "DEBT_TO_EQUITY")), operatingCashFlow: num(col(r, "OPERATING_CASH_FLOW")), freeCashFlow: num(col(r, "FREE_CASH_FLOW")),
      cash: num(col(r, "CASH")), dividendYield: num(col(r, "DIVIDEND_YIELD")), pe: num(col(r, "PE")), pb: num(col(r, "PB")), marketCap: num(col(r, "MARKET_CAP")),
    };
    const b = (by[symbol] ??= { source, sourceUrl: safeUrl(col(r, "SOURCE_URL")) ?? undefined, retrievedAt: new Date().toISOString(), status: "ok", quality: "medium", currency: col(r, "CURRENCY") ?? "INR", annual: [], quarterly: [], industryPe: null });
    (type === "annual" ? b.annual : b.quarterly).push(f);
    const ipe = num(col(r, "INDUSTRY_PE"));
    if (ipe != null) b.industryPe = ipe;
  });
  for (const b of Object.values(by)) {
    b.annual.sort((x, y) => y.period.localeCompare(x.period));
    b.quarterly.sort((x, y) => y.period.localeCompare(x.period));
    b.reportingPeriod = b.annual[0]?.period ?? b.quarterly[0]?.period;
  }
  return { bySymbol: by, errors };
}

export function parseShareholdingCsv(text: string): { bySymbol: Record<string, ShareholdingBundle>; errors: string[] } {
  const errors: string[] = [];
  const by: Record<string, ShareholdingBundle> = {};
  parseCsv(text).forEach((r, i) => {
    const symbol = (col(r, "SYMBOL") ?? "").toUpperCase();
    const period = col(r, "PERIOD");
    const source = sanitizeText(col(r, "SOURCE"), 200);
    if (!symbol || !period || !source) return errors.push(`row ${i + 2}: symbol, period and source are required`);
    const b = (by[symbol] ??= { source, sourceUrl: safeUrl(col(r, "SOURCE_URL")) ?? undefined, retrievedAt: new Date().toISOString(), status: "ok", quality: "medium", history: [] });
    b.history.push({ period, promoter: num(col(r, "PROMOTER")), fii: num(col(r, "FII")), dii: num(col(r, "DII")), mutualFunds: num(col(r, "MUTUAL_FUNDS")), promoterPledged: num(col(r, "PROMOTER_PLEDGED")) });
  });
  for (const b of Object.values(by)) b.history.sort((x, y) => y.period.localeCompare(x.period));
  return { bySymbol: by, errors };
}

/** Sector → NSE sectoral index whose published P/E is used as the industry benchmark. */
export const SECTOR_INDEX: Record<string, string> = {
  "Information Technology": "NIFTY IT",
  "Financial Services": "NIFTY FINANCIAL SERVICES",
  "Oil Gas & Consumable Fuels": "NIFTY OIL & GAS",
  "Fast Moving Consumer Goods": "NIFTY FMCG",
  "Automobile and Auto Components": "NIFTY AUTO",
  Healthcare: "NIFTY HEALTHCARE INDEX",
  "Metals & Mining": "NIFTY METAL",
  Power: "NIFTY ENERGY",
  Realty: "NIFTY REALTY",
  "Media Entertainment & Publication": "NIFTY MEDIA",
  "Consumer Durables": "NIFTY CONSUMER DURABLES",
  Chemicals: "NIFTY CHEMICALS",
};

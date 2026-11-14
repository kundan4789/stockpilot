// Shared domain types for StockPilot AI.
// Every externally sourced value carries provenance (DataPoint) so the UI and the
// AI layer can always show where a number came from and how fresh it is.

export type DataStatus = "ok" | "stale" | "partial" | "unavailable" | "error";
export type DataQuality = "high" | "medium" | "low" | "unknown";

export interface Provenance {
  source: string; // human-readable source name, e.g. "NSE sec_bhavdata_full"
  sourceUrl?: string; // original URL when one exists
  retrievedAt: string; // ISO timestamp of retrieval
  reportingPeriod?: string; // e.g. "2026-11-13" or "FY2026 Q2"
  status: DataStatus;
  quality: DataQuality;
  note?: string;
}

export interface DataPoint<T> extends Provenance {
  value: T | null; // null = not available; never fabricated
}

export type Exchange = "NSE" | "BSE" | "NASDAQ" | "NYSE" | "OTHER";

export interface StockMaster {
  symbol: string; // canonical symbol e.g. RELIANCE
  exchange: Exchange;
  name: string;
  isin?: string;
  bseCode?: string;
  sector?: string;
  industry?: string;
  indices?: string[];
  cik?: string; // SEC CIK for US listings
}

export interface Candle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  deliveryQty?: number | null;
  deliveryPct?: number | null;
}

export interface PriceSeries extends Provenance {
  symbol: string;
  candles: Candle[]; // ascending by date
  adjusted: boolean; // corporate-action adjusted?
}

export interface Financials {
  period: string;
  revenue: number | null;
  ebitda: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
  eps: number | null;
  roe: number | null; // %
  roce: number | null; // %
  debtToEquity: number | null;
  freeCashFlow: number | null;
  operatingCashFlow: number | null;
  cash: number | null;
  dividendYield: number | null; // %
  pe: number | null;
  pb: number | null;
  marketCap?: number | null; // in reporting currency
}

export interface FinancialsBundle extends Provenance {
  currency: string;
  annual: Financials[]; // newest first
  quarterly: Financials[]; // newest first
  industryPe?: number | null;
}

export interface Shareholding {
  period: string;
  promoter: number | null;
  fii: number | null;
  dii: number | null;
  mutualFunds: number | null;
  promoterPledged: number | null;
}

export interface ShareholdingBundle extends Provenance {
  history: Shareholding[]; // newest first
}

export type EventType =
  | "results"
  | "annual_report"
  | "board_meeting"
  | "dividend"
  | "buyback"
  | "merger"
  | "acquisition"
  | "announcement"
  | "filing";

export interface CorporateEvent {
  type: EventType;
  title: string;
  date: string;
  url?: string;
  source: string;
}

export type Sentiment = "positive" | "negative" | "neutral";
export type Impact = "high" | "medium" | "low" | "none";

export interface NewsItem {
  headline: string;
  publisher: string;
  url: string;
  publishedAt: string;
  retrievedAt: string;
  company: string;
  sentiment: Sentiment;
  sentimentScore: number; // -1..1
  relevance: number; // 0..1
  impact: Impact;
  category: string; // e.g. "company", "commodity", "policy", "macro", "competitor"
  evidence: string; // why we think it relates
}

export interface MacroIndicator {
  id: string;
  name: string;
  value: number | null;
  date: string | null;
  unit: string;
  source: string;
  sourceUrl: string;
  status: DataStatus;
}

export type Verdict = "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL" | "INSUFFICIENT DATA";
export type Horizon = "short" | "swing" | "medium" | "long";

export interface ComponentScore {
  key: "fundamentals" | "technical" | "valuation" | "institutional" | "global" | "risk";
  label: string;
  score: number | null; // 0..100, null when not computable
  weight: number; // 0..1
  coverage: number; // 0..1 share of inputs that were available
  explanation: string[];
}

export interface PriceLevels {
  horizon: Horizon;
  label: string;
  timeframe: string;
  actionable: boolean;
  reasonIfNot?: string;
  lastPrice: number | null;
  lastPriceDate: string | null;
  entryLow: number | null;
  entryHigh: number | null;
  target: number | null;
  stopLoss: number | null;
  upsidePct: number | null;
  downsidePct: number | null;
  riskReward: number | null;
  method: string[]; // transparent derivation steps
}

export interface HorizonRecommendation {
  horizon: Horizon;
  verdict: Verdict;
  score: number | null;
  levels: PriceLevels;
  confidence: number; // 0..100 evidence completeness, NOT profit probability
}

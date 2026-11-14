// Shape of a saved research report (shared by server and client).
import type { Narrative } from "./ai/narrative";
import type { FundamentalResult } from "./analysis/fundamental";
import type { TechnicalSnapshot } from "./analysis/technical";
import type { Candle, ComponentScore, CorporateEvent, FinancialsBundle, HorizonRecommendation, MacroIndicator, NewsItem, ShareholdingBundle, StockMaster } from "./types";

export interface StepStatus {
  step: string;
  status: "ok" | "partial" | "unavailable" | "error";
  detail: string;
  source?: string;
  ms?: number;
}

export interface PeerRow {
  symbol: string;
  name: string;
  close: number | null;
  return3m: number | null;
  return1y: number | null;
  technicalScore: number | null;
  roe: number | null;
  netMargin: number | null;
  pe: number | null;
}

export interface SourceRef {
  id: string;
  label: string;
  url?: string;
  retrievedAt?: string;
  period?: string;
}

export interface ResearchReport {
  version: 1;
  generatedAt: string;
  company: StockMaster;
  steps: StepStatus[];
  price: { lastClose: number | null; lastDate: string | null; changePct: number | null; status: string; source: string; sourceUrl?: string; bars: number; adjusted: boolean; adjustmentNote: string };
  candles: Candle[]; // up to 5Y daily, for charts
  technical: TechnicalSnapshot;
  fundamentals: { bundle: FinancialsBundle | null; result: FundamentalResult; valuation: FundamentalResult; derivedPe: { value: number | null; note: string } | null; industryPe: { value: number | null; source: string } | null };
  institutional: { bundle: ShareholdingBundle | null; result: FundamentalResult };
  events: CorporateEvent[];
  news: NewsItem[];
  macro: MacroIndicator[];
  peers: PeerRow[];
  components: ComponentScore[];
  recommendations: HorizonRecommendation[];
  researchScore: number | null;
  confidence: number;
  confidenceNotes: string[];
  weights: Record<string, number>;
  catalysts: { positive: string[]; negative: string[] };
  risks: string[];
  narrative: Narrative;
  narrativeSource: string; // "Google Gemini (...)" | "deterministic template"
  narrativeValidation: string[];
  sources: SourceRef[];
  disclaimer: string;
  fo?: import("../../pipeline/fo").FoAnalysis | null;
  history?: { date: string; close: number | null; score: number | null; confidence: number; verdicts: Record<string, string> }[];
}

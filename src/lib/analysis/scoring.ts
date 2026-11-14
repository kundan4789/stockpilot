// Configurable weighted research-score model and verdict mapping.

import type { ComponentScore, Horizon, NewsItem, Verdict } from "../types";
import type { TechnicalSnapshot } from "./technical";

export interface ScoringWeights {
  fundamentals: number;
  technical: number;
  valuation: number;
  institutional: number;
  global: number;
  risk: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  fundamentals: 0.3,
  technical: 0.25,
  valuation: 0.15,
  institutional: 0.1,
  global: 0.1,
  risk: 0.1,
};

/** Horizon tilt multipliers applied to the base weights, then renormalised. */
export const HORIZON_TILT: Record<Horizon, Partial<Record<keyof ScoringWeights, number>>> = {
  short: { technical: 2.2, fundamentals: 0.3, valuation: 0.3, global: 1.3 },
  swing: { technical: 1.6, fundamentals: 0.6, valuation: 0.6 },
  medium: {},
  long: { fundamentals: 1.5, valuation: 1.3, technical: 0.4, institutional: 1.2 },
};

export const THRESHOLDS = { strongBuy: 75, buy: 60, hold: 45, sell: 30 };

export function verdictFor(score: number | null, confidence: number): Verdict {
  if (score == null || confidence < 40) return "INSUFFICIENT DATA";
  if (score >= THRESHOLDS.strongBuy) return "STRONG BUY";
  if (score >= THRESHOLDS.buy) return "BUY";
  if (score >= THRESHOLDS.hold) return "HOLD";
  if (score >= THRESHOLDS.sell) return "SELL";
  return "STRONG SELL";
}

export function globalScore(news: NewsItem[]): { score: number | null; coverage: number; explanation: string[] } {
  const rel = news.filter((n) => n.relevance >= 0.3 && n.impact !== "none");
  if (rel.length < 3) return { score: null, coverage: rel.length / 3, explanation: [`Only ${rel.length} relevant news items (≥3 needed); global score not computed.`] };
  const iw = { high: 3, medium: 2, low: 1, none: 0 } as const;
  let num = 0, den = 0;
  for (const n of rel) {
    const w = n.relevance * iw[n.impact];
    num += n.sentimentScore * w;
    den += w;
  }
  const avg = den ? num / den : 0; // -1..1
  const score = Math.round((avg + 1) * 50);
  return {
    score,
    coverage: 1,
    explanation: [
      `Relevance- and impact-weighted average sentiment of ${rel.length} items = ${avg.toFixed(2)} on a −1..+1 scale, mapped to 0–100.`,
      `${rel.filter((n) => n.sentiment === "positive").length} positive, ${rel.filter((n) => n.sentiment === "negative").length} negative, ${rel.filter((n) => n.sentiment === "neutral").length} neutral.`,
    ],
  };
}

export function riskScore(t: TechnicalSnapshot, debtToEquity: number | null, pledge: number | null, news: NewsItem[]) {
  const parts: { s: number; why: string }[] = [];
  if (t.atrPct != null) parts.push({ s: Math.max(0, 100 - (t.atrPct / 6) * 100), why: `volatility: ATR ${t.atrPct.toFixed(2)}% of price (0% → 100, ≥6% → 0)` });
  if (t.close != null && t.high52w != null) {
    const dd = ((t.high52w - t.close) / t.high52w) * 100;
    parts.push({ s: Math.max(0, 100 - (dd / 40) * 100), why: `drawdown from 52-week high ${dd.toFixed(1)}% (0% → 100, ≥40% → 0)` });
  }
  if (debtToEquity != null) parts.push({ s: Math.max(0, 100 - (debtToEquity / 2) * 100), why: `leverage: D/E ${debtToEquity.toFixed(2)}` });
  if (pledge != null) parts.push({ s: Math.max(0, 100 - (pledge / 30) * 100), why: `promoter pledge ${pledge.toFixed(1)}%` });
  const negHigh = news.filter((n) => n.sentiment === "negative" && n.impact === "high").length;
  parts.push({ s: Math.max(0, 100 - negHigh * 25), why: `${negHigh} high-impact negative news items (−25 each)` });
  if (parts.length < 2) return { score: null, coverage: parts.length / 5, explanation: ["Too few risk inputs available."] };
  const score = Math.round(parts.reduce((a, p) => a + p.s, 0) / parts.length);
  return { score, coverage: parts.length / 5, explanation: [`Average of ${parts.length} risk factors (higher = lower risk):`, ...parts.map((p) => `${p.s.toFixed(0)} — ${p.why}`)] };
}

export function combineScores(components: ComponentScore[], horizon: Horizon, base: ScoringWeights = DEFAULT_WEIGHTS) {
  const tilt = HORIZON_TILT[horizon];
  const weighted = components.map((c) => ({ ...c, weight: base[c.key] * (tilt[c.key] ?? 1) }));
  const total = weighted.reduce((a, c) => a + c.weight, 0);
  const avail = weighted.filter((c) => c.score != null);
  const availW = avail.reduce((a, c) => a + c.weight, 0);
  const coverage = total ? avail.reduce((a, c) => a + c.weight * c.coverage, 0) / total : 0;
  // Technical inputs are mandatory: without a price history no horizon is assessable.
  const hasTech = avail.some((c) => c.key === "technical");
  const score = hasTech && availW / total >= 0.5 ? Math.round(avail.reduce((a, c) => a + (c.score as number) * c.weight, 0) / availW) : null;
  return {
    score,
    coverage,
    weights: Object.fromEntries(weighted.map((c) => [c.key, c.weight / total])) as Record<string, number>,
  };
}

/**
 * Research confidence = completeness & reliability of evidence (0..100).
 * It is NOT a probability of profit.
 */
export function confidenceScore(coverage: number, priceAgeDays: number | null, aiAvailable: boolean) {
  let c = coverage * 100;
  const notes = [`Evidence coverage ${(coverage * 100).toFixed(0)}% of weighted inputs.`];
  if (priceAgeDays == null) {
    c *= 0.3;
    notes.push("No price data: ×0.3.");
  } else if (priceAgeDays > 5) {
    c *= 0.6;
    notes.push(`Price data ${priceAgeDays} days old: ×0.6.`);
  }
  if (!aiAvailable) notes.push("AI narrative unavailable (does not affect numeric confidence).");
  return { confidence: Math.round(Math.max(0, Math.min(100, c))), notes };
}

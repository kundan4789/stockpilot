// Turns raw indicators into a technical snapshot, rule-based signals and a 0..100
// technical score. Every signal states the rule that produced it.

import type { Candle } from "../types";
import { adx, atr, bollinger, ema, lastOf, macd, rsi, sma, supportResistance, type Level } from "./indicators";

export type Trend = "bullish" | "bearish" | "sideways";

export interface TechnicalSnapshot {
  asOf: string | null;
  bars: number;
  close: number | null;
  sma20: number | null;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  atr14: number | null;
  atrPct: number | null;
  adx14: number | null;
  volAvg20: number | null;
  volAvg50: number | null;
  lastVolume: number | null;
  avgDeliveryPct20: number | null;
  high52w: number | null;
  low52w: number | null;
  return1m: number | null;
  return3m: number | null;
  return1y: number | null;
  supports: Level[];
  resistances: Level[];
  trend: Trend | null;
  trendStrength: "strong" | "moderate" | "weak" | null;
  momentum: "strong" | "moderate" | "weak" | null;
  condition: "overbought" | "oversold" | "neutral" | null;
  potentialBreakout: boolean;
  potentialBreakdown: boolean;
  signals: string[];
  score: number | null;
  scoreExplanation: string[];
}

export const MIN_BARS_FOR_ANALYSIS = 50;

const pctChange = (closes: number[], back: number) =>
  closes.length > back ? ((closes[closes.length - 1] / closes[closes.length - 1 - back]) - 1) * 100 : null;

export function analyzeTechnicals(candles: Candle[]): TechnicalSnapshot {
  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume);
  const n = candles.length;
  const base: TechnicalSnapshot = {
    asOf: n ? candles[n - 1].date : null,
    bars: n,
    close: n ? closes[n - 1] : null,
    sma20: null, sma50: null, sma100: null, sma200: null, ema20: null, ema50: null,
    rsi14: null, macd: null, macdSignal: null, macdHist: null,
    bbUpper: null, bbMiddle: null, bbLower: null, atr14: null, atrPct: null, adx14: null,
    volAvg20: null, volAvg50: null, lastVolume: n ? vols[n - 1] : null, avgDeliveryPct20: null,
    high52w: null, low52w: null, return1m: null, return3m: null, return1y: null,
    supports: [], resistances: [],
    trend: null, trendStrength: null, momentum: null, condition: null,
    potentialBreakout: false, potentialBreakdown: false,
    signals: [], score: null, scoreExplanation: [],
  };
  if (n < MIN_BARS_FOR_ANALYSIS) {
    base.scoreExplanation.push(`Only ${n} daily bars available; at least ${MIN_BARS_FOR_ANALYSIS} are needed for technical analysis.`);
    return base;
  }

  const s = base;
  s.sma20 = lastOf(sma(closes, 20));
  s.sma50 = lastOf(sma(closes, 50));
  s.sma100 = n >= 100 ? lastOf(sma(closes, 100)) : null;
  s.sma200 = n >= 200 ? lastOf(sma(closes, 200)) : null;
  s.ema20 = lastOf(ema(closes, 20));
  s.ema50 = lastOf(ema(closes, 50));
  s.rsi14 = lastOf(rsi(closes, 14));
  const m = macd(closes);
  s.macd = lastOf(m.line);
  s.macdSignal = lastOf(m.signal);
  s.macdHist = lastOf(m.histogram);
  const bb = bollinger(closes);
  s.bbUpper = lastOf(bb.upper);
  s.bbMiddle = lastOf(bb.middle);
  s.bbLower = lastOf(bb.lower);
  s.atr14 = lastOf(atr(candles, 14));
  s.atrPct = s.atr14 && s.close ? (s.atr14 / s.close) * 100 : null;
  s.adx14 = lastOf(adx(candles, 14).adx);
  s.volAvg20 = lastOf(sma(vols, 20));
  s.volAvg50 = lastOf(sma(vols, 50));
  const del = candles.slice(-20).map((c) => c.deliveryPct).filter((x): x is number => x != null);
  s.avgDeliveryPct20 = del.length >= 10 ? del.reduce((a, b) => a + b, 0) / del.length : null;
  const yr = candles.slice(-252);
  s.high52w = Math.max(...yr.map((c) => c.high));
  s.low52w = Math.min(...yr.map((c) => c.low));
  s.return1m = pctChange(closes, 21);
  s.return3m = pctChange(closes, 63);
  s.return1y = pctChange(closes, 252);
  const sr = supportResistance(candles);
  s.supports = sr.supports.slice(0, 3);
  s.resistances = sr.resistances.slice(0, 3);

  const close = s.close as number;
  const expl: string[] = [];
  let pts = 0;
  let max = 0;
  const rule = (weight: number, cond: boolean | null, yes: string, no: string) => {
    if (cond == null) return;
    max += weight;
    if (cond) {
      pts += weight;
      expl.push(`+${weight}: ${yes}`);
    } else expl.push(`+0/${weight}: ${no}`);
  };

  // Trend structure (40 pts)
  rule(10, s.sma20 != null ? close > s.sma20 : null, "close above SMA20", "close below SMA20");
  rule(10, close > (s.sma50 as number), "close above SMA50", "close below SMA50");
  rule(10, s.sma200 != null ? close > s.sma200 : null, "close above SMA200 (long-term uptrend)", "close below SMA200");
  rule(10, s.sma200 != null ? (s.sma50 as number) > s.sma200 : null, "SMA50 above SMA200 (golden-cross regime)", "SMA50 below SMA200");
  // Momentum (35 pts)
  rule(10, s.macdHist != null ? s.macdHist > 0 : null, "MACD above its signal line", "MACD below its signal line");
  rule(10, s.rsi14 != null ? s.rsi14 >= 45 && s.rsi14 <= 70 : null, "RSI in healthy 45–70 band", `RSI ${s.rsi14?.toFixed(1)} outside 45–70`);
  rule(15, s.return3m != null ? s.return3m > 0 : null, "positive 3-month return", "negative 3-month return");
  // Participation (10 pts)
  rule(10, s.volAvg20 != null && s.volAvg50 != null ? s.volAvg20 >= s.volAvg50 : null, "20-day avg volume ≥ 50-day avg", "volume participation fading");
  // Volatility sanity (15 pts)
  rule(15, s.atrPct != null ? s.atrPct < 4 : null, `ATR ${s.atrPct?.toFixed(2)}% of price (contained volatility)`, `ATR ${s.atrPct?.toFixed(2)}% of price (high volatility)`);

  s.score = max > 0 ? Math.round((pts / max) * 100) : null;
  s.scoreExplanation = [`Technical score = ${pts}/${max} rule points, scaled to 100.`, ...expl];

  // Classification
  const above50 = close > (s.sma50 as number);
  const slope50 = (() => {
    const s50 = sma(closes, 50);
    const a = s50[n - 1], b = s50[n - 11];
    return a != null && b != null ? ((a - b) / b) * 100 : 0;
  })();
  if (above50 && slope50 > 0.5 && (s.macdHist ?? 0) > 0) s.trend = "bullish";
  else if (!above50 && slope50 < -0.5 && (s.macdHist ?? 0) < 0) s.trend = "bearish";
  else s.trend = "sideways";
  s.trendStrength = s.adx14 == null ? null : s.adx14 >= 25 ? "strong" : s.adx14 >= 18 ? "moderate" : "weak";
  const mom = Math.abs(s.return1m ?? 0);
  s.momentum = mom >= 8 ? "strong" : mom >= 3 ? "moderate" : "weak";
  s.condition = s.rsi14 == null ? null : s.rsi14 >= 70 ? "overbought" : s.rsi14 <= 30 ? "oversold" : "neutral";

  const nearestRes = s.resistances[0]?.price;
  const nearestSup = s.supports[0]?.price;
  const volSurge = s.lastVolume != null && s.volAvg20 != null && s.lastVolume > 1.5 * s.volAvg20;
  s.potentialBreakout = !!(nearestRes && (nearestRes - close) / close < 0.02 && s.trend !== "bearish") || !!(close >= (s.high52w as number) * 0.98 && volSurge);
  s.potentialBreakdown = !!(nearestSup && (close - nearestSup) / close < 0.02 && s.trend !== "bullish") || !!(close <= (s.low52w as number) * 1.02 && volSurge);

  const sig: string[] = [];
  sig.push(`Trend: ${s.trend} (close vs SMA50, 10-day SMA50 slope ${slope50.toFixed(2)}%, MACD histogram sign).`);
  if (s.trendStrength) sig.push(`Trend strength: ${s.trendStrength} (ADX14 = ${s.adx14!.toFixed(1)}; ≥25 strong, 18–25 moderate).`);
  if (s.condition && s.condition !== "neutral") sig.push(`RSI14 = ${s.rsi14!.toFixed(1)} → ${s.condition}.`);
  if (s.potentialBreakout) sig.push("Potential breakout: price within 2% of nearest resistance or near 52-week high on above-average volume.");
  if (s.potentialBreakdown) sig.push("Potential breakdown: price within 2% of nearest support or near 52-week low on above-average volume.");
  if (s.bbUpper != null && close > s.bbUpper) sig.push("Close above upper Bollinger Band (stretched).");
  if (s.bbLower != null && close < s.bbLower) sig.push("Close below lower Bollinger Band (stretched).");
  if (volSurge) sig.push("Last session volume > 1.5× 20-day average.");
  s.signals = sig;
  return s;
}

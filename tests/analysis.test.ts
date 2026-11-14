import { describe, expect, it } from "vitest";
import { atr, ema, macd, rsi, sma, supportResistance } from "@/lib/analysis/indicators";
import { analyzeTechnicals } from "@/lib/analysis/technical";
import { computeLevels } from "@/lib/analysis/levels";
import { cagr, scoreFundamentals } from "@/lib/analysis/fundamental";
import { combineScores, confidenceScore, verdictFor } from "@/lib/analysis/scoring";
import type { Candle, ComponentScore, FinancialsBundle } from "@/lib/types";

function synthCandles(n: number, start = 100, drift = 0.001, endDate = "2026-11-13"): Candle[] {
  // Deterministic pseudo-random walk (LCG) — test fixture only, never shown in the app.
  let seed = 42;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
  const out: Candle[] = [];
  let p = start;
  const end = new Date(endDate + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const d = new Date(end.getTime() - (n - 1 - i) * 86_400_000);
    const o = p;
    p = p * (1 + drift + (rnd() - 0.5) * 0.03);
    const hi = Math.max(o, p) * (1 + rnd() * 0.01);
    const lo = Math.min(o, p) * (1 - rnd() * 0.01);
    out.push({ date: d.toISOString().slice(0, 10), open: o, high: hi, low: lo, close: p, volume: 1e6 + rnd() * 5e5, deliveryPct: 40 + rnd() * 20 });
  }
  return out;
}

describe("indicators", () => {
  it("SMA matches hand calculation", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
  it("EMA seeds with SMA and converges", () => {
    const e = ema([1, 2, 3, 4, 5, 6], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
  });
  it("RSI is 100 for monotonic gains and ~0 for losses", () => {
    const up = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(rsi(up)[29]).toBe(100);
    const down = up.slice().reverse();
    expect(rsi(down)[29]).toBeCloseTo(0);
  });
  it("RSI matches Wilder reference value", () => {
    // Classic Wilder example series (closing prices); textbook RSI ≈ 70.5 at index 14 (inputs rounded to 2 dp)
    const px = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    expect(rsi(px, 14)[14]).toBeCloseTo(70.5, 0);
  });
  it("MACD histogram = line − signal", () => {
    const c = synthCandles(120).map((x) => x.close);
    const m = macd(c);
    const i = 119;
    expect(m.histogram[i]).toBeCloseTo((m.line[i] as number) - (m.signal[i] as number));
  });
  it("ATR is positive", () => {
    const a = atr(synthCandles(60));
    expect(a[59]).toBeGreaterThan(0);
  });
  it("support below and resistance above last close", () => {
    const c = synthCandles(300);
    const last = c[c.length - 1].close;
    const sr = supportResistance(c);
    sr.supports.forEach((s) => expect(s.price).toBeLessThan(last));
    sr.resistances.forEach((r) => expect(r.price).toBeGreaterThan(last));
  });
});

describe("technical analysis", () => {
  it("refuses with too little data", () => {
    const t = analyzeTechnicals(synthCandles(20));
    expect(t.score).toBeNull();
    expect(t.trend).toBeNull();
  });
  it("classifies a steady uptrend as bullish", () => {
    const t = analyzeTechnicals(synthCandles(300, 100, 0.004));
    expect(t.trend).toBe("bullish");
    expect(t.score).toBeGreaterThan(50);
  });
});

describe("price levels", () => {
  const now = new Date("2026-11-14T10:00:00Z");
  it("produces ordered, validated levels", () => {
    const c = synthCandles(600, 100, 0.001);
    const t = analyzeTechnicals(c);
    for (const h of ["short", "swing", "medium", "long"] as const) {
      const l = computeLevels(h, c, t, null, now);
      expect(l.actionable, `${h}: ${l.reasonIfNot}`).toBe(true);
      expect(l.stopLoss!).toBeLessThan(l.entryLow!);
      expect(l.entryHigh!).toBeLessThan(l.target!);
      expect(l.riskReward!).toBeGreaterThan(0);
      expect(l.method.length).toBeGreaterThan(2);
    }
  });
  it("withholds levels when price data is stale", () => {
    const c = synthCandles(300, 100, 0.001, "2026-10-01");
    const l = computeLevels("short", c, analyzeTechnicals(c), null, now);
    expect(l.actionable).toBe(false);
    expect(l.target).toBeNull();
    expect(l.reasonIfNot).toMatch(/days old/);
  });
  it("withholds long-term levels with insufficient history", () => {
    const c = synthCandles(250);
    const l = computeLevels("long", c, analyzeTechnicals(c), null, now);
    expect(l.actionable).toBe(false);
  });
});

describe("fundamentals", () => {
  it("CAGR", () => {
    expect(cagr(121, 100, 2)).toBeCloseTo(10);
    expect(cagr(100, -5, 2)).toBeNull();
  });
  it("returns null score when data missing, never invents", () => {
    const r = scoreFundamentals(null, null);
    expect(r.score).toBeNull();
    expect(r.coverage).toBe(0);
  });
  it("scores a strong company highly", () => {
    const f = (rev: number, np: number) => ({ period: "", revenue: rev, ebitda: null, operatingProfit: rev * 0.2, netProfit: np, eps: np / 10, roe: 22, roce: 24, debtToEquity: 0.1, freeCashFlow: null, operatingCashFlow: np * 1.1, cash: null, dividendYield: null, pe: null, pb: null });
    const fin: FinancialsBundle = { source: "test", retrievedAt: "", status: "ok", quality: "high", currency: "INR", annual: [f(1500, 300), f(1300, 250), f(1150, 210), f(1000, 180)], quarterly: [] };
    const r = scoreFundamentals(fin, null);
    expect(r.score).toBeGreaterThan(70);
  });
});

describe("scoring model", () => {
  const comp = (key: ComponentScore["key"], score: number | null): ComponentScore => ({ key, label: key, score, weight: 0, coverage: score == null ? 0 : 1, explanation: [] });
  it("requires technical data", () => {
    const r = combineScores([comp("fundamentals", 80), comp("technical", null), comp("valuation", 70), comp("institutional", 60), comp("global", 50), comp("risk", 50)], "medium");
    expect(r.score).toBeNull();
  });
  it("verdict thresholds", () => {
    expect(verdictFor(80, 90)).toBe("STRONG BUY");
    expect(verdictFor(62, 90)).toBe("BUY");
    expect(verdictFor(50, 90)).toBe("HOLD");
    expect(verdictFor(35, 90)).toBe("SELL");
    expect(verdictFor(10, 90)).toBe("STRONG SELL");
    expect(verdictFor(80, 20)).toBe("INSUFFICIENT DATA");
  });
  it("weights sum to 1 after horizon tilt", () => {
    const r = combineScores([comp("fundamentals", 80), comp("technical", 60), comp("valuation", 70), comp("institutional", 60), comp("global", 50), comp("risk", 50)], "short");
    expect(Object.values(r.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
  it("confidence penalises missing prices", () => {
    expect(confidenceScore(1, null, true).confidence).toBe(30);
    expect(confidenceScore(1, 1, true).confidence).toBe(100);
  });
});

import { computeSignals, stopLossPlan } from "@/lib/analysis/signals";

describe("signals & stop-loss", () => {
  it("generates alternating BUY/SELL signals and consistent stats", () => {
    const c = synthCandles(800, 100, 0.0008);
    const r = computeSignals(c);
    for (let i = 1; i < r.signals.length; i++) expect(r.signals[i].type).not.toBe(r.signals[i - 1].type);
    if (r.signals.length) expect(r.signals[0].type).toBe("BUY");
    expect(r.stats.trades).toBe(r.trades.filter((t) => !t.open).length);
    if (r.stats.winRate != null) expect(r.stats.winRate).toBeGreaterThanOrEqual(0);
  });
  it("stop-loss plan sizes position by risk", () => {
    const p = stopLossPlan({ method: "percent", entry: 100, atr: 2, supports: [], percent: 5, atrMult: 2, capital: 100000, riskPct: 1, rr: 2 });
    expect(p.stop).toBeCloseTo(95);
    expect(p.qty).toBe(200); // ₹1,000 risk / ₹5 per share
    expect(p.target).toBeCloseTo(110);
    const s = stopLossPlan({ method: "support", entry: 100, atr: 2, supports: [97, 90], percent: 5, atrMult: 2, capital: 100000, riskPct: 1, rr: 2 });
    expect(s.stop).toBeCloseTo(96.5);
  });
});

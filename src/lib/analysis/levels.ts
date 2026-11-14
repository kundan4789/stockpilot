// Price-level calculation & validation module.
// The language model NEVER produces these numbers. They come only from the
// deterministic methods below, and each step is recorded in `method`.

import type { Candle, FinancialsBundle, Horizon, PriceLevels } from "../types";
import type { TechnicalSnapshot } from "./technical";

export const HORIZONS: Record<Horizon, { label: string; timeframe: string; minBars: number; atrStop: number; years: number }> = {
  short: { label: "Short term", timeframe: "days to weeks", minBars: 50, atrStop: 1.5, years: 1 / 12 },
  swing: { label: "Swing", timeframe: "2–12 weeks", minBars: 100, atrStop: 2.0, years: 0.25 },
  medium: { label: "Medium term", timeframe: "3–12 months", minBars: 200, atrStop: 3.0, years: 0.75 },
  long: { label: "Long term", timeframe: "1–5 years", minBars: 500, atrStop: 4.0, years: 2 },
};

export const MAX_STALE_DAYS = 5; // calendar days; covers weekends + one holiday

const r2 = (x: number) => Math.round(x * 100) / 100;

export function daysBetween(a: string, b: Date): number {
  return Math.floor((b.getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000);
}

/** Annualised volatility of daily log returns over the last `lookback` bars. */
export function annualVol(candles: Candle[], lookback = 252): number | null {
  const c = candles.slice(-lookback - 1);
  if (c.length < 60) return null;
  const rets = c.slice(1).map((x, i) => Math.log(x.close / c[i].close));
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mu) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

export function computeLevels(
  horizon: Horizon,
  candles: Candle[],
  t: TechnicalSnapshot,
  fin: FinancialsBundle | null,
  now: Date = new Date(),
): PriceLevels {
  const h = HORIZONS[horizon];
  const last = candles[candles.length - 1];
  const out: PriceLevels = {
    horizon, label: h.label, timeframe: h.timeframe, actionable: false,
    lastPrice: last?.close ?? null, lastPriceDate: last?.date ?? null,
    entryLow: null, entryHigh: null, target: null, stopLoss: null,
    upsidePct: null, downsidePct: null, riskReward: null, method: [],
  };
  if (!last) return { ...out, reasonIfNot: "No price data available." };
  const age = daysBetween(last.date, now);
  if (age > MAX_STALE_DAYS) return { ...out, reasonIfNot: `Latest price is ${age} days old (limit ${MAX_STALE_DAYS}). Levels withheld until data is refreshed.` };
  if (candles.length < h.minBars) return { ...out, reasonIfNot: `Needs ≥${h.minBars} daily bars for this horizon; only ${candles.length} available.` };
  if (t.atr14 == null) return { ...out, reasonIfNot: "ATR unavailable." };

  const close = last.close;
  const atr = t.atr14;
  const m: string[] = [];
  m.push(`Reference price: close ₹${r2(close)} on ${last.date}; ATR14 = ${r2(atr)}.`);

  // Entry zone: pullback of up to 0.5 ATR, floored at nearest support if closer.
  let entryLow = close - 0.5 * atr;
  const sup = t.supports[0]?.price;
  if (sup && sup > entryLow && sup < close) {
    entryLow = sup;
    m.push(`Entry low = nearest support ${r2(sup)} (closer than close − 0.5×ATR).`);
  } else m.push(`Entry low = close − 0.5×ATR = ${r2(entryLow)}.`);
  const entryHigh = close;
  m.push(`Entry high = latest close ${r2(close)}.`);

  // Stop: below support (if within the ATR budget) else ATR multiple.
  const atrStop = close - h.atrStop * atr;
  let stop = atrStop;
  const supBelow = t.supports.find((s) => s.price < entryLow);
  if (supBelow && supBelow.price - 0.25 * atr > atrStop) {
    stop = supBelow.price - 0.25 * atr;
    m.push(`Stop = support ${r2(supBelow.price)} − 0.25×ATR = ${r2(stop)}.`);
  } else m.push(`Stop = close − ${h.atrStop}×ATR = ${r2(stop)}.`);

  const risk = entryHigh - stop;
  let target: number;
  if (horizon === "short" || horizon === "swing") {
    const idx = horizon === "short" ? 0 : 1;
    const res = t.resistances[idx] ?? t.resistances[0];
    const minR = horizon === "short" ? 1.5 : 2;
    if (res && res.price - entryHigh >= minR * risk) {
      target = res.price;
      m.push(`Target = resistance ${r2(res.price)} (≥${minR}R away).`);
    } else {
      target = entryHigh + minR * risk;
      m.push(`Target = entry high + ${minR}×risk = ${r2(target)} (${res ? `nearest resistance ${r2(res.price)} offered <${minR}R` : "no overhead resistance found"}).`);
    }
  } else {
    const vol = annualVol(candles);
    if (vol == null) return { ...out, reasonIfNot: "Insufficient history for volatility estimate." };
    const volTarget = close * Math.exp(vol * Math.sqrt(h.years));
    m.push(`1-σ scenario: annualised volatility ${(vol * 100).toFixed(1)}% → close × e^(σ√${h.years}) = ${r2(volTarget)}.`);
    target = volTarget;
    const l = fin?.annual[0];
    if (horizon === "long" && l?.eps && l.eps > 0 && fin?.annual[3]?.eps && fin.annual[3].eps > 0) {
      const g = Math.min(Math.pow(l.eps / fin.annual[3].eps, 1 / 3) - 1, 0.25);
      const pe = Math.min(l.pe ?? Infinity, fin.industryPe ?? Infinity);
      if (Number.isFinite(pe) && g > 0) {
        const fundTarget = l.eps * Math.pow(1 + g, 2) * pe;
        m.push(`Earnings scenario: EPS ${r2(l.eps)} × (1 + ${(g * 100).toFixed(1)}% 3-yr EPS CAGR, capped 25%)² × min(P/E, industry P/E) ${r2(pe)} = ${r2(fundTarget)}.`);
        target = Math.min(volTarget, fundTarget);
        m.push(`Target = lower of the two scenarios = ${r2(target)} (conservative).`);
      }
    }
  }

  // Validation
  const errors: string[] = [];
  if (!(stop > 0)) errors.push("stop ≤ 0");
  if (!(stop < entryLow && entryLow <= entryHigh && entryHigh < target)) errors.push("levels not strictly ordered stop < entry < target");
  if ((entryHigh - stop) / entryHigh < 0.005) errors.push("stop closer than 0.5% (noise)");
  if ((target - entryHigh) / entryHigh > 1.5) errors.push("target implies >150% upside — rejected as implausible");
  if (errors.length) return { ...out, method: m, reasonIfNot: `Validation failed: ${errors.join("; ")}.` };

  return {
    ...out,
    actionable: true,
    entryLow: r2(entryLow),
    entryHigh: r2(entryHigh),
    target: r2(target),
    stopLoss: r2(stop),
    upsidePct: r2(((target - entryHigh) / entryHigh) * 100),
    downsidePct: r2(((stop - entryHigh) / entryHigh) * 100),
    riskReward: r2((target - entryHigh) / (entryHigh - stop)),
    method: [...m, "Validated: positive prices, stop < entry < target, stop ≥ 0.5% away, upside ≤ 150%."],
  };
}

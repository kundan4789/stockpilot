// Technical indicator calculations. Pure functions; every series output is aligned
// to the input (same length) with null where the indicator is not yet defined.

import type { Candle } from "../types";

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period; // seed with SMA
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(values, fast);
  const es = ema(values, slow);
  const line: Series = values.map((_, i) => (ef[i] != null && es[i] != null ? (ef[i] as number) - (es[i] as number) : null));
  const firstIdx = line.findIndex((v) => v != null);
  const sig: Series = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const compact = line.slice(firstIdx) as number[];
    const s = ema(compact, signal);
    s.forEach((v, j) => (sig[firstIdx + j] = v));
  }
  const hist: Series = line.map((v, i) => (v != null && sig[i] != null ? v - (sig[i] as number) : null));
  return { line, signal: sig, histogram: hist };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i] as number;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { middle: mid, upper, lower };
}

export function trueRange(c: Candle[]): number[] {
  return c.map((x, i) =>
    i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)),
  );
}

/** Wilder's ATR. */
export function atr(c: Candle[], period = 14): Series {
  const tr = trueRange(c);
  const out: Series = new Array(c.length).fill(null);
  if (c.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < c.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** ADX (trend strength, 0..100) with +DI / -DI. */
export function adx(c: Candle[], period = 14) {
  const n = c.length;
  const plusDI: Series = new Array(n).fill(null);
  const minusDI: Series = new Array(n).fill(null);
  const adxOut: Series = new Array(n).fill(null);
  if (n < period * 2 + 1) return { adx: adxOut, plusDI, minusDI };
  const tr = trueRange(c);
  const pdm: number[] = [0];
  const mdm: number[] = [0];
  for (let i = 1; i < n; i++) {
    const up = c[i].high - c[i - 1].high;
    const down = c[i - 1].low - c[i].low;
    pdm.push(up > down && up > 0 ? up : 0);
    mdm.push(down > up && down > 0 ? down : 0);
  }
  let trS = 0, pS = 0, mS = 0;
  for (let i = 1; i <= period; i++) {
    trS += tr[i];
    pS += pdm[i];
    mS += mdm[i];
  }
  const dx: number[] = [];
  for (let i = period; i < n; i++) {
    if (i > period) {
      trS = trS - trS / period + tr[i];
      pS = pS - pS / period + pdm[i];
      mS = mS - mS / period + mdm[i];
    }
    const p = trS === 0 ? 0 : (100 * pS) / trS;
    const m = trS === 0 ? 0 : (100 * mS) / trS;
    plusDI[i] = p;
    minusDI[i] = m;
    dx.push(p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m));
    if (dx.length === period) adxOut[i] = dx.reduce((a, b) => a + b, 0) / period;
    else if (dx.length > period) adxOut[i] = ((adxOut[i - 1] as number) * (period - 1) + dx[dx.length - 1]) / period;
  }
  return { adx: adxOut, plusDI, minusDI };
}

export interface Level {
  price: number;
  touches: number;
  kind: "support" | "resistance";
}

/**
 * Support/resistance from swing pivots (a bar whose high/low is the extreme of
 * `wing` bars either side), clustered within `tolerancePct`.
 */
export function supportResistance(c: Candle[], lookback = 250, wing = 3, tolerancePct = 1.5): { supports: Level[]; resistances: Level[] } {
  const data = c.slice(-lookback);
  if (data.length < wing * 2 + 1) return { supports: [], resistances: [] };
  const last = data[data.length - 1].close;
  const pivots: number[] = [];
  for (let i = wing; i < data.length - wing; i++) {
    const win = data.slice(i - wing, i + wing + 1);
    if (data[i].high === Math.max(...win.map((x) => x.high))) pivots.push(data[i].high);
    if (data[i].low === Math.min(...win.map((x) => x.low))) pivots.push(data[i].low);
  }
  pivots.sort((a, b) => a - b);
  const clusters: { sum: number; n: number }[] = [];
  for (const p of pivots) {
    const cl = clusters[clusters.length - 1];
    if (cl && Math.abs(p - cl.sum / cl.n) / (cl.sum / cl.n) * 100 <= tolerancePct) {
      cl.sum += p;
      cl.n++;
    } else clusters.push({ sum: p, n: 1 });
  }
  const levels = clusters.map((cl) => ({ price: cl.sum / cl.n, touches: cl.n }));
  const supports = levels
    .filter((l) => l.price < last)
    .map((l) => ({ ...l, kind: "support" as const }))
    .sort((a, b) => b.price - a.price);
  const resistances = levels
    .filter((l) => l.price > last)
    .map((l) => ({ ...l, kind: "resistance" as const }))
    .sort((a, b) => a.price - b.price);
  return { supports, resistances };
}

export const lastOf = (s: Series): number | null => {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return s[i] as number;
  return null;
};

// Rule-based BUY/SELL chart signals with a transparent back-test.
// System (long-only, end-of-day):
//   BUY  when EMA20 crosses above EMA50 and the close is above the 200-day SMA (trend filter)
//   SELL when EMA20 crosses below EMA50, or the close falls below a 3×ATR trailing stop
//        (highest close since entry − 3 × ATR14)
// Signals are evaluated on the close and assumed to be acted on at that close.

import type { Candle } from "../types";
import { atr, ema, sma } from "./indicators";

export interface Signal {
  date: string;
  type: "BUY" | "SELL";
  price: number;
  reason: string;
}

export interface Trade {
  entryDate: string;
  entry: number;
  exitDate: string | null;
  exit: number | null;
  returnPct: number;
  days: number;
  open: boolean;
}

export interface SignalResult {
  signals: Signal[];
  trades: Trade[];
  stats: { trades: number; wins: number; winRate: number | null; avgReturn: number | null; avgWin: number | null; avgLoss: number | null; best: number | null; worst: number | null; totalReturn: number | null; buyHold: number | null; avgDays: number | null };
  current: { state: "in-trade" | "flat"; since: string | null; entry: number | null; trailingStop: number | null; lastSignal: Signal | null; unrealizedPct: number | null };
  rules: string[];
}

const RULES = [
  "BUY: 20-day EMA crosses above the 50-day EMA while price is above its 200-day average (only trade with the long-term trend).",
  "SELL: 20-day EMA crosses below the 50-day EMA, or the close drops below a trailing stop = highest close since entry − 3 × ATR(14).",
  "Back-test: long-only, end-of-day closes, no costs or taxes. Past results do not guarantee future results.",
];

export function computeSignals(c: Candle[]): SignalResult {
  const closes = c.map((x) => x.close);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const s200 = sma(closes, 200);
  const a14 = atr(c, 14);
  const signals: Signal[] = [];
  const trades: Trade[] = [];
  let inTrade = false;
  let entry = 0;
  let entryIdx = 0;
  let peak = 0;
  for (let i = 1; i < c.length; i++) {
    const [p20, p50, n20, n50] = [e20[i - 1], e50[i - 1], e20[i], e50[i]];
    if (p20 == null || p50 == null || n20 == null || n50 == null) continue;
    const crossUp = p20 <= p50 && n20 > n50;
    const crossDown = p20 >= p50 && n20 < n50;
    if (!inTrade) {
      if (crossUp && s200[i] != null && closes[i] > (s200[i] as number)) {
        inTrade = true;
        entry = closes[i];
        entryIdx = i;
        peak = closes[i];
        signals.push({ date: c[i].date, type: "BUY", price: closes[i], reason: "EMA20 crossed above EMA50 with price above SMA200" });
      }
    } else {
      peak = Math.max(peak, closes[i]);
      const stop = a14[i] != null ? peak - 3 * (a14[i] as number) : null;
      const stopHit = stop != null && closes[i] < stop;
      if (crossDown || stopHit) {
        inTrade = false;
        const r = ((closes[i] - entry) / entry) * 100;
        trades.push({ entryDate: c[entryIdx].date, entry, exitDate: c[i].date, exit: closes[i], returnPct: r, days: i - entryIdx, open: false });
        signals.push({ date: c[i].date, type: "SELL", price: closes[i], reason: crossDown ? "EMA20 crossed below EMA50" : `Close below 3×ATR trailing stop (${stop!.toFixed(2)})` });
      }
    }
  }
  const last = c[c.length - 1];
  let current: SignalResult["current"] = { state: "flat", since: null, entry: null, trailingStop: null, lastSignal: signals[signals.length - 1] ?? null, unrealizedPct: null };
  if (inTrade && last) {
    const a = a14[c.length - 1];
    trades.push({ entryDate: c[entryIdx].date, entry, exitDate: null, exit: null, returnPct: ((last.close - entry) / entry) * 100, days: c.length - 1 - entryIdx, open: true });
    current = { state: "in-trade", since: c[entryIdx].date, entry, trailingStop: a != null ? peak - 3 * a : null, lastSignal: signals[signals.length - 1] ?? null, unrealizedPct: ((last.close - entry) / entry) * 100 };
  }
  const closed = trades.filter((t) => !t.open);
  const wins = closed.filter((t) => t.returnPct > 0);
  const losses = closed.filter((t) => t.returnPct <= 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const firstIdx = e50.findIndex((x) => x != null);
  const stats = {
    trades: closed.length,
    wins: wins.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    avgReturn: avg(closed.map((t) => t.returnPct)),
    avgWin: avg(wins.map((t) => t.returnPct)),
    avgLoss: avg(losses.map((t) => t.returnPct)),
    best: closed.length ? Math.max(...closed.map((t) => t.returnPct)) : null,
    worst: closed.length ? Math.min(...closed.map((t) => t.returnPct)) : null,
    totalReturn: closed.length ? (closed.reduce((m, t) => m * (1 + t.returnPct / 100), 1) - 1) * 100 : null,
    buyHold: firstIdx >= 0 && last ? ((last.close - closes[firstIdx]) / closes[firstIdx]) * 100 : null,
    avgDays: avg(closed.map((t) => t.days)),
  };
  return { signals, trades, stats, current, rules: RULES };
}

export type StopMethod = "atr" | "support" | "percent" | "trailing";

/** Stop-loss & position-size calculator (pure; used by the report page). */
export function stopLossPlan(opts: { method: StopMethod; entry: number; atr: number | null; supports: number[]; percent: number; atrMult: number; capital: number; riskPct: number; rr: number; highSinceEntry?: number | null }) {
  const { method, entry } = opts;
  let stop: number | null = null;
  let how = "";
  if (method === "atr" && opts.atr) {
    stop = entry - opts.atrMult * opts.atr;
    how = `Entry − ${opts.atrMult} × ATR(14) (${opts.atr.toFixed(2)})`;
  } else if (method === "support") {
    const s = opts.supports.filter((x) => x < entry).sort((a, b) => b - a)[0];
    if (s != null) {
      stop = s - (opts.atr ? 0.25 * opts.atr : s * 0.005);
      how = `Just below the nearest support ${s.toFixed(2)} (minus a ${opts.atr ? "quarter-ATR" : "0.5%"} buffer)`;
    } else how = "No support level below the entry price";
  } else if (method === "percent") {
    stop = entry * (1 - opts.percent / 100);
    how = `${opts.percent}% below entry`;
  } else if (method === "trailing" && opts.atr) {
    const hi = Math.max(entry, opts.highSinceEntry ?? entry);
    stop = hi - 3 * opts.atr;
    how = `Trailing: highest close since entry (${hi.toFixed(2)}) − 3 × ATR(14); move it up as price rises, never down`;
  }
  if (stop == null || !(stop > 0) || stop >= entry) return { stop: null, how: how || "Not computable with the available data", riskPerShare: null, qty: null, riskAmount: null, target: null, positionValue: null };
  const riskPerShare = entry - stop;
  const riskAmount = (opts.capital * opts.riskPct) / 100;
  const qty = Math.max(0, Math.floor(Math.min(riskAmount / riskPerShare, opts.capital / entry)));
  return { stop, how, riskPerShare, qty, riskAmount, target: entry + opts.rr * riskPerShare, positionValue: qty * entry };
}

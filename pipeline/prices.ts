// Price history: NSE daily bhavcopy (sec_bhavdata_full) for the tracked universe.
// Forward sync adds new sessions; a resumable backfill walks backwards to N years.
// Splits/bonuses are detected with NSE's ex-date adjusted PREV_CLOSE and history is back-adjusted.

import type { Candle, CorporateEvent, StockMaster } from "../src/lib/types";
import { fetchBhavcopy, NSE_URLS, type BhavRow } from "./nse";
import { readPrices, writePrices, type State } from "./store";
import { parseCsv, col } from "../src/lib/util/parse";
import { fetchSource } from "./http";
import { SEED_STOCKS } from "./seed-stocks";
import { readJson, writeJson, dataPath } from "./store";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(s + "T00:00:00Z");
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** NIFTY 50 constituents (with NSE industry as sector) from NSE's published index file. */
export async function loadUniverse(log: string[]): Promise<StockMaster[]> {
  try {
    const r = await fetchSource<string>(NSE_URLS.indexList("ind_nifty50list.csv"), { source: "nse", as: "text", headers: { Referer: "https://www.nseindia.com/" } });
    const list: StockMaster[] = parseCsv(r.data)
      .map((row) => ({ symbol: (col(row, "SYMBOL") ?? "").toUpperCase(), exchange: "NSE" as const, name: col(row, "COMPANY NAME") ?? "", sector: col(row, "INDUSTRY"), isin: col(row, "ISIN CODE"), indices: ["NIFTY 50"] }))
      .filter((s) => s.symbol && s.name);
    if (list.length >= 45) {
      await writeJson(dataPath("universe.json"), list, true);
      log.push(`Universe: ${list.length} NIFTY 50 constituents from NSE index file`);
      return list;
    }
    log.push(`Universe file returned only ${list.length} rows; using stored list`);
  } catch (e) {
    log.push(`Universe fetch failed (${(e as Error).message}); using stored list`);
  }
  const stored = await readJson<StockMaster[]>(dataPath("universe.json"), []);
  return stored.length ? stored : SEED_STOCKS.map((s) => ({ ...s, indices: ["seed list"] }));
}

const toCandle = (r: BhavRow, f = 1): Candle => ({ date: r.date, open: r.open * f, high: r.high * f, low: r.low * f, close: r.close * f, volume: Math.round(r.volume / f), deliveryQty: r.deliveryQty, deliveryPct: r.deliveryPct });

export async function syncPrices(universe: StockMaster[], state: State, deadline: number, years: number, log: string[]) {
  const symbols = new Set(universe.map((s) => s.symbol));
  const prices = new Map<string, Candle[]>();
  for (const s of symbols) prices.set(s, await readPrices(s));
  const events = new Map<string, CorporateEvent[]>();
  const addEvent = (sym: string, e: CorporateEvent) => events.set(sym, [...(events.get(sym) ?? []), e]);

  // ── 1. Forward: sessions after the newest stored date ──
  if (state.lastPriceDate) {
    let added = 0;
    const today = new Date();
    for (let d = new Date(day(state.lastPriceDate).getTime() + 86400000); d <= today && Date.now() < deadline; d = new Date(d.getTime() + 86400000)) {
      if (isWeekend(d)) continue;
      const b = await fetchBhavcopy(d).catch((e) => (log.push(`${iso(d)}: ${(e as Error).message}`), null));
      if (!b) continue;
      for (const r of b.rows) {
        if (!symbols.has(r.symbol) || (r.series !== "EQ" && r.series !== "BE")) continue;
        const c = prices.get(r.symbol)!;
        const lastBar = c[c.length - 1];
        if (lastBar && r.prevClose && lastBar.date < r.date) {
          const f = r.prevClose / lastBar.close;
          if (Math.abs(f - 1) > 0.03 && f > 0.02 && f < 50) {
            for (const x of c) {
              x.open *= f; x.high *= f; x.low *= f; x.close *= f; x.volume = Math.round(x.volume / f);
            }
            addEvent(r.symbol, { type: "announcement", title: `Price history adjusted ×${f.toFixed(4)} — NSE adjusted previous close ${r.prevClose} vs stored ${lastBar.close.toFixed(2)} (split/bonus/rights)`, date: r.date, url: b.url, source: "StockPilot corporate-action detector" });
          }
        }
        c.push(toCandle(r));
      }
      state.lastPriceDate = iso(d);
      added++;
    }
    log.push(`Prices: ${added} new session(s) added; latest ${state.lastPriceDate}`);
  }

  // ── 2. Backward: resumable backfill to `years` of history ──
  if (!state.backfillDone) {
    const stopAt = new Date(Date.now() - years * 365.25 * 86400000);
    let d = state.backfillCursor ? new Date(day(state.backfillCursor).getTime() - 86400000) : new Date();
    const factor = new Map<string, number>();
    let nextDayPrev = new Map<string, number>();
    if (state.backfillCursor) {
      // carry adjustments already applied to the stored boundary bar
      const b = await fetchBhavcopy(day(state.backfillCursor)).catch(() => null);
      if (b) {
        nextDayPrev = new Map(b.rows.map((r) => [r.symbol, r.prevClose ?? 0]));
        for (const r of b.rows) {
          const stored = prices.get(r.symbol)?.find((x) => x.date === r.date);
          if (stored && r.close > 0 && Math.abs(stored.close / r.close - 1) > 0.001) factor.set(r.symbol, stored.close / r.close);
        }
      }
    }
    let n = 0;
    while (d > stopAt && Date.now() < deadline) {
      if (!isWeekend(d)) {
        const b = await fetchBhavcopy(d).catch((e) => (log.push(`${iso(d)}: ${(e as Error).message}`), null));
        if (b) {
          const keep = b.rows.filter((r) => symbols.has(r.symbol) && (r.series === "EQ" || r.series === "BE"));
          for (const r of keep) {
            const np = nextDayPrev.get(r.symbol);
            if (np && Math.abs(np / r.close - 1) > 0.03) factor.set(r.symbol, (factor.get(r.symbol) ?? 1) * (np / r.close));
            prices.get(r.symbol)!.push(toCandle(r, factor.get(r.symbol) ?? 1));
          }
          nextDayPrev = new Map(keep.map((r) => [r.symbol, r.prevClose ?? 0]));
          if (!state.lastPriceDate || r0(keep) > state.lastPriceDate) state.lastPriceDate = r0(keep);
          n++;
        }
        state.backfillCursor = iso(d);
      }
      d = new Date(d.getTime() - 86400000);
    }
    state.backfillDone = d <= stopAt;
    log.push(`Backfill: ${n} session(s) this run; history now back to ${state.backfillCursor}${state.backfillDone ? " (complete)" : " (continues next run)"}`);
  }

  for (const [s, c] of prices) await writePrices(s, c);
  const out = new Map<string, Candle[]>();
  for (const s of symbols) out.set(s, await readPrices(s)); // re-read sorted & de-duplicated
  return { prices: out, adjustmentEvents: events };
}

const r0 = (rows: BhavRow[]) => rows[0]?.date ?? "";

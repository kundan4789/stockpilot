// File-based state kept in the git repository (data/). GitHub is the database:
// every run commits the updated files, so history is versioned and free.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Candle } from "../src/lib/types";
import { env } from "./env";

export const dataPath = (...p: string[]) => path.join(env.dataDir, ...p);
export const sitePath = (...p: string[]) => path.join(env.siteDataDir, ...p);

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(file: string, value: unknown, pretty = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file + ".tmp", JSON.stringify(value, null, pretty ? 1 : 0));
  await fs.rename(file + ".tmp", file);
}

// Prices are stored compactly: [date, open, high, low, close, volume, deliveryQty, deliveryPct]
type Row = [string, number, number, number, number, number, number | null, number | null];
const r2 = (x: number) => Math.round(x * 100) / 100;

export async function readPrices(symbol: string): Promise<Candle[]> {
  const rows = await readJson<Row[]>(dataPath("prices", `${symbol}.json`), []);
  return rows.map(([date, open, high, low, close, volume, deliveryQty, deliveryPct]) => ({ date, open, high, low, close, volume, deliveryQty, deliveryPct }));
}

export async function writePrices(symbol: string, candles: Candle[]) {
  const m = new Map(candles.map((c) => [c.date, c]));
  const sorted = [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
  await writeJson(
    dataPath("prices", `${symbol}.json`),
    sorted.map((c) => [c.date, r2(c.open), r2(c.high), r2(c.low), r2(c.close), Math.round(c.volume), c.deliveryQty ?? null, c.deliveryPct ?? null] as Row),
  );
}

export interface State {
  lastPriceDate: string | null;
  backfillCursor: string | null; // oldest date fetched so far (walking backwards)
  backfillDone: boolean;
  runs: number;
}

export const loadState = () => readJson<State>(dataPath("state.json"), { lastPriceDate: null, backfillCursor: null, backfillDone: false, runs: 0 });
export const saveState = (s: State) => writeJson(dataPath("state.json"), s, true);

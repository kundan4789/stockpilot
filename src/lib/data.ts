"use client";

// Reads the JSON published by the daily GitHub Actions pipeline.
import { useEffect, useState } from "react";
import type { ResearchReport } from "./report-types";
import type { ComponentScore, HorizonRecommendation, MacroIndicator, NewsItem } from "./types";

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const cache = new Map<string, Promise<unknown>>();

export function getJson<T>(path: string): Promise<T> {
  if (!cache.has(path))
    cache.set(
      path,
      fetch(`${BASE}/data/${path}`, { cache: "no-cache" }).then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Data not published yet — the first daily update may still be running." : `Could not load data (${r.status})`);
        return r.json();
      }),
    );
  return cache.get(path) as Promise<T>;
}

export function useJson<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let live = true;
    getJson<T>(path).then((d) => live && setData(d)).catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [path]);
  return { data, error };
}

export interface StockRow {
  symbol: string; name: string; sector: string | null; isin: string | null;
  close: number | null; asOf: string | null; changePct: number | null; marketCap: number | null;
  revenueGrowth: number | null; profitGrowth: number | null; roe: number | null; roce: number | null; debtToEquity: number | null; pe: number | null;
  rsi: number | null; aboveSma50: boolean | null; aboveSma200: boolean | null; trend: string | null; technicalScore: number | null; fundamentalScore: number | null;
  return3m: number | null; return1y: number | null; atrPct: number | null;
  components: { key: ComponentScore["key"]; score: number | null; coverage: number }[];
  recommendations: Pick<HorizonRecommendation, "horizon" | "verdict" | "score" | "confidence">[];
  researchScore: number | null; confidence: number; generatedAt: string;
  highImpactNews: { headline: string; url: string; sentiment: string; publishedAt: string }[];
}

export interface IndexRow { name: string; date: string; close: number; changePct: number | null; pe: number | null }
export interface Mover { symbol: string; name: string; close: number; changePct: number; date: string }
export interface MarketData {
  generatedAt: string;
  indices: { status: string; date: string | null; sourceUrl: string | null; retrievedAt: string | null; headline: IndexRow[]; sectors: IndexRow[] };
  indexHistory: Record<string, Record<string, [number, number | null]>>;
  sensex: { value: number | null; changePct?: number | null; asOf?: string | null; url?: string };
  global: { items: (MacroIndicator & { prev: number | null })[]; error?: string };
  macro: MacroIndicator[];
  movers: { date: string | null; universe: string; gainers: Mover[]; losers: Mover[]; count: number };
  news: NewsItem[];
}

export interface Meta {
  generatedAt: string; lastPriceDate: string | null; backfill: { done: boolean; oldest: string | null }; universe: string[];
  ai: string; usage: Record<string, number>; requests: number; failures: { source: string; url: string; status: number; message?: string; at: string }[]; log: string[]; minutes: number;
}

export type Report = ResearchReport;

"use client";

// Personal data lives in this browser (localStorage): watchlist, virtual portfolio,
// alert rules/feed and scoring weights. Nothing is sent anywhere.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_WEIGHTS, type ScoringWeights } from "./analysis/scoring";

export interface WatchItem { symbol: string; addedAt: string; buyPrice: number | null; quantity: number | null; target: number | null; stopLoss: number | null; notes: string | null }
export interface Trade { id: string; symbol: string; side: "BUY" | "SELL"; quantity: number; price: number; tradeDate: string; note: string | null }
export type AlertKind = "price_above" | "price_below" | "announcement" | "negative_news" | "positive_news" | "technical_change" | "recommendation_change";
export interface AlertRule { id: string; symbol: string; kind: AlertKind; threshold: number | null; active: boolean; createdAt: string }
export interface AlertEvent { id: string; key: string; symbol: string; kind: AlertKind; message: string; reason: string; url: string | null; createdAt: string; read: boolean }

const KEYS = { watch: "sp.watch", trades: "sp.trades", rules: "sp.alertRules", events: "sp.alertEvents", weights: "sp.weights" } as const;

function read<T>(k: string, fb: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fb;
  } catch {
    return fb;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    window.dispatchEvent(new Event("sp-storage"));
  } catch {}
}

function useStored<T>(k: string, fb: T): [T, (v: T) => void, boolean] {
  const [v, setV] = useState<T>(fb);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const load = () => {
      setV(read(k, fb));
      setReady(true);
    };
    load();
    window.addEventListener("sp-storage", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("sp-storage", load);
      window.removeEventListener("storage", load);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  const set = useCallback((x: T) => write(k, x), [k]);
  return [v, set, ready];
}

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
export const useWatchlist = () => useStored<WatchItem[]>(KEYS.watch, []);
export const useTrades = () => useStored<Trade[]>(KEYS.trades, []);
export const useAlertRules = () => useStored<AlertRule[]>(KEYS.rules, []);
export const useAlertEvents = () => useStored<AlertEvent[]>(KEYS.events, []);
export const useWeights = () => useStored<ScoringWeights>(KEYS.weights, DEFAULT_WEIGHTS);
export const readStore = read;
export const writeStore = write;
export { KEYS };

export function isCustomWeights(w: ScoringWeights) {
  return (Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]).some((k) => Math.abs(w[k] - DEFAULT_WEIGHTS[k]) > 0.001);
}

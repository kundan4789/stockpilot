"use client";

// Evaluates the user's alert rules (stored in this browser) against the latest
// published data whenever the app is open, and raises browser notifications.
import { useEffect } from "react";
import { getJson, type StockRow } from "@/lib/data";
import type { ResearchReport } from "@/lib/report-types";
import { KEYS, readStore, uid, writeStore, type AlertEvent, type AlertRule, type WatchItem } from "@/lib/local";
import { notify } from "./pwa";

type Hist = { date: string; close: number | null; verdicts: Record<string, string> }[];

export async function evaluateAlerts(): Promise<number> {
  const rules = readStore<AlertRule[]>(KEYS.rules, []).filter((r) => r.active);
  const watch = readStore<WatchItem[]>(KEYS.watch, []);
  const events = readStore<AlertEvent[]>(KEYS.events, []);
  const keys = new Set(events.map((e) => e.key));
  const stocks = await getJson<StockRow[]>("stocks.json");
  const by = new Map(stocks.map((s) => [s.symbol, s]));
  const fresh: AlertEvent[] = [];
  const add = (key: string, e: Omit<AlertEvent, "id" | "key" | "createdAt" | "read">) => {
    if (keys.has(key)) return;
    keys.add(key);
    fresh.push({ ...e, id: uid(), key, createdAt: new Date().toISOString(), read: false });
  };
  const reports = new Map<string, ResearchReport & { history?: Hist }>();
  const rep = async (s: string) => {
    if (!reports.has(s)) reports.set(s, await getJson<ResearchReport & { history?: Hist }>(`reports/${s}.json`).catch(() => null as never));
    return reports.get(s);
  };

  for (const r of rules) {
    const s = by.get(r.symbol);
    if (!s) continue;
    if ((r.kind === "price_above" || r.kind === "price_below") && r.threshold != null && s.close != null) {
      const hit = r.kind === "price_above" ? s.close >= r.threshold : s.close <= r.threshold;
      if (hit) add(`${r.id}:${s.asOf}`, { symbol: s.symbol, kind: r.kind, message: `${s.symbol} closed ${r.kind === "price_above" ? "at/above" : "at/below"} ${r.threshold}`, reason: `Close ₹${s.close} on ${s.asOf} vs your level ${r.threshold}. Source: NSE daily bhavcopy.`, url: null });
      continue;
    }
    const report = await rep(r.symbol);
    if (!report) continue;
    if (r.kind === "announcement")
      for (const e of report.events.filter((e) => e.date >= r.createdAt.slice(0, 10)).slice(0, 3)) add(`${r.id}:${e.date}:${e.title}`, { symbol: r.symbol, kind: r.kind, message: `${r.symbol}: ${e.title.slice(0, 120)}`, reason: `New ${e.type.replace("_", " ")} published ${e.date} (${e.source}).`, url: e.url ?? null });
    if (r.kind === "negative_news" || r.kind === "positive_news") {
      const want = r.kind === "negative_news" ? "negative" : "positive";
      for (const n of report.news.filter((n) => n.sentiment === want && n.impact === "high" && n.retrievedAt >= r.createdAt).slice(0, 3)) add(`${r.id}:${n.url}`, { symbol: r.symbol, kind: r.kind, message: `${r.symbol}: ${n.headline.slice(0, 140)}`, reason: `High-impact ${want} item (relevance ${n.relevance.toFixed(2)}) — ${n.publisher}, ${n.publishedAt.slice(0, 10)}. ${n.evidence.split(" (matched")[0]}`, url: n.url });
    }
    if (r.kind === "technical_change") {
      const t = report.technical;
      if (t.potentialBreakout) add(`${r.id}:bo:${t.asOf}`, { symbol: r.symbol, kind: r.kind, message: `${r.symbol}: potential breakout`, reason: t.signals.find((x) => x.startsWith("Potential breakout")) ?? "", url: null });
      if (t.potentialBreakdown) add(`${r.id}:bd:${t.asOf}`, { symbol: r.symbol, kind: r.kind, message: `${r.symbol}: potential breakdown`, reason: t.signals.find((x) => x.startsWith("Potential breakdown")) ?? "", url: null });
      if (t.condition && t.condition !== "neutral") add(`${r.id}:rsi:${t.asOf}`, { symbol: r.symbol, kind: r.kind, message: `${r.symbol}: RSI ${t.condition}`, reason: `RSI14 = ${t.rsi14?.toFixed(1)} on ${t.asOf}.`, url: null });
    }
    if (r.kind === "recommendation_change") {
      const h = report.history ?? [];
      for (const hz of ["swing", "medium"])
        if (h[0] && h[1] && h[0].verdicts[hz] !== h[1].verdicts[hz]) add(`${r.id}:${hz}:${h[0].date}`, { symbol: r.symbol, kind: r.kind, message: `${r.symbol}: ${hz} assessment ${h[1].verdicts[hz]} → ${h[0].verdicts[hz]}`, reason: `Daily research on ${h[0].date} vs ${h[1].date}.`, url: null });
    }
  }
  for (const w of watch) {
    const s = by.get(w.symbol);
    if (!s?.close) continue;
    if (w.target != null && s.close >= w.target) add(`w:${w.symbol}:t:${w.target}`, { symbol: w.symbol, kind: "price_above", message: `${w.symbol} reached your watchlist target ${w.target}`, reason: `Close ₹${s.close} on ${s.asOf}.`, url: null });
    if (w.stopLoss != null && s.close <= w.stopLoss) add(`w:${w.symbol}:s:${w.stopLoss}`, { symbol: w.symbol, kind: "price_below", message: `${w.symbol} hit your watchlist stop-loss ${w.stopLoss}`, reason: `Close ₹${s.close} on ${s.asOf}.`, url: null });
  }
  if (fresh.length) {
    writeStore(KEYS.events, [...fresh, ...events].slice(0, 300));
    for (const e of fresh.slice(0, 5)) await notify(e.message, e.reason);
  }
  return fresh.length;
}

export function AlertEngine() {
  useEffect(() => {
    evaluateAlerts().catch(() => {});
    const t = setInterval(() => evaluateAlerts().catch(() => {}), 10 * 60_000);
    return () => clearInterval(t);
  }, []);
  return null;
}

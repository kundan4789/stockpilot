"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, HistogramSeries, LineSeries, type IChartApi, type SeriesMarker, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "@/lib/types";
import { sma } from "@/lib/analysis/indicators";
import { cn } from "./ui";

const PERIODS: { k: string; days: number }[] = [
  { k: "1D", days: 1 },
  { k: "1W", days: 7 },
  { k: "1M", days: 31 },
  { k: "3M", days: 92 },
  { k: "6M", days: 183 },
  { k: "1Y", days: 366 },
  { k: "3Y", days: 1096 },
  { k: "5Y", days: 1827 },
];

const ts = (d: string) => (Date.parse(d + "T00:00:00Z") / 1000) as UTCTimestamp;

export function PriceChart({ candles, levels, signals }: { candles: Candle[]; levels?: { price: number; label: string; color: string }[]; signals?: { date: string; type: "BUY" | "SELL"; price: number }[] }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [period, setPeriod] = useState("1Y");
  const [overlays, setOverlays] = useState({ sma50: true, sma200: true, signals: true });

  const view = useMemo(() => {
    if (!candles.length) return { data: [] as Candle[], start: 0 };
    const p = PERIODS.find((x) => x.k === period)!;
    const last = Date.parse(candles[candles.length - 1].date);
    const cut = new Date(last - p.days * 86400000).toISOString().slice(0, 10);
    const startIdx = Math.max(0, candles.findIndex((c) => c.date > cut));
    return { data: candles, start: p.k === "1D" ? candles.length - 1 : startIdx };
  }, [candles, period]);

  useEffect(() => {
    if (!el.current || !candles.length) return;
    const c = createChart(el.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a97b0", fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: "rgba(148,163,184,0.06)" }, horzLines: { color: "rgba(148,163,184,0.06)" } },
      rightPriceScale: { borderColor: "rgba(148,163,184,0.15)" },
      timeScale: { borderColor: "rgba(148,163,184,0.15)" },
      crosshair: { mode: 0 },
      autoSize: true,
    });
    chart.current = c;
    const closes = candles.map((x) => x.close);
    const s = c.addSeries(CandlestickSeries, { upColor: "#22c55e", downColor: "#ef4444", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444" });
    s.setData(candles.map((x) => ({ time: ts(x.date), open: x.open, high: x.high, low: x.low, close: x.close })));
    const v = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: "rgba(96,165,250,0.25)" });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    v.setData(candles.map((x, i) => ({ time: ts(x.date), value: x.volume, color: i && x.close < candles[i - 1].close ? "rgba(239,68,68,0.25)" : "rgba(34,197,94,0.25)" })));
    const addSma = (n: number, color: string) => {
      const ln = c.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const vals = sma(closes, n);
      ln.setData(candles.flatMap((x, i) => (vals[i] == null ? [] : [{ time: ts(x.date), value: vals[i] as number }])));
    };
    if (overlays.sma50) addSma(50, "#60a5fa");
    if (overlays.sma200) addSma(200, "#f59e0b");
    if (overlays.signals && signals?.length) {
      const m: SeriesMarker<UTCTimestamp>[] = signals.map((x) => ({ time: ts(x.date), position: x.type === "BUY" ? "belowBar" : "aboveBar", color: x.type === "BUY" ? "#22c55e" : "#ef4444", shape: x.type === "BUY" ? "arrowUp" : "arrowDown", text: x.type }));
      createSeriesMarkers(s, m);
    }
    for (const l of levels ?? []) s.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: l.label });
    return () => {
      c.remove();
      chart.current = null;
    };
  }, [candles, levels, overlays, signals]);

  useEffect(() => {
    const c = chart.current;
    if (!c || !view.data.length) return;
    c.timeScale().setVisibleRange({ from: ts(view.data[Math.max(0, view.start - (period === "1D" ? 1 : 0))].date), to: ts(view.data[view.data.length - 1].date) });
  }, [view, period, overlays]);

  const available = candles.length ? Math.round((Date.parse(candles[candles.length - 1].date) - Date.parse(candles[0].date)) / 86400000) : 0;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {PERIODS.map((p) => (
          <button key={p.k} onClick={() => setPeriod(p.k)} disabled={p.days > available + 31 && p.k !== "1D"} className={cn("rounded-md px-2 py-1 text-xs font-medium disabled:opacity-30", period === p.k ? "bg-accent/15 text-accent" : "text-muted hover:text-ink")}>
            {p.k}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-line" />
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={overlays.sma50} onChange={(e) => setOverlays((o) => ({ ...o, sma50: e.target.checked }))} /> <span className="text-blue-400">SMA50</span>
        </label>
        <label className="ml-2 flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={overlays.sma200} onChange={(e) => setOverlays((o) => ({ ...o, sma200: e.target.checked }))} /> <span className="text-amber-400">SMA200</span>
        </label>
        {signals && (
          <label className="ml-2 flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={overlays.signals} onChange={(e) => setOverlays((o) => ({ ...o, signals: e.target.checked }))} /> <span><span className="text-up">▲BUY</span>/<span className="text-down">▼SELL</span> signals</span>
          </label>
        )}
      </div>
      <div ref={el} className="h-[340px] w-full sm:h-[400px]" />
      <p className="mt-1 text-[10px] text-faint">End-of-day data. 1D shows the latest session (no free intraday feed). Periods longer than the stored history are disabled until the backfill job has run.</p>
    </div>
  );
}

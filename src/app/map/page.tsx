"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useJson, type StockRow } from "@/lib/data";
import { useWeights } from "@/lib/local";
import { rescore } from "@/lib/rescore";
import { cn, Notice, Spinner } from "@/components/ui";

type Mode = "changePct" | "return1w" | "return1m" | "signal";

function color(v: number | null, scale: number) {
  if (v == null) return "rgba(148,163,184,0.12)";
  const t = Math.max(-1, Math.min(1, v / scale));
  return t >= 0 ? `rgba(34,197,94,${0.15 + 0.7 * t})` : `rgba(239,68,68,${0.15 + 0.7 * -t})`;
}

export default function MapPage() {
  const { data, error } = useJson<StockRow[]>("stocks.json");
  const [w] = useWeights();
  const [mode, setMode] = useState<Mode>("changePct");
  const groups = useMemo(() => {
    const g = new Map<string, StockRow[]>();
    for (const s of data ?? []) g.set(s.sector ?? "Other", [...(g.get(s.sector ?? "Other") ?? []), s]);
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [data]);
  const val = (s: StockRow): number | null => {
    if (mode === "signal") {
      const v = rescore(s.components, s.asOf, w).find((x) => x.horizon === "swing")!.verdict;
      return v === "STRONG BUY" ? 2 : v === "BUY" ? 1 : v === "SELL" ? -1 : v === "STRONG SELL" ? -2 : v === "HOLD" ? 0 : null;
    }
    return s[mode];
  };
  const scale = mode === "changePct" ? 3 : mode === "return1w" ? 6 : mode === "return1m" ? 12 : 2;
  const label = (s: StockRow) => {
    const v = val(s);
    if (mode === "signal") return rescore(s.components, s.asOf, w).find((x) => x.horizon === "swing")!.verdict.replace("INSUFFICIENT DATA", "N/A");
    return v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold">Market Map — NIFTY 50</h1>
        <div className="flex gap-1">
          {([["changePct", "1 Day"], ["return1w", "1 Week"], ["return1m", "1 Month"], ["signal", "Buy/Sell view"]] as [Mode, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} className={cn("rounded-md px-2.5 py-1 text-xs", mode === k ? "bg-accent/15 text-accent" : "text-muted hover:text-ink")}>{l}</button>
          ))}
        </div>
      </div>
      {error && <Notice kind="warn">{error}</Notice>}
      {!data ? <Spinner /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(([sector, list]) => (
            <div key={sector} className="glass rounded-xl p-2">
              <div className="mb-1.5 px-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{sector}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {list.map((s) => (
                  <Link key={s.symbol} href={`/research/?s=${s.symbol}`} title={s.name} className="rounded-md px-2 py-2 text-center transition-transform hover:scale-[1.03]" style={{ background: color(val(s), scale) }}>
                    <div className="truncate text-xs font-semibold">{s.symbol}</div>
                    <div className="num text-[11px]">{label(s)}</div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-faint">Colour intensity shows the size of the move (green up, red down). “Buy/Sell view” colours each stock by its swing-horizon verdict. Tap any tile for the full research report.</p>
    </div>
  );
}

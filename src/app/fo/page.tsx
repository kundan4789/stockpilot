"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useJson, type MarketData, type StockRow } from "@/lib/data";
import { FoCard, StanceBadge } from "@/components/fo-card";
import { Card, cn, fmtNum, Notice, Pct, Spinner } from "@/components/ui";

const BUILDUPS = ["All", "Long build-up", "Short build-up", "Short covering", "Long unwinding", "Neutral"];

export default function FoPage() {
  const { data: m } = useJson<MarketData>("market.json");
  const { data: rows, error } = useJson<StockRow[]>("stocks.json");
  const [b, setB] = useState("All");
  const list = useMemo(() => (rows ?? []).filter((r) => r.fo && (b === "All" || r.fo.buildup === b)).sort((x, y) => (y.fo!.stanceScore ?? 0) - (x.fo!.stanceScore ?? 0)), [rows, b]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">F&O Analyst</h1>
      <Notice>Derived from NSE&apos;s end-of-day F&O bhavcopy: open-interest build-up, Put-Call Ratio, max pain and option-OI support/resistance. Derivatives are leveraged and high-risk — use this to understand positioning, not as a trade instruction.</Notice>
      {error && <Notice kind="warn">{error}</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        <FoCard fo={m?.fo?.indices?.NIFTY} title="NIFTY options & futures" />
        <FoCard fo={m?.fo?.indices?.BANKNIFTY} title="BANK NIFTY options & futures" />
      </div>
      <Card title="NIFTY 50 stocks — F&O positioning" subtitle="Sorted from most bullish to most bearish F&O stance">
        <div className="mb-3 flex flex-wrap gap-1">
          {BUILDUPS.map((x) => <button key={x} onClick={() => setB(x)} className={cn("rounded-md px-2 py-1 text-xs", b === x ? "bg-accent/15 text-accent" : "text-muted hover:text-ink")}>{x}</button>)}
        </div>
        {!rows ? <Spinner /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted"><tr><th className="py-1.5 text-left">Stock</th><th className="text-right">Close</th><th className="text-right">Day</th><th className="text-left pl-3">Build-up</th><th className="text-right">Fut OI Δ</th><th className="text-right">PCR</th><th className="text-right">Support</th><th className="text-right">Resistance</th><th className="text-right">Max pain</th><th className="text-right">Stance</th></tr></thead>
              <tbody className="num">
                {list.map((r) => (
                  <tr key={r.symbol} className="border-t border-line/50">
                    <td className="py-1.5 font-sans"><Link href={`/research/?s=${r.symbol}`} className="font-medium text-accent hover:underline">{r.symbol}</Link></td>
                    <td className="text-right">{fmtNum(r.close)}</td>
                    <td className="text-right"><Pct v={r.changePct} /></td>
                    <td className={cn("pl-3 font-sans text-xs", r.fo!.buildup === "Long build-up" || r.fo!.buildup === "Short covering" ? "text-up" : r.fo!.buildup === "Short build-up" || r.fo!.buildup === "Long unwinding" ? "text-down" : "text-muted")}>{r.fo!.buildup}</td>
                    <td className="text-right"><Pct v={r.fo!.oiChangePct} d={1} /></td>
                    <td className="text-right">{fmtNum(r.fo!.pcr)}</td>
                    <td className="text-right">{fmtNum(r.fo!.support, 0)}</td>
                    <td className="text-right">{fmtNum(r.fo!.resistance, 0)}</td>
                    <td className="text-right">{fmtNum(r.fo!.maxPain, 0)}</td>
                    <td className="text-right font-sans"><StanceBadge s={r.fo!.stance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!list.length && <p className="py-3 text-sm text-muted">No F&O data in the latest update.</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

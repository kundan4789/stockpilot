"use client";

import Link from "next/link";
import { StockSearch } from "@/components/stock-search";
import { PicksStrip } from "@/components/picks";
import { useJson, type Picks } from "@/lib/data";
import { GlobalIndices, IndexStrip, MarketLoading, MarketNews, Movers, Opportunities, Sectors, useMarket } from "@/components/market-panels";

export default function Home() {
  const { d, err } = useMarket();
  const { data: picks } = useJson<Picks>("picks.json");
  return (
    <div className="space-y-6">
      <section className="pt-2 pb-2 text-center sm:pt-8 sm:pb-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
          Search any stock. <span className="bg-gradient-to-r from-blue-400 to-teal-300 bg-clip-text text-transparent">Understand every opportunity.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted sm:text-base">NIFTY 50 research every evening — technicals, disclosures, global news and AI analysis, every figure with its source and date.</p>
        <div className="mx-auto mt-6 max-w-2xl">
          <StockSearch large autoFocus />
        </div>
        <p className="mt-2 text-xs text-faint">Try RELIANCE.NS, TCS, Infosys, HDFCBANK or ICICI Bank · NIFTY 50 researched every evening after market close</p>
      </section>
      {!d ? (
        <MarketLoading err={err} />
      ) : (
        <>
          <p className="text-center text-[11px] text-faint">Last update {new Date(d.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} · end-of-day data</p>
          <IndexStrip d={d} />
          {picks && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-wide uppercase">🔥 Top picks of the week</h2>
                <span className="flex gap-3 text-xs"><Link href="/map/" className="text-accent">Market map →</Link><Link href="/picks/" className="text-accent">All picks & trending →</Link></span>
              </div>
              <PicksStrip buys={picks.bestBuys} sells={picks.bestSells} />
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Movers d={d} />
              <Sectors d={d} />
            </div>
            <div className="space-y-4">
              <Opportunities />
              <GlobalIndices d={d} />
              <MarketNews d={d} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

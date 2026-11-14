"use client";

import Link from "next/link";
import { useJson, type Picks } from "@/lib/data";
import { PickCard } from "@/components/picks";
import { Card, Notice, Pct, Spinner } from "@/components/ui";

export default function PicksPage() {
  const { data: p, error } = useJson<Picks>("picks.json");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Top Picks of the Week</h1>
        {p && <p className="text-xs text-muted">Based on research after the {p.asOf} close · refreshed every trading day</p>}
      </div>
      {error && <Notice kind="warn">{error}</Notice>}
      {!p ? <Spinner /> : (
        <>
          <Card title="🔥 Trending stocks" subtitle="Biggest 1-week moves backed by above-average volume">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold text-up">Trending up</div>
                <div className="grid gap-2 sm:grid-cols-2">{p.trendingUp.map((x) => <PickCard key={x.symbol} p={x} side="trend" />)}</div>
                {!p.trendingUp.length && <p className="text-sm text-muted">None this week.</p>}
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold text-down">Trending down</div>
                <div className="grid gap-2 sm:grid-cols-2">{p.trendingDown.map((x) => <PickCard key={x.symbol} p={x} side="trend" />)}</div>
                {!p.trendingDown.length && <p className="text-sm text-muted">None this week.</p>}
              </div>
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="✅ Best buys of the week" subtitle="Swing horizon (2–12 weeks), with entry, target and stop-loss">
              <div className="grid gap-2 sm:grid-cols-2">{p.bestBuys.map((x) => <PickCard key={x.symbol} p={x} side="buy" />)}</div>
              {!p.bestBuys.length && <p className="text-sm text-muted">No stock meets the BUY bar this week.</p>}
            </Card>
            <Card title="⛔ Best sells / avoid of the week" subtitle="Weakest swing setups — consider exiting or avoiding">
              <div className="grid gap-2 sm:grid-cols-2">{p.bestSells.map((x) => <PickCard key={x.symbol} p={x} side="sell" />)}</div>
              {!p.bestSells.length && <p className="text-sm text-muted">No stock meets the SELL bar this week.</p>}
            </Card>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="F&O long build-up" subtitle="Price up with rising futures open interest">
              <ul className="space-y-1 text-sm">{p.longBuildup.map((x) => <li key={x.symbol} className="flex justify-between"><Link className="text-accent" href={`/research/?s=${x.symbol}`}>{x.symbol}</Link><span>price <Pct v={x.changePct} /> · OI <Pct v={x.oiChangePct} d={1} /></span></li>)}</ul>
              {!p.longBuildup.length && <p className="text-sm text-muted">None in the latest session.</p>}
            </Card>
            <Card title="F&O short build-up" subtitle="Price down with rising futures open interest">
              <ul className="space-y-1 text-sm">{p.shortBuildup.map((x) => <li key={x.symbol} className="flex justify-between"><Link className="text-accent" href={`/research/?s=${x.symbol}`}>{x.symbol}</Link><span>price <Pct v={x.changePct} /> · OI <Pct v={x.oiChangePct} d={1} /></span></li>)}</ul>
              {!p.shortBuildup.length && <p className="text-sm text-muted">None in the latest session.</p>}
            </Card>
          </div>
          <Card title="How picks are chosen">
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">{p.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </Card>
        </>
      )}
    </div>
  );
}

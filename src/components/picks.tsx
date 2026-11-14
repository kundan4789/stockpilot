"use client";

import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { WeeklyPick } from "@/lib/data";
import { cn, fmtNum, Pct, VerdictBadge } from "./ui";

export function PickCard({ p, side }: { p: WeeklyPick; side: "buy" | "sell" | "trend" }) {
  return (
    <Link href={`/research/?s=${p.symbol}`} className={cn("block rounded-xl border p-3 transition-colors hover:bg-white/[0.03]", side === "buy" ? "border-up/30" : side === "sell" ? "border-down/30" : "border-line")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{p.symbol}</div>
          <div className="max-w-[160px] truncate text-[11px] text-faint">{p.name}</div>
        </div>
        <div className="text-right">
          <div className="num text-sm">₹{fmtNum(p.close)}</div>
          <Pct v={p.return1w} className="text-[11px]" /> <span className="text-[10px] text-faint">1W</span>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <VerdictBadge v={p.verdict} />
        <span className="text-[11px] text-muted">score {p.score ?? "—"} · conf {p.confidence}</span>
      </div>
      {p.levels && side !== "trend" && (
        <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
          <div className="rounded bg-white/5 px-1 py-1"><div className="text-faint">Entry</div><div className="num">{fmtNum(p.levels.entryLow, 0)}–{fmtNum(p.levels.entryHigh, 0)}</div></div>
          <div className="rounded bg-up/10 px-1 py-1"><div className="text-faint">Target</div><div className="num text-up">{fmtNum(p.levels.target, 0)}</div></div>
          <div className="rounded bg-down/10 px-1 py-1"><div className="text-faint">Stop</div><div className="num text-down">{fmtNum(p.levels.stopLoss, 0)}</div></div>
        </div>
      )}
      <ul className="mt-2 space-y-0.5 text-[11px] text-muted">{p.why.slice(0, 3).map((w, i) => <li key={i}>• {w}</li>)}</ul>
    </Link>
  );
}

export function PicksStrip({ buys, sells }: { buys: WeeklyPick[]; sells: WeeklyPick[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="glass rounded-xl p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-up"><TrendingUp className="h-4 w-4" /> Best buys this week</div>
        <div className="flex flex-wrap gap-2">
          {buys.length ? buys.map((p) => (
            <Link key={p.symbol} href={`/research/?s=${p.symbol}`} className="rounded-lg border border-up/30 px-2.5 py-1.5 text-sm hover:bg-up/10">
              <b>{p.symbol}</b> <Pct v={p.return1w} className="text-[11px]" />
            </Link>
          )) : <span className="text-xs text-muted">No stock meets the BUY bar this week.</span>}
        </div>
      </div>
      <div className="glass rounded-xl p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-down"><TrendingDown className="h-4 w-4" /> Best sells / avoid this week</div>
        <div className="flex flex-wrap gap-2">
          {sells.length ? sells.map((p) => (
            <Link key={p.symbol} href={`/research/?s=${p.symbol}`} className="rounded-lg border border-down/30 px-2.5 py-1.5 text-sm hover:bg-down/10">
              <b>{p.symbol}</b> <Pct v={p.return1w} className="text-[11px]" />
            </Link>
          )) : <span className="text-xs text-muted">No stock meets the SELL bar this week.</span>}
        </div>
      </div>
    </div>
  );
}

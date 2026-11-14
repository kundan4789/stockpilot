"use client";

import type { FoAnalysis } from "../../pipeline/fo";
import { Card, cn, fmtCompact, fmtNum, Pct, SourceLink, Unavailable } from "./ui";

const stanceCls = (s: string) => (s === "bullish" ? "bg-up/15 text-up border-up/30" : s === "bearish" ? "bg-down/15 text-down border-down/30" : "bg-warn/10 text-warn border-warn/30");

export function StanceBadge({ s }: { s: string | null | undefined }) {
  if (!s) return <span className="text-faint">—</span>;
  return <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase", stanceCls(s))}>{s}</span>;
}

export function FoCard({ fo, title = "F&O analyst view" }: { fo: FoAnalysis | null | undefined; title?: string }) {
  if (!fo) return <Card title={title}><Unavailable what="F&O data" why="Not in today's NSE F&O bhavcopy." /></Card>;
  const f = fo.futures;
  const o = fo.options;
  return (
    <Card title={title} subtitle={<>NSE F&O bhavcopy · {fo.date} · <SourceLink href={fo.sourceUrl}>source</SourceLink></>} action={<StanceBadge s={fo.stance} />}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Build-up", f?.buildup ?? "—"],
          ["Futures OI change", f?.oiChangePct != null ? <Pct key="o" v={f.oiChangePct} d={1} /> : "—"],
          ["Futures basis", f?.basisPct != null ? `${f.basisPct.toFixed(2)}%` : "—"],
          ["Futures OI", fmtCompact(f?.oi)],
          ["Put-Call Ratio", fmtNum(o?.pcr)],
          ["Max pain", fmtNum(o?.maxPain, 0)],
          ["Option support (put OI)", fmtNum(fo.levels.support, 0)],
          ["Option resistance (call OI)", fmtNum(fo.levels.resistance, 0)],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-line/70 bg-white/[0.02] px-3 py-2">
            <div className="text-[11px] text-muted">{k}</div>
            <div className="num mt-0.5 text-sm font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-1 text-sm">{fo.reasons.map((r, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />{r}</li>)}</ul>
      {o && (o.topCallOiAdds.length > 0 || o.topPutOiAdds.length > 0) && (
        <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
          <div><div className="mb-1 font-semibold text-down">Biggest call OI additions ({o.expiry})</div>{o.topCallOiAdds.map((x) => <div key={x.strike} className="num flex justify-between text-muted"><span>{x.strike} CE</span><span>+{fmtCompact(x.oiChange)}</span></div>)}</div>
          <div><div className="mb-1 font-semibold text-up">Biggest put OI additions ({o.expiry})</div>{o.topPutOiAdds.map((x) => <div key={x.strike} className="num flex justify-between text-muted"><span>{x.strike} PE</span><span>+{fmtCompact(x.oiChange)}</span></div>)}</div>
        </div>
      )}
      <p className="mt-3 text-[11px] text-faint">{fo.levels.note} Build-up compares the day&apos;s price change with the change in total futures open interest. F&O trading carries high risk; these readings describe positioning, not guaranteed direction.</p>
    </Card>
  );
}

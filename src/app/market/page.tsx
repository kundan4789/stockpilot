"use client";

import { Card, fmtNum, Pct, SourceLink } from "@/components/ui";
import { GlobalIndices, IndexStrip, MarketLoading, MarketNews, Movers, Sectors, useMarket } from "@/components/market-panels";

export default function MarketPage() {
  const { d, err } = useMarket();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Market Overview</h1>
      {!d ? (
        <MarketLoading err={err} />
      ) : (
        <>
          <IndexStrip d={d} />
          <Card title="Indian indices" subtitle={<>NSE ind_close_all · {d.indices.date ?? "n/a"} · <SourceLink href={d.indices.sourceUrl}>source</SourceLink>{d.indices.retrievedAt ? ` · retrieved ${new Date(d.indices.retrievedAt).toLocaleString("en-IN")}` : ""}</>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr><th className="py-1.5">Index</th><th className="text-right">Close</th><th className="text-right">Change</th><th className="text-right">P/E</th></tr>
                </thead>
                <tbody>
                  {[...d.indices.headline, ...d.indices.sectors].map((r) => (
                    <tr key={r.name} className="border-t border-line/60">
                      <td className="py-1.5">{r.name}</td>
                      <td className="num text-right">{fmtNum(r.close)}</td>
                      <td className="text-right"><Pct v={r.changePct} /></td>
                      <td className="num text-right text-muted">{fmtNum(r.pe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Movers d={d} />
            <Sectors d={d} />
            <GlobalIndices d={d} all />
            <MarketNews d={d} />
          </div>
        </>
      )}
    </div>
  );
}

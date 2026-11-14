"use client";

import Link from "next/link";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { StockSearch } from "@/components/stock-search";
import { ReportView } from "@/components/report-view";
import { Card, Pct, Spinner, VerdictBadge } from "@/components/ui";
import { useJson, type StockRow } from "@/lib/data";
import { useWeights } from "@/lib/local";
import { rescore } from "@/lib/rescore";

function ResearchIndex() {
  const { data } = useJson<StockRow[]>("stocks.json");
  const [w] = useWeights();
  const rows = useMemo(() => (data ?? []).map((s) => ({ s, r: rescore(s.components, s.asOf, w) })).sort((a, b) => (b.s.researchScore ?? -1) - (a.s.researchScore ?? -1) || a.s.symbol.localeCompare(b.s.symbol)), [data, w]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">AI Research</h1>
      <StockSearch />
      <Card title="Tonight's research — NIFTY 50" subtitle="Every stock is fully re-researched after each market close. Click a stock for the complete report.">
        {!data ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-1.5">Stock</th><th className="text-right">Close</th><th className="text-right">Day</th>{["Short", "Swing", "3–12 m", "1–5 y"].map((h) => <th key={h} className="text-right">{h}</th>)}<th className="text-right">Confidence</th></tr>
              </thead>
              <tbody>
                {rows.map(({ s, r }) => (
                  <tr key={s.symbol} className="border-t border-line/60">
                    <td className="py-2"><Link className="font-medium text-accent hover:underline" href={`/research/?s=${s.symbol}`}>{s.symbol}</Link><div className="max-w-[200px] truncate text-[10px] text-faint">{s.name}</div></td>
                    <td className="num text-right">{s.close?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}</td>
                    <td className="text-right"><Pct v={s.changePct} /></td>
                    {r.map((x) => <td key={x.horizon} className="text-right"><VerdictBadge v={x.verdict} /></td>)}
                    <td className="num text-right">{Math.max(...r.map((x) => x.confidence))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Router() {
  const s = useSearchParams().get("s");
  return s ? <ReportView key={s} symbol={s} /> : <ResearchIndex />;
}

export default function ResearchPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Router />
    </Suspense>
  );
}

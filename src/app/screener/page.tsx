"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useJson, type StockRow } from "@/lib/data";
import { useWeights } from "@/lib/local";
import { rescore } from "@/lib/rescore";
import { Button, Card, cn, fmtCompact, fmtNum, Input, Notice, Pct, Select, Spinner, VerdictBadge } from "@/components/ui";

interface Row {
  symbol: string; name: string; sector: string | null; close: number | null; asOf: string | null; marketCap: number | null;
  revenueGrowth: number | null; profitGrowth: number | null; roe: number | null; roce: number | null; debtToEquity: number | null; pe: number | null;
  rsi: number | null; aboveSma50: boolean | null; aboveSma200: boolean | null; trend: string | null; technicalScore: number | null; fundamentalScore: number | null;
  return3m: number | null; atrPct: number | null; verdict: string | null; swing?: string | null; reportId: string | null;
}
type Range = { min?: string; max?: string };
const FIELDS: { k: keyof Row; label: string }[] = [
  { k: "marketCap", label: "Market cap" }, { k: "revenueGrowth", label: "Revenue growth %" }, { k: "profitGrowth", label: "Profit growth %" },
  { k: "roe", label: "ROE %" }, { k: "roce", label: "ROCE %" }, { k: "debtToEquity", label: "Debt/Equity" }, { k: "pe", label: "P/E" },
  { k: "rsi", label: "RSI 14" }, { k: "fundamentalScore", label: "Fundamental score" }, { k: "technicalScore", label: "Technical score" },
];

/** Best research opportunities rule (shown in the UI). */
function opportunity(r: Row): { score: number; basis: string } | null {
  if (r.technicalScore == null || r.close == null) return null;
  if ([r.verdict, r.swing].some((v) => v === "SELL" || v === "STRONG SELL")) return null;
  const risk = r.atrPct == null ? 50 : Math.max(0, 100 - (r.atrPct / 6) * 100);
  if (r.fundamentalScore != null) {
    const val = r.pe == null ? null : Math.max(0, Math.min(100, 100 - ((r.pe - 10) / 50) * 100));
    const parts = [r.fundamentalScore * 0.4, r.technicalScore * 0.3, (val ?? 50) * 0.15, risk * 0.15];
    return { score: Math.round(parts.reduce((a, b) => a + b, 0)), basis: "quality + momentum + valuation + risk" };
  }
  return { score: Math.round(r.technicalScore * 0.7 + risk * 0.3), basis: "momentum + risk only (no fundamentals stored)" };
}

type Sort = { k: keyof Row; dir: 1 | -1 };
function Th({ k, children, right = true, sort, setSort }: { k: keyof Row; children: React.ReactNode; right?: boolean; sort: Sort; setSort: React.Dispatch<React.SetStateAction<Sort>> }) {
  return (
    <th className={cn("cursor-pointer py-1.5 select-none whitespace-nowrap hover:text-ink", right ? "text-right" : "text-left")} onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      {children}{sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );
}

export default function ScreenerPage() {
  const { data: raw, error: err } = useJson<StockRow[]>("stocks.json");
  const [w] = useWeights();
  const data = useMemo(() => {
    if (!raw) return null;
    const rows: Row[] = raw.map((s) => ({ ...s, verdict: rescore(s.components, s.asOf, w).find((x) => x.horizon === "medium")!.verdict, swing: rescore(s.components, s.asOf, w).find((x) => x.horizon === "swing")!.verdict, reportId: null }));
    return { rows, sectors: [...new Set(rows.map((r) => r.sector).filter(Boolean) as string[])].sort(), coverage: { prices: rows.filter((r) => r.close != null).length, fundamentals: rows.filter((r) => r.roe != null).length, total: rows.length } };
  }, [raw, w]);
  const [sector, setSector] = useState("");
  const [trend, setTrend] = useState("");
  const [ma, setMa] = useState("");
  const [verdict, setVerdict] = useState("");
  const [ranges, setRanges] = useState<Partial<Record<keyof Row, Range>>>({});
  const [sort, setSort] = useState<Sort>({ k: "technicalScore", dir: -1 });

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((r) => (!sector || r.sector === sector) && (!trend || r.trend === trend) && (!verdict || r.verdict === verdict))
      .filter((r) => (ma === "above50" ? r.aboveSma50 === true : ma === "below50" ? r.aboveSma50 === false : ma === "above200" ? r.aboveSma200 === true : ma === "below200" ? r.aboveSma200 === false : true))
      .filter((r) =>
        Object.entries(ranges).every(([k, rg]) => {
          const v = r[k as keyof Row] as number | null;
          if (!rg || (rg.min === "" || rg.min == null) && (rg.max === "" || rg.max == null)) return true;
          if (v == null) return false; // missing data never passes an active filter
          return (rg.min == null || rg.min === "" || v >= Number(rg.min)) && (rg.max == null || rg.max === "" || v <= Number(rg.max));
        }),
      )
      .sort((a, b) => {
        const x = a[sort.k] as number | null, y = b[sort.k] as number | null;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x > y ? 1 : x < y ? -1 : 0) * sort.dir;
      });
  }, [data, sector, trend, ma, verdict, ranges, sort]);

  const best = useMemo(() => (data?.rows ?? []).map((r) => ({ r, o: opportunity(r) })).filter((x) => x.o).sort((a, b) => b.o!.score - a.o!.score).slice(0, 6), [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Stock Screener</h1>
<span className="text-xs text-muted">Universe: NIFTY 50 · updated daily</span>
      </div>
      {err && <Notice kind="warn">{err}</Notice>}
      {!data ? (
        <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Computing indicators from stored prices…</div>
      ) : (
        <>
          <Notice>
            Data coverage: prices for {data.coverage.prices}/{data.coverage.total}, fundamentals for {data.coverage.fundamentals}/{data.coverage.total}. Stocks missing a field never pass a filter on that field.
          </Notice>
          <Card title="Best research opportunities" subtitle="Rule: 40% fundamental score + 30% technical score + 15% valuation (P/E 10→100, 60→0) + 15% risk (ATR% 0→100, 6%→0); momentum-only when fundamentals are missing; SELL verdicts excluded. Candidates for research — not guaranteed winners.">
            {!best.length ? <p className="text-sm text-muted">Not enough stored data yet.</p> : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {best.map(({ r, o }) => (
                  <Link key={r.symbol} href={`/research/?s=${r.symbol}`} className="rounded-lg border border-line px-3 py-2 hover:border-accent/40">
                    <div className="flex items-center justify-between"><span className="font-semibold">{r.symbol}</span><span className="num text-lg font-bold">{o!.score}</span></div>
                    <div className="text-[11px] text-muted">{r.sector ?? "—"} · {o!.basis}</div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
          <Card title="Filters">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select value={sector} onChange={(e) => setSector(e.target.value)}><option value="">All sectors</option>{data.sectors.map((s) => <option key={s}>{s}</option>)}</Select>
              <Select value={trend} onChange={(e) => setTrend(e.target.value)}><option value="">Any trend</option><option>bullish</option><option>sideways</option><option>bearish</option></Select>
              <Select value={ma} onChange={(e) => setMa(e.target.value)}><option value="">Any moving-average position</option><option value="above50">Above SMA50</option><option value="below50">Below SMA50</option><option value="above200">Above SMA200</option><option value="below200">Below SMA200</option></Select>
              <Select value={verdict} onChange={(e) => setVerdict(e.target.value)}><option value="">Any AI recommendation</option>{["STRONG BUY", "BUY", "HOLD", "SELL", "STRONG SELL", "INSUFFICIENT DATA"].map((v) => <option key={v}>{v}</option>)}</Select>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {FIELDS.map((f) => (
                <div key={f.k}>
                  <div className="mb-1 text-[11px] text-muted">{f.label}</div>
                  <div className="flex gap-1">
                    <Input placeholder="min" inputMode="decimal" value={ranges[f.k]?.min ?? ""} onChange={(e) => setRanges((r) => ({ ...r, [f.k]: { ...r[f.k], min: e.target.value } }))} className="px-2 py-1 text-xs" />
                    <Input placeholder="max" inputMode="decimal" value={ranges[f.k]?.max ?? ""} onChange={(e) => setRanges((r) => ({ ...r, [f.k]: { ...r[f.k], max: e.target.value } }))} className="px-2 py-1 text-xs" />
                  </div>
                </div>
              ))}
            </div>
            <Button variant="ghost" className="mt-2" onClick={() => { setRanges({}); setSector(""); setTrend(""); setMa(""); setVerdict(""); }}>Reset filters</Button>
          </Card>
          <Card title={`Results (${rows.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <Th sort={sort} setSort={setSort} k="symbol" right={false}>Stock</Th><Th sort={sort} setSort={setSort} k="close">Close</Th><Th sort={sort} setSort={setSort} k="return3m">3M</Th><Th sort={sort} setSort={setSort} k="marketCap">Mcap</Th><Th sort={sort} setSort={setSort} k="revenueGrowth">Rev g%</Th><Th sort={sort} setSort={setSort} k="profitGrowth">PAT g%</Th>
                    <Th sort={sort} setSort={setSort} k="roe">ROE</Th><Th sort={sort} setSort={setSort} k="roce">ROCE</Th><Th sort={sort} setSort={setSort} k="debtToEquity">D/E</Th><Th sort={sort} setSort={setSort} k="pe">P/E</Th><Th sort={sort} setSort={setSort} k="rsi">RSI</Th><Th sort={sort} setSort={setSort} k="trend">Trend</Th><Th sort={sort} setSort={setSort} k="technicalScore">Tech</Th><Th sort={sort} setSort={setSort} k="fundamentalScore">Fund</Th><Th sort={sort} setSort={setSort} k="swing">Swing</Th><Th sort={sort} setSort={setSort} k="verdict">3–12m</Th>
                  </tr>
                </thead>
                <tbody className="num">
                  {rows.map((r) => (
                    <tr key={r.symbol} className="border-t border-line/50 hover:bg-white/[0.02]">
                      <td className="py-1.5 font-sans"><Link href={`/research/?s=${r.symbol}`} className="font-medium text-accent hover:underline">{r.symbol}</Link><div className="max-w-[160px] truncate text-[10px] text-faint">{r.sector}</div></td>
                      <td className="text-right">{fmtNum(r.close)}</td><td className="text-right"><Pct v={r.return3m} d={1} /></td><td className="text-right">{fmtCompact(r.marketCap)}</td>
                      <td className="text-right">{fmtNum(r.revenueGrowth, 1)}</td><td className="text-right">{fmtNum(r.profitGrowth, 1)}</td><td className="text-right">{fmtNum(r.roe, 1)}</td><td className="text-right">{fmtNum(r.roce, 1)}</td>
                      <td className="text-right">{fmtNum(r.debtToEquity)}</td><td className="text-right">{fmtNum(r.pe, 1)}</td><td className="text-right">{fmtNum(r.rsi, 0)}</td>
                      <td className={cn("text-right font-sans text-xs", r.trend === "bullish" ? "text-up" : r.trend === "bearish" ? "text-down" : "text-muted")}>{r.trend ?? "—"}</td>
                      <td className="text-right">{r.technicalScore ?? "—"}</td><td className="text-right">{r.fundamentalScore ?? "—"}</td>
                      <td className="text-right font-sans"><VerdictBadge v={r.swing} /></td><td className="text-right font-sans"><VerdictBadge v={r.verdict} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

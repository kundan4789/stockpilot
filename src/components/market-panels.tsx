"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useJson, type MarketData, type Mover, type StockRow } from "@/lib/data";
import { useWeights } from "@/lib/local";
import { rescore } from "@/lib/rescore";
import { Card, cn, fmtNum, Notice, Pct, SourceLink, Spinner, StatusDot, Unavailable, VerdictBadge } from "./ui";

export type { MarketData };

export function useMarket() {
  const { data, error } = useJson<MarketData>("market.json");
  return { d: data, err: error };
}

export function IndexStrip({ d }: { d: MarketData }) {
  const nifty = d.indices.headline.find((r) => r.name === "NIFTY 50");
  const bank = d.indices.headline.find((r) => r.name === "NIFTY BANK");
  const tiles = [
    { name: "NIFTY 50", v: nifty?.close ?? null, c: nifty?.changePct ?? null, date: nifty?.date, src: d.indices.sourceUrl, status: nifty ? "ok" : "unavailable" },
    { name: "SENSEX", v: d.sensex.value, c: d.sensex.changePct ?? null, date: d.sensex.asOf?.slice(0, 10), src: d.sensex.url, status: d.sensex.value != null ? "ok" : "unavailable" },
    { name: "BANK NIFTY", v: bank?.close ?? null, c: bank?.changePct ?? null, date: bank?.date, src: d.indices.sourceUrl, status: bank ? "ok" : "unavailable" },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map((t) => (
        <div key={t.name} className="glass rounded-xl px-4 py-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-semibold tracking-wide">{t.name}</span>
            <StatusDot s={t.status} />
          </div>
          {t.v != null ? (
            <>
              <div className="num mt-1 text-2xl font-semibold">{fmtNum(t.v)}</div>
              <div className="mt-0.5 flex items-center justify-between text-xs">
                <Pct v={t.c} />
                <SourceLink href={t.src}>{t.date ?? "source"}</SourceLink>
              </div>
            </>
          ) : (
            <div className="mt-2 text-xs text-muted">Unavailable — source did not return a value. No figure is shown rather than a guess.</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function GlobalIndices({ d, all }: { d: MarketData; all?: boolean }) {
  const items = d.global.items.filter((i) => all || ["FRED:SP500", "FRED:NASDAQCOM", "FRED:DJIA", "FRED:DEXINUS", "FRED:DCOILBRENTEU"].includes(i.id));
  return (
    <Card title="Global markets & macro" subtitle="FRED daily series (US close; may lag one session)">
      {d.global.error && <Notice kind="warn" className="mb-3">{d.global.error}</Notice>}
      <table className="w-full text-sm">
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-line/60 last:border-0">
              <td className="py-1.5 text-muted">
                <SourceLink href={i.sourceUrl}>{i.name}</SourceLink>
              </td>
              <td className="num py-1.5 text-right">{i.value == null ? <span className="text-faint">n/a</span> : fmtNum(i.value)}</td>
              <td className="py-1.5 pl-3 text-right">{i.value != null && i.prev ? <Pct v={((i.value - i.prev) / i.prev) * 100} /> : <span className="text-faint">—</span>}</td>
              <td className="num hidden py-1.5 pl-3 text-right text-xs text-faint sm:table-cell">{i.date ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function MoverList({ rows }: { rows: Mover[] }) {
  return (
    <ul className="space-y-1">
      {rows.map((m) => (
        <li key={m.symbol}>
          <Link href={`/research/?s=${m.symbol}`} className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-white/5">
            <span className="font-medium">{m.symbol}</span>
            <span className="flex gap-3">
              <span className="num text-muted">{fmtNum(m.close)}</span>
              <Pct v={m.changePct} className="w-16 text-right" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Movers({ d }: { d: MarketData }) {
  if (!d.movers.count) return <Card title="Top gainers & losers"><Unavailable what="Movers" why="No end-of-day prices published yet." /></Card>;
  return (
    <Card title="Top gainers & losers" subtitle={`${d.movers.universe} · session ${d.movers.date} · NSE bhavcopy`}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold text-up">Gainers</div>
          <MoverList rows={d.movers.gainers} />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold text-down">Losers</div>
          <MoverList rows={d.movers.losers} />
        </div>
      </div>
    </Card>
  );
}

export function Sectors({ d }: { d: MarketData }) {
  if (!d.indices.sectors.length) return <Card title="Sector movements"><Unavailable what="Sector indices" why="NSE indices file not available in the latest update." /></Card>;
  const max = Math.max(...d.indices.sectors.map((s) => Math.abs(s.changePct ?? 0)), 0.5);
  return (
    <Card title="Sector movements" subtitle={<>NSE sectoral indices · {d.indices.date} · <SourceLink href={d.indices.sourceUrl}>source</SourceLink></>}>
      <ul className="space-y-1.5">
        {[...d.indices.sectors].sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).map((s) => (
          <li key={s.name} className="grid grid-cols-[1fr_120px_56px] items-center gap-2 text-sm">
            <span className="truncate text-muted">{s.name.replace("NIFTY ", "")}</span>
            <span className="relative h-2 rounded bg-white/5">
              <span className={cn("absolute top-0 h-2 rounded", (s.changePct ?? 0) >= 0 ? "left-1/2 bg-up/70" : "right-1/2 bg-down/70")} style={{ width: `${(Math.abs(s.changePct ?? 0) / max) * 50}%` }} />
            </span>
            <Pct v={s.changePct} className="text-right text-xs" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function MarketNews({ d }: { d: MarketData }) {
  return (
    <Card title="Market news" subtitle="GDELT · Indian market headlines, last 48h">
      {!d.news.length ? (
        <Unavailable what="Market news" />
      ) : (
        <ul className="space-y-2.5">
          {d.news.slice(0, 8).map((n) => (
            <li key={n.url} className="text-sm leading-snug">
              <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-accent">
                {n.headline}
              </a>
              <div className="mt-0.5 text-[11px] text-faint">
                {n.publisher} · {new Date(n.publishedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Opportunities() {
  const { data } = useJson<StockRow[]>("stocks.json");
  const [w] = useWeights();
  const opps = useMemo(
    () =>
      (data ?? [])
        .map((s) => ({ s, recs: rescore(s.components, s.asOf, w) }))
        .map(({ s, recs }) => ({ s, sw: recs.find((r) => r.horizon === "swing")!, md: recs.find((r) => r.horizon === "medium")! }))
        .filter(({ sw, md }) => [sw.verdict, md.verdict].some((v) => v === "BUY" || v === "STRONG BUY") && Math.max(sw.confidence, md.confidence) >= 50)
        .sort((a, b) => (b.md.score ?? b.sw.score ?? 0) - (a.md.score ?? a.sw.score ?? 0))
        .slice(0, 8),
    [data, w],
  );
  return (
    <Card title="AI research opportunities" subtitle="NIFTY 50 stocks rated BUY / STRONG BUY (swing or medium term) with confidence ≥ 50 in tonight's research. Not a guarantee of returns.">
      {!data ? (
        <Spinner />
      ) : !opps.length ? (
        <p className="text-sm text-muted">No stock meets the bar today. Open the <Link href="/screener/" className="text-accent">screener</Link> to explore.</p>
      ) : (
        <ul className="divide-y divide-line">
          {opps.map(({ s, sw, md }) => (
            <li key={s.symbol}>
              <Link href={`/research/?s=${s.symbol}`} className="flex items-center justify-between gap-2 py-2 hover:text-accent">
                <span className="font-medium">{s.symbol}</span>
                <span className="flex items-center gap-2 text-[11px] text-muted">
                  swing <VerdictBadge v={sw.verdict} /> 3–12m <VerdictBadge v={md.verdict} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function MarketLoading({ err }: { err: string | null }) {
  return err ? <Notice kind="warn">{err}</Notice> : <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading market data from NSE, BSE, FRED and GDELT…</div>;
}

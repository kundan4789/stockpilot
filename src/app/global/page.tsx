"use client";

import { useState } from "react";
import { useJson, type MarketData } from "@/lib/data";
import type { ResearchReport } from "@/lib/report-types";
import { StockSearch } from "@/components/stock-search";
import { Card, cn, fmtNum, Notice, SourceLink, Spinner, StatusDot, Unavailable } from "@/components/ui";

export default function GlobalPage() {
  const [sym, setSym] = useState<string | null>(null);
  const { data: m, error } = useJson<MarketData>("market.json");
  const { data: rep } = useJson<ResearchReport>(sym ? `reports/${sym}.json` : null);
  const [cat, setCat] = useState("");
  const news = rep && rep.company.symbol === sym ? rep.news : [];
  const cats = [...new Set(news.map((n) => n.category))];
  const shown = news.filter((n) => !cat || n.category === cat);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Global Intelligence</h1>
      <StockSearch onPick={(h) => { setCat(""); setSym(h.symbol); }} />
      {error && <Notice kind="warn">{error}</Notice>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Macro & global indicators">
          {!m ? <Spinner /> : (
            <>
              {m.global.error && <Notice kind="warn" className="mb-2">{m.global.error}</Notice>}
              <ul className="space-y-1.5 text-sm">
                {m.macro.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2"><StatusDot s={x.status} /><SourceLink href={x.sourceUrl}>{x.name}</SourceLink></span>
                    <span className="num text-right">{x.value == null ? <span className="text-faint">n/a</span> : `${fmtNum(x.value)} ${x.unit}`}<div className="text-[10px] text-faint">{x.date}</div></span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card title={rep && sym ? `Developments relevant to ${rep.company.name}` : "Company intelligence"} subtitle={sym ? "Relevance = direct mention 0.95 · group/brand 0.7 · competitor 0.55 · sector theme 0.25–0.55 · other 0.1" : undefined} className="lg:col-span-2">
          {!sym ? (
            <p className="text-sm text-muted">Search a NIFTY 50 company to see global developments — industry investments, M&A, competitors, policy, commodities, rates, currency and supply chain — each scored for relevance with the reason shown.</p>
          ) : !rep ? <Spinner /> : !shown.length ? <Unavailable what="Relevant news" /> : (
            <>
              <div className="mb-3 flex flex-wrap gap-1">
                {["", ...cats].map((c) => <button key={c} onClick={() => setCat(c)} className={cn("rounded-md px-2 py-1 text-xs", cat === c ? "bg-accent/15 text-accent" : "text-muted hover:text-ink")}>{c || "all"}</button>)}
              </div>
              <ul className="space-y-3">
                {shown.slice(0, 40).map((n) => (
                  <li key={n.url} className="border-b border-line/50 pb-2 last:border-0">
                    <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className="text-sm leading-snug hover:text-accent">{n.headline}</a>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-faint">
                      <span>{n.publisher}</span><span>published {n.publishedAt.slice(0, 16).replace("T", " ")}</span><span>retrieved {n.retrievedAt.slice(0, 16).replace("T", " ")}</span>
                      <span className={n.sentiment === "positive" ? "text-up" : n.sentiment === "negative" ? "text-down" : ""}>{n.sentiment}</span>
                      <span>relevance {n.relevance.toFixed(2)}</span><span>{n.impact} impact</span><span>{n.category}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{n.evidence}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

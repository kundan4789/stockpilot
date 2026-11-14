"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FoCard } from "./fo-card";
import { SignalPanel, StopLossTool, useSignals, type PlanLines } from "./trade-guide";
import { Check, ExternalLink, Star } from "lucide-react";
import { useJson } from "@/lib/data";
import { useWatchlist, useWeights, isCustomWeights } from "@/lib/local";
import { rescore } from "@/lib/rescore";
import type { ResearchReport } from "@/lib/report-types";
import type { Statement } from "@/lib/ai/narrative";
import { PriceChart } from "@/components/price-chart";
import { Button, Card, cn, fmtCompact, fmtNum, fmtPct, Notice, Pct, ScoreBar, SourceLink, Spinner, StatusDot, Unavailable, VerdictBadge } from "@/components/ui";

type Hist = { date: string; close: number | null; score: number | null; confidence: number; verdicts: Record<string, string> }[];

export function ReportView({ symbol }: { symbol: string }) {
  const sym = symbol.toUpperCase().replace(/^(NSE|BSE):/, "").replace(/\.(NS|BO)$/, "");
  const { data, error } = useJson<ResearchReport & { history?: Hist }>(`reports/${encodeURIComponent(sym)}.json`);
  const [w] = useWeights();
  const rep = useMemo(() => {
    if (!data || !isCustomWeights(w)) return data;
    // Re-apply the user's own weights from Settings (component scores unchanged).
    const re = rescore(data.components, data.price.lastDate, w);
    return {
      ...data,
      recommendations: data.recommendations.map((r) => {
        const x = re.find((y) => y.horizon === r.horizon)!;
        const blocked = x.verdict === "SELL" || x.verdict === "STRONG SELL" || x.verdict === "INSUFFICIENT DATA";
        return { ...r, verdict: x.verdict, score: x.score, confidence: x.confidence, levels: blocked && r.levels.actionable ? { ...r.levels, actionable: false, reasonIfNot: `Verdict is ${x.verdict} under your custom weights — no long entry suggested.` } : r.levels };
      }),
      researchScore: re.find((y) => y.horizon === "medium")!.score,
    };
  }, [data, w]);
  if (error)
    return (
      <div className="space-y-4">
        <Notice kind="warn">{error.includes("not published") ? `No research report for “${sym}”. StockPilot covers the NIFTY 50 constituents.` : error}</Notice>
        <Link href="/search/" className="text-sm text-accent">← Back to search</Link>
      </div>
    );
  if (!rep) return <div className="flex items-center gap-2 text-sm text-muted"><Spinner /> Loading research report…</div>;
  return <Report rep={rep} history={data?.history ?? []} custom={isCustomWeights(w)} />;
}

function Cites({ ids, sources }: { ids: string[]; sources: ResearchReport["sources"] }) {
  if (!ids.length) return null;
  return (
    <sup className="ml-0.5 space-x-0.5">
      {ids.map((id) => {
        const i = sources.findIndex((s) => s.id === id);
        if (i < 0) return null;
        return (
          <a key={id} href={`#src-${i + 1}`} className="text-[10px] text-accent hover:underline">
            [{i + 1}]
          </a>
        );
      })}
    </sup>
  );
}

function Statements({ items, sources, empty }: { items: Statement[]; sources: ResearchReport["sources"]; empty?: string }) {
  if (!items?.length) return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  return (
    <ul className="space-y-1.5 text-sm leading-relaxed">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span>
            {s.text}
            <Cites ids={s.cites} sources={sources} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function KV({ k, v, sub }: { k: string; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line/70 bg-white/[0.02] px-3 py-2">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="num mt-0.5 font-semibold">{v}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

function Report({ rep, history, custom }: { rep: ResearchReport; history: Hist; custom: boolean }) {
  const c = rep.company;
  const t = rep.technical;
  const [watchlist, setWatchlist] = useWatchlist();
  const onList = watchlist.some((x) => x.symbol === rep.company.symbol);
  const sources = rep.sources;
  const N = rep.narrative;
  const medium = rep.recommendations.find((r) => r.horizon === "medium");
  const [plan, setPlan] = useState<PlanLines | null>(null);
  const sig = useSignals(rep.candles);
  const chartLevels = useMemo(() => {
    if (plan?.stop) return [
      { price: plan.entry!, label: "Your entry", color: "#60a5fa" },
      { price: plan.target!, label: "Your target", color: "#22c55e" },
      { price: plan.stop, label: "Your stop-loss", color: "#ef4444" },
    ];
    const l = rep.recommendations.find((r) => r.horizon === "swing")?.levels;
    if (!l?.actionable) return [];
    return [
      { price: l.target!, label: "Swing target", color: "#22c55e" },
      { price: l.stopLoss!, label: "Swing stop", color: "#ef4444" },
    ];
  }, [rep, plan]);
  const addWatch = () => {
    if (!onList) setWatchlist([...watchlist, { symbol: c.symbol, addedAt: new Date().toISOString(), buyPrice: null, quantity: null, target: null, stopLoss: null, notes: null }]);
  };
  const fin = rep.fundamentals.bundle;
  const sh = rep.institutional.bundle;

  return (
    <article className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs text-muted">
            {c.exchange} · {c.symbol} {c.isin ? `· ${c.isin}` : ""} {c.sector ? `· ${c.sector}` : ""}
          </div>
          <h1 className="text-2xl font-bold sm:text-3xl">{c.name}</h1>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            {rep.price.lastClose != null ? (
              <>
                <span className="num text-3xl font-semibold">₹{fmtNum(rep.price.lastClose)}</span>
                <Pct v={rep.price.changePct} className="text-base" />
                <span className="text-xs text-muted">
                  close {rep.price.lastDate} · <SourceLink href={rep.price.sourceUrl}>{rep.price.source}</SourceLink>
                </span>
                {rep.price.status === "stale" && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[11px] text-warn">STALE</span>}
              </>
            ) : (
              <span className="text-sm text-warn">Price data unavailable</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={addWatch} disabled={onList}>
            {onList ? <Check className="h-4 w-4 text-up" /> : <Star className="h-4 w-4" />}
            {onList ? "On watchlist" : "Add to watchlist"}
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-faint">
        Researched {new Date(rep.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} (daily after market close) · narrative: {rep.narrativeSource}{custom ? " · verdicts recalculated with your custom weights (Settings)" : ""}
      </p>

      {/* Executive summary + assessment */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Executive summary" className="lg:col-span-2">
          <Statements items={N.executiveSummary} sources={sources} />
        </Card>
        <Card title="Research score" subtitle="Medium-term weights (configurable in Settings)">
          <div className="flex items-center gap-4">
            <div className="num text-4xl font-bold">{rep.researchScore ?? "—"}</div>
            <div className="space-y-1">
              <VerdictBadge v={medium?.verdict} />
              <div className="text-xs text-muted">Research confidence {rep.confidence}/100</div>
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">Confidence measures completeness and reliability of evidence — not the probability of making a profit. {rep.confidenceNotes.join(" ")}</p>
          <div className="mt-3 space-y-1.5">
            {rep.components.map((k) => (
              <div key={k.key}>
                <div className="flex justify-between text-[11px] text-muted">
                  <span>{k.label}</span>
                  <span>{Math.round(k.weight * 100)}%</span>
                </div>
                <ScoreBar v={k.score} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 13/14 Assessment & entry/exit */}
      <Card title="AI investment assessment · entry & exit scenarios" subtitle="Levels come from the deterministic price-level module (ATR, support/resistance, volatility). The language model never sets prices.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {rep.recommendations.map((r) => {
            const l = r.levels;
            return (
              <div key={r.horizon} className="rounded-xl border border-line bg-white/[0.02] p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">{l.label}</div>
                    <div className="text-[11px] text-muted">{l.timeframe}</div>
                  </div>
                  <VerdictBadge v={r.verdict} />
                </div>
                <div className="mt-2 flex justify-between text-[11px] text-muted">
                  <span>Score {r.score ?? "—"}</span>
                  <span>Confidence {r.confidence}</span>
                </div>
                {l.actionable ? (
                  <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                    <dt className="text-muted">Latest price</dt><dd className="num text-right">{fmtNum(l.lastPrice)}</dd>
                    <dt className="text-muted">Entry range</dt><dd className="num text-right">{fmtNum(l.entryLow)}–{fmtNum(l.entryHigh)}</dd>
                    <dt className="text-muted">Target</dt><dd className="num text-right text-up">{fmtNum(l.target)}</dd>
                    <dt className="text-muted">Stop-loss</dt><dd className="num text-right text-down">{fmtNum(l.stopLoss)}</dd>
                    <dt className="text-muted">Upside / downside</dt><dd className="num text-right"><Pct v={l.upsidePct} /> / <Pct v={l.downsidePct} /></dd>
                    <dt className="text-muted">Risk / reward</dt><dd className="num text-right">1 : {fmtNum(l.riskReward)}</dd>
                  </dl>
                ) : (
                  <p className="mt-2 rounded-md bg-white/5 px-2 py-1.5 text-[11px] text-muted">{l.reasonIfNot ?? "No actionable levels."}</p>
                )}
                {l.method.length > 0 && (
                  <details className="mt-2 text-[11px] text-muted">
                    <summary className="cursor-pointer text-accent">How these levels were calculated</summary>
                    <ol className="mt-1 list-decimal space-y-0.5 pl-4">{l.method.map((m, i) => <li key={i}>{m}</li>)}</ol>
                  </details>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div>
            <h3 className="mb-1 text-xs font-semibold text-up">Positive catalysts</h3>
            <Statements items={N.positiveCatalysts} sources={sources} empty="None identified from available evidence." />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold text-down">Negative catalysts</h3>
            <Statements items={N.negativeCatalysts} sources={sources} empty="None identified from available evidence." />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold text-warn">Thesis invalidation</h3>
            <Statements items={N.invalidation} sources={sources} empty="No invalidation levels (no actionable setup)." />
          </div>
        </div>
      </Card>

      {/* 1 Company overview & 2 current position */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Company overview">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <KV k="Exchange" v={c.exchange} />
            <KV k="Symbol" v={c.symbol} />
            <KV k="ISIN" v={c.isin ?? "—"} />
            <KV k="Sector" v={c.sector ?? "—"} />
            <KV k="Indices" v={c.indices?.length ? c.indices.join(", ") : "—"} />
            <KV k="Market cap" v={fmtCompact(fin?.annual[0]?.marketCap ?? null)} sub={fin?.annual[0]?.marketCap ? fin.source : "not in stored data"} />
          </div>
          <p className="mt-2 text-[11px] text-faint">Business description is not generated from model memory; only stored, sourced data is shown.</p>
        </Card>
        <Card title="Current market position">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <KV k="52-week high" v={fmtNum(t.high52w)} />
            <KV k="52-week low" v={fmtNum(t.low52w)} />
            <KV k="1M return" v={<Pct v={t.return1m} />} />
            <KV k="3M return" v={<Pct v={t.return3m} />} />
            <KV k="1Y return" v={<Pct v={t.return1y} />} />
            <KV k="Avg delivery % (20d)" v={fmtNum(t.avgDeliveryPct20, 1)} />
          </div>
          <div className="mt-3">
            <Statements items={N.currentPosition} sources={sources} />
          </div>
        </Card>
      </div>

      {/* 3 Price history */}
      <Card title="Price history" subtitle={`${rep.price.bars} daily bars · ${rep.price.adjustmentNote}`}>
        {rep.candles.length ? <PriceChart candles={rep.candles} levels={chartLevels} signals={sig.signals} /> : <Unavailable what="Price history" why="History is still being collected by the daily update." />}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <SignalPanel sig={sig} lastClose={rep.price.lastClose} />
        <StopLossTool technical={t} lastClose={rep.price.lastClose} onPlan={setPlan} />
      </div>
      <FoCard fo={rep.fo} />

      {/* 5 Technical */}
      <Card title="Technical analysis" subtitle={t.asOf ? `As of ${t.asOf}` : undefined}>
        {t.score == null ? (
          <Unavailable what="Technical analysis" why={t.scoreExplanation[0]} />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-md border border-line px-2 py-1">Trend: <b className={t.trend === "bullish" ? "text-up" : t.trend === "bearish" ? "text-down" : "text-warn"}>{t.trend}</b></span>
              <span className="rounded-md border border-line px-2 py-1">Strength: <b>{t.trendStrength ?? "—"}</b></span>
              <span className="rounded-md border border-line px-2 py-1">Momentum: <b>{t.momentum}</b></span>
              <span className="rounded-md border border-line px-2 py-1">RSI condition: <b>{t.condition}</b></span>
              {t.potentialBreakout && <span className="rounded-md bg-up/10 px-2 py-1 text-up">Potential breakout</span>}
              {t.potentialBreakdown && <span className="rounded-md bg-down/10 px-2 py-1 text-down">Potential breakdown</span>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              <KV k="SMA 20" v={fmtNum(t.sma20)} />
              <KV k="SMA 50" v={fmtNum(t.sma50)} />
              <KV k="SMA 100" v={fmtNum(t.sma100)} />
              <KV k="SMA 200" v={fmtNum(t.sma200)} />
              <KV k="EMA 20" v={fmtNum(t.ema20)} />
              <KV k="EMA 50" v={fmtNum(t.ema50)} />
              <KV k="RSI 14" v={fmtNum(t.rsi14, 1)} />
              <KV k="MACD / signal" v={`${fmtNum(t.macd)} / ${fmtNum(t.macdSignal)}`} />
              <KV k="Bollinger (20,2)" v={`${fmtNum(t.bbLower, 0)}–${fmtNum(t.bbUpper, 0)}`} />
              <KV k="ATR 14" v={`${fmtNum(t.atr14)} (${fmtNum(t.atrPct)}%)`} />
              <KV k="ADX 14" v={fmtNum(t.adx14, 1)} />
              <KV k="Vol avg 20 / 50" v={`${fmtCompact(t.volAvg20)} / ${fmtCompact(t.volAvg50)}`} />
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1 text-xs font-semibold text-muted">Support / resistance (swing-pivot clusters)</h3>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {t.resistances.map((r) => <span key={r.price} className="num rounded bg-down/10 px-2 py-0.5 text-down">R {fmtNum(r.price)} ×{r.touches}</span>)}
                  {t.supports.map((s) => <span key={s.price} className="num rounded bg-up/10 px-2 py-0.5 text-up">S {fmtNum(s.price)} ×{s.touches}</span>)}
                </div>
                <h3 className="mt-3 mb-1 text-xs font-semibold text-muted">Signals</h3>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">{t.signals.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </div>
              <div>
                <Statements items={N.technicalAnalysis} sources={sources} />
                <details className="mt-2 text-[11px] text-muted">
                  <summary className="cursor-pointer text-accent">Technical score breakdown ({t.score}/100)</summary>
                  <ul className="mt-1 space-y-0.5">{t.scoreExplanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </details>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* 4 Fundamental + 6 Financial statements */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Fundamental analysis" subtitle={rep.fundamentals.result.score != null ? `Score ${rep.fundamentals.result.score}/100 · coverage ${Math.round(rep.fundamentals.result.coverage * 100)}%` : undefined}>
          {rep.fundamentals.result.score == null && !fin ? (
            <Unavailable what="Fundamental data" why="Not yet collected for this company — fundamentals are refreshed gradually (up to 25 companies per daily run). Nothing is estimated." />
          ) : (
            <>
              <table className="w-full text-xs">
                <tbody>
                  {rep.fundamentals.result.subScores.map((s) => (
                    <tr key={s.name} className="border-b border-line/50 last:border-0">
                      <td className="py-1.5 pr-2 text-muted">{s.name}</td>
                      <td className="w-28 py-1.5"><ScoreBar v={s.score == null ? null : Math.round(s.score)} /></td>
                      <td className="py-1.5 pl-2 text-faint">{s.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3 className="mt-3 mb-1 text-xs font-semibold text-muted">Valuation {rep.fundamentals.valuation.score != null ? `(${rep.fundamentals.valuation.score}/100)` : ""}</h3>
              <ul className="space-y-0.5 text-xs text-faint">{rep.fundamentals.valuation.subScores.map((s) => <li key={s.name}>{s.name}: {s.detail}</li>)}</ul>
              {rep.fundamentals.derivedPe && <p className="mt-1 text-[11px] text-faint">{rep.fundamentals.derivedPe.note}</p>}
              {rep.fundamentals.industryPe && <p className="text-[11px] text-faint">Industry P/E {rep.fundamentals.industryPe.value}: {rep.fundamentals.industryPe.source}</p>}
              <div className="mt-3"><Statements items={N.fundamentalAnalysis} sources={sources} /></div>
            </>
          )}
        </Card>
        <Card title="Financial statements" subtitle={fin ? <>{fin.currency} · retrieved {fin.retrievedAt.slice(0, 10)}</> : undefined}>
          {fin?.note && <Notice className="mb-2">{fin.note}</Notice>}
          {!fin ? (
            <Unavailable what="Financial statements" why="Not yet collected for this company." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr><th className="py-1 text-left">Metric</th>{fin.annual.slice(0, 5).map((f) => <th key={f.period} className="text-right">{f.period}</th>)}</tr>
                </thead>
                <tbody className="num">
                  {([["Revenue", "revenue"], ["EBITDA", "ebitda"], ["Operating profit", "operatingProfit"], ["Net profit", "netProfit"], ["EPS", "eps"], ["ROE %", "roe"], ["ROCE %", "roce"], ["Debt/Equity", "debtToEquity"], ["Op. cash flow", "operatingCashFlow"], ["Free cash flow", "freeCashFlow"], ["Cash", "cash"], ["Dividend yield %", "dividendYield"], ["P/E", "pe"], ["P/B", "pb"]] as const).map(([lbl, k]) => (
                    <tr key={k} className="border-t border-line/50">
                      <td className="py-1 font-sans text-muted">{lbl}</td>
                      {fin.annual.slice(0, 5).map((f) => <td key={f.period} className="text-right">{f[k] == null ? <span className="text-faint">n/a</span> : Math.abs(f[k] as number) >= 1e5 ? fmtCompact(f[k]) : fmtNum(f[k])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {fin && "citations" in fin && Array.isArray((fin as { citations?: unknown }).citations) && (
            <div className="mt-2 text-[11px] text-faint">
              Sources:{" "}
              {((fin as unknown as { citations: { uri: string; title?: string }[] }).citations).map((c, i) => (
                <a key={i} href={c.uri} target="_blank" rel="noopener noreferrer nofollow" className="mr-2 text-accent hover:underline">{c.title ?? `source ${i + 1}`}</a>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 7 Institutional */}
      <Card title="Institutional activity" subtitle={sh ? `${sh.source} · latest ${sh.history[0]?.period}` : undefined}>
        {!sh ? (
          <Unavailable what="Shareholding data" why="Not yet collected for this company." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted"><tr><th className="py-1 text-left">Period</th><th className="text-right">Promoter</th><th className="text-right">FII</th><th className="text-right">DII</th><th className="text-right">MF</th><th className="text-right">Pledged</th></tr></thead>
                <tbody className="num">
                  {sh.history.slice(0, 6).map((h) => (
                    <tr key={h.period} className="border-t border-line/50">
                      <td className="py-1 font-sans">{h.period}</td>
                      {[h.promoter, h.fii, h.dii, h.mutualFunds, h.promoterPledged].map((v, i) => <td key={i} className="text-right">{fmtNum(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <Statements items={N.institutionalActivity} sources={sources} />
              <ul className="mt-2 space-y-0.5 text-[11px] text-faint">{rep.institutional.result.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          </div>
        )}
      </Card>

      {/* 8 Global + 9 News */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Global intelligence" subtitle="Relevance is scored and explained; not every global item affects the company.">
          <Statements items={N.globalIntelligence} sources={sources} />
          {rep.macro.filter((m) => m.status === "ok").length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {rep.macro.filter((m) => m.status === "ok").slice(0, 6).map((m) => <KV key={m.id} k={m.name} v={`${fmtNum(m.value)} ${m.unit}`} sub={<SourceLink href={m.sourceUrl}>{m.date}</SourceLink>} />)}
            </div>
          )}
        </Card>
        <Card title="Latest relevant news" subtitle={`${rep.news.length} items · GDELT, last 30 days`}>
          {!rep.news.length ? (
            <Unavailable what="News" why={rep.steps.find((s) => s.step.startsWith("Global"))?.detail} />
          ) : (
            <ul className="max-h-[420px] space-y-2.5 overflow-auto pr-1">
              {rep.news.slice(0, 25).map((n) => (
                <li key={n.url} className="text-sm">
                  <a href={n.url} target="_blank" rel="noopener noreferrer nofollow" className="leading-snug hover:text-accent">{n.headline}</a>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-faint">
                    <span>{n.publisher}</span>
                    <span>{n.publishedAt.slice(0, 10)}</span>
                    <span className={n.sentiment === "positive" ? "text-up" : n.sentiment === "negative" ? "text-down" : ""}>{n.sentiment}</span>
                    <span>relevance {n.relevance.toFixed(2)}</span>
                    <span>{n.impact} impact</span>
                    <span>{n.category}</span>
                  </div>
                  <div className="text-[11px] text-muted">{n.evidence.split(" (matched")[0]}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 10 Peers */}
      <Card title="Competitor comparison" subtitle={`Same-sector NSE peers (${c.sector ?? "sector unknown"})`}>
        {!rep.peers.length ? (
          <Unavailable what="Peer comparison" why="No same-sector peers in the stock master." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1">Company</th><th className="text-right">Close</th><th className="text-right">3M</th><th className="text-right">1Y</th><th className="text-right">Tech score</th><th className="text-right">ROE %</th><th className="text-right">Net margin %</th><th className="text-right">P/E</th></tr></thead>
              <tbody className="num">
                <tr className="border-t border-line/60 bg-accent/5">
                  <td className="py-1.5 font-sans font-semibold">{c.symbol} (this)</td>
                  <td className="text-right">{fmtNum(t.close)}</td><td className="text-right"><Pct v={t.return3m} /></td><td className="text-right"><Pct v={t.return1y} /></td><td className="text-right">{t.score ?? "—"}</td>
                  <td className="text-right">{fmtNum(fin?.annual[0]?.roe)}</td><td className="text-right">{fin?.annual[0]?.revenue && fin.annual[0].netProfit != null ? fmtNum((fin.annual[0].netProfit / fin.annual[0].revenue) * 100) : "—"}</td><td className="text-right">{fmtNum(fin?.annual[0]?.pe ?? rep.fundamentals.derivedPe?.value)}</td>
                </tr>
                {rep.peers.map((p) => (
                  <tr key={p.symbol} className="border-t border-line/60">
                    <td className="py-1.5 font-sans"><Link className="text-accent hover:underline" href={`/research/?s=${p.symbol}`}>{p.symbol}</Link></td>
                    <td className="text-right">{fmtNum(p.close)}</td><td className="text-right"><Pct v={p.return3m} /></td><td className="text-right"><Pct v={p.return1y} /></td><td className="text-right">{p.technicalScore ?? "—"}</td>
                    <td className="text-right">{fmtNum(p.roe)}</td><td className="text-right">{fmtNum(p.netMargin)}</td><td className="text-right">{fmtNum(p.pe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 11 Growth, 12 risks */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Growth opportunities"><Statements items={N.growthOpportunities} sources={sources} empty="No growth catalysts identified from available evidence." /></Card>
        <Card title="Risks and challenges">
          <Statements items={N.risks} sources={sources} />
          {rep.risks.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted">{rep.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </Card>
      </div>

      {/* 15 Conclusion */}
      <Card title="Final conclusion">
        <Statements items={N.conclusion} sources={sources} />
        {history.length > 1 && (
          <div className="mt-3">
            <h3 className="mb-1 text-xs font-semibold text-muted">Assessment history (swing · 3–12 months)</h3>
            <div className="flex flex-wrap gap-2 text-[11px]">
              {history.slice(0, 15).map((h) => (
                <span key={h.date} className="flex items-center gap-1.5 rounded border border-line px-2 py-1">
                  {h.date} <VerdictBadge v={h.verdicts.swing} /> <VerdictBadge v={h.verdicts.medium} />
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Workflow + sources */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Research workflow log">
          <ul className="space-y-1.5 text-xs">
            {rep.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <StatusDot s={s.status} />
                <span>
                  <b className="font-medium text-ink">{s.step}</b> <span className="text-muted">— {s.detail}</span>
                  {s.ms != null && <span className="text-faint"> ({(s.ms / 1000).toFixed(1)}s)</span>}
                </span>
              </li>
            ))}
          </ul>
          {rep.narrativeValidation.length > 0 && (
            <details className="mt-3 text-[11px] text-muted">
              <summary className="cursor-pointer text-warn">{rep.narrativeValidation.length} AI statement(s) removed by number validation</summary>
              <ul className="mt-1 space-y-0.5">{rep.narrativeValidation.map((v, i) => <li key={i}>{v}</li>)}</ul>
            </details>
          )}
        </Card>
        <Card title="Sources">
          <ol className="max-h-[360px] space-y-1 overflow-auto text-xs">
            {sources.map((s, i) => (
              <li key={s.id} id={`src-${i + 1}`} className="flex gap-2">
                <span className="num w-6 shrink-0 text-right text-faint">[{i + 1}]</span>
                <span>
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">{s.label} <ExternalLink className="inline h-3 w-3" /></a> : s.label}
                  <span className="text-faint">{s.period ? ` · ${s.period}` : ""}{s.retrievedAt ? ` · retrieved ${s.retrievedAt.slice(0, 16).replace("T", " ")}` : ""}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
      <p className="text-[11px] leading-relaxed text-faint">{rep.disclaimer} Research score uses: {Object.entries(rep.weights).map(([k, w]) => `${k} ${fmtPct(w * 100, 0).replace("+", "")}`).join(", ")}.</p>
    </article>
  );
}

// StockPilot daily research pipeline (runs in GitHub Actions after market close).
//   prices → indices → disclosures → news → macro → fundamentals → scores → levels → AI narrative → site JSON
// Usage: npx tsx pipeline/run.ts

import type { ComponentScore, CorporateEvent, FinancialsBundle, Horizon, HorizonRecommendation, MacroIndicator, NewsItem, ShareholdingBundle, StockMaster } from "../src/lib/types";
import type { PeerRow, ResearchReport, SourceRef, StepStatus } from "../src/lib/report-types";
import { analyzeTechnicals, type TechnicalSnapshot } from "../src/lib/analysis/technical";
import { cagr, scoreFundamentals, scoreInstitutional, scoreValuation } from "../src/lib/analysis/fundamental";
import { computeLevels, daysBetween, HORIZONS } from "../src/lib/analysis/levels";
import { combineScores, confidenceScore, DEFAULT_WEIGHTS, globalScore, riskScore, verdictFor } from "../src/lib/analysis/scoring";
import { evidenceNumbers, NarrativeSchema, SYSTEM_PROMPT, validateNarrative, type Narrative } from "../src/lib/ai/narrative";
import { env } from "./env";
import { httpLog, usage } from "./http";
import { feedStatus, fetchCorporateEvents, fetchIndicesClose, latestAvailable, NSE_URLS } from "./nse";
import { fetchMarketNews, fetchUniverseNews, setNewsBudget } from "./gdelt";
import { fetchGNews } from "./gnews";
import { fetchFred, fetchImf, fetchWorldBank } from "./macro";
import { fetchSensex } from "./bse";
import { SECTOR_INDEX } from "./fundamentals";
import { getAIProvider } from "./gemini";
import { refreshFundamentals } from "./fundamentals-ai";
import { refreshSecFundamentals, SEC_FILERS } from "./sec";
import { analyzeFo, fetchFo, finalizeStance, type FoAnalysis } from "./fo";
import { computeSignals } from "../src/lib/analysis/signals";
import { loadUniverse, syncPrices } from "./prices";
import { dataPath, loadState, readJson, saveState, sitePath, writeJson } from "./store";

const DISCLAIMER =
  "StockPilot AI is a research tool, not investment advice and not a SEBI-registered research analyst. Scores and levels are mechanical outputs of the documented rules applied to the data shown; research confidence measures evidence completeness, not the probability of profit. Verify figures with the original sources before making any decision.";

const t0 = Date.now();
const deadline = t0 + env.maxMinutes * 60_000;
const log: string[] = [];
const say = (s: string) => {
  log.push(s);
  console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
};
const ret = (c: import("../src/lib/types").Candle[], n: number) => (c.length > n ? ((c[c.length - 1].close - c[c.length - 1 - n].close) / c[c.length - 1 - n].close) * 100 : null);
const volRatio = (c: import("../src/lib/types").Candle[]) => {
  if (c.length < 55) return null;
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return avg(c.slice(-5).map((x) => x.volume)) / avg(c.slice(-55, -5).map((x) => x.volume));
};
const rnd = (x: number | null | undefined) => (x == null ? null : Math.round(x * 100) / 100);

async function main() {
  const state = await loadState();
  state.runs++;
  say(`Run #${state.runs} — model ${env.geminiModel}, AI ${env.geminiKey ? "on" : "off"}, FRED ${env.fredKey ? "on" : "off"}`);

  // 1. Universe + prices
  const universe = await loadUniverse(log);
  const priceBudget = Math.min(deadline, t0 + (state.backfillDone ? 10 : 30) * 60_000);
  const { prices, adjustmentEvents } = await syncPrices(universe, state, priceBudget, env.backfillYears, log);
  await saveState(state);
  say(`Prices ready (latest ${state.lastPriceDate}, backfill ${state.backfillDone ? "complete" : "in progress to " + state.backfillCursor})`);

  // 2. Indices (latest published session) + SENSEX
  const idx = await latestAvailable((d) => fetchIndicesClose(d)).catch(() => null);
  const indexRows = idx?.value.rows ?? [];
  const sensex = await fetchSensex();
  if (indexRows.length) {
    const hist = await readJson<Record<string, Record<string, [number, number | null]>>>(dataPath("index-history.json"), {});
    hist[indexRows[0].date] = Object.fromEntries(indexRows.filter((r) => ["NIFTY 50", "NIFTY BANK", "NIFTY NEXT 50", "NIFTY 500", "INDIA VIX"].includes(r.name)).map((r) => [r.name, [r.close, r.changePct]]));
    await writeJson(dataPath("index-history.json"), hist);
  }
  say(`Indices: ${indexRows.length} rows (${indexRows[0]?.date ?? "unavailable"}); SENSEX ${sensex.value ?? "unavailable"}`);

  // 3. Macro
  const [fred, wb, imf] = await Promise.all([fetchFred(), fetchWorldBank(), fetchImf()]);
  const macro: (MacroIndicator & { prev?: number | null })[] = [...fred.items, ...wb, ...imf];
  say(`Macro: ${macro.filter((m) => m.status === "ok").length}/${macro.length} indicators${fred.error ? ` (${fred.error})` : ""}`);

  // 3b. F&O bhavcopy for the latest session
  let fo: Awaited<ReturnType<typeof fetchFo>> = null;
  if (state.lastPriceDate) {
    fo = await fetchFo(new Date(state.lastPriceDate + "T00:00:00Z")).catch((e) => (say(`F&O fetch failed: ${(e as Error).message}`), null));
    say(fo ? `F&O: ${fo.rows.length} contracts (${fo.rows[0]?.date}); header: ${fo.header.slice(0, 160)}` : "F&O: bhavcopy not available for the latest session");
  }
  const foIndex = (sym: string) => {
    if (!fo) return null;
    const a = analyzeFo(sym, fo.rows, fo.url, true);
    const row = indexRows.find((r) => r.name === (sym === "NIFTY" ? "NIFTY 50" : "NIFTY BANK"));
    return a ? finalizeStance(a, row?.changePct ?? null, row?.close ?? null) : null;
  };
  const foIndices = { NIFTY: foIndex("NIFTY"), BANKNIFTY: foIndex("BANKNIFTY") };

  // 4. Market news
  const marketNews = await fetchMarketNews().catch((e) => (say(`Market news failed: ${(e as Error).message}`), [] as NewsItem[]));

  // 5a. Official fundamentals from SEC 20-F filings (ADR-listed NIFTY 50 companies)
  for (const sym of Object.keys(SEC_FILERS)) if (universe.some((u) => u.symbol === sym)) await refreshSecFundamentals(sym, say).catch((e) => say(`${sym}: SEC fetch failed — ${(e as Error).message.slice(0, 120)}`));

  // 5a-2. Other companies: AI search with citations (needs a Gemini key with search-grounding quota)
  if (env.geminiKey && !process.env.SKIP_AI_FUNDAMENTALS) {
    const ages = await Promise.all(universe.map(async (c) => ({ c, t: (await readJson<FinancialsBundle | null>(dataPath("fundamentals", `${c.symbol}.json`), null))?.retrievedAt ?? "" })));
    let done = 0;
    for (const { c } of ages.sort((a, b) => a.t.localeCompare(b.t)).slice(0, 25)) {
      if (Date.now() > t0 + 20 * 60_000) break; // at most ~20 minutes on fundamentals per run
      const close = prices.get(c.symbol)?.at(-1)?.close ?? null;
      try {
        if (await refreshFundamentals(c, close, say)) done++;
      } catch (e) {
        say(`${c.symbol}: fundamentals failed — ${(e as Error).message.slice(0, 160)}`);
        if (/429|quota|No Gemini model/.test((e as Error).message)) break;
      }
    }
    say(`Fundamentals refreshed for ${done} compan${done === 1 ? "y" : "ies"}`);
  }

  // 4b. News for the whole universe (batched, capped at 12 minutes; stored news is kept if GDELT throttles us)
  setNewsBudget(12 * 60_000);
  const newsMap = await fetchUniverseNews(universe, say);
  const gnews = await fetchGNews(universe, say);
  if (gnews) for (const [sym, items] of gnews) newsMap.set(sym, [...(newsMap.get(sym) ?? []), ...items]);

  // 5b. Per-stock research
  const ai = getAIProvider();
  const reports: ResearchReport[] = [];
  const ordered = [...universe].sort((a, b) => a.symbol.localeCompare(b.symbol));
  for (const company of ordered) {
    if (Date.now() > deadline) {
      say(`Time budget reached — ${company.symbol} and later stocks keep their previous report until the next run`);
      break;
    }
    const extraEvents = adjustmentEvents.get(company.symbol) ?? [];
    try {
      const rep = await research(company, universe, prices, indexRows, idx?.value.url ?? null, idx?.value.retrievedAt ?? null, macro, extraEvents, ai, fo, newsMap.get(company.symbol) ?? []);
      reports.push(rep);
      await writeJson(sitePath("reports", `${company.symbol}.json`), rep);
      say(`${company.symbol}: ${rep.recommendations.map((r) => `${r.horizon}=${r.verdict}`).join(", ")} | conf ${rep.confidence} | ${rep.news.length} news | ${rep.narrativeSource.split(" (")[0]}`);
    } catch (e) {
      say(`${company.symbol}: FAILED — ${(e as Error).message}`);
    }
  }

  say(`NSE feeds: ${feedStatus.join("; ")}`);

  // Stocks not reached this run keep their previous report (if any) in the site files.
  for (const c of ordered) {
    if (reports.some((r) => r.company.symbol === c.symbol)) continue;
    const prevRep = await readJson<ResearchReport | null>(sitePath("reports", `${c.symbol}.json`), null);
    if (prevRep) reports.push(prevRep);
  }

  // 6. Site-level files
  const nifty = universe.map((s) => s.symbol);
  const movers = reports
    .filter((r) => r.price.changePct != null && r.price.lastDate === state.lastPriceDate)
    .map((r) => ({ symbol: r.company.symbol, name: r.company.name, close: r.price.lastClose!, changePct: r.price.changePct!, date: r.price.lastDate! }))
    .sort((a, b) => b.changePct - a.changePct);
  const HEAD = ["NIFTY 50", "NIFTY BANK", "NIFTY NEXT 50", "NIFTY MIDCAP 100", "NIFTY SMALLCAP 100", "NIFTY 500", "INDIA VIX"];
  const SECT = ["NIFTY IT", "NIFTY AUTO", "NIFTY FMCG", "NIFTY PHARMA", "NIFTY METAL", "NIFTY REALTY", "NIFTY ENERGY", "NIFTY FINANCIAL SERVICES", "NIFTY MEDIA", "NIFTY OIL & GAS", "NIFTY PSU BANK", "NIFTY PRIVATE BANK", "NIFTY HEALTHCARE INDEX", "NIFTY CONSUMER DURABLES"];
  await writeJson(sitePath("market.json"), {
    generatedAt: new Date().toISOString(),
    indices: { status: indexRows.length ? "ok" : "unavailable", date: indexRows[0]?.date ?? null, sourceUrl: idx?.value.url ?? null, retrievedAt: idx?.value.retrievedAt ?? null, headline: HEAD.map((n) => indexRows.find((r) => r.name === n)).filter(Boolean), sectors: SECT.map((n) => indexRows.find((r) => r.name === n)).filter(Boolean) },
    indexHistory: await readJson(dataPath("index-history.json"), {}),
    sensex,
    global: { items: fred.items, error: fred.error },
    macro,
    movers: { date: state.lastPriceDate, universe: "NIFTY 50", gainers: movers.filter((m) => m.changePct > 0).slice(0, 8), losers: movers.filter((m) => m.changePct < 0).reverse().slice(0, 8), count: movers.length },
    news: marketNews.slice(0, 20),
    fo: { date: fo?.rows[0]?.date ?? null, sourceUrl: fo?.url ?? null, indices: foIndices },
  });
  await writeJson(
    sitePath("stocks.json"),
    reports.map((r) => {
      const l = r.fundamentals.bundle?.annual ?? [];
      const y = Math.min(3, l.length - 1);
      return {
        symbol: r.company.symbol, name: r.company.name, sector: r.company.sector ?? null, isin: r.company.isin ?? null,
        close: r.price.lastClose, asOf: r.price.lastDate, changePct: r.price.changePct, marketCap: l[0]?.marketCap ?? null,
        revenueGrowth: y >= 1 ? cagr(l[0]?.revenue ?? null, l[y]?.revenue ?? null, y) : null, profitGrowth: y >= 1 ? cagr(l[0]?.netProfit ?? null, l[y]?.netProfit ?? null, y) : null,
        roe: l[0]?.roe ?? null, roce: l[0]?.roce ?? null, debtToEquity: l[0]?.debtToEquity ?? null, pe: l[0]?.pe ?? r.fundamentals.derivedPe?.value ?? null,
        rsi: r.technical.rsi14, aboveSma50: r.technical.sma50 != null && r.technical.close != null ? r.technical.close > r.technical.sma50 : null, aboveSma200: r.technical.sma200 != null && r.technical.close != null ? r.technical.close > r.technical.sma200 : null,
        trend: r.technical.trend, technicalScore: r.technical.score, fundamentalScore: r.fundamentals.result.score, return3m: r.technical.return3m, return1y: r.technical.return1y, atrPct: r.technical.atrPct,
        components: r.components.map((c) => ({ key: c.key, score: c.score, coverage: c.coverage })),
        recommendations: r.recommendations.map((x) => ({ horizon: x.horizon, verdict: x.verdict, score: x.score, confidence: x.confidence })),
        researchScore: r.researchScore, confidence: r.confidence, generatedAt: r.generatedAt,
        return1w: ret(r.candles, 5), return1m: r.technical.return1m, volRatio: volRatio(r.candles),
        fo: r.fo ? { stance: r.fo.stance, stanceScore: r.fo.stanceScore, buildup: r.fo.futures?.buildup ?? null, oiChangePct: r.fo.futures?.oiChangePct ?? null, pcr: r.fo.options?.pcr ?? null, maxPain: r.fo.options?.maxPain ?? null, support: r.fo.levels.support, resistance: r.fo.levels.resistance, basisPct: r.fo.futures?.basisPct ?? null } : null,
        signal: (() => { const s = computeSignals(r.candles); return { state: s.current.state, since: s.current.since, last: s.current.lastSignal, winRate: s.stats.winRate, trades: s.stats.trades, avgReturn: s.stats.avgReturn }; })(),
        highImpactNews: r.news.filter((n) => n.impact === "high").slice(0, 3).map((n) => ({ headline: n.headline, url: n.url, sentiment: n.sentiment, publishedAt: n.publishedAt })),
      };
    }),
  );
  // Weekly picks (transparent ranking rules, recomputed daily)
  const pick = (r: ResearchReport) => {
    const sw = r.recommendations.find((x) => x.horizon === "swing")!;
    const sig = computeSignals(r.candles);
    const w1 = ret(r.candles, 5);
    const comp = (sw.score ?? 50) + 0.2 * (r.fo?.stanceScore ?? 0) + (sig.current.state === "in-trade" ? 5 : 0) + (r.technical.condition === "overbought" ? -5 : 0);
    const why: string[] = [`Swing verdict ${sw.verdict} (score ${sw.score ?? "n/a"}, confidence ${sw.confidence})`];
    if (r.fo) why.push(`F&O ${r.fo.stance}${r.fo.futures ? ` — ${r.fo.futures.buildup}` : ""}${r.fo.options?.pcr != null ? `, PCR ${r.fo.options.pcr.toFixed(2)}` : ""}`);
    if (sig.current.state === "in-trade") why.push(`Chart BUY signal active since ${sig.current.since}`);
    else if (sig.current.lastSignal?.type === "SELL") why.push(`Last chart signal SELL on ${sig.current.lastSignal.date}`);
    if (w1 != null) why.push(`1-week return ${w1 >= 0 ? "+" : ""}${w1.toFixed(2)}%`);
    const lv = r.recommendations.find((x) => x.horizon === "swing")!.levels;
    return { symbol: r.company.symbol, name: r.company.name, sector: r.company.sector ?? null, close: r.price.lastClose, verdict: sw.verdict, score: sw.score, confidence: sw.confidence, composite: Math.round(comp), return1w: w1, volRatio: volRatio(r.candles), foStance: r.fo?.stance ?? null, why, levels: lv.actionable ? { entryLow: lv.entryLow, entryHigh: lv.entryHigh, target: lv.target, stopLoss: lv.stopLoss, riskReward: lv.riskReward } : null };
  };
  const all = reports.map(pick);
  await writeJson(sitePath("picks.json"), {
    generatedAt: new Date().toISOString(),
    asOf: state.lastPriceDate,
    rules: [
      "Composite = swing-horizon research score + 0.2 × F&O stance score (−100…+100) + 5 if a chart BUY signal is active − 5 if RSI is overbought.",
      "Best buys: swing verdict BUY or STRONG BUY, highest composite first. Best sells: swing verdict SELL or STRONG SELL, or HOLD with bearish F&O and a bearish trend — lowest composite first.",
      "Trending: biggest 1-week moves with 5-day volume at least equal to the 50-day average.",
      "These are research candidates for the coming week, not guaranteed outcomes.",
    ],
    bestBuys: all.filter((p) => p.verdict === "BUY" || p.verdict === "STRONG BUY").sort((a, b) => b.composite - a.composite).slice(0, 5),
    bestSells: all.filter((p) => p.verdict === "SELL" || p.verdict === "STRONG SELL" || (p.verdict === "HOLD" && p.foStance === "bearish" && reports.find((r) => r.company.symbol === p.symbol)?.technical.trend === "bearish")).sort((a, b) => a.composite - b.composite).slice(0, 5),
    trendingUp: all.filter((p) => p.return1w != null && p.return1w > 0 && (p.volRatio ?? 0) >= 1).sort((a, b) => b.return1w! - a.return1w!).slice(0, 6),
    trendingDown: all.filter((p) => p.return1w != null && p.return1w < 0 && (p.volRatio ?? 0) >= 1).sort((a, b) => a.return1w! - b.return1w!).slice(0, 6),
    longBuildup: reports.filter((r) => r.fo?.futures?.buildup === "Long build-up").sort((a, b) => (b.fo!.futures!.oiChangePct ?? 0) - (a.fo!.futures!.oiChangePct ?? 0)).slice(0, 6).map((r) => ({ symbol: r.company.symbol, oiChangePct: r.fo!.futures!.oiChangePct, changePct: r.price.changePct })),
    shortBuildup: reports.filter((r) => r.fo?.futures?.buildup === "Short build-up").sort((a, b) => (b.fo!.futures!.oiChangePct ?? 0) - (a.fo!.futures!.oiChangePct ?? 0)).slice(0, 6).map((r) => ({ symbol: r.company.symbol, oiChangePct: r.fo!.futures!.oiChangePct, changePct: r.price.changePct })),
  });

  await writeJson(sitePath("meta.json"), {
    generatedAt: new Date().toISOString(),
    lastPriceDate: state.lastPriceDate,
    backfill: { done: state.backfillDone, oldest: state.backfillCursor },
    universe: nifty,
    ai: ai.name,
    usage,
    requests: httpLog.length,
    failures: httpLog.filter((l) => !l.ok).slice(-60),
    log,
    minutes: Math.round((Date.now() - t0) / 600) / 100,
  }, true);
  await saveState(state);
  say(`Done: ${reports.length}/${universe.length} reports in ${((Date.now() - t0) / 60000).toFixed(1)} min; ${httpLog.length} requests (${httpLog.filter((l) => !l.ok).length} failed)`);
}

async function research(
  company: StockMaster,
  universe: StockMaster[],
  prices: Map<string, import("../src/lib/types").Candle[]>,
  indexRows: { name: string; date: string; pe: number | null }[],
  indexUrl: string | null,
  indexRetrievedAt: string | null,
  macro: MacroIndicator[],
  extraEvents: CorporateEvent[],
  ai: ReturnType<typeof getAIProvider>,
  fo: Awaited<ReturnType<typeof fetchFo>>,
  freshNews: NewsItem[],
): Promise<ResearchReport> {
  const steps: StepStatus[] = [{ step: "Identify company", status: "ok", detail: `${company.name} (NSE: ${company.symbol}${company.sector ? `, ${company.sector}` : ""})`, source: "NSE NIFTY 50 constituents file" }];
  const sources: SourceRef[] = [];
  const now = new Date();
  const candles = prices.get(company.symbol) ?? [];
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const priceAge = last ? daysBetween(last.date, now) : null;
  steps.push({ step: "Market data", status: !candles.length ? "unavailable" : priceAge! > 5 ? "partial" : "ok", detail: candles.length ? `${candles.length} daily bars, ${candles[0].date} → ${last.date}${priceAge! > 5 ? ` (stale: ${priceAge} days)` : ""}` : "No prices stored yet", source: "NSE sec_bhavdata_full" });
  if (last) sources.push({ id: "prices", label: "NSE daily bhavcopy (sec_bhavdata_full)", url: NSE_URLS.bhavcopyFull(new Date(last.date + "T00:00:00Z")), retrievedAt: now.toISOString(), period: last.date });

  // Fundamentals & ownership: stored files (written by the fundamentals step when a source is available)
  const fin = await readJson<FinancialsBundle | null>(dataPath("fundamentals", `${company.symbol}.json`), null);
  const sh = await readJson<ShareholdingBundle | null>(dataPath("shareholding", `${company.symbol}.json`), null);
  steps.push({ step: "Financial statements", status: fin ? "ok" : "unavailable", detail: fin ? `${fin.annual.length} annual / ${fin.quarterly.length} quarterly periods (${fin.source})` : "Not available from a free licence-clear source yet", source: fin?.source });

  // Corporate events (NSE RSS, accumulated)
  const evFile = dataPath("events", `${company.symbol}.json`);
  const stored = await readJson<CorporateEvent[]>(evFile, []);
  const ev = await fetchCorporateEvents(company).catch((e) => ({ events: [] as CorporateEvent[], errors: [(e as Error).message] }));
  const seen = new Set(stored.map((e) => `${e.date}|${e.title.toLowerCase()}`));
  const merged = [...stored, ...[...extraEvents, ...ev.events].filter((e) => !seen.has(`${e.date}|${e.title.toLowerCase()}`) && seen.add(`${e.date}|${e.title.toLowerCase()}`))].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  await writeJson(evFile, merged);
  const events = merged.slice(0, 25);
  steps.push({ step: "Ownership & disclosures", status: events.length ? (sh ? "ok" : "partial") : "unavailable", detail: `${events.length} corporate events on record (NSE RSS)${sh ? "" : "; shareholding not available"}${ev.errors.length ? `; ${ev.errors.length} feed error(s)` : ""}`, source: "NSE RSS feeds" });

  // News (GDELT) — accumulated for 45 days
  const peers = universe.filter((s) => s.symbol !== company.symbol && s.sector && s.sector === company.sector).slice(0, 5);
  const newsFile = dataPath("news", `${company.symbol}.json`);
  const oldNews = await readJson<NewsItem[]>(newsFile, []);
  const fresh = { items: freshNews, errors: [] as string[], queries: ["batched GDELT queries"] };
  const cutoff = new Date(Date.now() - 45 * 86400000).toISOString();
  const byUrl = new Map([...oldNews, ...fresh.items].filter((n) => n.publishedAt >= cutoff).map((n) => [n.url, n]));
  const allNews = [...byUrl.values()];
  await writeJson(newsFile, allNews);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const news = allNews.filter((n) => n.publishedAt >= since30).sort((a, b) => b.relevance - a.relevance || b.publishedAt.localeCompare(a.publishedAt)).slice(0, 60);
  steps.push({ step: "Global news & intelligence", status: fresh.items.length ? (fresh.errors.length ? "partial" : "ok") : news.length ? "partial" : "unavailable", detail: `${fresh.items.length} new item(s) from ${fresh.queries.length} GDELT queries; ${news.length} in last 30 days${fresh.errors.length ? `; errors: ${fresh.errors[0]}` : ""}`, source: "GDELT DOC 2.0" });

  // Technical
  const technical = analyzeTechnicals(candles);
  steps.push({ step: "Technical indicators", status: technical.score != null ? "ok" : "unavailable", detail: technical.score != null ? `${technical.bars} bars; trend ${technical.trend}; score ${technical.score}` : technical.scoreExplanation[0] });

  // F&O analyst view
  let foView: FoAnalysis | null = null;
  if (fo) {
    const a = analyzeFo(company.symbol, fo.rows, fo.url);
    if (a) foView = finalizeStance(a, last && prev ? ((last.close - prev.close) / prev.close) * 100 : null, last?.close ?? null);
  }
  steps.push({ step: "F&O analysis", status: foView ? "ok" : "unavailable", detail: foView ? `${foView.futures?.buildup ?? "no futures"}; PCR ${foView.options?.pcr?.toFixed(2) ?? "n/a"}; stance ${foView.stance}` : "Stock not in today's F&O bhavcopy or file unavailable", source: "NSE F&O UDiFF bhavcopy" });
  if (foView) sources.push({ id: "fo", label: "NSE F&O bhavcopy (UDiFF)", url: foView.sourceUrl, period: foView.date });

  // Chart signals (rule-based, back-tested)
  const sig = computeSignals(candles);

  // Fundamentals
  let derivedPe: ResearchReport["fundamentals"]["derivedPe"] = null;
  const finEff: FinancialsBundle | null = fin ? structuredClone(fin) : null;
  if (finEff?.annual[0] && finEff.annual[0].pe == null && finEff.annual[0].eps && finEff.annual[0].eps > 0 && last) {
    finEff.annual[0].pe = last.close / finEff.annual[0].eps;
    derivedPe = { value: rnd(finEff.annual[0].pe), note: `Derived: close ₹${last.close} (${last.date}) ÷ ${finEff.annual[0].period} EPS ${finEff.annual[0].eps}` };
  }
  let industryPe: ResearchReport["fundamentals"]["industryPe"] = null;
  const sIdx = company.sector ? indexRows.find((r) => r.name === SECTOR_INDEX[company.sector!]) : undefined;
  if (sIdx?.pe) {
    industryPe = { value: sIdx.pe, source: `${sIdx.name} P/E, NSE ind_close_all ${sIdx.date}` };
    if (finEff && finEff.industryPe == null) finEff.industryPe = sIdx.pe;
    sources.push({ id: "sectorpe", label: `NSE indices close — ${sIdx.name} P/E`, url: indexUrl ?? undefined, retrievedAt: indexRetrievedAt ?? undefined, period: sIdx.date });
  }
  const peerRows: PeerRow[] = await Promise.all(
    peers.map(async (p) => {
      const c = prices.get(p.symbol) ?? [];
      const t = c.length >= 50 ? analyzeTechnicals(c) : null;
      const f = (await readJson<FinancialsBundle | null>(dataPath("fundamentals", `${p.symbol}.json`), null))?.annual[0];
      const lc = c[c.length - 1]?.close ?? null;
      return { symbol: p.symbol, name: p.name, close: lc, return3m: t?.return3m ?? null, return1y: t?.return1y ?? null, technicalScore: t?.score ?? null, roe: f?.roe ?? null, netMargin: f?.revenue && f.netProfit != null ? (f.netProfit / f.revenue) * 100 : null, pe: f?.pe ?? (f?.eps && lc ? lc / f.eps : null) };
    }),
  );
  const fundResult = scoreFundamentals(finEff, sh, peerRows);
  const a = finEff?.annual ?? [];
  const yrs = Math.min(3, a.length - 1);
  const valResult = scoreValuation(finEff, yrs >= 1 ? cagr(a[0]?.eps ?? null, a[yrs]?.eps ?? null, yrs) : null);
  const shInst = scoreInstitutional(sh);
  // Derivatives positioning (F&O build-up, PCR, option walls) is institutional-money evidence too.
  const foInst = foView ? { name: "F&O positioning", score: Math.max(0, Math.min(100, 50 + foView.stanceScore / 2)), weight: 0.5, detail: `F&O stance ${foView.stance} (${foView.stanceScore >= 0 ? "+" : ""}${foView.stanceScore} on −100…+100): ${foView.reasons[0] ?? ""}` } : null;
  const instResult = (() => {
    if (!foInst) return shInst;
    const parts = [...(shInst.score != null ? [{ s: shInst.score, w: 0.5 }] : []), { s: foInst.score, w: foInst.weight }];
    const score = Math.round(parts.reduce((a, p) => a + p.s * p.w, 0) / parts.reduce((a, p) => a + p.w, 0));
    return { score, coverage: shInst.score != null ? 1 : 0.6, subScores: [...shInst.subScores, foInst], explanation: [`Blend of ${shInst.score != null ? "shareholding changes and " : ""}F&O positioning.`, ...shInst.explanation.slice(1), `${foInst.name}: ${foInst.score.toFixed(0)} — ${foInst.detail}`] };
  })();
  steps.push({ step: "Fundamental ratios", status: fundResult.score != null ? "ok" : "unavailable", detail: fundResult.explanation[0] });
  steps.push({ step: "Competitor comparison", status: peerRows.length ? "ok" : "unavailable", detail: peerRows.length ? `${peerRows.length} NIFTY 50 sector peers: ${peerRows.map((p) => p.symbol).join(", ")}` : "No same-sector peers in NIFTY 50" });

  // Scores
  const g = globalScore(news);
  const lf = finEff?.annual[0];
  const rk = riskScore(technical, lf?.debtToEquity ?? null, sh?.history[0]?.promoterPledged ?? null, news);
  const components: ComponentScore[] = [
    { key: "fundamentals", label: "Fundamentals", score: fundResult.score, weight: 0, coverage: fundResult.score == null ? 0 : fundResult.coverage, explanation: fundResult.explanation },
    { key: "technical", label: "Technical analysis", score: technical.score, weight: 0, coverage: technical.score == null ? 0 : 1, explanation: technical.scoreExplanation },
    { key: "valuation", label: "Valuation", score: valResult.score, weight: 0, coverage: valResult.score == null ? 0 : valResult.coverage, explanation: valResult.explanation },
    { key: "institutional", label: "Institutional activity", score: instResult.score, weight: 0, coverage: instResult.score == null ? 0 : instResult.coverage, explanation: instResult.explanation },
    { key: "global", label: "Global intelligence", score: g.score, weight: 0, coverage: g.score == null ? 0 : g.coverage, explanation: g.explanation },
    { key: "risk", label: "Risk assessment", score: rk.score, weight: 0, coverage: rk.score == null ? 0 : rk.coverage, explanation: rk.explanation },
  ];
  const recommendations: HorizonRecommendation[] = (Object.keys(HORIZONS) as Horizon[]).map((h) => {
    const c = combineScores(components, h, DEFAULT_WEIGHTS);
    // Short-horizon timing adjustment: stretched (overbought) prices carry pull-back risk.
    if (c.score != null && technical.condition === "overbought" && (h === "short" || h === "swing")) c.score -= h === "short" ? 8 : 4;
    const conf = confidenceScore(c.coverage, priceAge, ai.available());
    const verdict = verdictFor(c.score, conf.confidence);
    const levels = computeLevels(h, candles, technical, finEff, now);
    if (levels.actionable && (verdict === "SELL" || verdict === "STRONG SELL" || verdict === "INSUFFICIENT DATA")) {
      levels.actionable = false;
      levels.reasonIfNot = verdict === "INSUFFICIENT DATA" ? "Verdict is INSUFFICIENT DATA — no levels suggested." : `Verdict is ${verdict} — no long entry suggested.`;
    }
    return { horizon: h, verdict, score: c.score, levels, confidence: conf.confidence };
  });
  const medium = combineScores(components, "medium", DEFAULT_WEIGHTS);
  const conf = confidenceScore(medium.coverage, priceAge, ai.available());

  // Catalysts & risks
  const positive: string[] = [];
  const negative: string[] = [];
  const risks: string[] = [];
  if (foView?.stance === "bullish") positive.push(`F&O: ${foView.reasons[0]}`);
  if (foView?.stance === "bearish") negative.push(`F&O: ${foView.reasons[0]}`);
  if (sig.current.state === "in-trade" && sig.current.since) positive.push(`Trend-following BUY signal active since ${sig.current.since} (entry ${sig.current.entry?.toFixed(2)}; trailing stop ${sig.current.trailingStop?.toFixed(2)}).`);
  else if (sig.current.lastSignal?.type === "SELL" && last && daysBetween(sig.current.lastSignal.date, new Date(last.date + "T00:00:00Z")) <= 20) negative.push(`Trend-following SELL signal on ${sig.current.lastSignal.date}: ${sig.current.lastSignal.reason}.`);
  if (technical.potentialBreakout) positive.push("Price is within 2% of resistance or near its 52-week high with a non-bearish trend — potential breakout setup.");
  if (technical.trend === "bullish") positive.push("Bullish trend structure: close above a rising 50-day average with positive MACD histogram.");
  if (technical.potentialBreakdown) negative.push("Price is within 2% of support or near its 52-week low — potential breakdown setup.");
  if (technical.trend === "bearish") negative.push("Bearish trend structure: close below a falling 50-day average with negative MACD histogram.");
  for (const e of events.filter((e) => ["board_meeting", "dividend", "buyback", "results", "merger", "acquisition"].includes(e.type)).slice(0, 4)) positive.push(`Corporate event: ${e.title.slice(0, 160)} (${e.date}, ${e.source}).`);
  news.filter((n) => n.impact === "high" || (n.impact === "medium" && n.relevance >= 0.5)).slice(0, 8).forEach((n) => (n.sentiment === "positive" ? positive : n.sentiment === "negative" ? negative : []).push(`${n.headline} — ${n.publisher}, ${n.publishedAt.slice(0, 10)} [relevance ${n.relevance.toFixed(2)}, ${n.impact} impact]`));
  if (technical.condition === "overbought") risks.push(`RSI14 ${technical.rsi14?.toFixed(1)} is overbought — short-term score reduced by 8 points and swing by 4 (pull-back risk).`);
  if (technical.atrPct != null && technical.atrPct > 3) risks.push(`Elevated volatility: ATR is ${technical.atrPct.toFixed(2)}% of price.`);
  if (technical.sma200 != null && technical.close != null && technical.close < technical.sma200) risks.push("Price is below its 200-day average (long-term uptrend not confirmed).");
  if (technical.high52w && technical.close && (technical.high52w - technical.close) / technical.high52w > 0.2) risks.push(`Trading ${(((technical.high52w - technical.close) / technical.high52w) * 100).toFixed(1)}% below its 52-week high.`);
  if (lf?.debtToEquity != null && lf.debtToEquity > 1) risks.push(`Leverage: debt-to-equity ${lf.debtToEquity.toFixed(2)} (${lf.period}).`);
  const negHi = news.filter((n) => n.sentiment === "negative" && n.impact === "high");
  if (negHi.length) risks.push(`${negHi.length} high-impact negative news item(s) in the last 30 days.`);
  if (!fin) risks.push("Fundamental data not available — assessment relies on price action, news and risk evidence.");
  if (priceAge != null && priceAge > 5) risks.push(`Price data is ${priceAge} days old.`);
  steps.push({ step: "Catalysts & risks", status: "ok", detail: `${positive.length} positive, ${negative.length} negative catalysts; ${risks.length} risks` });
  steps.push({ step: "Research score", status: medium.score != null ? "ok" : "unavailable", detail: medium.score != null ? `Medium-term score ${medium.score}; confidence ${conf.confidence}` : "Not enough evidence for a medium-term composite score" });

  if (fin) sources.push({ id: "fund", label: fin.source, url: fin.sourceUrl, retrievedAt: fin.retrievedAt, period: fin.reportingPeriod });
  events.slice(0, 10).forEach((e, i) => sources.push({ id: `event:${i}`, label: `${e.source}: ${e.title.slice(0, 100)}`, url: e.url, period: e.date }));
  news.slice(0, 25).forEach((n, i) => sources.push({ id: `news:${i}`, label: `${n.publisher}: ${n.headline.slice(0, 120)}`, url: n.url, retrievedAt: n.retrievedAt, period: n.publishedAt.slice(0, 10) }));
  macro.filter((m) => m.status === "ok").forEach((m) => sources.push({ id: `macro:${m.id}`, label: `${m.source}: ${m.name}`, url: m.sourceUrl, period: m.date ?? undefined }));

  // Narrative
  const evidence = {
    company: { name: company.name, symbol: company.symbol, exchange: "NSE", sector: company.sector, indices: company.indices },
    price: last ? { close: last.close, date: last.date, return1m: rnd(technical.return1m), return3m: rnd(technical.return3m), return1y: rnd(technical.return1y), high52w: rnd(technical.high52w), low52w: rnd(technical.low52w) } : "unavailable",
    tech: { trend: technical.trend, trendStrength: technical.trendStrength, momentum: technical.momentum, condition: technical.condition, rsi14: rnd(technical.rsi14), adx14: rnd(technical.adx14), sma50: rnd(technical.sma50), sma200: rnd(technical.sma200), atrPct: rnd(technical.atrPct), signals: technical.signals, score: technical.score },
    fund: fundResult.score == null ? "unavailable" : { score: fundResult.score, criteria: fundResult.subScores.map((s) => ({ name: s.name, score: s.score == null ? null : Math.round(s.score), detail: s.detail })) },
    valuation: valResult.score == null ? (industryPe ? { sectorPe: industryPe.value, note: "company P/E unavailable" } : "unavailable") : { score: valResult.score, criteria: valResult.subScores.map((s) => s.detail) },
    own: instResult.score == null ? "unavailable" : { score: instResult.score, criteria: instResult.subScores.map((s) => s.detail) },
    peers: peerRows.map((p) => ({ symbol: p.symbol, return3m: rnd(p.return3m), return1y: rnd(p.return1y), technicalScore: p.technicalScore })),
    events: events.slice(0, 10).map((e, i) => ({ id: `event:${i}`, type: e.type, date: e.date, title: e.title.slice(0, 200) })),
    news: news.slice(0, 25).map((n, i) => ({ id: `news:${i}`, headline: n.headline, publisher: n.publisher, date: n.publishedAt.slice(0, 10), sentiment: n.sentiment, relevance: n.relevance, impact: n.impact, category: n.category, why: n.evidence.split(" (matched")[0] })),
    macro: macro.filter((m) => m.status === "ok").map((m) => ({ id: `macro:${m.id}`, name: m.name, value: m.value, date: m.date, unit: m.unit })),
    verdicts: recommendations.map((r) => ({ horizon: r.horizon, verdict: r.verdict, score: r.score, confidence: r.confidence })),
    fo: foView ? { stance: foView.stance, buildup: foView.futures?.buildup, pcr: rnd(foView.options?.pcr), maxPain: foView.options?.maxPain, support: foView.levels.support, resistance: foView.levels.resistance, reasons: foView.reasons } : "unavailable",
    chartSignal: { state: sig.current.state, since: sig.current.since, lastSignal: sig.current.lastSignal, backtest: { trades: sig.stats.trades, winRate: rnd(sig.stats.winRate), avgReturn: rnd(sig.stats.avgReturn) } },
    catalysts: { positive, negative },
    risks,
  };
  const validIds = new Set(["tech", "fund", "valuation", "own", "peers", "price", "risks", ...evidence.events.map((e) => e.id), ...evidence.news.map((n) => n.id), ...evidence.macro.map((m) => m.id)]);
  let narrative: Narrative = templateNarrative(company, technical, fundResult.score, news, recommendations, risks, positive, negative);
  let narrativeSource = "deterministic template (no AI key configured)";
  let validation: string[] = [];
  if (ai.available()) {
    try {
      const raw = await ai.generateJson(SYSTEM_PROMPT, `EVIDENCE:\n${JSON.stringify(evidence)}`, `${company.symbol}:${last?.date}`);
      const v = validateNarrative(NarrativeSchema.parse(raw), evidenceNumbers(evidence), validIds);
      narrative = v.narrative;
      validation = v.removed;
      narrativeSource = ai.name;
      steps.push({ step: "AI research narrative", status: "ok", detail: `${ai.name}; ${v.removed.length} statement(s) removed by number validation` });
    } catch (e) {
      narrativeSource = "deterministic template (AI call failed)";
      steps.push({ step: "AI research narrative", status: "error", detail: `${(e as Error).message.slice(0, 200)} — template used` });
    }
  } else steps.push({ step: "AI research narrative", status: "unavailable", detail: "GEMINI_API_KEY secret not set — template used" });

  // Verdict history (one entry per trading day)
  const histFile = dataPath("history", `${company.symbol}.json`);
  const history = await readJson<{ date: string; close: number | null; score: number | null; confidence: number; verdicts: Record<string, string> }[]>(histFile, []);
  if (last && history[0]?.date !== last.date) {
    history.unshift({ date: last.date, close: last.close, score: medium.score, confidence: conf.confidence, verdicts: Object.fromEntries(recommendations.map((r) => [r.horizon, r.verdict])) });
    await writeJson(histFile, history.slice(0, 250));
  }

  return {
    version: 1,
    generatedAt: now.toISOString(),
    company,
    steps,
    price: { lastClose: last?.close ?? null, lastDate: last?.date ?? null, changePct: last && prev ? ((last.close - prev.close) / prev.close) * 100 : null, status: !last ? "unavailable" : priceAge! > 5 ? "stale" : "ok", source: "NSE sec_bhavdata_full (daily bhavcopy)", sourceUrl: last ? NSE_URLS.bhavcopyFull(new Date(last.date + "T00:00:00Z")) : undefined, bars: candles.length, adjusted: true, adjustmentNote: "Split/bonus adjusted using NSE's ex-date adjusted previous close; dividends not adjusted." },
    candles,
    technical,
    fundamentals: { bundle: fin, result: fundResult, valuation: valResult, derivedPe, industryPe },
    institutional: { bundle: sh, result: instResult },
    events,
    news,
    macro,
    peers: peerRows,
    components: components.map((c) => ({ ...c, weight: medium.weights[c.key] })),
    recommendations,
    researchScore: medium.score,
    confidence: conf.confidence,
    confidenceNotes: conf.notes,
    weights: medium.weights,
    catalysts: { positive, negative },
    risks,
    narrative,
    narrativeSource,
    narrativeValidation: validation,
    sources,
    disclaimer: DISCLAIMER,
    history,
    fo: foView,
  } as ResearchReport;
}

function templateNarrative(c: StockMaster, t: TechnicalSnapshot, fundScore: number | null, news: NewsItem[], recs: HorizonRecommendation[], risks: string[], pos: string[], neg: string[]): Narrative {
  const st = (text: string, cites: string[] = []) => ({ text, cites });
  const v = recs.map((r) => `${HORIZONS[r.horizon].label}: ${r.verdict}`).join("; ");
  const f = (x: number | null) => (x == null ? "n/a" : x.toFixed(2));
  return {
    executiveSummary: [
      st(`${c.name} (NSE: ${c.symbol}) — ${c.sector ?? "sector not classified"}.`),
      t.close != null ? st(`Latest close ${t.close.toFixed(2)} on ${t.asOf}; trend classified ${t.trend ?? "n/a"} with ${t.trendStrength ?? "n/a"} trend strength.`, ["tech"]) : st("Price data is unavailable."),
      st(`Assessment by horizon — ${v}.`),
      fundScore == null ? st("Fundamental data was not available; verdicts lean on technical, news and risk evidence.") : st(`Fundamental score ${fundScore}/100.`, ["fund"]),
    ],
    currentPosition: t.close != null ? [st(`1-month return ${f(t.return1m)}%, 3-month ${f(t.return3m)}%, 1-year ${f(t.return1y)}%. 52-week range ${f(t.low52w)}–${f(t.high52w)}.`, ["tech"])] : [],
    fundamentalAnalysis: fundScore == null ? [st("Financial statements are not available from a free, licence-clear source for this company yet.")] : [st(`Fundamental score ${fundScore}/100; see the criteria table.`, ["fund"])],
    technicalAnalysis: t.signals.map((s) => st(s, ["tech"])),
    institutionalActivity: [st("Shareholding data is not available yet.")],
    globalIntelligence: news.filter((n) => n.relevance >= 0.5).slice(0, 4).map((n) => st(`${n.headline} (${n.publisher}, ${n.publishedAt.slice(0, 10)}) — ${n.evidence.split(" (matched")[0]}`, [`news:${news.indexOf(n)}`])),
    growthOpportunities: pos.slice(0, 3).map((p) => st(p)),
    risks: risks.slice(0, 5).map((r) => st(r, ["risks"])),
    positiveCatalysts: pos.slice(0, 4).map((p) => st(p)),
    negativeCatalysts: neg.slice(0, 4).map((p) => st(p)),
    invalidation: recs.filter((r) => r.levels.actionable && r.levels.stopLoss != null).slice(0, 2).map((r) => st(`${HORIZONS[r.horizon].label}: a daily close below ${r.levels.stopLoss} would invalidate the setup.`, ["tech"])),
    conclusion: [st(`Mechanical assessment: ${v}.`)],
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

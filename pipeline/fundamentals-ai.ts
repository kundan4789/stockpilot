// Company fundamentals & shareholding via Gemini + Grounding with Google Search.
// The model may only report figures it finds in cited web pages; every figure is then
// sanity-checked here (ranges, internal consistency, P/E vs NSE price ÷ EPS) and
// anything failing is dropped (set to null), never guessed. Refreshed every 30 days.

import type { Financials, FinancialsBundle, ShareholdingBundle, StockMaster } from "../src/lib/types";
import { env } from "./env";
import { fetchSource } from "./http";
import { dataPath, readJson, writeJson } from "./store";

const REFRESH_DAYS = 30;

interface Grounded {
  candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
}

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() !== "" && Number.isFinite(Number(x.replace(/,/g, ""))) ? Number(x.replace(/,/g, "")) : null);
const inRange = (x: number | null, lo: number, hi: number) => (x != null && x >= lo && x <= hi ? x : null);

function prompt(c: StockMaster) {
  return `Use Google Search to find the most recent officially reported CONSOLIDATED financials of ${c.name} (NSE symbol ${c.symbol}, ISIN ${c.isin ?? "n/a"}), an Indian listed company in "${c.sector ?? "unknown"}".
Prefer company annual reports/results, NSE/BSE filings, then reputable financial data sites.
Return ONLY a JSON object, no prose:
{"currency":"INR","unit":"crore",
 "annual":[{"period":"FY2026","revenue":0,"ebitda":0,"operatingProfit":0,"netProfit":0,"eps":0,"roe":0,"roce":0,"debtToEquity":0,"operatingCashFlow":0,"freeCashFlow":0,"cash":0,"dividendYield":0}],
 "shareholding":[{"period":"2026-09","promoter":0,"fii":0,"dii":0,"mutualFunds":0,"promoterPledged":0}],
 "marketCap":0}
Rules: "annual" = up to the last 4 fiscal years, newest first; amounts in INR crore; eps in INR; roe, roce, dividendYield, shareholding values in percent; for banks use total income as revenue.
"shareholding" = the last 2 quarters, newest first ("promoterPledged" = % of promoter holding pledged).
Use null for ANY value you did not find in a source. Never estimate or calculate missing values.`;
}

function validate(raw: Record<string, unknown>, lastClose: number | null): { fin: Financials[]; sh: ShareholdingBundle["history"]; notes: string[]; marketCap: number | null } {
  const notes: string[] = [];
  const annual = (Array.isArray(raw.annual) ? raw.annual : []) as Record<string, unknown>[];
  const fin: Financials[] = [];
  const seen = new Set<string>();
  for (const a of annual.slice(0, 5)) {
    const period = String(a.period ?? "").trim().toUpperCase().replace(/\s+/g, "");
    if (!/^FY\d{2,4}$/.test(period) || seen.has(period)) continue;
    seen.add(period);
    const revenue = inRange(n(a.revenue), 1, 5e7);
    let netProfit = n(a.netProfit);
    if (netProfit != null && revenue != null && Math.abs(netProfit) > revenue * 1.5) {
      notes.push(`${period}: net profit inconsistent with revenue — dropped`);
      netProfit = null;
    }
    let eps = inRange(n(a.eps), -5000, 50000);
    if (eps != null && netProfit != null && Math.sign(eps) !== Math.sign(netProfit) && netProfit !== 0) {
      notes.push(`${period}: EPS sign disagrees with net profit — EPS dropped`);
      eps = null;
    }
    fin.push({
      period,
      revenue,
      ebitda: inRange(n(a.ebitda), -5e7, 5e7),
      operatingProfit: inRange(n(a.operatingProfit), -5e7, 5e7),
      netProfit,
      eps,
      roe: inRange(n(a.roe), -100, 150),
      roce: inRange(n(a.roce), -100, 150),
      debtToEquity: inRange(n(a.debtToEquity), 0, 30),
      operatingCashFlow: inRange(n(a.operatingCashFlow), -5e7, 5e7),
      freeCashFlow: inRange(n(a.freeCashFlow), -5e7, 5e7),
      cash: inRange(n(a.cash), 0, 5e7),
      dividendYield: inRange(n(a.dividendYield), 0, 25),
      pe: null, // always recomputed from the live NSE price ÷ EPS
      pb: null,
      marketCap: null,
    });
  }
  fin.sort((x, y) => y.period.localeCompare(x.period));
  // Market cap: keep only if plausible vs price (cannot verify share count; range check only)
  const marketCap = inRange(n(raw.marketCap), 100, 5e7);
  if (fin[0]) fin[0].marketCap = marketCap;
  // EPS vs price sanity: implied P/E must be within 1–300 for profitable companies
  if (fin[0]?.eps && fin[0].eps > 0 && lastClose) {
    const pe = lastClose / fin[0].eps;
    if (pe < 1 || pe > 300) {
      notes.push(`Latest EPS ${fin[0].eps} implies P/E ${pe.toFixed(1)} at ₹${lastClose} — EPS dropped as implausible`);
      fin[0].eps = null;
    }
  }
  const shRaw = (Array.isArray(raw.shareholding) ? raw.shareholding : []) as Record<string, unknown>[];
  const sh: ShareholdingBundle["history"] = [];
  for (const s of shRaw.slice(0, 4)) {
    const period = String(s.period ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(period)) continue;
    const row = { period, promoter: inRange(n(s.promoter), 0, 100), fii: inRange(n(s.fii), 0, 100), dii: inRange(n(s.dii), 0, 100), mutualFunds: inRange(n(s.mutualFunds), 0, 100), promoterPledged: inRange(n(s.promoterPledged), 0, 100) };
    const sum = (row.promoter ?? 0) + (row.fii ?? 0) + (row.dii ?? 0);
    if (sum > 101) {
      notes.push(`${period}: shareholding adds to ${sum.toFixed(1)}% — dropped`);
      continue;
    }
    if (row.mutualFunds != null && row.dii != null && row.mutualFunds > row.dii + 0.5) row.mutualFunds = null;
    sh.push(row);
  }
  sh.sort((x, y) => y.period.localeCompare(x.period));
  return { fin, sh, notes, marketCap };
}

export async function refreshFundamentals(c: StockMaster, lastClose: number | null, log: (s: string) => void): Promise<boolean> {
  if (!env.geminiKey) return false;
  const file = dataPath("fundamentals", `${c.symbol}.json`);
  const cur = await readJson<FinancialsBundle | null>(file, null);
  if (cur && Date.now() - new Date(cur.retrievedAt).getTime() < REFRESH_DAYS * 86400000) return false;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`;
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt(c) }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0 } });
  const r = await fetchSource<Grounded>(url, { source: "gemini", method: "POST", body, headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey }, timeoutMs: 90_000, retries: 1 });
  const cand = r.data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    log(`${c.symbol}: fundamentals response was not valid JSON`);
    return false;
  }
  const cites = (cand?.groundingMetadata?.groundingChunks ?? []).map((g) => g.web).filter((w): w is { uri: string; title?: string } => !!w?.uri);
  if (!cites.length) {
    log(`${c.symbol}: fundamentals rejected — no cited web sources`);
    return false;
  }
  const v = validate(raw, lastClose);
  if (!v.fin.length || v.fin[0].revenue == null) {
    log(`${c.symbol}: fundamentals rejected — no usable annual figures`);
    return false;
  }
  const sourceLabel = `Google Search (via Gemini) — ${cites.slice(0, 3).map((x) => x.title ?? new URL(x.uri).hostname).join(", ")}`;
  const bundle: FinancialsBundle & { citations: { uri: string; title?: string }[]; validationNotes: string[] } = {
    source: sourceLabel,
    sourceUrl: cites[0].uri,
    retrievedAt: new Date().toISOString(),
    reportingPeriod: v.fin[0].period,
    status: "ok",
    quality: "medium",
    note: "Figures extracted from cited web pages by AI search, then range- and consistency-checked. Verify against the company's filings before relying on them.",
    currency: "INR (₹ crore)",
    annual: v.fin,
    quarterly: [],
    industryPe: null,
    citations: cites.slice(0, 8),
    validationNotes: v.notes,
  };
  await writeJson(file, bundle);
  if (v.sh.length) {
    const shb: ShareholdingBundle = { source: sourceLabel, sourceUrl: cites[0].uri, retrievedAt: bundle.retrievedAt, reportingPeriod: v.sh[0].period, status: "ok", quality: "medium", history: v.sh };
    await writeJson(dataPath("shareholding", `${c.symbol}.json`), shb);
  }
  log(`${c.symbol}: fundamentals ${v.fin.map((f) => f.period).join("/")}, shareholding ${v.sh.length} qtr, ${cites.length} sources${v.notes.length ? `; ${v.notes.length} value(s) dropped` : ""}`);
  return true;
}

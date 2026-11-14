import type { NewsItem, StockMaster } from "../src/lib/types";
import { fetchSource } from "./http";
import { safeUrl, sanitizeText } from "../src/lib/util/parse";
import { classifyImpact, lexiconSentiment, MACRO_THEMES, scoreRelevance, SECTOR_THEMES, shortName, type Theme } from "../src/lib/analysis/news";

// GDELT DOC 2.0 API — free, documented: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string; // 20261113T101500Z
  domain: string;
  language: string;
  sourcecountry: string;
}

const toIso = (s: string) => (/^\d{8}T\d{6}Z$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z` : new Date().toISOString());

let newsDeadline = Infinity;
let consecutive429 = 0;
export function setNewsBudget(ms: number) {
  newsDeadline = Date.now() + ms;
}

async function query(q: string, timespan = "14d", max = 40, attempt = 0): Promise<{ articles: GdeltArticle[]; retrievedAt: string }> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${q} sourcelang:english`)}&mode=artlist&maxrecords=${max}&format=json&sort=datedesc&timespan=${timespan}`;
  if (/\bOR\b/.test(q) && !q.trim().startsWith("(")) return query(`(${q})`, timespan, max, attempt);
  if (Date.now() > newsDeadline) throw new Error("news time budget reached");
  let r: { data: { articles?: GdeltArticle[] } | string; retrievedAt: string };
  try {
    r = await fetchSource<{ articles?: GdeltArticle[] } | string>(url, { source: "gdelt", as: "text", timeoutMs: 30_000, retries: 0 });
  } catch (e) {
    // GDELT throttles shared cloud IPs: back off and retry (up to 3 times).
    if (/429/.test((e as Error).message)) consecutive429++;
    if (consecutive429 >= 6) newsDeadline = 0; // GDELT is throttling this runner — stop asking this run
    if (attempt < 1 && /429|fetch failed|abort/i.test((e as Error).message) && Date.now() < newsDeadline) {
      await new Promise((res) => setTimeout(res, 15_000));
      return query(q, timespan, max, attempt + 1);
    }
    throw e;
  }
  // GDELT returns plain-text errors (e.g. "query too short") with HTTP 200.
  let parsed: { articles?: GdeltArticle[] } = {};
  try {
    parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  } catch {
    throw new Error(`GDELT: ${sanitizeText(String(r.data), 160)}`);
  }
  consecutive429 = 0;
  return { articles: parsed.articles ?? [], retrievedAt: r.retrievedAt };
}

export async function fetchCompanyNews(company: StockMaster, competitors: StockMaster[]): Promise<{ items: NewsItem[]; errors: string[]; queries: string[] }> {
  const sn = shortName(company.name);
  const tasks: { q: string; theme: Theme | null }[] = [{ q: `"${sn}"`, theme: null }];
  for (const t of SECTOR_THEMES[company.sector ?? ""] ?? []) tasks.push({ q: t.query, theme: t });
  for (const t of MACRO_THEMES.slice(0, 2)) tasks.push({ q: t.query, theme: t });
  const comps = competitors.slice(0, 5); // used only to recognise competitor mentions in headlines

  const errors: string[] = [];
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  // GDELT asks for spaced requests, so these run sequentially through the rate limiter.
  for (const t of tasks) {
    try {
      const { articles, retrievedAt } = await query(t.q, t.theme ? "7d" : "30d", t.theme ? 15 : 40);
      for (const a of articles) {
        const url = safeUrl(a.url);
        const headline = sanitizeText(a.title, 300);
        if (!url || !headline || seen.has(url)) continue;
        seen.add(url);
        const rel = scoreRelevance(headline, company, t.theme, comps.map((c) => c.name));
        const s = lexiconSentiment(headline);
        items.push({
          headline,
          publisher: sanitizeText(a.domain, 100),
          url,
          publishedAt: toIso(a.seendate),
          retrievedAt,
          company: company.symbol,
          sentiment: s.sentiment,
          sentimentScore: s.score,
          relevance: rel.relevance,
          impact: classifyImpact(rel.relevance, s.score, headline),
          category: rel.category,
          evidence: `${rel.evidence}${s.hits.length ? ` Sentiment cues: ${s.hits.slice(0, 4).join(", ")}.` : ""} (matched query: ${t.q})`,
        });
      }
    } catch (e) {
      errors.push(`${t.q}: ${(e as Error).message}`);
      if ((e as Error).message.includes("429")) await new Promise((r) => setTimeout(r, 30_000)); // GDELT asks clients to slow down
      if ((e as Error).name === "QuotaExceededError" || (e as Error).message.includes("quota")) break;
    }
  }
  items.sort((a, b) => b.relevance - a.relevance || b.publishedAt.localeCompare(a.publishedAt));
  return { items, errors, queries: tasks.map((t) => t.q) };
}

export async function fetchMarketNews(): Promise<NewsItem[]> {
  const { articles, retrievedAt } = await query('("Sensex" OR "Nifty") (stocks OR market)', "2d", 30);
  return articles
    .map((a) => {
      const headline = sanitizeText(a.title, 300);
      const s = lexiconSentiment(headline);
      return { headline, publisher: sanitizeText(a.domain, 100), url: safeUrl(a.url) ?? "", publishedAt: toIso(a.seendate), retrievedAt, company: "MARKET", sentiment: s.sentiment, sentimentScore: s.score, relevance: 0.5, impact: "low" as const, category: "market", evidence: "Indian market news (GDELT query: Sensex/Nifty)." };
    })
    .filter((n) => n.url && n.headline);
}


/**
 * Batched news collection for the whole universe: company names are OR-ed together
 * (10 per query) and themes are queried once, then each article is assigned to the
 * companies it relates to. ~20 GDELT requests instead of hundreds.
 */
export async function fetchUniverseNews(universe: StockMaster[], log: (s: string) => void): Promise<Map<string, NewsItem[]>> {
  const out = new Map<string, NewsItem[]>(universe.map((c) => [c.symbol, []]));
  const add = (c: StockMaster, a: GdeltArticle, retrievedAt: string, theme: Theme | null, q: string) => {
    const url = safeUrl(a.url);
    const headline = sanitizeText(a.title, 300);
    if (!url || !headline) return;
    const list = out.get(c.symbol)!;
    if (list.some((n) => n.url === url)) return;
    const peers = universe.filter((p) => p.symbol !== c.symbol && p.sector && p.sector === c.sector).map((p) => p.name);
    const rel = scoreRelevance(headline, c, theme, peers);
    if (!theme && rel.relevance < 0.5) return; // batch article not about this company
    const s = lexiconSentiment(headline);
    list.push({ headline, publisher: sanitizeText(a.domain, 100), url, publishedAt: toIso(a.seendate), retrievedAt, company: c.symbol, sentiment: s.sentiment, sentimentScore: s.score, relevance: rel.relevance, impact: classifyImpact(rel.relevance, s.score, headline), category: rel.category, evidence: `${rel.evidence}${s.hits.length ? ` Sentiment cues: ${s.hits.slice(0, 4).join(", ")}.` : ""} (matched query: ${q.slice(0, 120)})` });
  };
  let ok = 0, failed = 0;
  // 1. Company batches
  for (let i = 0; i < universe.length; i += 5) {
    const batch = universe.slice(i, i + 5);
    const q = `(${batch.map((c) => `"${shortName(c.name)}"`).join(" OR ")})`;
    try {
      const { articles, retrievedAt } = await query(q, "14d", 250);
      for (const a of articles) for (const c of batch) add(c, a, retrievedAt, null, q);
      ok++;
    } catch (e) {
      failed++;
      log(`GDELT batch ${i / 5 + 1} failed: ${(e as Error).message}`);
    }
  }
  // 2. Sector & macro themes, once each
  const themes = new Map<string, Theme>();
  for (const c of universe) for (const t of SECTOR_THEMES[c.sector ?? ""] ?? []) themes.set(t.query, t);
  for (const t of MACRO_THEMES.slice(0, 2)) themes.set(t.query, t);
  for (const t of themes.values()) {
    try {
      const { articles, retrievedAt } = await query(t.query, "7d", 12);
      const targets = MACRO_THEMES.includes(t) ? universe : universe.filter((c) => (SECTOR_THEMES[c.sector ?? ""] ?? []).includes(t));
      for (const a of articles) for (const c of targets) add(c, a, retrievedAt, t, t.query);
      ok++;
    } catch (e) {
      failed++;
      log(`GDELT theme failed (${t.query.slice(0, 40)}): ${(e as Error).message}`);
    }
  }
  log(`News: ${ok} GDELT queries ok, ${failed} failed; ${[...out.values()].reduce((a, l) => a + l.length, 0)} items assigned`);
  return out;
}

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

async function query(q: string, timespan = "14d", max = 40): Promise<{ articles: GdeltArticle[]; retrievedAt: string }> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`${q} sourcelang:english`)}&mode=artlist&maxrecords=${max}&format=json&sort=datedesc&timespan=${timespan}`;
  const r = await fetchSource<{ articles?: GdeltArticle[] } | string>(url, { source: "gdelt", ttlSeconds: 60 * 60 * 3, as: "text", timeoutMs: 20_000, retries: 1 });
  // GDELT returns plain-text errors (e.g. "query too short") with HTTP 200.
  let parsed: { articles?: GdeltArticle[] } = {};
  try {
    parsed = typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  } catch {
    throw new Error(`GDELT: ${sanitizeText(String(r.data), 160)}`);
  }
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

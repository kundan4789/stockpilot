// GNews (gnews.io) — documented news search API; free plan: 100 requests/day, 10 articles each.
// One query per company per day (exact company name, India, English), plus nothing else,
// so the daily quota is never exceeded.

import type { NewsItem, StockMaster } from "../src/lib/types";
import { classifyImpact, lexiconSentiment, scoreRelevance, shortName } from "../src/lib/analysis/news";
import { safeUrl, sanitizeText } from "../src/lib/util/parse";
import { env } from "./env";
import { fetchSource } from "./http";

interface GArticle { title: string; description?: string; url: string; publishedAt: string; source?: { name?: string; url?: string } }

export async function fetchGNews(universe: StockMaster[], log: (s: string) => void): Promise<Map<string, NewsItem[]> | null> {
  if (!env.gnewsKey) return null;
  const out = new Map<string, NewsItem[]>();
  let ok = 0, failed = 0;
  for (const c of universe) {
    const sn = shortName(c.name);
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(`"${sn}"`)}&lang=en&country=in&max=10&sortby=publishedAt&apikey=${env.gnewsKey}`;
    try {
      const r = await fetchSource<{ articles?: GArticle[] }>(url, { source: "gnews", cacheKey: `gnews:${c.symbol}`, retries: 1 });
      const peers = universe.filter((p) => p.symbol !== c.symbol && p.sector === c.sector).map((p) => p.name);
      const items: NewsItem[] = [];
      for (const a of r.data.articles ?? []) {
        const link = safeUrl(a.url);
        const headline = sanitizeText(a.title, 300);
        if (!link || !headline) continue;
        const text = `${headline}. ${sanitizeText(a.description, 300)}`;
        const rel = scoreRelevance(text, c, null, peers);
        if (rel.relevance < 0.5) continue;
        const s = lexiconSentiment(headline);
        items.push({ headline, publisher: sanitizeText(a.source?.name, 100) || new URL(link).hostname, url: link, publishedAt: new Date(a.publishedAt).toISOString(), retrievedAt: r.retrievedAt, company: c.symbol, sentiment: s.sentiment, sentimentScore: s.score, relevance: rel.relevance, impact: classifyImpact(rel.relevance, s.score, headline), category: rel.category, evidence: `${rel.evidence}${s.hits.length ? ` Sentiment cues: ${s.hits.slice(0, 4).join(", ")}.` : ""} (GNews search: "${sn}")` });
      }
      out.set(c.symbol, items);
      ok++;
    } catch (e) {
      failed++;
      if (/429|quota/i.test((e as Error).message)) {
        log(`GNews quota reached after ${ok} companies`);
        break;
      }
    }
  }
  log(`GNews: ${ok} companies searched, ${failed} failed, ${[...out.values()].reduce((a, l) => a + l.length, 0)} relevant articles`);
  return out;
}

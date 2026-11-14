import { fetchSource } from "./http";
import { parseRss } from "../src/lib/util/parse";

// BSE publishes a public SENSEX RSS feed (www.bseindia.com/data/xml/sensexrss.xml).
// We only extract a number that is literally present in the feed; if the format
// changes and no number can be read, SENSEX is reported as unavailable.

export async function fetchSensex(): Promise<{ value: number | null; changePct: number | null; asOf: string | null; raw: string; url: string; retrievedAt: string | null }> {
  const url = "https://www.bseindia.com/data/xml/sensexrss.xml";
  try {
    const r = await fetchSource<string>(url, { source: "bse", as: "text", ttlSeconds: 900, headers: { Referer: "https://www.bseindia.com/" } });
    const it = parseRss(r.data)[0];
    if (!it) return { value: null, changePct: null, asOf: null, raw: "", url, retrievedAt: r.retrievedAt };
    const text = `${it.title} ${it.description}`;
    const nums = [...text.matchAll(/(-?\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|-?\d{4,6}(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
    const value = nums.find((n) => n > 10000 && n < 500000) ?? null; // plausibility band for the index level
    const pct = text.match(/(-?\d+(?:\.\d+)?)\s*%/);
    return { value, changePct: pct ? Number(pct[1]) : null, asOf: it.pubDate, raw: text.slice(0, 300), url, retrievedAt: r.retrievedAt };
  } catch {
    return { value: null, changePct: null, asOf: null, raw: "", url, retrievedAt: null };
  }
}

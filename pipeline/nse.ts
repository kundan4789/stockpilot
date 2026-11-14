import type { Candle, CorporateEvent, EventType, StockMaster } from "../src/lib/types";
import { fetchSource, HttpError } from "./http";
import { col, ddmmyyyy, num, parseCsv, parseDate, parseRss } from "../src/lib/util/parse";

// NSE publicly published daily reports (nsearchives.nseindia.com) and RSS feeds.
// These are the files NSE publishes for download on its "All Reports" page —
// no scraping of HTML pages and no undocumented JSON endpoints are used.
// URL patterns occasionally change; they are centralised here so they can be updated in one place.

export const NSE_URLS = {
  bhavcopyFull: (d: Date) => `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`,
  indicesClose: (d: Date) => `https://nsearchives.nseindia.com/content/indices/ind_close_all_${ddmmyyyy(d)}.csv`,
  equityList: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
  indexList: (file: string) => `https://nsearchives.nseindia.com/content/indices/${file}`,
  // RSS feeds listed at https://www.nseindia.com/static/rss-feed. Several spellings are tried;
  // the first that responds is used and the result is logged.
  rss: {
    announcements: ["Online_announcements.xml"],
    financialResults: ["Financial_Results.xml", "Financial_Result.xml", "financial_results.xml", "Fin_Results.xml"],
    boardMeetings: ["Board_Meetings.xml", "Board_Meeting.xml", "board_meetings.xml", "BoardMeetings.xml"],
    corporateActions: ["Corporate_action.xml", "Corporate_Actions.xml", "Corporate_actions.xml", "corporate_action.xml"],
    annualReports: ["Annual_Reports.xml", "Annual_Report.xml", "annual_reports.xml"],
  } as Record<string, string[]>,
};

export const INDEX_FILES: Record<string, string> = {
  "NIFTY 50": "ind_nifty50list.csv",
  "NIFTY NEXT 50": "ind_niftynext50list.csv",
  "NIFTY BANK": "ind_niftybanklist.csv",
  "NIFTY 500": "ind_nifty500list.csv",
};

const HEADERS = { Referer: "https://www.nseindia.com/", "Accept-Language": "en-US,en;q=0.9" };

export interface BhavRow extends Candle {
  symbol: string;
  series: string;
  prevClose: number | null;
}

export function parseBhavcopyFull(csv: string): BhavRow[] {
  const out: BhavRow[] = [];
  for (const r of parseCsv(csv)) {
    const series = col(r, "SERIES") ?? "";
    if (!["EQ", "BE", "BZ", "SM", "ST"].includes(series)) continue;
    const date = parseDate(col(r, "DATE1", "DATE", "TRADDT", "TIMESTAMP"));
    const open = num(col(r, "OPEN_PRICE", "OPEN", "OPNPRIC"));
    const high = num(col(r, "HIGH_PRICE", "HIGH", "HGHPRIC"));
    const low = num(col(r, "LOW_PRICE", "LOW", "LWPRIC"));
    const close = num(col(r, "CLOSE_PRICE", "CLOSE", "CLSPRIC"));
    const vol = num(col(r, "TTL_TRD_QNTY", "TOTTRDQTY", "TTLTRADGVOL"));
    if (!date || !open || !high || !low || !close || vol == null) continue; // reject incomplete rows rather than guess
    out.push({
      symbol: (col(r, "SYMBOL", "TCKRSYMB") ?? "").toUpperCase(),
      series,
      date,
      open,
      high,
      low,
      close,
      volume: vol,
      prevClose: num(col(r, "PREV_CLOSE", "PREVCLOSE", "PRVSCLSGPRIC")),
      deliveryQty: num(col(r, "DELIV_QTY")),
      deliveryPct: num(col(r, "DELIV_PER")),
    });
  }
  return out;
}

/** Fetch one day's full bhavcopy. Returns null on holidays/weekends (404). */
export async function fetchBhavcopy(d: Date): Promise<{ rows: BhavRow[]; url: string; retrievedAt: string } | null> {
  const url = NSE_URLS.bhavcopyFull(d);
  try {
    const r = await fetchSource<string>(url, { source: "nse", as: "text", ttlSeconds: 60 * 60 * 24 * 30, headers: HEADERS, retries: 1 });
    const rows = parseBhavcopyFull(r.data);
    return rows.length ? { rows, url, retrievedAt: r.retrievedAt } : null;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}

export interface IndexClose {
  name: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  changePct: number | null;
  pe: number | null;
  pb: number | null;
  divYield: number | null;
}

export function parseIndicesClose(csv: string): IndexClose[] {
  return parseCsv(csv)
    .map((r) => ({
      name: (col(r, "INDEX NAME") ?? "").toUpperCase(),
      date: parseDate(col(r, "INDEX DATE")) ?? "",
      open: num(col(r, "OPEN INDEX VALUE")),
      high: num(col(r, "HIGH INDEX VALUE")),
      low: num(col(r, "LOW INDEX VALUE")),
      close: num(col(r, "CLOSING INDEX VALUE")) as number,
      changePct: num(col(r, "CHANGE(%)", "CHANGE (%)")),
      pe: num(col(r, "P/E")),
      pb: num(col(r, "P/B")),
      divYield: num(col(r, "DIV YIELD")),
    }))
    .filter((x) => x.name && x.date && x.close != null);
}

export async function fetchIndicesClose(d: Date) {
  const url = NSE_URLS.indicesClose(d);
  try {
    const r = await fetchSource<string>(url, { source: "nse", as: "text", ttlSeconds: 60 * 60 * 24 * 30, headers: HEADERS, retries: 1 });
    const rows = parseIndicesClose(r.data);
    return rows.length ? { rows, url, retrievedAt: r.retrievedAt } : null;
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}

/** Walk back from `from` to find the most recent trading day that has a published file. */
export async function latestAvailable<T>(fn: (d: Date) => Promise<T | null>, from = new Date(), maxBack = 7): Promise<{ date: Date; value: T } | null> {
  for (let i = 0; i <= maxBack; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - i));
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const v = await fn(d);
    if (v) return { date: d, value: v };
  }
  return null;
}

/** Security master from EQUITY_L.csv plus sector/industry from NIFTY index constituent files. */
export async function fetchSecurityMaster(): Promise<StockMaster[]> {
  const eq = await fetchSource<string>(NSE_URLS.equityList, { source: "nse", as: "text", ttlSeconds: 86400 * 7, headers: HEADERS });
  const master = new Map<string, StockMaster>();
  for (const r of parseCsv(eq.data)) {
    const symbol = col(r, "SYMBOL");
    if (!symbol) continue;
    master.set(symbol, { symbol, exchange: "NSE", name: col(r, "NAME OF COMPANY") ?? symbol, isin: col(r, "ISIN NUMBER", " ISIN NUMBER"), indices: [] });
  }
  for (const [index, file] of Object.entries(INDEX_FILES)) {
    try {
      const r = await fetchSource<string>(NSE_URLS.indexList(file), { source: "nse", as: "text", ttlSeconds: 86400 * 7, headers: HEADERS });
      for (const row of parseCsv(r.data)) {
        const s = col(row, "SYMBOL");
        if (!s) continue;
        const m = master.get(s) ?? { symbol: s, exchange: "NSE" as const, name: col(row, "COMPANY NAME") ?? s, isin: col(row, "ISIN CODE"), indices: [] };
        m.sector = m.sector ?? col(row, "INDUSTRY");
        m.indices = [...new Set([...(m.indices ?? []), index])];
        master.set(s, m);
      }
    } catch {
      /* index file unavailable — sector stays unknown, never guessed */
    }
  }
  return [...master.values()];
}

const RSS_TYPE: Record<string, EventType> = {
  announcements: "announcement",
  financialResults: "results",
  boardMeetings: "board_meeting",
  corporateActions: "dividend",
  annualReports: "annual_report",
};

function classify(title: string, fallback: EventType): EventType {
  const t = title.toLowerCase();
  if (/buy ?back/.test(t)) return "buyback";
  if (/amalgamation|merger/.test(t)) return "merger";
  if (/acquisition|acquire/.test(t)) return "acquisition";
  if (/dividend/.test(t)) return "dividend";
  if (/financial result|results/.test(t)) return "results";
  if (/board meeting/.test(t)) return "board_meeting";
  return fallback;
}

const norm = (x: string) => x.toUpperCase().replace(/&AMP;/g, "&").replace(/\b(LIMITED|LTD)\b\.?/g, "").replace(/[^A-Z0-9&]+/g, " ").trim();

let feedCache: Promise<{ key: string; url: string; items: ReturnType<typeof parseRss>; retrievedAt: string }[]> | null = null;
export const feedStatus: string[] = [];

/** Fetch every NSE feed once per run (first working URL variant). */
function loadFeeds() {
  if (!feedCache)
    feedCache = (async () => {
      const out: { key: string; url: string; items: ReturnType<typeof parseRss>; retrievedAt: string }[] = [];
      for (const [key, names] of Object.entries(NSE_URLS.rss)) {
        let ok = false;
        for (const name of names) {
          const url = `https://nsearchives.nseindia.com/content/RSS/${name}`;
          try {
            const r = await fetchSource<string>(url, { source: "nse", as: "text", headers: HEADERS, retries: 0 });
            const items = parseRss(r.data);
            out.push({ key, url, items, retrievedAt: r.retrievedAt });
            feedStatus.push(`${key}: ${name} (${items.length} items)`);
            ok = true;
            break;
          } catch {
            /* try next spelling */
          }
        }
        if (!ok) feedStatus.push(`${key}: no working URL among ${names.join(", ")}`);
      }
      return out;
    })();
  return feedCache;
}

/**
 * Corporate events for a company from NSE's public RSS feeds. Items are matched on
 * the exact company name in the item title (NSE puts the company name there).
 */
export async function fetchCorporateEvents(company: StockMaster): Promise<{ events: CorporateEvent[]; errors: string[] }> {
  const feeds = await loadFeeds();
  const want = norm(company.name);
  const events: CorporateEvent[] = [];
  for (const f of feeds)
    for (const it of f.items) {
      if (norm(it.title) !== want) continue;
      events.push({ type: classify(`${it.title} ${it.description}`, RSS_TYPE[f.key] ?? "announcement"), title: it.description ? `${it.title} — ${it.description}`.slice(0, 400) : it.title, date: (it.pubDate ?? f.retrievedAt).slice(0, 10), url: it.link ?? undefined, source: `NSE RSS (${f.key})` });
    }
  const seen = new Set<string>();
  return {
    events: events.filter((e) => {
      const k = `${e.date}|${e.title.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
    errors: [],
  };
}

// Transparent, rule-based news relevance and sentiment. An optional AI pass may
// refine sentiment labels later, but relevance logic and evidence stay explainable.

import type { Impact, Sentiment, StockMaster } from "../types";

const POS = ["surge", "soar", "jump", "rally", "gain", "rise", "record", "beat", "beats", "upgrade", "outperform", "profit up", "growth", "expands", "expansion", "wins", "win", "bags", "order", "contract", "approval", "approves", "launch", "partnership", "acquires", "strong", "boost", "bullish", "dividend", "buyback", "investment", "invest", "raises", "higher", "positive", "recovery", "cut rates", "rate cut", "eases"];
const NEG = ["fall", "falls", "slump", "plunge", "drop", "decline", "loss", "losses", "miss", "misses", "downgrade", "underperform", "probe", "investigation", "fraud", "penalty", "fine", "ban", "lawsuit", "sued", "default", "debt", "weak", "cut", "cuts", "layoff", "layoffs", "strike", "shutdown", "recall", "bearish", "warning", "risk", "tariff", "sanction", "sanctions", "war", "lower", "negative", "slowdown", "inflation", "hike", "raid", "resigns"];
const SEVERE = ["fraud", "probe", "investigation", "default", "raid", "ban", "sanction", "bankrupt", "insolvency", "sebi order", "penalty", "resigns", "war"];

export function lexiconSentiment(text: string): { sentiment: Sentiment; score: number; hits: string[] } {
  const t = ` ${text.toLowerCase()} `;
  const hits: string[] = [];
  let s = 0;
  for (const w of POS) if (t.includes(` ${w}`)) { s += 1; hits.push(`+${w}`); }
  for (const w of NEG) if (t.includes(` ${w}`)) { s -= 1; hits.push(`−${w}`); }
  const score = Math.max(-1, Math.min(1, s / 3));
  return { sentiment: score > 0.15 ? "positive" : score < -0.15 ? "negative" : "neutral", score, hits };
}

export interface Theme {
  query: string; // GDELT query fragment
  category: "industry" | "commodity" | "policy" | "macro" | "competitor" | "geopolitics";
  why: string; // relationship explanation shown to the user
  weight: number; // base relevance 0..1
}

// Sector → global themes that plausibly transmit to Indian companies in that sector.
export const SECTOR_THEMES: Record<string, Theme[]> = {
  "Oil Gas & Consumable Fuels": [
    { query: '"crude oil" (price OR OPEC)', category: "commodity", why: "Crude prices drive refining margins, input costs and upstream realisations for oil & gas companies.", weight: 0.5 },
    { query: '"refining margins" OR "petrochemical prices"', category: "industry", why: "Refining and petrochemical spreads are a direct earnings driver for integrated refiners.", weight: 0.5 },
    { query: '"windfall tax" India OR "fuel price" India', category: "policy", why: "Indian fuel pricing and windfall taxes change realised margins.", weight: 0.45 },
  ],
  "Information Technology": [
    { query: '"IT spending" OR "tech spending" (US OR Europe)', category: "industry", why: "Indian IT services revenue depends on US/European enterprise technology budgets.", weight: 0.5 },
    { query: '"H-1B" OR "visa fees" OR "outsourcing" policy', category: "policy", why: "US visa and outsourcing policy affects delivery cost and onsite staffing.", weight: 0.45 },
    { query: '"generative AI" (services OR outsourcing) deal', category: "industry", why: "AI adoption reshapes demand and pricing for IT services contracts.", weight: 0.35 },
  ],
  "Financial Services": [
    { query: '"Reserve Bank of India" (repo OR rate OR liquidity)', category: "policy", why: "RBI rate and liquidity decisions set lending spreads and credit growth for banks and NBFCs.", weight: 0.55 },
    { query: '"India" ("credit growth" OR "bad loans" OR NPA)', category: "industry", why: "System-wide credit growth and asset quality drive bank earnings.", weight: 0.45 },
    { query: '"Federal Reserve" (rates OR decision)', category: "macro", why: "US rates influence foreign flows into Indian financials and the rupee.", weight: 0.35 },
  ],
  "Fast Moving Consumer Goods": [
    { query: '"palm oil" OR "commodity prices" FMCG', category: "commodity", why: "Edible oil and agri-commodity prices are major FMCG input costs.", weight: 0.45 },
    { query: '"rural demand" India OR monsoon India', category: "macro", why: "Rural demand and monsoon outcomes drive FMCG volumes.", weight: 0.45 },
  ],
  "Automobile and Auto Components": [
    { query: '"auto sales" India OR "vehicle sales" India', category: "industry", why: "Monthly vehicle sales show demand trends for automakers and suppliers.", weight: 0.5 },
    { query: '"electric vehicle" India (policy OR subsidy)', category: "policy", why: "EV policy changes product mix and capex needs.", weight: 0.4 },
    { query: '"steel prices" OR "semiconductor shortage"', category: "commodity", why: "Steel and chip supply affect auto production costs and volumes.", weight: 0.4 },
  ],
  Healthcare: [
    { query: '"US FDA" (India OR Indian) (warning OR approval OR inspection)', category: "policy", why: "US FDA actions on Indian plants directly affect pharma export revenue.", weight: 0.55 },
    { query: '"generic drug" prices US', category: "industry", why: "US generic pricing is a key earnings driver for Indian pharma exporters.", weight: 0.45 },
  ],
  "Metals & Mining": [
    { query: '"steel prices" OR "iron ore" OR "aluminium prices" OR "copper prices"', category: "commodity", why: "Global metal prices set realisations for Indian metal producers.", weight: 0.55 },
    { query: 'China (steel OR "property sector" OR stimulus)', category: "geopolitics", why: "Chinese demand and exports dominate global metal balances.", weight: 0.45 },
  ],
  Power: [
    { query: '"coal prices" OR "power demand" India', category: "commodity", why: "Fuel costs and electricity demand drive utility economics.", weight: 0.5 },
    { query: '"renewable energy" India (auction OR tariff OR policy)', category: "policy", why: "Renewable auctions and tariffs shape growth for power companies.", weight: 0.45 },
  ],
  Telecommunication: [
    { query: '"spectrum auction" India OR "telecom tariff" India', category: "policy", why: "Spectrum costs and tariff moves drive telecom profitability.", weight: 0.55 },
  ],
  "Construction Materials": [
    { query: '"cement prices" India OR "infrastructure spending" India', category: "industry", why: "Cement demand tracks infrastructure and housing activity.", weight: 0.5 },
  ],
  Construction: [{ query: '"infrastructure spending" India OR "order inflow" India', category: "industry", why: "Government capex drives order books for construction companies.", weight: 0.5 }],
  "Capital Goods": [{ query: '"capex cycle" India OR "infrastructure spending" India', category: "industry", why: "Capital-goods orders follow public and private capex.", weight: 0.5 }],
  Chemicals: [{ query: '"chemical prices" China OR "anti-dumping" chemicals India', category: "industry", why: "Chinese supply and trade remedies set chemical pricing.", weight: 0.45 }],
  Realty: [{ query: '"housing sales" India OR "home loan rates" India', category: "industry", why: "Housing demand and mortgage rates drive real-estate sales.", weight: 0.5 }],
  "Consumer Durables": [{ query: '"consumer demand" India (durables OR appliances)', category: "industry", why: "Discretionary demand drives durables volumes.", weight: 0.45 }],
};

export const MACRO_THEMES: Theme[] = [
  { query: '"Indian rupee" (dollar OR forex)', category: "macro", why: "Rupee moves affect exporters' revenue and importers' costs and foreign investor returns.", weight: 0.3 },
  { query: '"foreign investors" India (stocks OR equities OR FPI)', category: "macro", why: "Foreign portfolio flows move Indian large-cap prices broadly.", weight: 0.3 },
  { query: '"India" (GDP OR inflation OR budget) economy', category: "macro", why: "Domestic growth and inflation conditions affect earnings across sectors.", weight: 0.25 },
];

export function shortName(name: string): string {
  return name.replace(/\b(limited|ltd\.?|inc\.?|corporation|corp\.?|plc|company|co\.)\b/gi, "").replace(/\s+/g, " ").trim();
}

export function classifyImpact(relevance: number, sentimentScore: number, text: string): Impact {
  const severe = SEVERE.some((w) => text.toLowerCase().includes(w));
  const strength = relevance * (Math.abs(sentimentScore) + (severe ? 0.6 : 0));
  if (relevance < 0.2) return "none";
  if (strength >= 0.55) return "high";
  if (strength >= 0.25) return "medium";
  return "low";
}

/** Score relevance of a headline to a company, with an explanation. */
export function scoreRelevance(headline: string, company: StockMaster, theme: Theme | null, competitors: string[]): { relevance: number; category: string; evidence: string } {
  const h = headline.toLowerCase();
  const sn = shortName(company.name).toLowerCase();
  const firstWord = sn.split(" ")[0];
  if (h.includes(sn)) return { relevance: 0.95, category: "company", evidence: `Headline names ${shortName(company.name)} directly.` };
  const GENERIC = new Set(["state", "bank", "india", "indian", "bharat", "power", "oil", "steel", "life", "hindustan", "national", "general", "united", "asian", "grasim", "coal"]);
  if (firstWord.length > 3 && !GENERIC.has(firstWord) && new RegExp(`\\b${firstWord}\\b`).test(h))
    return { relevance: 0.5, category: "group", evidence: `Headline mentions "${firstWord}" — may refer to ${shortName(company.name)} or another company of the same group.` };
  const comp = competitors.find((c) => h.includes(shortName(c).toLowerCase()));
  if (comp) return { relevance: 0.55, category: "competitor", evidence: `Mentions peer ${shortName(comp)}; competitor developments can shift share, pricing or sentiment in ${company.sector ?? "the sector"}.` };
  if (theme) return { relevance: theme.weight, category: theme.category, evidence: theme.why };
  return { relevance: 0.1, category: "other", evidence: "No direct link found to the company; shown for context only." };
}

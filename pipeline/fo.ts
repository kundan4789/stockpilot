// F&O analyst: NSE's daily F&O UDiFF bhavcopy (public archive file) →
// futures OI build-up, options PCR, max pain and option-OI support/resistance.
// All figures are computed from the exchange file; nothing is estimated.

import { unzipSync, strFromU8 } from "fflate";
import { fetchSource, HttpError } from "./http";
import { col, num, parseCsv, parseDate } from "../src/lib/util/parse";

const ymd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
export const foUrl = (d: Date) => `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${ymd(d)}_F_0000.csv.zip`;

interface FoRow {
  type: string; // STF stock fut, STO stock opt, IDF index fut, IDO index opt
  symbol: string;
  expiry: string;
  strike: number | null;
  optType: string | null; // CE / PE
  close: number | null;
  settle: number | null;
  underlying: number | null;
  oi: number;
  oiChange: number;
  volume: number;
  date: string;
}

export function parseFo(csv: string): FoRow[] {
  return parseCsv(csv)
    .map((r) => ({
      type: (col(r, "FININSTRMTP", "INSTRUMENT") ?? "").toUpperCase(),
      symbol: (col(r, "TCKRSYMB", "SYMBOL") ?? "").toUpperCase(),
      expiry: parseDate(col(r, "XPRYDT", "EXPIRY_DT")) ?? "",
      strike: num(col(r, "STRKPRIC", "STRIKE_PR")),
      optType: (col(r, "OPTNTP", "OPTION_TYP") ?? "").toUpperCase() || null,
      close: num(col(r, "CLSPRIC", "CLOSE")),
      settle: num(col(r, "STTLMPRIC", "SETTLE_PR")),
      underlying: num(col(r, "UNDRLYGPRIC")),
      oi: num(col(r, "OPNINTRST", "OPEN_INT")) ?? 0,
      oiChange: num(col(r, "CHNGINOPNINTRST", "CHG_IN_OI")) ?? 0,
      volume: num(col(r, "TTLTRADGVOL", "CONTRACTS")) ?? 0,
      date: parseDate(col(r, "TRADDT", "TIMESTAMP")) ?? "",
    }))
    .filter((r) => r.symbol && r.expiry);
}

export async function fetchFo(d: Date): Promise<{ rows: FoRow[]; url: string; header: string } | null> {
  const url = foUrl(d);
  try {
    const r = await fetchSource<ArrayBuffer>(url, { source: "nse", as: "binary", headers: { Referer: "https://www.nseindia.com/" }, retries: 1 });
    const files = unzipSync(new Uint8Array(r.data));
    const name = Object.keys(files).find((k) => k.toLowerCase().endsWith(".csv"));
    if (!name) return null;
    const csv = strFromU8(files[name]);
    return { rows: parseFo(csv), url, header: csv.slice(0, csv.indexOf("\n")).slice(0, 400) };
  } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}

export type Buildup = "Long build-up" | "Short build-up" | "Short covering" | "Long unwinding" | "Neutral";

export interface FoAnalysis {
  symbol: string;
  date: string;
  sourceUrl: string;
  futures: { expiry: string; price: number | null; prevPrice: number | null; changePct: number | null; basisPct: number | null; oi: number; oiChangePct: number | null; buildup: Buildup; rolloverExpiry: string | null } | null;
  options: { expiry: string; pcr: number | null; pcrChange: number | null; maxPain: number | null; callWall: number | null; putWall: number | null; callOi: number; putOi: number; topCallOiAdds: { strike: number; oiChange: number }[]; topPutOiAdds: { strike: number; oiChange: number }[] } | null;
  stance: "bullish" | "bearish" | "neutral";
  stanceScore: number; // -100..100
  reasons: string[];
  levels: { support: number | null; resistance: number | null; note: string };
}

function buildup(priceChg: number | null, oiChg: number | null): Buildup {
  if (priceChg == null || oiChg == null || (Math.abs(priceChg) < 0.2 && Math.abs(oiChg) < 1)) return "Neutral";
  if (priceChg > 0 && oiChg > 0) return "Long build-up";
  if (priceChg < 0 && oiChg > 0) return "Short build-up";
  if (priceChg > 0 && oiChg < 0) return "Short covering";
  return "Long unwinding";
}

/** Strike at which option writers' total payout to holders is smallest. */
function maxPain(opts: FoRow[]): number | null {
  const strikes = [...new Set(opts.map((o) => o.strike).filter((s): s is number => s != null))].sort((a, b) => a - b);
  if (strikes.length < 3) return null;
  let best: number | null = null;
  let bestPay = Infinity;
  for (const k of strikes) {
    let pay = 0;
    for (const o of opts) {
      if (o.strike == null || !o.oi) continue;
      if (o.optType === "CE" && k > o.strike) pay += (k - o.strike) * o.oi;
      if (o.optType === "PE" && k < o.strike) pay += (o.strike - k) * o.oi;
    }
    if (pay < bestPay) {
      bestPay = pay;
      best = k;
    }
  }
  return best;
}

export function analyzeFo(symbol: string, rows: FoRow[], url: string, isIndex = false): FoAnalysis | null {
  const futType = isIndex ? "IDF" : "STF";
  const optType = isIndex ? "IDO" : "STO";
  const mine = rows.filter((r) => r.symbol === symbol);
  if (!mine.length) return null;
  const date = mine[0].date;
  const futs = mine.filter((r) => r.type === futType).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const near = futs[0];
  const reasons: string[] = [];
  const score = 0;

  let futures: FoAnalysis["futures"] = null;
  if (near) {
    const totalOi = futs.reduce((a, f) => a + f.oi, 0);
    const totalChg = futs.reduce((a, f) => a + f.oiChange, 0);
    const prevOi = totalOi - totalChg;
    const oiChangePct = prevOi > 0 ? (totalChg / prevOi) * 100 : null;
    const price = near.close ?? near.settle;
    // previous futures price is not in the file; use the underlying move implied by the cash close vs basis
    const changePct = null as number | null;
    const basisPct = price != null && near.underlying ? ((price - near.underlying) / near.underlying) * 100 : null;
    futures = { expiry: near.expiry, price, prevPrice: null, changePct, basisPct, oi: totalOi, oiChangePct, buildup: "Neutral", rolloverExpiry: futs[1]?.expiry ?? null };
  }

  let options: FoAnalysis["options"] = null;
  const opts = mine.filter((r) => r.type === optType);
  if (opts.length) {
    const expiry = [...new Set(opts.map((o) => o.expiry))].sort()[0];
    const nearOpts = opts.filter((o) => o.expiry === expiry);
    const callOi = nearOpts.filter((o) => o.optType === "CE").reduce((a, o) => a + o.oi, 0);
    const putOi = nearOpts.filter((o) => o.optType === "PE").reduce((a, o) => a + o.oi, 0);
    const prevCall = callOi - nearOpts.filter((o) => o.optType === "CE").reduce((a, o) => a + o.oiChange, 0);
    const prevPut = putOi - nearOpts.filter((o) => o.optType === "PE").reduce((a, o) => a + o.oiChange, 0);
    const pcr = callOi > 0 ? putOi / callOi : null;
    const prevPcr = prevCall > 0 ? prevPut / prevCall : null;
    const top = (t: string, key: "oi" | "oiChange") => nearOpts.filter((o) => o.optType === t && o.strike != null).sort((a, b) => b[key] - a[key]);
    options = {
      expiry,
      pcr,
      pcrChange: pcr != null && prevPcr != null ? pcr - prevPcr : null,
      maxPain: maxPain(nearOpts),
      callWall: top("CE", "oi")[0]?.strike ?? null,
      putWall: top("PE", "oi")[0]?.strike ?? null,
      callOi,
      putOi,
      topCallOiAdds: top("CE", "oiChange").slice(0, 3).filter((o) => o.oiChange > 0).map((o) => ({ strike: o.strike!, oiChange: o.oiChange })),
      topPutOiAdds: top("PE", "oiChange").slice(0, 3).filter((o) => o.oiChange > 0).map((o) => ({ strike: o.strike!, oiChange: o.oiChange })),
    };
  }
  return { symbol, date, sourceUrl: url, futures, options, stance: "neutral", stanceScore: score, reasons, levels: { support: options?.putWall ?? null, resistance: options?.callWall ?? null, note: "Support = put strike with the highest open interest; resistance = call strike with the highest open interest (near-month expiry)." } };
}

/** Combine F&O data with the cash-market move to classify build-up and an overall F&O stance. */
export function finalizeStance(a: FoAnalysis, cashChangePct: number | null, spot: number | null): FoAnalysis {
  const reasons: string[] = [];
  let s = 0;
  if (a.futures) {
    a.futures.changePct = cashChangePct;
    a.futures.buildup = buildup(cashChangePct, a.futures.oiChangePct);
    const b = a.futures.buildup;
    const oi = a.futures.oiChangePct;
    const txt = `${b}: price ${cashChangePct == null ? "n/a" : `${cashChangePct >= 0 ? "+" : ""}${cashChangePct.toFixed(2)}%`}, futures OI ${oi == null ? "n/a" : `${oi >= 0 ? "+" : ""}${oi.toFixed(1)}%`}`;
    if (b === "Long build-up") { s += 35; reasons.push(`${txt} — fresh long positions being added (bullish).`); }
    else if (b === "Short build-up") { s -= 35; reasons.push(`${txt} — fresh short positions being added (bearish).`); }
    else if (b === "Short covering") { s += 15; reasons.push(`${txt} — shorts exiting; rally may lack fresh buying.`); }
    else if (b === "Long unwinding") { s -= 15; reasons.push(`${txt} — longs exiting (mildly bearish).`); }
    else reasons.push(`${txt} — no clear positioning change.`);
    if (a.futures.basisPct != null) reasons.push(`Futures ${a.futures.basisPct >= 0 ? "premium" : "discount"} to spot: ${a.futures.basisPct.toFixed(2)}%.`);
  }
  if (a.options) {
    const { pcr, maxPain: mp, callWall, putWall } = a.options;
    if (pcr != null) {
      if (pcr >= 1.2) { s += 15; reasons.push(`Put-Call Ratio ${pcr.toFixed(2)} — put writers active, supportive.`); }
      else if (pcr <= 0.7) { s -= 15; reasons.push(`Put-Call Ratio ${pcr.toFixed(2)} — call writers dominant, capping upside.`); }
      else reasons.push(`Put-Call Ratio ${pcr.toFixed(2)} — balanced.`);
    }
    if (spot != null && callWall != null && putWall != null) {
      reasons.push(`Option OI range ${putWall}–${callWall} (highest put OI = support, highest call OI = resistance).`);
      if (spot > callWall) { s += 15; reasons.push(`Price is above the highest call-OI strike — breakout through option resistance.`); }
      if (spot < putWall) { s -= 15; reasons.push(`Price is below the highest put-OI strike — breakdown through option support.`); }
    }
    if (spot != null && mp != null) reasons.push(`Max pain ${mp} (${(((mp - spot) / spot) * 100).toFixed(1)}% from price) for ${a.options.expiry} expiry.`);
  }
  s = Math.max(-100, Math.min(100, s));
  return { ...a, stanceScore: s, stance: s >= 25 ? "bullish" : s <= -25 ? "bearish" : "neutral", reasons };
}

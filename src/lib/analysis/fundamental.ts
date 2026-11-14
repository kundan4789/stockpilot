// Fundamental and valuation scoring. Transparent, rule-based, 0..100.
// Missing inputs reduce coverage; they are never imputed.

import type { Financials, FinancialsBundle, ShareholdingBundle } from "../types";

export interface SubScore {
  name: string;
  score: number | null; // 0..100
  weight: number;
  detail: string;
}

export interface FundamentalResult {
  score: number | null;
  coverage: number;
  subScores: SubScore[];
  explanation: string[];
}

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
/** Linear map of x from [a,b] onto [0,100]. */
const scale = (x: number, a: number, b: number) => clamp(((x - a) / (b - a)) * 100);

export function cagr(newest: number | null, oldest: number | null, years: number): number | null {
  if (newest == null || oldest == null || years <= 0 || oldest <= 0 || newest <= 0) return null;
  return (Math.pow(newest / oldest, 1 / years) - 1) * 100;
}

const margin = (f: Financials) => (f.revenue && f.operatingProfit != null ? (f.operatingProfit / f.revenue) * 100 : null);

function combine(subs: SubScore[]): FundamentalResult {
  const avail = subs.filter((s) => s.score != null);
  const totalW = subs.reduce((a, s) => a + s.weight, 0);
  const availW = avail.reduce((a, s) => a + s.weight, 0);
  const coverage = totalW ? availW / totalW : 0;
  const score = availW > 0 && coverage >= 0.4 ? Math.round(avail.reduce((a, s) => a + (s.score as number) * s.weight, 0) / availW) : null;
  const explanation = [
    score == null
      ? `Insufficient inputs: only ${(coverage * 100).toFixed(0)}% of weighted criteria available (40% required).`
      : `Weighted average of ${avail.length}/${subs.length} available criteria (coverage ${(coverage * 100).toFixed(0)}%). Missing criteria are excluded, not assumed.`,
    ...subs.map((s) => `${s.name} (weight ${Math.round(s.weight * 100)}%): ${s.score == null ? "n/a" : s.score.toFixed(0)} — ${s.detail}`),
  ];
  return { score, coverage, subScores: subs, explanation };
}

export function scoreFundamentals(fin: FinancialsBundle | null, sh: ShareholdingBundle | null, peers: { roe: number | null; netMargin: number | null }[] = []): FundamentalResult {
  const a = fin?.annual ?? [];
  const latest = a[0];
  const subs: SubScore[] = [];

  // Sales growth: up to 3-year CAGR
  const yrs = Math.min(3, a.length - 1);
  const revCagr = yrs >= 1 ? cagr(a[0]?.revenue ?? null, a[yrs]?.revenue ?? null, yrs) : null;
  subs.push({ name: "Sales growth", weight: 0.15, score: revCagr == null ? null : scale(revCagr, -5, 20), detail: revCagr == null ? "needs ≥2 annual revenue figures" : `${yrs}-yr revenue CAGR ${revCagr.toFixed(1)}% (−5% → 0, 20% → 100)` });

  const npCagr = yrs >= 1 ? cagr(a[0]?.netProfit ?? null, a[yrs]?.netProfit ?? null, yrs) : null;
  subs.push({ name: "Profit growth", weight: 0.15, score: npCagr == null ? null : scale(npCagr, -5, 25), detail: npCagr == null ? "needs ≥2 positive annual net profits" : `${yrs}-yr net profit CAGR ${npCagr.toFixed(1)}% (−5% → 0, 25% → 100)` });

  const m0 = latest ? margin(latest) : null;
  const mOld = a[yrs] ? margin(a[yrs]) : null;
  const mDelta = m0 != null && mOld != null && yrs >= 1 ? m0 - mOld : null;
  subs.push({ name: "Margin trend", weight: 0.1, score: mDelta == null ? null : scale(mDelta, -5, 5), detail: mDelta == null ? "operating margin history unavailable" : `operating margin ${m0!.toFixed(1)}%, change ${mDelta >= 0 ? "+" : ""}${mDelta.toFixed(1)} pts over ${yrs} yr` });

  const cfq = latest?.operatingCashFlow != null && latest?.netProfit ? latest.operatingCashFlow / latest.netProfit : null;
  subs.push({ name: "Cash-flow quality", weight: 0.12, score: cfq == null ? null : scale(cfq, 0.3, 1.2), detail: cfq == null ? "operating cash flow or net profit unavailable" : `operating cash flow / net profit = ${cfq.toFixed(2)} (0.3 → 0, 1.2 → 100)` });

  const roe = latest?.roe ?? null;
  const roce = latest?.roce ?? null;
  const rr = roe != null && roce != null ? (scale(roe, 5, 25) + scale(roce, 5, 25)) / 2 : roe != null ? scale(roe, 5, 25) : roce != null ? scale(roce, 5, 25) : null;
  subs.push({ name: "Return ratios", weight: 0.15, score: rr, detail: rr == null ? "ROE/ROCE unavailable" : `ROE ${roe?.toFixed(1) ?? "n/a"}%, ROCE ${roce?.toFixed(1) ?? "n/a"}% (5% → 0, 25% → 100)` });

  const de = latest?.debtToEquity ?? null;
  subs.push({ name: "Debt management", weight: 0.12, score: de == null ? null : clamp(100 - scale(de, 0, 2)), detail: de == null ? "debt-to-equity unavailable" : `debt-to-equity ${de.toFixed(2)} (0 → 100, ≥2 → 0; banks/NBFCs naturally score low here)` });

  const profitable = a.slice(0, 5).filter((f) => f.netProfit != null);
  const consistency = profitable.length >= 3 ? (profitable.filter((f) => (f.netProfit as number) > 0).length / profitable.length) * 100 : null;
  subs.push({ name: "Earnings consistency", weight: 0.08, score: consistency, detail: consistency == null ? "needs ≥3 years of profit data" : `${profitable.filter((f) => (f.netProfit as number) > 0).length}/${profitable.length} recent years profitable` });

  // Competitive position vs peers: percentile of ROE among peers
  const peerRoe = peers.map((p) => p.roe).filter((x): x is number => x != null);
  const cp = roe != null && peerRoe.length >= 2 ? (peerRoe.filter((x) => x <= roe).length / peerRoe.length) * 100 : null;
  subs.push({ name: "Competitive position", weight: 0.08, score: cp, detail: cp == null ? "peer ROE data unavailable" : `ROE at ${cp.toFixed(0)}th percentile of ${peerRoe.length} peers` });

  const pledge = sh?.history[0]?.promoterPledged ?? null;
  subs.push({ name: "Governance (pledging)", weight: 0.05, score: pledge == null ? null : clamp(100 - scale(pledge, 0, 30)), detail: pledge == null ? "promoter pledge data unavailable" : `${pledge.toFixed(1)}% of promoter holding pledged (0% → 100, ≥30% → 0)` });

  return combine(subs);
}

export function scoreValuation(fin: FinancialsBundle | null, earningsGrowth: number | null): FundamentalResult {
  const l = fin?.annual[0];
  const pe = l?.pe ?? null;
  const pb = l?.pb ?? null;
  const ind = fin?.industryPe ?? null;
  const subs: SubScore[] = [];
  subs.push({ name: "P/E vs industry", weight: 0.4, score: pe != null && ind ? clamp(100 - scale(pe / ind, 0.6, 1.6)) : null, detail: pe != null && ind ? `P/E ${pe.toFixed(1)} vs industry ${ind.toFixed(1)} (ratio 0.6 → 100, 1.6 → 0)` : "P/E or industry P/E unavailable" });
  const peg = pe != null && earningsGrowth != null && earningsGrowth > 0 ? pe / earningsGrowth : null;
  subs.push({ name: "PEG", weight: 0.35, score: peg == null ? null : clamp(100 - scale(peg, 0.8, 3)), detail: peg == null ? "needs P/E and positive earnings growth" : `PEG ${peg.toFixed(2)} (≤0.8 → 100, ≥3 → 0)` });
  subs.push({ name: "P/B", weight: 0.25, score: pb == null ? null : clamp(100 - scale(pb, 1, 10)), detail: pb == null ? "P/B unavailable" : `P/B ${pb.toFixed(2)} (≤1 → 100, ≥10 → 0)` });
  return combine(subs);
}

export function scoreInstitutional(sh: ShareholdingBundle | null): FundamentalResult {
  const h = sh?.history ?? [];
  const now = h[0];
  const prev = h[1];
  const subs: SubScore[] = [];
  const d = (k: "fii" | "dii" | "mutualFunds" | "promoter") => (now?.[k] != null && prev?.[k] != null ? (now[k] as number) - (prev[k] as number) : null);
  const fii = d("fii"), dii = d("dii"), mf = d("mutualFunds"), pr = d("promoter");
  subs.push({ name: "FII change (QoQ)", weight: 0.3, score: fii == null ? null : scale(fii, -2, 2), detail: fii == null ? "needs two quarters" : `${fii >= 0 ? "+" : ""}${fii.toFixed(2)} pts` });
  subs.push({ name: "DII change (QoQ)", weight: 0.25, score: dii == null ? null : scale(dii, -2, 2), detail: dii == null ? "needs two quarters" : `${dii >= 0 ? "+" : ""}${dii.toFixed(2)} pts` });
  subs.push({ name: "Mutual fund change (QoQ)", weight: 0.2, score: mf == null ? null : scale(mf, -1.5, 1.5), detail: mf == null ? "needs two quarters" : `${mf >= 0 ? "+" : ""}${mf.toFixed(2)} pts` });
  subs.push({ name: "Promoter change (QoQ)", weight: 0.25, score: pr == null ? null : scale(pr, -2, 1), detail: pr == null ? "needs two quarters" : `${pr >= 0 ? "+" : ""}${pr.toFixed(2)} pts (selling penalised more than buying is rewarded)` });
  return combine(subs);
}

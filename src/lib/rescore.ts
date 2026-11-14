// Re-applies the user's own scoring weights (Settings) in the browser.
// Component scores come from the pipeline; only the weighting changes.
import { combineScores, confidenceScore, verdictFor, type ScoringWeights } from "./analysis/scoring";
import { daysBetween, HORIZONS } from "./analysis/levels";
import type { ComponentScore, Horizon, Verdict } from "./types";

export function rescore(components: Pick<ComponentScore, "key" | "score" | "coverage">[], lastDate: string | null, w: ScoringWeights) {
  const full = components.map((c) => ({ ...c, label: c.key, weight: 0, explanation: [] })) as ComponentScore[];
  const age = lastDate ? daysBetween(lastDate, new Date()) : null;
  return (Object.keys(HORIZONS) as Horizon[]).map((h) => {
    const c = combineScores(full, h, w);
    const conf = confidenceScore(c.coverage, age, true).confidence;
    return { horizon: h, score: c.score, confidence: conf, verdict: verdictFor(c.score, conf) as Verdict };
  });
}

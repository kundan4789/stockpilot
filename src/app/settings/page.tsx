"use client";

import { useEffect, useState } from "react";
import { useJson, type Meta } from "@/lib/data";
import { KEYS, readStore, useWeights, writeStore } from "@/lib/local";
import { DEFAULT_WEIGHTS, type ScoringWeights } from "@/lib/analysis/scoring";
import { Button, Card, cn, Notice, Spinner, StatusDot } from "@/components/ui";

const LABELS: Record<keyof ScoringWeights, string> = { fundamentals: "Fundamentals", technical: "Technical analysis", valuation: "Valuation", institutional: "Institutional activity", global: "Global intelligence", risk: "Risk assessment" };

export default function SettingsPage() {
  const [saved, setSaved] = useWeights();
  const [w, setW] = useState<ScoringWeights>(DEFAULT_WEIGHTS);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- sync editor with stored weights
  useEffect(() => setW(saved), [saved]);
  const { data: meta } = useJson<Meta>("meta.json");
  const [msg, setMsg] = useState<string | null>(null);
  const total = Object.values(w).reduce((a, b) => a + b, 0);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(Object.fromEntries(Object.values(KEYS).map((k) => [k, readStore(k, null)])), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `stockpilot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const importData = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as Record<string, unknown>;
      let n = 0;
      for (const k of Object.values(KEYS)) if (d[k] != null) { writeStore(k, d[k]); n++; }
      setMsg(`Imported ${n} section(s) into this browser.`);
    } catch {
      setMsg("That file is not a StockPilot backup.");
    }
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Settings</h1>
      {msg && <Notice kind="warn">{msg}</Notice>}
      <Card title="Scoring model weights" subtitle="Saved in this browser. Applied to the medium-term horizon; other horizons tilt these (short term emphasises technicals, long term emphasises fundamentals & valuation). Must total 100%.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(LABELS) as (keyof ScoringWeights)[]).map((k) => (
            <label key={k} className="text-sm">
              <div className="flex justify-between text-xs text-muted"><span>{LABELS[k]}</span><span className="num">{Math.round(w[k] * 100)}%</span></div>
              <input type="range" min={0} max={60} value={Math.round(w[k] * 100)} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) / 100 })} className="w-full accent-blue-400" />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" disabled={Math.abs(total - 1) > 0.001} onClick={() => { setSaved(w); setMsg("Weights saved — verdicts across the site now use them."); }}>Save weights</Button>
          <span className={cn("num text-sm", Math.abs(total - 1) > 0.001 ? "text-warn" : "text-muted")}>Total {Math.round(total * 100)}%</span>
          <Button variant="ghost" onClick={() => { setW(DEFAULT_WEIGHTS); setSaved(DEFAULT_WEIGHTS); }}>Reset to 30/25/15/10/10/10</Button>
        </div>
      </Card>

      <Card title="Your data on this device" subtitle="Watchlist, virtual portfolio, alerts and weights are stored only in this browser. Use a backup file to move them between your phone and laptop.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportData}>Download backup</Button>
          <label className="inline-flex cursor-pointer items-center rounded-lg border border-line bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10">
            Restore from backup
            <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importData(e.target.files[0])} />
          </label>
        </div>
      </Card>

      <Card title="Daily data update" subtitle="Runs automatically on GitHub every weekday evening after NSE publishes the day's files.">
        {!meta ? <Spinner /> : (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1.5">
              <li className="flex gap-2"><StatusDot s="ok" />Last update: {new Date(meta.generatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })} ({meta.minutes} min)</li>
              <li className="flex gap-2"><StatusDot s={meta.lastPriceDate ? "ok" : "unavailable"} />Latest NSE session: {meta.lastPriceDate ?? "none"}</li>
              <li className="flex gap-2"><StatusDot s={meta.backfill.done ? "ok" : "partial"} />Price history: {meta.backfill.done ? "complete" : "still being collected"} — back to {meta.backfill.oldest}</li>
              <li className="flex gap-2"><StatusDot s={meta.ai.includes("Gemini") ? "ok" : "unavailable"} />AI narrative: {meta.ai === "none" ? "off (deterministic template)" : meta.ai}</li>
              <li className="flex gap-2"><StatusDot s="ok" />{meta.requests} source requests · {meta.failures.length} failed</li>
            </ul>
            <details>
              <summary className="cursor-pointer text-accent">Run log</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-navy p-2 text-[11px] whitespace-pre-wrap text-muted">{meta.log.join("\n")}</pre>
            </details>
            {meta.failures.length > 0 && (
              <details>
                <summary className="cursor-pointer text-warn">Failed requests</summary>
                <ul className="mt-2 max-h-60 space-y-0.5 overflow-auto text-[11px] text-faint">{meta.failures.map((f, i) => <li key={i}>{f.source} {f.status} {f.url} {f.message ?? ""}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

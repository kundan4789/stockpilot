"use client";

import { useMemo, useState } from "react";
import type { Candle } from "@/lib/types";
import type { TechnicalSnapshot } from "@/lib/analysis/technical";
import { computeSignals, stopLossPlan, type StopMethod } from "@/lib/analysis/signals";
import { Card, cn, fmtNum, Input, Pct, Select } from "./ui";

export function useSignals(candles: Candle[]) {
  return useMemo(() => computeSignals(candles), [candles]);
}

export function SignalPanel({ sig, lastClose }: { sig: ReturnType<typeof computeSignals>; lastClose: number | null }) {
  const s = sig.stats;
  const cur = sig.current;
  return (
    <Card title="When to buy & when to sell — chart signals" subtitle="▲ BUY / ▼ SELL markers on the chart come from the rules below; the back-test shows how they performed on this stock.">
      <div className={cn("rounded-lg border px-3 py-2 text-sm", cur.state === "in-trade" ? "border-up/40 bg-up/5" : "border-line bg-white/[0.02]")}>
        {cur.state === "in-trade" ? (
          <>
            <b className="text-up">Signal: HOLD/BUY</b> — BUY triggered on {cur.since} at ₹{fmtNum(cur.entry)} ({cur.unrealizedPct != null && <Pct v={cur.unrealizedPct} />} since). Exit if the close falls below the trailing stop <b className="text-down">₹{fmtNum(cur.trailingStop)}</b> or EMA20 crosses below EMA50.
          </>
        ) : cur.lastSignal ? (
          <>
            <b className="text-down">Signal: STAY OUT</b> — last signal was {cur.lastSignal.type} on {cur.lastSignal.date} at ₹{fmtNum(cur.lastSignal.price)} ({cur.lastSignal.reason}). Wait for a new BUY: EMA20 crossing above EMA50 with price above the 200-day average{lastClose ? ` (latest close ₹${fmtNum(lastClose)})` : ""}.
          </>
        ) : (
          <>No signal yet in the available history.</>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Closed trades", s.trades],
          ["Win rate", s.winRate == null ? "—" : `${s.winRate.toFixed(0)}%`],
          ["Avg trade", <Pct key="a" v={s.avgReturn} />],
          ["Avg win / loss", <span key="w"><Pct v={s.avgWin} d={1} /> / <Pct v={s.avgLoss} d={1} /></span>],
          ["Best / worst", <span key="b"><Pct v={s.best} d={1} /> / <Pct v={s.worst} d={1} /></span>],
          ["Strategy total", <Pct key="t" v={s.totalReturn} d={1} />],
          ["Buy & hold (same period)", <Pct key="h" v={s.buyHold} d={1} />],
          ["Avg holding", s.avgDays == null ? "—" : `${Math.round(s.avgDays)} days`],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-line/70 bg-white/[0.02] px-3 py-2">
            <div className="text-[11px] text-muted">{k}</div>
            <div className="num mt-0.5 text-sm font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer text-accent">Rules & recent signals</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">{sig.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <table className="mt-2 w-full">
          <tbody className="num">
            {[...sig.trades].reverse().slice(0, 8).map((t) => (
              <tr key={t.entryDate} className="border-t border-line/50">
                <td className="py-1">{t.entryDate} → {t.exitDate ?? "open"}</td>
                <td className="text-right">₹{fmtNum(t.entry)} → {t.exit ? `₹${fmtNum(t.exit)}` : "—"}</td>
                <td className="text-right"><Pct v={t.returnPct} /></td>
                <td className="text-right text-faint">{t.days}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-[11px] text-muted">{label}{children}</label>;
}

export interface PlanLines { stop: number | null; target: number | null; entry: number | null }

export function StopLossTool({ technical, lastClose, onPlan }: { technical: TechnicalSnapshot; lastClose: number | null; onPlan: (p: PlanLines) => void }) {
  const [method, setMethod] = useState<StopMethod>("atr");
  const [entry, setEntry] = useState(lastClose ? String(lastClose) : "");
  const [capital, setCapital] = useState("100000");
  const [riskPct, setRiskPct] = useState("1");
  const [percent, setPercent] = useState("5");
  const [atrMult, setAtrMult] = useState("2");
  const [rr, setRr] = useState("2");
  const plan = useMemo(() => {
    const e = Number(entry);
    if (!(e > 0)) return null;
    return stopLossPlan({ method, entry: e, atr: technical.atr14, supports: technical.supports.map((s) => s.price), percent: Number(percent) || 5, atrMult: Number(atrMult) || 2, capital: Number(capital) || 0, riskPct: Number(riskPct) || 1, rr: Number(rr) || 2, highSinceEntry: technical.close });
  }, [method, entry, capital, riskPct, percent, atrMult, rr, technical]);
  const show = () => onPlan({ stop: plan?.stop ?? null, target: plan?.target ?? null, entry: Number(entry) || null });

  return (
    <Card title="Stop-loss & position size calculator" subtitle="Choose how to place your stop; the tool sizes the position so a stop-out loses only your chosen % of capital.">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <L label="Stop-loss method">
          <Select value={method} onChange={(e) => setMethod(e.target.value as StopMethod)} className="w-full">
            <option value="atr">ATR based (volatility)</option>
            <option value="support">Below nearest support</option>
            <option value="percent">Fixed percentage</option>
            <option value="trailing">Trailing stop (3×ATR)</option>
          </Select>
        </L>
        <L label="Buy / entry price ₹"><Input inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} /></L>
        <L label="Capital ₹"><Input inputMode="decimal" value={capital} onChange={(e) => setCapital(e.target.value)} /></L>
        <L label="Risk per trade %"><Input inputMode="decimal" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} /></L>
        {method === "percent" && <L label="Stop % below entry"><Input inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} /></L>}
        {method === "atr" && <L label="ATR multiple"><Select value={atrMult} onChange={(e) => setAtrMult(e.target.value)} className="w-full">{["1", "1.5", "2", "2.5", "3"].map((x) => <option key={x}>{x}</option>)}</Select></L>}
        <L label="Target (reward : risk)"><Select value={rr} onChange={(e) => setRr(e.target.value)} className="w-full">{["1.5", "2", "2.5", "3"].map((x) => <option key={x} value={x}>{x} : 1</option>)}</Select></L>
      </div>
      {plan && (
        plan.stop == null ? <p className="mt-3 text-sm text-warn">{plan.how}</p> : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ["Stop-loss", <span key="s" className="text-down">₹{fmtNum(plan.stop)}</span>],
                ["Target", <span key="t" className="text-up">₹{fmtNum(plan.target)}</span>],
                ["Risk / share", `₹${fmtNum(plan.riskPerShare)} (${((plan.riskPerShare! / Number(entry)) * 100).toFixed(1)}%)`],
                ["Shares to buy", plan.qty],
                ["Position value", `₹${fmtNum(plan.positionValue, 0)}`],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg border border-line/70 bg-white/[0.02] px-3 py-2">
                  <div className="text-[11px] text-muted">{k}</div>
                  <div className="num mt-0.5 text-sm font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">{plan.how}. Max loss if stopped out ≈ ₹{fmtNum((plan.qty ?? 0) * (plan.riskPerShare ?? 0), 0)}.</p>
            <button onClick={show} className="mt-2 rounded-lg border border-line px-3 py-1.5 text-xs hover:bg-white/5">Show these levels on the chart</button>
          </>
        )
      )}
    </Card>
  );
}

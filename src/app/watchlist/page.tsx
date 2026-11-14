"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useJson, type StockRow } from "@/lib/data";
import { useWatchlist, useWeights, type WatchItem } from "@/lib/local";
import { rescore } from "@/lib/rescore";
import { StockSearch } from "@/components/stock-search";
import { Button, Card, cn, fmtNum, Input, Notice, Pct, Unavailable, VerdictBadge } from "@/components/ui";

export default function WatchlistPage() {
  const [items, setItems, ready] = useWatchlist();
  const { data } = useJson<StockRow[]>("stocks.json");
  const [w] = useWeights();
  const [edit, setEdit] = useState<WatchItem | null>(null);
  const by = new Map((data ?? []).map((s) => [s.symbol, s]));

  const add = (symbol: string) => !items.some((x) => x.symbol === symbol) && setItems([...items, { symbol, addedAt: new Date().toISOString(), buyPrice: null, quantity: null, target: null, stopLoss: null, notes: null }]);
  const save = () => {
    if (!edit) return;
    setItems(items.map((x) => (x.symbol === edit.symbol ? edit : x)));
    setEdit(null);
  };
  const numIn = (k: keyof WatchItem, label: string) => (
    <label className="text-xs text-muted">{label}
      <Input inputMode="decimal" value={(edit?.[k] as number | null) ?? ""} onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); setEdit((x) => x && { ...x, [k]: v != null && (!Number.isFinite(v) || v <= 0) ? x[k] : v }); }} />
    </label>
  );

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Watchlist</h1>
      <StockSearch onPick={(h) => add(h.symbol)} />
      <Notice>Your watchlist is saved in this browser only (each device keeps its own). Buy prices are hypothetical — StockPilot never places trades. Target / stop-loss crossings appear in Alerts.</Notice>
      {edit && (
        <Card title={`Edit ${edit.symbol}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{numIn("buyPrice", "Hypothetical buy price")}{numIn("quantity", "Quantity")}{numIn("target", "Target")}{numIn("stopLoss", "Stop-loss")}</div>
          <label className="mt-3 block text-xs text-muted">Notes<Input value={edit.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
          <div className="mt-3 flex gap-2"><Button variant="primary" onClick={save}>Save</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button></div>
        </Card>
      )}
      <Card title="Tracked stocks">
        {!ready ? null : !items.length ? <Unavailable what="Watchlist items" why="Add stocks with the search above or from any research report." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-1.5">Stock</th><th className="text-right">Close</th><th className="text-right">Day</th><th className="text-right">3M</th><th className="text-right">Buy @</th><th className="text-right">Hyp. P&L</th><th className="text-right">Target / Stop</th><th className="text-right">Swing · 3–12m</th><th /></tr>
              </thead>
              <tbody className="num">
                {items.map((x) => {
                  const s = by.get(x.symbol);
                  const pnl = s?.close != null && x.buyPrice && x.quantity ? (s.close - x.buyPrice) * x.quantity : null;
                  const pnlPct = s?.close != null && x.buyPrice ? ((s.close - x.buyPrice) / x.buyPrice) * 100 : null;
                  const r = s ? rescore(s.components, s.asOf, w) : [];
                  return (
                    <tr key={x.symbol} className="border-t border-line/60 align-top">
                      <td className="py-2 font-sans"><Link href={`/research/?s=${x.symbol}`} className="font-medium text-accent hover:underline">{x.symbol}</Link><div className="max-w-[180px] truncate text-[11px] text-faint">{s?.name}</div></td>
                      <td className="text-right">{fmtNum(s?.close)}<div className="text-[10px] text-faint">{s?.asOf ?? "no data"}</div></td>
                      <td className="text-right"><Pct v={s?.changePct} /></td>
                      <td className="text-right"><Pct v={s?.return3m} d={1} /></td>
                      <td className="text-right">{fmtNum(x.buyPrice)}{x.quantity ? <div className="text-[10px] text-faint">× {x.quantity}</div> : null}</td>
                      <td className="text-right"><span className={cn(pnl == null ? "text-faint" : pnl >= 0 ? "text-up" : "text-down")}>{pnl == null ? "—" : fmtNum(pnl)}</span><div><Pct v={pnlPct} className="text-[10px]" /></div></td>
                      <td className="text-right"><span className="text-up">{fmtNum(x.target)}</span> / <span className="text-down">{fmtNum(x.stopLoss)}</span></td>
                      <td className="space-x-1 text-right font-sans whitespace-nowrap"><VerdictBadge v={r.find((y) => y.horizon === "swing")?.verdict} /><VerdictBadge v={r.find((y) => y.horizon === "medium")?.verdict} /></td>
                      <td className="pl-2 text-right whitespace-nowrap">
                        <button aria-label="Edit" onClick={() => setEdit(x)} className="p-1 text-muted hover:text-ink"><Pencil className="h-4 w-4" /></button>
                        <button aria-label="Remove" onClick={() => setItems(items.filter((y) => y.symbol !== x.symbol))} className="p-1 text-muted hover:text-down"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

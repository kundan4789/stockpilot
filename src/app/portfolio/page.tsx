"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useJson, type StockRow } from "@/lib/data";
import { uid, useTrades } from "@/lib/local";
import { Button, Card, cn, fmtNum, Input, Notice, Pct, Select, Unavailable } from "@/components/ui";

export default function PortfolioPage() {
  const [trades, setTrades] = useTrades();
  const { data } = useJson<StockRow[]>("stocks.json");
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ query: "", side: "BUY", quantity: "", price: "", tradeDate: "", note: "" });
  const by = useMemo(() => new Map((data ?? []).map((s) => [s.symbol, s])), [data]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const sym = f.query.trim().toUpperCase().replace(/\.(NS|BO)$/, "");
    const q = Number(f.quantity), p = Number(f.price);
    if (!by.has(sym)) return setErr(`${sym} is not in the NIFTY 50 list.`);
    if (!(q > 0) || !(p > 0)) return setErr("Quantity and price must be positive numbers.");
    setTrades([...trades, { id: uid(), symbol: sym, side: f.side as "BUY" | "SELL", quantity: q, price: p, tradeDate: f.tradeDate || new Date().toISOString().slice(0, 10), note: f.note || null }]);
    setF({ ...f, query: "", quantity: "", price: "", note: "" });
  };

  const { positions, totals } = useMemo(() => {
    const pos = new Map<string, { symbol: string; qty: number; cost: number; realized: number }>();
    for (const e of [...trades].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))) {
      const p = pos.get(e.symbol) ?? { symbol: e.symbol, qty: 0, cost: 0, realized: 0 };
      if (e.side === "BUY") { p.cost += e.quantity * e.price; p.qty += e.quantity; }
      else { const avg = p.qty ? p.cost / p.qty : 0; const q = Math.min(e.quantity, p.qty); p.realized += (e.price - avg) * q; p.cost -= avg * q; p.qty -= q; }
      pos.set(e.symbol, p);
    }
    const positions = [...pos.values()].map((p) => {
      const s = by.get(p.symbol);
      const mv = s?.close != null ? s.close * p.qty : null;
      return { ...p, avgCost: p.qty ? p.cost / p.qty : null, lastPrice: s?.close ?? null, asOf: s?.asOf ?? null, marketValue: mv, unrealized: mv != null ? mv - p.cost : null, unrealizedPct: mv != null && p.cost ? ((mv - p.cost) / p.cost) * 100 : null };
    });
    const totals = positions.reduce((t, p) => ({ invested: t.invested + p.cost, value: t.value + (p.marketValue ?? p.cost), realized: t.realized + p.realized }), { invested: 0, value: 0, realized: 0 });
    return { positions, totals };
  }, [trades, by]);
  const unreal = totals.value - totals.invested;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Portfolio Simulator</h1>
      <Notice>Virtual money only, saved in this browser. It records hypothetical trades for learning and is never connected to a broker.</Notice>
      {err && <Notice kind="warn">{err}</Notice>}
      <Card title="Record a virtual trade">
        <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Input placeholder="Symbol (e.g. TCS)" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} required className="col-span-2 sm:col-span-1" />
          <Select value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}><option>BUY</option><option>SELL</option></Select>
          <Input placeholder="Quantity" inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required />
          <Input placeholder="Price ₹" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required />
          <Input type="date" aria-label="Trade date (defaults to today)" value={f.tradeDate} onChange={(e) => setF({ ...f, tradeDate: e.target.value })} />
          <Button variant="primary" type="submit">Add trade</Button>
        </form>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([["Invested (open)", fmtNum(totals.invested), null], ["Market value", fmtNum(totals.value), null], ["Unrealised P&L", fmtNum(unreal), unreal], ["Realised P&L", fmtNum(totals.realized), totals.realized]] as const).map(([k, v, t]) => (
          <div key={k} className="glass rounded-xl px-4 py-3"><div className="text-xs text-muted">{k}</div><div className={cn("num mt-1 text-xl font-semibold", t != null && (t >= 0 ? "text-up" : "text-down"))}>{v}</div></div>
        ))}
      </div>
      <Card title="Positions">
        {!positions.length ? <Unavailable what="Positions" why="Record a virtual BUY above." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted"><tr><th className="py-1.5 text-left">Stock</th><th className="text-right">Qty</th><th className="text-right">Avg cost</th><th className="text-right">Last</th><th className="text-right">Value</th><th className="text-right">Unrealised</th><th className="text-right">Realised</th></tr></thead>
              <tbody className="num">
                {positions.map((p) => (
                  <tr key={p.symbol} className="border-t border-line/60">
                    <td className="py-1.5 font-sans font-medium">{p.symbol}</td><td className="text-right">{fmtNum(p.qty, 0)}</td><td className="text-right">{fmtNum(p.avgCost)}</td>
                    <td className="text-right">{fmtNum(p.lastPrice)}<div className="text-[10px] text-faint">{p.asOf}</div></td><td className="text-right">{fmtNum(p.marketValue)}</td>
                    <td className="text-right">{fmtNum(p.unrealized)} <Pct v={p.unrealizedPct} className="text-[11px]" /></td><td className="text-right">{fmtNum(p.realized)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Trade log">
        {!trades.length ? <p className="text-sm text-muted">No trades yet.</p> : (
          <ul className="divide-y divide-line text-sm">
            {[...trades].reverse().map((e) => (
              <li key={e.id} className="flex items-center justify-between py-1.5">
                <span><span className={e.side === "BUY" ? "text-up" : "text-down"}>{e.side}</span> {e.quantity} × {e.symbol} @ {fmtNum(e.price)} <span className="text-xs text-faint">{e.tradeDate}</span></span>
                <button aria-label="Delete" onClick={() => setTrades(trades.filter((t) => t.id !== e.id))} className="p-1 text-muted hover:text-down"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

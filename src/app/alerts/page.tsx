"use client";

import { useEffect, useState } from "react";
import { BellRing, Trash2 } from "lucide-react";
import { evaluateAlerts } from "@/components/alert-engine";
import { uid, useAlertEvents, useAlertRules, type AlertKind } from "@/lib/local";
import { Button, Card, cn, Input, Notice, Select, Unavailable } from "@/components/ui";

const KINDS: Record<AlertKind, string> = {
  price_above: "Price at/above (target)",
  price_below: "Price at/below (stop-loss)",
  announcement: "Important corporate announcement",
  negative_news: "Major negative news",
  positive_news: "Major positive news",
  technical_change: "Significant technical change",
  recommendation_change: "AI recommendation changes",
};

export default function AlertsPage() {
  const [rules, setRules] = useAlertRules();
  const [events, setEvents] = useAlertEvents();
  const [f, setF] = useState({ query: "", kind: "price_above" as AlertKind, threshold: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [perm, setPerm] = useState<string>("unsupported");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only API read after mount
  useEffect(() => setPerm(typeof Notification !== "undefined" ? Notification.permission : "unsupported"), []);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const symbol = f.query.trim().toUpperCase().replace(/\.(NS|BO)$/, "");
    const t = f.threshold ? Number(f.threshold) : null;
    if (f.kind.startsWith("price") && !(t && t > 0)) return setMsg("Price alerts need a positive price level.");
    setRules([...rules, { id: uid(), symbol, kind: f.kind, threshold: t, active: true, createdAt: new Date().toISOString() }]);
    setF({ ...f, query: "", threshold: "" });
    setMsg(null);
  };
  const check = async () => {
    try {
      const n = await evaluateAlerts();
      setMsg(`Checked against the latest daily data: ${n} new alert(s).`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Alerts</h1>
        <div className="flex gap-2">
          {perm === "default" && <Button onClick={async () => setPerm(await Notification.requestPermission())}><BellRing className="h-4 w-4" /> Enable notifications</Button>}
          <Button onClick={check}>Check now</Button>
        </div>
      </div>
      <Notice>Alert rules are saved in this browser and checked against each evening&apos;s research whenever you open StockPilot. Browser notifications work while the site is open — no paid push service is used.</Notice>
      {msg && <Notice kind="warn">{msg}</Notice>}
      <Card title="Create alert">
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-4">
          <Input placeholder="Symbol (e.g. INFY)" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} required />
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AlertKind })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Input placeholder={f.kind.startsWith("price") ? "Price level ₹" : "No level needed"} disabled={!f.kind.startsWith("price")} inputMode="decimal" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} />
          <Button variant="primary" type="submit">Add alert</Button>
        </form>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Alert feed" action={events.some((e) => !e.read) ? <Button variant="ghost" onClick={() => setEvents(events.map((e) => ({ ...e, read: true })))}>Mark all read</Button> : null}>
          {!events.length ? <Unavailable what="Alerts" why="Nothing has triggered yet." /> : (
            <ul className="space-y-2.5">
              {events.map((e) => (
                <li key={e.id} className={cn("rounded-lg border px-3 py-2", e.read ? "border-line" : "border-accent/40 bg-accent/5")}>
                  <div className="text-sm font-medium">{e.message}</div>
                  <div className="mt-0.5 text-xs text-muted">Why: {e.reason}</div>
                  <div className="mt-1 flex gap-3 text-[11px] text-faint"><span>{new Date(e.createdAt).toLocaleString("en-IN")}</span><span>{KINDS[e.kind]}</span>{e.url && <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="text-accent">source</a>}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Your rules">
          {!rules.length ? <p className="text-sm text-muted">No rules yet. Watchlist targets and stop-losses alert automatically.</p> : (
            <ul className="divide-y divide-line text-sm">
              {rules.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span className={cn(!r.active && "opacity-50")}><b>{r.symbol}</b> · {KINDS[r.kind]}{r.threshold != null ? ` @ ${r.threshold}` : ""}</span>
                  <span className="flex items-center gap-1">
                    <Button variant="ghost" onClick={() => setRules(rules.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)))}>{r.active ? "Pause" : "Resume"}</Button>
                    <button aria-label="Delete" onClick={() => setRules(rules.filter((x) => x.id !== r.id))} className="p-1 text-muted hover:text-down"><Trash2 className="h-4 w-4" /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

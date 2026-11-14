"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useJson, type StockRow } from "@/lib/data";
import { cn } from "./ui";

interface Hit { symbol: string; name: string; sector: string | null }

function match(rows: StockRow[], q: string): Hit[] {
  const raw = q.trim().toUpperCase().replace(/^(NSE|BSE):/, "").replace(/\.(NS|BO)$/, "");
  if (!raw) return [];
  return rows
    .map((r) => {
      const n = r.name.toUpperCase();
      const sc = r.symbol === raw ? 100 : r.symbol.startsWith(raw) ? 80 : n.startsWith(raw) ? 70 : n.split(/\s+/).some((w) => w.startsWith(raw)) ? 60 : n.includes(raw) || r.symbol.includes(raw) || r.isin === raw ? 40 : 0;
      return { r, sc };
    })
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc || a.r.symbol.localeCompare(b.r.symbol))
    .slice(0, 10)
    .map(({ r }) => ({ symbol: r.symbol, name: r.name, sector: r.sector }));
}

export function StockSearch({ large, autoFocus, onPick }: { large?: boolean; autoFocus?: boolean; onPick?: (h: Hit) => void }) {
  const router = useRouter();
  const { data } = useJson<StockRow[]>("stocks.json");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const hits = useMemo(() => match(data ?? [], q), [data, q]);

  const pick = (h: Hit) => {
    setOpen(false);
    setQ("");
    if (onPick) onPick(h);
    else router.push(`/research/?s=${encodeURIComponent(h.symbol)}`);
  };

  return (
    <div className="relative w-full">
      <div className={cn("glass flex items-center gap-3 rounded-xl px-4", large ? "py-4" : "py-2.5")}>
        <Search className={cn("shrink-0 text-muted", large ? "h-5 w-5" : "h-4 w-4")} />
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, hits.length - 1));
            else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter" && hits[idx]) pick(hits[idx]);
          }}
          placeholder="Enter company name or stock symbol..."
          aria-label="Search stocks"
          className={cn("w-full bg-transparent text-ink placeholder:text-faint focus:outline-none", large ? "text-lg" : "text-sm")}
        />
      </div>
      {open && q.trim() && (
        <ul className="absolute z-50 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-line bg-panel-solid shadow-2xl" role="listbox">
          {hits.length ? (
            hits.map((h, i) => (
              <li key={h.symbol} role="option" aria-selected={i === idx}>
                <button onMouseDown={() => pick(h)} onMouseEnter={() => setIdx(i)} className={cn("flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left", i === idx && "bg-white/5")}>
                  <span>
                    <span className="font-semibold">{h.symbol}</span> <span className="text-sm text-muted">{h.name}</span>
                  </span>
                  <span className="hidden shrink-0 text-[11px] text-faint sm:inline">NSE{h.sector ? ` · ${h.sector}` : ""}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-4 py-3 text-sm text-muted">{data ? "No NIFTY 50 company matches. StockPilot researches the 50 NIFTY constituents every evening." : "Loading stock list…"}</li>
          )}
        </ul>
      )}
    </div>
  );
}

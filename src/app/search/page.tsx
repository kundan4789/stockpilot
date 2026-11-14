"use client";

import Link from "next/link";
import { StockSearch } from "@/components/stock-search";
import { Card, Pct, Spinner } from "@/components/ui";
import { useJson, type StockRow } from "@/lib/data";

export default function SearchPage() {
  const { data } = useJson<StockRow[]>("stocks.json");
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-bold">Search Stock</h1>
      <StockSearch large autoFocus />
      <Card title="NIFTY 50 — researched every evening" subtitle="Search by company name, NSE symbol (TCS), Yahoo-style ticker (RELIANCE.NS) or ISIN. Opening a stock shows its full research report.">
        {!data ? (
          <Spinner />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {[...data].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((s) => (
              <Link key={s.symbol} href={`/research/?s=${s.symbol}`} className="rounded-lg border border-line px-3 py-2 hover:border-accent/50">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{s.symbol}</span>
                  <Pct v={s.changePct} className="text-xs" />
                </div>
                <div className="truncate text-[11px] text-faint">{s.name}</div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

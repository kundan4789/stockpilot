"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAlertEvents } from "@/lib/local";
import { Bell, BriefcaseBusiness, CandlestickChart, Filter, Flame, Globe2, Home, LayoutGrid, LineChart, MoreHorizontal, Search, Settings, Sparkles, Star, X } from "lucide-react";
import { cn } from "./ui";

export const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/picks", label: "Top Picks of the Week", icon: Flame },
  { href: "/search", label: "Search Stock", icon: Search },
  { href: "/research", label: "AI Research", icon: Sparkles },
  { href: "/market", label: "Market Overview", icon: LineChart },
  { href: "/map", label: "Market Map", icon: LayoutGrid },
  { href: "/fo", label: "F&O Analyst", icon: CandlestickChart },
  { href: "/screener", label: "Stock Screener", icon: Filter },
  { href: "/global", label: "Global Intelligence", icon: Globe2 },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/portfolio", label: "Portfolio Simulator", icon: BriefcaseBusiness },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings },
];

const MOBILE_PRIMARY = ["/", "/picks", "/search", "/research"];

const active = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));


export function Sidebar() {
  const path = usePathname();
  const [events] = useAlertEvents();
  const unread = events.filter((e) => !e.read).length;
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-navy/60 backdrop-blur-xl lg:flex">
      <Link href="/" className="flex items-center gap-2 px-5 py-5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-teal-400 text-sm font-black text-navy">SP</span>
        <span className="text-[15px] font-bold tracking-tight">
          StockPilot <span className="text-accent">AI</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-0.5 px-3">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", active(path, href) ? "bg-accent/10 text-ink" : "text-muted hover:bg-white/5 hover:text-ink")}>
            <Icon className={cn("h-4 w-4", active(path, href) && "text-accent")} />
            <span className="flex-1">{label}</span>
            {href === "/alerts" && unread > 0 && <span className="rounded-full bg-down px-1.5 text-[10px] font-bold text-white">{unread}</span>}
          </Link>
        ))}
      </nav>
      <p className="px-5 py-4 text-[10px] leading-relaxed text-faint">Private research tool. Not investment advice. Never executes trades.</p>
    </aside>
  );
}

export function MobileNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const primary = NAV.filter((n) => MOBILE_PRIMARY.includes(n.href));
  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-navy/80 px-4 py-3 backdrop-blur-xl lg:hidden">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-blue-500 to-teal-400 text-xs font-black text-navy">SP</span>
          StockPilot <span className="text-accent">AI</span>
        </Link>
        <Link href="/alerts" aria-label="Alerts" className="text-muted">
          <Bell className="h-5 w-5" />
        </Link>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-navy/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {primary.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={cn("flex flex-col items-center gap-1 py-2 text-[10px]", active(path, href) ? "text-accent" : "text-muted")}>
            <Icon className="h-5 w-5" />
            {href === "/picks" ? "Picks" : label.split(" ")[0]}
          </Link>
        ))}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-1 py-2 text-[10px] text-muted">
          <MoreHorizontal className="h-5 w-5" />
          More
        </button>
      </nav>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-panel-solid p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">All sections</span>
              <button onClick={() => setOpen(false)} aria-label="Close">
                <X className="h-5 w-5 text-muted" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} onClick={() => setOpen(false)} className={cn("flex flex-col items-center gap-1.5 rounded-xl border border-line px-2 py-3 text-center text-[11px]", active(path, href) ? "bg-accent/10 text-ink" : "text-muted")}>
                  <Icon className="h-5 w-5" />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

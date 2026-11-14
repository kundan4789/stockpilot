import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { MobileNav, Sidebar } from "@/components/nav";
import { PwaRegister } from "@/components/pwa";
import { AlertEngine } from "@/components/alert-engine";

export const metadata: Metadata = {
  title: { default: "StockPilot AI", template: "%s · StockPilot AI" },
  description: "AI-powered stock market research for NSE & BSE. Search any stock. Understand every opportunity.",
  applicationName: "StockPilot AI",
  appleWebApp: { capable: true, title: "StockPilot", statusBarStyle: "black-translucent" },
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icons/icon-192.png`, apple: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icons/apple-touch-icon.png` },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0b1324", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className="dark">
      <body className="min-h-dvh">
        <div className="flex">
          <Suspense fallback={<div className="hidden w-60 lg:block" />}>
            <Sidebar />
          </Suspense>
          <div className="min-w-0 flex-1">
            <Suspense fallback={null}>
              <MobileNav />
            </Suspense>
            <main className="mx-auto w-full max-w-7xl px-4 pt-4 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
          </div>
        </div>
        <PwaRegister />
        <AlertEngine />
      </body>
    </html>
  );
}

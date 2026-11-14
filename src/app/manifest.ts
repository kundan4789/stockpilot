import type { MetadataRoute } from "next";

export const dynamic = "force-static";
const B = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StockPilot AI",
    short_name: "StockPilot",
    description: "Search any stock. Understand every opportunity.",
    start_url: `${B}/`, scope: `${B}/`,
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#070b14",
    theme_color: "#0b1324",
    categories: ["finance", "productivity"],
    icons: [
      { src: `${B}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${B}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
      { src: `${B}/icons/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

// Small, dependency-free parsers shared by connectors. Everything retrieved from
// the outside world is treated as untrusted text: no HTML is ever rendered and
// no content is ever interpreted as instructions.

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().replace(/^﻿/, "").toUpperCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** Pick the first present column among aliases (header names are upper-cased). */
export function col(r: Record<string, string>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = r[n.toUpperCase()];
    if (v !== undefined && v !== "" && v !== "-") return v;
  }
  return undefined;
}

export function num(v: string | undefined | null): number | null {
  if (v == null) return null;
  const x = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(x) ? x : null;
}

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** Accepts 13-Nov-2026, 13-NOV-2026, 13/11/2026, 2026-11-13, 13 Nov 2026. Returns YYYY-MM-DD or null. */
export function parseDate(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{4})/);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Strip markup, decode basic entities, remove control chars, collapse whitespace, cap length. */
export function sanitizeText(s: string | undefined | null, max = 500): string {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (_, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? " ",
    )
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Only http(s) URLs survive; anything else (javascript:, data:) becomes null. */
export function safeUrl(u: string | undefined | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u.trim());
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : null;
  } catch {
    return null;
  }
}

export interface RssItem {
  title: string;
  link: string | null;
  description: string;
  pubDate: string | null;
}

export function parseRss(xml: string): RssItem[] {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const tag = (block: string, t: string) => block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, "i"))?.[1];
  return items.map((b) => ({
    title: sanitizeText(tag(b, "title"), 400),
    link: safeUrl(sanitizeText(tag(b, "link"), 1000)),
    description: sanitizeText(tag(b, "description"), 1000),
    pubDate: (() => {
      const d = sanitizeText(tag(b, "pubDate"), 100);
      const t = d ? new Date(d) : null;
      return t && !isNaN(t.getTime()) ? t.toISOString() : parseDate(d) ? new Date(parseDate(d)! + "T00:00:00Z").toISOString() : null;
    })(),
  }));
}

/** DDMMYYYY for NSE archive filenames. */
export const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${d.getUTCFullYear()}`;

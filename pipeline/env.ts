// Pipeline configuration from GitHub Actions secrets / environment variables.
const e = (k: string) => (process.env[k] && process.env[k]!.trim()) || undefined;

export const env = {
  geminiKey: e("GEMINI_API_KEY"),
  geminiModel: e("GEMINI_MODEL") ?? "gemini-3.5-flash-lite",
  searchModel: e("GEMINI_SEARCH_MODEL"),
  fredKey: e("FRED_API_KEY"),
  gnewsKey: e("GNEWS_API_KEY"),
  tejhqKey: e("TEJHQ_API_KEY"),
  tejhqBaseUrl: e("TEJHQ_BASE_URL"),
  dataDir: e("DATA_DIR") ?? "data",
  siteDataDir: e("SITE_DATA_DIR") ?? "public/data",
  backfillYears: Number(e("BACKFILL_YEARS") ?? 5),
  maxMinutes: Number(e("MAX_MINUTES") ?? 50),
};

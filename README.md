# StockPilot AI

**Search any stock. Understand every opportunity.**

A free public website with daily AI-assisted research on the **NIFTY 50**. It opens on any phone or laptop and can be installed as an app. It costs ₹0 per month: GitHub Actions does the research and GitHub Pages hosts the site.

> Research tool, not investment advice; not a SEBI-registered research analyst. It never places trades.

## How it works

```
Every weekday 18:45 IST — GitHub Actions (free)
  pipeline/run.ts
    1. NIFTY 50 list ............ NSE index constituents file
    2. Prices (5 years) ......... NSE daily bhavcopy, split/bonus adjusted
    3. Indices + sector P/E ..... NSE ind_close_all;  SENSEX: BSE RSS
    4. Corporate disclosures .... NSE RSS feeds (announcements, results, board meetings…)
    5. News & global themes ..... GDELT (relevance + reason for every item)
    6. Macro .................... FRED, World Bank, IMF
    7. Technicals, scores, levels   (deterministic, unit-tested)
    8. Research narrative ....... Google Gemini free tier (numbers validated)
  → commits data/ and public/data/*.json to this repo
  → builds the static site and deploys it to GitHub Pages
```

* **Prices, verdicts and levels never come from the AI.** Entry, target and stop-loss are calculated by `src/lib/analysis/levels.ts`. If the AI writes a sentence containing a number that isn't in the evidence, that sentence is deleted.
* **Missing data is shown as unavailable**, never estimated. Research confidence measures how complete the evidence is. It is not a probability of profit.
* **Personal data** (watchlist, virtual portfolio, alert rules, custom scoring weights) is saved in each visitor's own browser. Settings can export a backup file and import it on another device.

## Setup (one time)

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions → New repository secret**
   * `GEMINI_API_KEY`: free key from aistudio.google.com. Without it, a plain template summary is used.
   * `FRED_API_KEY`: free key from fred.stlouisfed.org. Without it, US indices, crude oil and INR/USD show as unavailable.
   * Optional repository *variable* `GEMINI_MODEL`: any model the Gemini pricing page lists as free (default `gemini-3.5-flash-lite`).
3. **Actions → Daily research & deploy → Run workflow.** The first run downloads up to 5 years of prices (about 30 minutes). Later runs take about 15 minutes.

Website: `https://<username>.github.io/stockpilot/`

## Scoring model

Default weights are Fundamentals 30%, Technical 25%, Valuation 15%, Institutional 10%, Global 10% and Risk 10%. Each horizon tilts them (short term favours technicals; long term favours fundamentals and valuation). Score thresholds: ≥75 STRONG BUY, ≥60 BUY, ≥45 HOLD, ≥30 SELL, otherwise STRONG SELL. The verdict is INSUFFICIENT DATA when evidence covers less than half of the weighted inputs or confidence is below 40. Every sub-score in a report lists its inputs and thresholds.

## Limitations

* **Company financials and shareholding:** there is no free, licence-clear API for NSE/BSE. Until one is wired in, short-term and swing verdicts use technicals, news and risk only, and medium/long-term verdicts may show INSUFFICIENT DATA.
* **End-of-day data only:** there is no free licensed intraday feed.
* **Alerts:** checked when the site is open, against the latest daily data.
* **Data licences:** exchange data is subject to the exchanges' terms. Keep the site for personal or small-group use.

## Develop

```bash
npm install
npm run research   # run the pipeline locally (needs internet)
npm run dev        # http://localhost:3000
npm test
```

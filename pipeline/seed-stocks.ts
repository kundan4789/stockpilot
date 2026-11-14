import type { StockMaster } from "../src/lib/types";

// Minimal bootstrap master so search works on first run. Run "Sync stock master"
// (Settings, or POST /api/cron/master) to load the full NSE list with current
// index memberships from NSE's published EQUITY_L.csv and index constituent files.
// Sectors use NSE's industry classification names.
const s = (symbol: string, name: string, sector: string): StockMaster => ({ symbol, exchange: "NSE", name, sector, indices: [] });

export const SEED_STOCKS: StockMaster[] = [
  s("RELIANCE", "Reliance Industries Limited", "Oil Gas & Consumable Fuels"),
  s("ONGC", "Oil & Natural Gas Corporation Limited", "Oil Gas & Consumable Fuels"),
  s("IOC", "Indian Oil Corporation Limited", "Oil Gas & Consumable Fuels"),
  s("BPCL", "Bharat Petroleum Corporation Limited", "Oil Gas & Consumable Fuels"),
  s("TCS", "Tata Consultancy Services Limited", "Information Technology"),
  s("INFY", "Infosys Limited", "Information Technology"),
  s("HCLTECH", "HCL Technologies Limited", "Information Technology"),
  s("WIPRO", "Wipro Limited", "Information Technology"),
  s("TECHM", "Tech Mahindra Limited", "Information Technology"),
  s("HDFCBANK", "HDFC Bank Limited", "Financial Services"),
  s("ICICIBANK", "ICICI Bank Limited", "Financial Services"),
  s("SBIN", "State Bank of India", "Financial Services"),
  s("KOTAKBANK", "Kotak Mahindra Bank Limited", "Financial Services"),
  s("AXISBANK", "Axis Bank Limited", "Financial Services"),
  s("BAJFINANCE", "Bajaj Finance Limited", "Financial Services"),
  s("HINDUNILVR", "Hindustan Unilever Limited", "Fast Moving Consumer Goods"),
  s("ITC", "ITC Limited", "Fast Moving Consumer Goods"),
  s("NESTLEIND", "Nestle India Limited", "Fast Moving Consumer Goods"),
  s("MARUTI", "Maruti Suzuki India Limited", "Automobile and Auto Components"),
  s("M&M", "Mahindra & Mahindra Limited", "Automobile and Auto Components"),
  s("BAJAJ-AUTO", "Bajaj Auto Limited", "Automobile and Auto Components"),
  s("SUNPHARMA", "Sun Pharmaceutical Industries Limited", "Healthcare"),
  s("DRREDDY", "Dr. Reddy's Laboratories Limited", "Healthcare"),
  s("CIPLA", "Cipla Limited", "Healthcare"),
  s("TATASTEEL", "Tata Steel Limited", "Metals & Mining"),
  s("JSWSTEEL", "JSW Steel Limited", "Metals & Mining"),
  s("HINDALCO", "Hindalco Industries Limited", "Metals & Mining"),
  s("NTPC", "NTPC Limited", "Power"),
  s("POWERGRID", "Power Grid Corporation of India Limited", "Power"),
  s("BHARTIARTL", "Bharti Airtel Limited", "Telecommunication"),
  s("LT", "Larsen & Toubro Limited", "Construction"),
  s("ULTRACEMCO", "UltraTech Cement Limited", "Construction Materials"),
  s("ASIANPAINT", "Asian Paints Limited", "Consumer Durables"),
  s("TITAN", "Titan Company Limited", "Consumer Durables"),
];

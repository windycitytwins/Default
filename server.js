'use strict';

/**
 * Chart School — data server (zero dependencies).
 *
 *   GET /api/chart?symbol=AAPL&range=1y&interval=1d[&adjusted=1]
 *   GET /api/search?q=apple
 *   GET /api/diagnose?symbol=AAPL      (per-provider health report)
 *   GET /api/health
 *
 * REAL data only, no API key required. Source order:
 *   0) Twelve Data   — ONLY if you set TWELVEDATA_KEY (free, very reliable)
 *   1) Yahoo Finance — full cookie + crumb handshake, retries, host rotation,
 *                      split/dividend-adjusted prices, intraday + daily
 *   2) Stooq         — keyless daily CSV (stooq.com → stooq.pl)
 *
 * If every source fails it returns an honest error — it never fabricates data.
 *
 * Run with: node server.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8123;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const TWELVEDATA_KEY = process.env.TWELVEDATA_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.command': 'text/plain; charset=utf-8'
};
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// SEC requires a descriptive User-Agent for programmatic access.
const SEC_UA = process.env.SEC_UA || 'ChartSchool/1.0 (educational tool; contact via app)';
// Optional: AI auto-research via the Claude API (the user's own key).
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const ANTHROPIC_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS) || 4096;
const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
const INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- tiny in-memory cache (so repeated views don't re-hit providers) --------
const cache = new Map(); // key -> { data, exp }
function cacheGet(k) {
  const e = cache.get(k);
  if (e && e.exp > Date.now()) return e.data;
  if (e) cache.delete(k);
  return null;
}
function cacheSet(k, data, ttl) {
  cache.set(k, { data, exp: Date.now() + ttl });
}

// --- low-level GET -> {status, body, headers} --------------------------------
function httpGet(url, { headers = {}, timeoutMs = 10000, redirects = 4 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        const setCookie = res.headers['set-cookie'];
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        const fwd = { ...headers };
        // carry cookies through redirects
        if (setCookie) {
          const got = setCookie.map((c) => c.split(';')[0]).join('; ');
          fwd.Cookie = [headers.Cookie, got].filter(Boolean).join('; ');
        }
        httpGet(next, { headers: fwd, timeoutMs, redirects: redirects - 1 }).then(resolve, reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function withRetry(fn, { attempts = 3, base = 400 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(base * Math.pow(2, i) + Math.random() * 200);
    }
  }
  throw last;
}
function snippet(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}
function tagErr(msg, status, body) {
  const e = new Error(msg);
  e.status = status;
  e.snippet = snippet(body);
  return e;
}

// --- Yahoo cookie + crumb handshake (the fix for HTTP 429) -------------------
let yAuth = { cookie: '', crumb: '', at: 0 };
async function getYahooAuth(force) {
  if (!force && yAuth.cookie && Date.now() - yAuth.at < 25 * 60 * 1000) return yAuth;
  let cookie = '';
  for (const u of ['https://fc.yahoo.com/', 'https://finance.yahoo.com/quote/AAPL']) {
    try {
      const r = await httpGet(u, { timeoutMs: 7000 });
      const sc = r.headers['set-cookie'];
      if (sc && sc.length) {
        cookie = sc.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
        if (cookie) break;
      }
    } catch (_) {}
  }
  let crumb = '';
  if (cookie) {
    for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
      try {
        const r = await httpGet(`https://${host}/v1/test/getcrumb`, {
          headers: { Cookie: cookie, 'Accept-Language': 'en-US,en;q=0.9' },
          timeoutMs: 7000
        });
        if (r.status === 200 && r.body && r.body.length < 80 && !r.body.includes('<') && !/[\s]/.test(r.body)) {
          crumb = r.body.trim();
          break;
        }
      } catch (_) {}
    }
  }
  yAuth = { cookie, crumb, at: Date.now() };
  return yAuth;
}

// --- Yahoo Finance -----------------------------------------------------------
async function fromYahoo(symbol, range, interval) {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  const run = async (attempt) => {
    const auth = await getYahooAuth(attempt > 0 && attempt % 2 === 1);
    const host = hosts[attempt % hosts.length];
    const u = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
    u.searchParams.set('range', range);
    u.searchParams.set('interval', interval);
    u.searchParams.set('includePrePost', 'false');
    u.searchParams.set('events', 'div,splits');
    u.searchParams.set('includeAdjustedClose', 'true');
    if (auth.crumb) u.searchParams.set('crumb', auth.crumb);
    const headers = { 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://finance.yahoo.com/' };
    if (auth.cookie) headers.Cookie = auth.cookie;
    const res = await httpGet(u.toString(), { headers, timeoutMs: 10000 });
    if (res.status !== 200) {
      if (res.status === 401 || res.status === 403 || res.status === 429) await getYahooAuth(true);
      throw tagErr(`Yahoo HTTP ${res.status}`, res.status, res.body);
    }
    return res.body;
  };
  const raw = await withRetry(run, { attempts: 3, base: 700 }); // gentle: avoid self-throttling
  const json = JSON.parse(raw);
  const e = json && json.chart && json.chart.error;
  if (e) throw tagErr(`Yahoo: ${e.code || e.description}`, 200, e.description);
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result || !result.timestamp) throw tagErr('Yahoo: empty result (unknown symbol?)', 200, raw);
  const q = result.indicators.quote[0];
  const adj = result.indicators.adjclose && result.indicators.adjclose[0] ? result.indicators.adjclose[0].adjclose : null;
  const t = result.timestamp;
  const candles = [];
  for (let i = 0; i < t.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ time: t[i] * 1000, open: +o, high: +h, low: +l, close: +c, adjclose: adj && adj[i] != null ? +adj[i] : +c, volume: q.volume[i] == null ? 0 : +q.volume[i] });
  }
  if (candles.length < 2) throw tagErr('Yahoo: too few candles', 200, raw);
  const m = result.meta || {};
  return {
    symbol: (m.symbol || symbol).toUpperCase(), currency: m.currency || 'USD',
    exchange: m.fullExchangeName || m.exchangeName || '', instrumentType: m.instrumentType || '',
    timezone: m.exchangeTimezoneName || '', interval, range, source: 'Yahoo Finance',
    name: m.longName || m.shortName || '', regularMarketPrice: m.regularMarketPrice,
    previousClose: m.chartPreviousClose ?? m.previousClose, marketState: m.marketState || '',
    fetchedAt: Date.now(), candles
  };
}

// --- Stooq (keyless daily backstop) ------------------------------------------
function stooqSymbol(symbol) {
  const s = symbol.toLowerCase();
  if (s.startsWith('^') || s.includes('.')) return s;
  if (s.includes('-')) return s;
  return `${s}.us`;
}
async function fromStooq(symbol) {
  const s = stooqSymbol(symbol);
  let lastBody = '';
  let lastStatus = 0;
  for (const host of ['stooq.com', 'stooq.pl']) {
    try {
      const res = await withRetry(() => httpGet(`https://${host}/q/d/l/?s=${encodeURIComponent(s)}&i=d`, { timeoutMs: 9000 }), { attempts: 2 });
      lastStatus = res.status;
      lastBody = res.body;
      if (res.status !== 200) continue;
      const lines = res.body.trim().split(/\r?\n/);
      if (lines.length < 3 || !/^Date,/i.test(lines[0])) continue; // limit page / HTML / "No data"
      const candles = [];
      for (let i = 1; i < lines.length; i++) {
        const [date, o, h, l, c, v] = lines[i].split(',');
        if (!date || o === 'N/D' || isNaN(+o)) continue;
        candles.push({ time: new Date(date + 'T00:00:00Z').getTime(), open: +o, high: +h, low: +l, close: +c, adjclose: +c, volume: v ? +v : 0 });
      }
      if (candles.length >= 2)
        return { symbol: symbol.toUpperCase(), currency: 'USD', exchange: '', interval: '1d', range: 'max', source: 'Stooq', name: '', fetchedAt: Date.now(), candles: candles.slice(-2600) };
    } catch (err) {
      lastBody = err.message;
    }
  }
  throw tagErr('Stooq: no usable CSV (rate-limited or unknown symbol)', lastStatus, lastBody);
}

// --- Nasdaq official API (keyless daily history) -----------------------------
async function fromNasdaq(symbol, range) {
  const years = range === 'max' ? 25 : range === '10y' ? 10 : range === '5y' ? 5 : range === '2y' ? 2 : 1;
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical` +
    `?assetclass=stocks&fromdate=${fmt(from)}&todate=${fmt(to)}&limit=99999`;
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://www.nasdaq.com',
    Referer: 'https://www.nasdaq.com/',
    'Accept-Language': 'en-US,en;q=0.9'
  };
  const res = await withRetry(() => httpGet(url, { headers, timeoutMs: 11000 }), { attempts: 2 });
  if (res.status !== 200) throw tagErr(`Nasdaq HTTP ${res.status}`, res.status, res.body);
  const json = JSON.parse(res.body);
  const rows = json && json.data && json.data.tradesTable && json.data.tradesTable.rows;
  if (!rows || !rows.length) throw tagErr('Nasdaq: no rows (unknown symbol?)', 200, res.body);
  const num = (s) => +String(s).replace(/[$,]/g, '');
  const candles = rows
    .map((r) => ({
      time: new Date(r.date).getTime(),
      open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close),
      adjclose: num(r.close), volume: r.volume ? num(r.volume) : 0
    }))
    .filter((c) => isFinite(c.close) && isFinite(c.time))
    .sort((a, b) => a.time - b.time);
  if (candles.length < 2) throw tagErr('Nasdaq: too few candles', 200, res.body);
  return {
    symbol: symbol.toUpperCase(), currency: 'USD', exchange: 'NASDAQ', interval: '1d',
    range, source: 'Nasdaq', name: '', fetchedAt: Date.now(), candles
  };
}

// --- live quote (Nasdaq /info) + US market state ----------------------------
function numLike(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function usMarketState() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return 'CLOSED';
  const mins = et.getHours() * 60 + et.getMinutes();
  if (mins >= 570 && mins < 960) return 'REGULAR'; // 9:30–16:00 ET
  if (mins >= 240 && mins < 570) return 'PRE'; // 4:00–9:30
  if (mins >= 960 && mins < 1200) return 'POST'; // 16:00–20:00
  return 'CLOSED';
}
async function fromNasdaqQuote(symbol) {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`;
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://www.nasdaq.com',
    Referer: 'https://www.nasdaq.com/',
    'Accept-Language': 'en-US,en;q=0.9'
  };
  const res = await withRetry(() => httpGet(url, { headers, timeoutMs: 9000 }), { attempts: 2 });
  if (res.status !== 200) throw tagErr(`Nasdaq quote HTTP ${res.status}`, res.status, res.body);
  const json = JSON.parse(res.body);
  const d = json && json.data;
  const pd = d && d.primaryData;
  const price = pd && numLike(pd.lastSalePrice);
  if (price == null) throw tagErr('Nasdaq quote: no price', 200, res.body);
  const change = pd ? numLike(pd.netChange) : null;
  return {
    symbol: ((d && d.symbol) || symbol).toUpperCase(),
    price,
    change,
    changePct: pd ? numLike(pd.percentageChange) : null,
    previousClose: change != null ? +(price - change).toFixed(4) : null,
    volume: pd ? numLike(pd.volume) : null,
    name: (d && d.companyName) || '',
    exchange: (d && d.exchange) || '',
    asOf: (pd && pd.lastTradeTimestamp) || '',
    marketState: usMarketState(),
    source: 'Nasdaq'
  };
}
// Best-effort live price (keyless). Returns null on failure.
async function getQuote(symbol) {
  try {
    return await fromNasdaqQuote(symbol);
  } catch (_) {
    return null;
  }
}

// --- Nasdaq intraday (keyless live-ticking for the 1D view) ------------------
const INTRADAY_MS = { '1m': 60000, '2m': 120000, '5m': 300000, '15m': 900000, '30m': 1800000, '60m': 3600000, '90m': 5400000, '1h': 3600000 };
// Aggregate fine-grained price points into proper OHLC candles.
function bucketize(points, intervalMs) {
  const map = new Map();
  for (const p of points) {
    const k = Math.floor(p.time / intervalMs) * intervalMs;
    let b = map.get(k);
    if (!b) {
      b = { time: k, open: p.price, high: p.price, low: p.price, close: p.price, volume: 0 };
      map.set(k, b);
    }
    if (p.price > b.high) b.high = p.price;
    if (p.price < b.low) b.low = p.price;
    b.close = p.price;
    b.volume += p.volume || 0;
  }
  const out = [...map.values()].sort((a, b) => a.time - b.time);
  out.forEach((c) => (c.adjclose = c.close));
  return out;
}
async function fromNasdaqIntraday(symbol, interval) {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/chart?assetclass=stocks`;
  const headers = {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://www.nasdaq.com',
    Referer: 'https://www.nasdaq.com/',
    'Accept-Language': 'en-US,en;q=0.9'
  };
  const res = await withRetry(() => httpGet(url, { headers, timeoutMs: 10000 }), { attempts: 2 });
  if (res.status !== 200) throw tagErr(`Nasdaq intraday HTTP ${res.status}`, res.status, res.body);
  const json = JSON.parse(res.body);
  const arr = json && json.data && (json.data.chart || json.data.charts);
  if (!Array.isArray(arr) || arr.length < 2) throw tagErr('Nasdaq intraday: no points', 200, res.body);
  const points = arr
    .map((p) => {
      let time = NaN;
      if (p.x != null && Number(p.x) > 1e11) time = Number(p.x);
      else if (p.z && p.z.dateTime) time = new Date(String(p.z.dateTime).replace(/\bET\b/i, '').trim()).getTime();
      const price = p.y != null ? Number(p.y) : p.z ? numLike(p.z.value) : null;
      const volume = p.z && p.z.volume != null ? numLike(p.z.volume) : 0;
      return { time, price, volume: volume || 0 };
    })
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.price));
  if (points.length < 2) throw tagErr('Nasdaq intraday: unparseable points', 200, res.body);
  const candles = bucketize(points, INTRADAY_MS[interval] || 120000);
  if (candles.length < 2) throw tagErr('Nasdaq intraday: too few candles', 200, res.body);
  return {
    symbol: symbol.toUpperCase(), currency: 'USD', exchange: 'NASDAQ', instrumentType: 'EQUITY',
    interval, range: '1d', source: 'Nasdaq (intraday)', name: '', fetchedAt: Date.now(),
    marketState: usMarketState(), regularMarketPrice: points[points.length - 1].price, candles
  };
}

// --- Twelve Data (optional, needs free TWELVEDATA_KEY) -----------------------
const TD_INTERVAL = { '1m': '1min', '2m': '5min', '5m': '5min', '15m': '15min', '30m': '30min', '60m': '1h', '90m': '1h', '1h': '1h', '1d': '1day', '5d': '1day', '1wk': '1week', '1mo': '1month', '3mo': '1month' };
async function fromTwelveData(symbol, interval) {
  if (!TWELVEDATA_KEY) throw tagErr('Twelve Data: no key set', 0, '');
  const u = new URL('https://api.twelvedata.com/time_series');
  u.searchParams.set('symbol', symbol);
  u.searchParams.set('interval', TD_INTERVAL[interval] || '1day');
  u.searchParams.set('outputsize', '5000');
  u.searchParams.set('apikey', TWELVEDATA_KEY);
  const res = await withRetry(() => httpGet(u.toString(), { timeoutMs: 10000 }), { attempts: 2 });
  if (res.status !== 200) throw tagErr(`Twelve Data HTTP ${res.status}`, res.status, res.body);
  const json = JSON.parse(res.body);
  if (json.status === 'error' || !Array.isArray(json.values)) throw tagErr(`Twelve Data: ${json.message || 'error'}`, 200, res.body);
  const candles = json.values
    .map((v) => ({ time: new Date(v.datetime.replace(' ', 'T') + (v.datetime.length <= 10 ? 'T00:00:00Z' : 'Z')).getTime(), open: +v.open, high: +v.high, low: +v.low, close: +v.close, adjclose: +v.close, volume: v.volume ? +v.volume : 0 }))
    .filter((c) => isFinite(c.close))
    .sort((a, b) => a.time - b.time);
  if (candles.length < 2) throw tagErr('Twelve Data: too few candles', 200, res.body);
  return { symbol: symbol.toUpperCase(), currency: 'USD', exchange: '', interval, range: 'max', source: 'Twelve Data', name: (json.meta && json.meta.symbol) || '', fetchedAt: Date.now(), candles };
}

// --- Nasdaq fundamentals (key stats) ----------------------------------------
async function fromNasdaqSummary(symbol) {
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=stocks`;
  const headers = { Accept: 'application/json, text/plain, */*', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/', 'Accept-Language': 'en-US,en;q=0.9' };
  const res = await withRetry(() => httpGet(url, { headers, timeoutMs: 9000 }), { attempts: 2 });
  if (res.status !== 200) throw tagErr(`Nasdaq summary HTTP ${res.status}`, res.status, res.body);
  const json = JSON.parse(res.body);
  const sd = json && json.data && json.data.summaryData;
  if (!sd) throw tagErr('Nasdaq summary: no data', 200, res.body);
  const g = (k) => (sd[k] && sd[k].value != null && sd[k].value !== 'N/A' ? sd[k].value : null);
  return {
    symbol: symbol.toUpperCase(),
    marketCap: g('MarketCap'),
    peRatio: g('PERatio'),
    forwardPE: g('ForwardPE1Yr'),
    eps: g('EarningsPerShare'),
    sector: g('Sector'),
    industry: g('Industry'),
    week52: g('FiftyTwoWeekHighLow') || g('FiftTwoWeekHighLow'),
    oneYrTarget: g('OneYrTarget'),
    yield: g('Yield'),
    avgVolume: g('AverageVolume')
  };
}

// --- SEC EDGAR (free public API) ---------------------------------------------
let cikMap = null;
let cikAt = 0;
async function loadCikMap() {
  if (cikMap && Date.now() - cikAt < 24 * 3600 * 1000) return cikMap;
  const res = await httpGet('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': SEC_UA }, timeoutMs: 12000 });
  if (res.status !== 200) throw tagErr(`SEC tickers HTTP ${res.status}`, res.status, res.body);
  const j = JSON.parse(res.body);
  const map = {};
  for (const k in j) {
    const e = j[k];
    if (e && e.ticker) map[e.ticker.toUpperCase()] = { cik: String(e.cik_str).padStart(10, '0'), title: e.title };
  }
  cikMap = map;
  cikAt = Date.now();
  return map;
}
async function secConcept(cik, tags, unit) {
  for (const tag of tags) {
    try {
      const res = await httpGet(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`, { headers: { 'User-Agent': SEC_UA }, timeoutMs: 10000 });
      if (res.status !== 200) continue;
      const j = JSON.parse(res.body);
      const arr = j.units && (j.units[unit] || j.units.USD || j.units['USD/shares']);
      if (!arr) continue;
      const annual = {};
      for (const x of arr) if (x.form === '10-K' && x.fp === 'FY' && x.fy) annual[x.fy] = x.val;
      const years = Object.keys(annual).map(Number).sort((a, b) => a - b).slice(-4);
      if (years.length) return years.map((y) => ({ fy: y, val: annual[y] }));
    } catch (_) {}
  }
  return [];
}
async function edgarReport(symbol) {
  const map = await loadCikMap();
  const ent = map[symbol.toUpperCase()];
  if (!ent) throw tagErr('No SEC CIK found for ' + symbol + ' (US-listed companies only).', 404, '');
  const res = await httpGet(`https://data.sec.gov/submissions/CIK${ent.cik}.json`, { headers: { 'User-Agent': SEC_UA }, timeoutMs: 12000 });
  if (res.status !== 200) throw tagErr(`SEC submissions HTTP ${res.status}`, res.status, res.body);
  const j = JSON.parse(res.body);
  const r = j.filings && j.filings.recent;
  const filings = [];
  const KEEP = ['8-K', '10-Q', '10-K', '6-K', '20-F', 'S-1', 'DEF 14A', '424B4'];
  if (r) {
    for (let i = 0; i < r.form.length && filings.length < 12; i++) {
      if (!KEEP.includes(r.form[i])) continue;
      const acc = r.accessionNumber[i].replace(/-/g, '');
      filings.push({ form: r.form[i], date: r.filingDate[i], desc: r.primaryDocDescription[i] || '', url: `https://www.sec.gov/Archives/edgar/data/${parseInt(ent.cik, 10)}/${acc}/${r.primaryDocument[i]}` });
    }
  }
  let financials = { revenue: [], netIncome: [], eps: [] };
  try {
    const [revenue, netIncome, eps] = await Promise.all([
      secConcept(ent.cik, ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'SalesRevenueNet'], 'USD'),
      secConcept(ent.cik, ['NetIncomeLoss'], 'USD'),
      secConcept(ent.cik, ['EarningsPerShareDiluted', 'EarningsPerShareBasic'], 'USD/shares')
    ]);
    financials = { revenue, netIncome, eps };
  } catch (_) {}
  return { cik: ent.cik, name: j.name || ent.title, sic: j.sicDescription || '', exchange: (j.exchanges && j.exchanges[0]) || '', filings, financials, edgarUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ent.cik}&type=&dateb=&owner=include&count=40` };
}

async function profileReport(symbol) {
  const out = { symbol: symbol.toUpperCase() };
  try {
    const q = await getQuote(symbol);
    if (q) {
      out.price = q.price;
      out.change = q.change;
      out.changePct = q.changePct;
      out.name = q.name;
      out.exchange = q.exchange;
      out.marketState = q.marketState;
    }
  } catch (_) {}
  try {
    Object.assign(out, await fromNasdaqSummary(symbol));
  } catch (e) {
    out.summaryError = e.message;
  }
  return out;
}

// --- AI auto-research via the Claude API (optional, user's own key) ----------
function httpsPostJSON(url, headers, bodyObj, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyObj);
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.setTimeout(timeoutMs || 90000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      b += c;
      if (b.length > 300000) req.destroy();
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}
// Robustly pull a JSON object out of model text (handles code fences, preamble,
// and truncation — keeps every complete "key":"value" pair it can find).
function extractJsonObject(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = t.indexOf('{');
  if (start > 0) t = t.slice(start);
  try {
    return JSON.parse(t);
  } catch (_) {}
  const end = t.lastIndexOf('}');
  if (end > 0) {
    try {
      return JSON.parse(t.slice(0, end + 1));
    } catch (_) {}
  }
  // truncation repair: collect every complete string key/value pair
  const obj = {};
  const re = /"([A-Za-z0-9_]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  let n = 0;
  while ((m = re.exec(t))) {
    try {
      obj[m[1]] = JSON.parse('"' + m[2] + '"');
    } catch (_) {
      obj[m[1]] = m[2];
    }
    n++;
  }
  if (n) return obj;
  throw new Error('no_json');
}
async function aiResearch(symbol, fields) {
  if (!ANTHROPIC_KEY) throw tagErr('AI research is disabled. Set ANTHROPIC_API_KEY (your Anthropic key) and restart the server to enable it.', 0, '');
  // gather grounding context from the free data sources
  const ctx = { symbol };
  try {
    const p = await fromNasdaqSummary(symbol);
    Object.assign(ctx, p);
  } catch (_) {}
  try {
    const q = await getQuote(symbol);
    if (q) {
      ctx.price = q.price;
      ctx.name = ctx.name || q.name;
      ctx.exchange = ctx.exchange || q.exchange;
    }
  } catch (_) {}
  try {
    const e = await edgarReport(symbol);
    ctx.companyName = e.name;
    ctx.sic = e.sic;
    ctx.financials = e.financials;
    ctx.recentFilings = (e.filings || []).slice(0, 6).map((f) => `${f.form} ${f.date}`);
  } catch (_) {}

  const fieldList = fields.map((f) => `- ${f.id} [${f.section || ''} › ${f.label}]${f.prompt ? ' — ' + f.prompt : ''}`).join('\n');
  const system =
    `You are an equity-research assistant writing a FIRST-DRAFT due-diligence worksheet for ${symbol} that the user will independently verify. ` +
    `Be concise: 1–2 sentences per field, specific and neutral. Ground any figures in the DATA provided; do NOT fabricate precise numbers you are unsure of — qualify with "approx." or "(verify)". ` +
    `If you genuinely don't know something, say so briefly rather than guessing. This is educational research, NOT investment advice, and must not be presented as a recommendation. ` +
    `Respond with ONLY one minified JSON object mapping each field id to a concise string. No markdown, no code fences, no extra commentary.`;
  const user =
    `Company: ${ctx.companyName || ctx.name || symbol} (${symbol})\n` +
    `DATA (from Nasdaq & SEC EDGAR — may be partial, verify):\n${JSON.stringify(ctx)}\n\n` +
    `Fill in EVERY one of these fields (use the id exactly as the JSON key):\n${fieldList}\n\n` +
    `Return: {"field_id":"text", ...} covering all ids above.`;

  const res = await httpsPostJSON(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    {
      model: ANTHROPIC_MODEL,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      system,
      // (No assistant prefill — some models reject it; the system prompt asks
      // for raw JSON and extractJsonObject() handles fences/preamble/truncation.)
      messages: [{ role: 'user', content: user }]
    },
    120000
  );
  if (res.status !== 200) {
    // surface Anthropic's actual error so failures are diagnosable
    let why = res.body;
    try {
      const ej = JSON.parse(res.body);
      why = (ej.error && ej.error.message) || why;
    } catch (_) {}
    throw tagErr(`Anthropic API ${res.status}: ${String(why).slice(0, 220)}`, res.status, res.body);
  }
  const j = JSON.parse(res.body);
  const text = (j.content && j.content[0] && j.content[0].text) || '';
  let obj;
  try {
    obj = extractJsonObject(text);
  } catch (_) {
    throw tagErr('AI returned unparseable output', 200, text.slice(0, 300));
  }
  if (!obj || !Object.keys(obj).length) throw tagErr('AI returned no fields', 200, text.slice(0, 300));
  return { fields: obj, model: ANTHROPIC_MODEL, company: ctx.companyName || ctx.name || symbol };
}

// --- unified loader + diagnostics --------------------------------------------
function providersFor(interval) {
  const daily = ['1d', '1wk', '1mo', '3mo'].includes(interval);
  const list = [];
  if (TWELVEDATA_KEY) list.push(['Twelve Data', (s, r, i) => fromTwelveData(s, i)]);
  list.push(['Yahoo Finance', (s, r, i) => fromYahoo(s, r, i)]);
  // keyless backups when Yahoo throttles: Nasdaq/Stooq daily, Nasdaq intraday.
  if (daily) {
    list.push(['Nasdaq', (s, r) => fromNasdaq(s, r)]);
    list.push(['Stooq', (s) => fromStooq(s)]);
  } else {
    list.push(['Nasdaq Intraday', (s, r, i) => fromNasdaqIntraday(s, i)]);
  }
  return list;
}
// Resample daily candles into weekly/monthly/quarterly OHLCV (for the keyless
// daily sources, which ignore the requested interval).
function periodKey(ms, interval) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  if (interval === '1mo') return y * 12 + d.getUTCMonth();
  if (interval === '3mo') return y * 4 + Math.floor(d.getUTCMonth() / 3);
  const week = Math.floor((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 1)) / (7 * 86400000));
  return y * 53 + week; // 1wk
}
function aggregateCandles(candles, interval) {
  if (!candles || !candles.length) return candles;
  const out = [];
  let cur = null;
  let curKey = null;
  for (const c of candles) {
    const k = periodKey(c.time, interval);
    if (k !== curKey) {
      if (cur) out.push(cur);
      cur = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, adjclose: c.adjclose, volume: c.volume || 0 };
      curKey = k;
    } else {
      if (c.high > cur.high) cur.high = c.high;
      if (c.low < cur.low) cur.low = c.low;
      cur.close = c.close;
      cur.adjclose = c.adjclose;
      cur.volume += c.volume || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}
async function loadChart(symbol, range, interval, noQuote) {
  const key = `${symbol}|${range}|${interval}|${noQuote ? 'nq' : 'q'}`;
  const hit = cacheGet(key);
  if (hit) return { data: hit, errors: [], cached: true };
  const errors = [];
  for (const [name, fn] of providersFor(interval)) {
    try {
      const data = await fn(symbol, range, interval);
      if (errors.length) data.note = 'Primary source busy; served by ' + data.source + '.';
      // If a daily-only source (Nasdaq/Stooq) was used for a weekly/monthly
      // request, resample the candles so the timeframe is actually honoured.
      if (['1wk', '1mo', '3mo'].includes(interval) && data.interval !== interval) {
        data.candles = aggregateCandles(data.candles, interval);
        data.interval = interval;
      }
      // Daily sources (Nasdaq/Stooq) only have completed bars — enrich with a
      // live quote so the header shows the CURRENT price, not yesterday's close.
      // (Skipped for bulk screener requests via noQuote to halve provider calls.)
      if (!noQuote && (data.regularMarketPrice == null || data.previousClose == null)) {
        const qd = await getQuote(symbol);
        if (qd) {
          if (data.regularMarketPrice == null && isFinite(qd.price)) data.regularMarketPrice = qd.price;
          if (data.previousClose == null && qd.previousClose != null) data.previousClose = qd.previousClose;
          data.quoteAsOf = data.quoteAsOf || qd.asOf;
          data.quoteSource = data.quoteSource || qd.source;
        }
      }
      if (!data.marketState) data.marketState = usMarketState();
      // short TTL for intraday so it stays live; longer for daily to be gentle
      cacheSet(key, data, /[mh]/.test(interval) ? 10000 : 90000);
      return { data, errors };
    } catch (e) {
      errors.push({ provider: name, status: e.status || 0, error: e.message, snippet: e.snippet || '' });
    }
  }
  const err = new Error('All real-data sources failed for ' + symbol);
  err.errors = errors;
  throw err;
}
async function diagnose(symbol) {
  const out = [];
  const all = [
    ['Yahoo Finance', () => fromYahoo(symbol, '1mo', '1d')],
    ['Nasdaq', () => fromNasdaq(symbol, '1y')],
    ['Nasdaq Intraday', () => fromNasdaqIntraday(symbol, '2m')],
    ['Stooq', () => fromStooq(symbol)]
  ];
  if (TWELVEDATA_KEY) all.unshift(['Twelve Data', () => fromTwelveData(symbol, '1d')]);
  for (const [name, fn] of all) {
    const t0 = Date.now();
    try {
      const d = await fn();
      out.push({ provider: name, ok: true, ms: Date.now() - t0, bars: d.candles.length, latest: d.candles[d.candles.length - 1] });
    } catch (e) {
      out.push({ provider: name, ok: false, ms: Date.now() - t0, status: e.status || 0, error: e.message, snippet: e.snippet || '' });
    }
  }
  return { symbol, twelveDataKey: !!TWELVEDATA_KEY, attempts: out };
}

async function searchSymbols(q) {
  const auth = await getYahooAuth();
  const u = new URL('https://query1.finance.yahoo.com/v1/finance/search');
  u.searchParams.set('q', q);
  u.searchParams.set('quotesCount', '8');
  u.searchParams.set('newsCount', '0');
  if (auth.crumb) u.searchParams.set('crumb', auth.crumb);
  const res = await withRetry(() => httpGet(u.toString(), { headers: auth.cookie ? { Cookie: auth.cookie } : {}, timeoutMs: 7000 }), { attempts: 2 });
  if (res.status !== 200) throw tagErr(`search HTTP ${res.status}`, res.status, res.body);
  const json = JSON.parse(res.body);
  return (json.quotes || []).filter((x) => x.symbol).map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname || '', exchange: x.exchDisp || '', type: x.typeDisp || x.quoteType || '' }));
}

// --- http plumbing -----------------------------------------------------------
function sendJSON(res, payload, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(payload));
}
function round4(n) {
  return Math.round(n * 10000) / 10000;
}
function applyAdjustment(data) {
  data.candles = data.candles.map((c) => {
    const r = c.close ? c.adjclose / c.close : 1;
    return { ...c, open: round4(c.open * r), high: round4(c.high * r), low: round4(c.low * r), close: round4(c.adjclose) };
  });
  data.adjusted = true;
  return data;
}

async function handleChart(res, query) {
  const symbol = (query.get('symbol') || 'AAPL').trim().toUpperCase().slice(0, 15);
  let range = (query.get('range') || '1y').trim();
  let interval = (query.get('interval') || '1d').trim();
  if (!RANGES.has(range)) range = '1y';
  if (!INTERVALS.has(interval)) interval = '1d';
  const noQuote = query.get('noquote') === '1';
  try {
    let { data } = await loadChart(symbol, range, interval, noQuote);
    if (query.get('adjusted') === '1') data = applyAdjustment(data);
    return sendJSON(res, data);
  } catch (err) {
    return sendJSON(res, {
      error: 'upstream_unavailable', symbol,
      message: 'Could not fetch real market data for "' + symbol + '". No fabricated data is shown. ' +
        'Tip: run “node verify-data.js ' + symbol + '” to see exactly why, or set a free TWELVEDATA_KEY.',
      detail: (err.errors || []).map((e) => `${e.provider}: ${e.error}${e.snippet ? ' — ' + e.snippet : ''}`)
    }, 502);
  }
}

const server = http.createServer((req, res) => {
  let parsed;
  try {
    parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400);
    return void res.end('Bad request');
  }
  const p = parsed.pathname;
  const q = parsed.searchParams;
  if (req.method === 'POST' && p === '/api/ai-research') {
    return void readBody(req).then((body) => {
      let parsed2 = {};
      try {
        parsed2 = JSON.parse(body || '{}');
      } catch (_) {}
      const sym = (parsed2.symbol || 'AAPL').toUpperCase().slice(0, 15);
      const fields = Array.isArray(parsed2.fields) ? parsed2.fields.slice(0, 80) : [];
      return aiResearch(sym, fields).then((r) => sendJSON(res, r));
    }).catch((e) => sendJSON(res, { error: e.message, detail: e.snippet || '' }, e.status === 0 ? 400 : 502));
  }
  if (p === '/api/chart') return void handleChart(res, q).catch((e) => sendJSON(res, { error: 'server_error', message: e.message }, 500));
  if (p === '/api/search') return void searchSymbols((q.get('q') || '').slice(0, 40)).then((quotes) => sendJSON(res, { quotes })).catch((e) => sendJSON(res, { quotes: [], error: e.message }));
  if (p === '/api/quote') return void getQuote((q.get('symbol') || 'AAPL').toUpperCase().slice(0, 15)).then((r) => (r ? sendJSON(res, r) : sendJSON(res, { error: 'no_quote' }, 502))).catch((e) => sendJSON(res, { error: e.message }, 502));
  if (p === '/api/profile') return void profileReport((q.get('symbol') || 'AAPL').toUpperCase().slice(0, 15)).then((r) => sendJSON(res, r)).catch((e) => sendJSON(res, { error: e.message }, 502));
  if (p === '/api/edgar') return void edgarReport((q.get('symbol') || 'AAPL').toUpperCase().slice(0, 15)).then((r) => sendJSON(res, r)).catch((e) => sendJSON(res, { error: e.message, detail: e.snippet || '' }, e.status === 404 ? 404 : 502));
  if (p === '/api/diagnose') return void diagnose((q.get('symbol') || 'AAPL').toUpperCase().slice(0, 15)).then((r) => sendJSON(res, r)).catch((e) => sendJSON(res, { error: e.message }, 500));
  if (p === '/api/health') return void sendJSON(res, { ok: true, twelveDataKey: !!TWELVEDATA_KEY, aiEnabled: !!ANTHROPIC_KEY, aiModel: ANTHROPIC_KEY ? ANTHROPIC_MODEL : null, time: Date.now() });
  // static
  let rel = decodeURIComponent(p);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return void res.end('Forbidden');
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return void res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    /* eslint-disable no-console */
    console.log(`\n  📈  Chart School is running`);
    console.log(`      →  http://localhost:${PORT}\n`);
    console.log(`  Real data: ${TWELVEDATA_KEY ? 'Twelve Data → ' : ''}Yahoo Finance → Nasdaq → Stooq (keyless). No fabricated data.`);
    console.log(`  AI auto-research: ${ANTHROPIC_KEY ? 'ON (' + ANTHROPIC_MODEL + ')' : 'off — set ANTHROPIC_API_KEY to enable'}`);
    console.log(`  Verify accuracy:  node verify-data.js AAPL\n`);
    console.log(`  Press Ctrl+C to stop.\n`);
  });
}

module.exports = { fromYahoo, fromStooq, fromNasdaq, fromNasdaqIntraday, fromNasdaqQuote, getQuote, fromTwelveData, fromNasdaqSummary, profileReport, edgarReport, aiResearch, extractJsonObject, aggregateCandles, searchSymbols, loadChart, diagnose, applyAdjustment, getYahooAuth };

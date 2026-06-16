'use strict';

/**
 * Chart School — data server (zero dependencies).
 *
 *   1. Serves the static front-end in /public.
 *   2. Proxies REAL market data (no API key) so the browser avoids CORS:
 *        GET /api/chart?symbol=AAPL&range=1y&interval=1d[&adjusted=1]
 *        GET /api/search?q=apple
 *        GET /api/health
 *
 * Data sources, in order, ALL real:
 *      a) Yahoo Finance  (query1 → query2, retries, cookie warm-up,
 *                         split/dividend-adjusted prices, intraday + daily)
 *      b) Stooq          (keyless daily CSV, reliable accuracy backstop)
 *
 * If every real source fails the API returns an honest error — it never
 * fabricates data. (The browser only shows synthetic data if YOU explicitly
 * ask for "sample data".)
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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.command': 'text/plain; charset=utf-8'
};

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Allowed Yahoo parameters (anything else is coerced to a safe default).
const RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
const INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- low-level GET returning {status, body, headers} -------------------------
function httpGet(url, { headers = {}, timeoutMs = 10000, redirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        httpGet(next, { headers, timeoutMs, redirects: redirects - 1 }).then(resolve, reject);
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

async function withRetry(fn, { attempts = 3, base = 350 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(i);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(base * Math.pow(2, i) + Math.random() * 150);
    }
  }
  throw lastErr;
}

// --- Yahoo cookie warm-up (reduces 429 rate-limiting) ------------------------
let yahooCookie = '';
let cookieAt = 0;
async function ensureYahooCookie() {
  if (yahooCookie && Date.now() - cookieAt < 30 * 60 * 1000) return yahooCookie;
  try {
    const res = await httpGet('https://fc.yahoo.com/', { timeoutMs: 6000 });
    const sc = res.headers['set-cookie'];
    if (sc && sc.length) {
      yahooCookie = sc.map((c) => c.split(';')[0]).join('; ');
      cookieAt = Date.now();
    }
  } catch (_) {
    /* cookie is best-effort */
  }
  return yahooCookie;
}

// --- Yahoo Finance -----------------------------------------------------------
async function fromYahoo(symbol, range, interval) {
  await ensureYahooCookie();
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

  const fetchOnce = async (attempt) => {
    const host = hosts[attempt % hosts.length];
    const u = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`);
    u.searchParams.set('range', range);
    u.searchParams.set('interval', interval);
    u.searchParams.set('includePrePost', 'false');
    u.searchParams.set('events', 'div,splits');
    u.searchParams.set('includeAdjustedClose', 'true');
    const headers = { 'Accept-Language': 'en-US,en;q=0.9' };
    if (yahooCookie) headers.Cookie = yahooCookie;
    const res = await httpGet(u.toString(), { headers, timeoutMs: 10000 });
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      // refresh cookie and signal retry
      yahooCookie = '';
      await ensureYahooCookie();
      throw new Error(`Yahoo HTTP ${res.status}`);
    }
    if (res.status !== 200) throw new Error(`Yahoo HTTP ${res.status}`);
    return res.body;
  };

  const raw = await withRetry(fetchOnce, { attempts: 4, base: 400 });
  const json = JSON.parse(raw);
  const err = json && json.chart && json.chart.error;
  if (err) throw new Error(`Yahoo: ${err.code || err.description || 'error'}`);
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result || !result.timestamp) throw new Error('Yahoo: empty result (unknown symbol?)');

  const q = result.indicators.quote[0];
  const adj =
    result.indicators.adjclose && result.indicators.adjclose[0]
      ? result.indicators.adjclose[0].adjclose
      : null;
  const t = result.timestamp;
  const candles = [];
  for (let i = 0; i < t.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    const ac = adj && adj[i] != null ? +adj[i] : +c;
    candles.push({
      time: t[i] * 1000,
      open: +o, high: +h, low: +l, close: +c,
      adjclose: ac,
      volume: q.volume[i] == null ? 0 : +q.volume[i]
    });
  }
  if (candles.length < 2) throw new Error('Yahoo: too few candles');

  const meta = result.meta || {};
  return {
    symbol: (meta.symbol || symbol).toUpperCase(),
    currency: meta.currency || 'USD',
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    instrumentType: meta.instrumentType || '',
    timezone: meta.exchangeTimezoneName || meta.timezone || '',
    interval,
    range,
    source: 'Yahoo Finance',
    name: meta.longName || meta.shortName || '',
    regularMarketPrice: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose ?? meta.previousClose,
    marketState: meta.marketState || '',
    fetchedAt: Date.now(),
    candles
  };
}

// --- Stooq (keyless daily accuracy backstop) ---------------------------------
function stooqSymbol(symbol) {
  const s = symbol.toLowerCase();
  if (s.startsWith('^') || s.includes('.')) return s;
  if (s.includes('-')) return s; // crypto like btc-usd not supported by stooq; let it fail to demo
  return `${s}.us`;
}
async function fromStooq(symbol) {
  const s = stooqSymbol(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`;
  const res = await withRetry(() => httpGet(url, { timeoutMs: 9000 }), { attempts: 3 });
  if (res.status !== 200) throw new Error(`Stooq HTTP ${res.status}`);
  const lines = res.body.trim().split(/\r?\n/);
  if (lines.length < 3 || !/^Date,/i.test(lines[0])) throw new Error('Stooq: no data');
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, o, h, l, c, v] = lines[i].split(',');
    if (!date || o === 'N/D') continue;
    candles.push({
      time: new Date(date + 'T00:00:00Z').getTime(),
      open: +o, high: +h, low: +l, close: +c, adjclose: +c,
      volume: v ? +v : 0
    });
  }
  if (candles.length < 2) throw new Error('Stooq: too few candles');
  return {
    symbol: symbol.toUpperCase(),
    currency: 'USD',
    exchange: '',
    interval: '1d',
    range: 'max',
    source: 'Stooq',
    name: '',
    fetchedAt: Date.now(),
    candles: candles.slice(-2600)
  };
}

// --- Yahoo symbol search (autocomplete) --------------------------------------
async function searchSymbols(q) {
  await ensureYahooCookie();
  const u = new URL('https://query1.finance.yahoo.com/v1/finance/search');
  u.searchParams.set('q', q);
  u.searchParams.set('quotesCount', '8');
  u.searchParams.set('newsCount', '0');
  const headers = yahooCookie ? { Cookie: yahooCookie } : {};
  const res = await withRetry(() => httpGet(u.toString(), { headers, timeoutMs: 7000 }), { attempts: 2 });
  if (res.status !== 200) throw new Error(`search HTTP ${res.status}`);
  const json = JSON.parse(res.body);
  return (json.quotes || [])
    .filter((x) => x.symbol)
    .map((x) => ({
      symbol: x.symbol,
      name: x.shortname || x.longname || '',
      exchange: x.exchDisp || x.exchange || '',
      type: x.typeDisp || x.quoteType || ''
    }));
}

// --- helpers -----------------------------------------------------------------
function sendJSON(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

// Optionally rebuild OHLC from the adjusted close (split+dividend adjusted).
function applyAdjustment(data) {
  data.candles = data.candles.map((c) => {
    const r = c.close ? c.adjclose / c.close : 1;
    return { ...c, open: round4(c.open * r), high: round4(c.high * r), low: round4(c.low * r), close: round4(c.adjclose) };
  });
  data.adjusted = true;
  return data;
}
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

async function handleChart(res, query) {
  const symbol = (query.get('symbol') || 'AAPL').trim().toUpperCase().slice(0, 15);
  let range = (query.get('range') || '1y').trim();
  let interval = (query.get('interval') || '1d').trim();
  const adjusted = query.get('adjusted') === '1';
  if (!RANGES.has(range)) range = '1y';
  if (!INTERVALS.has(interval)) interval = '1d';

  const errors = [];
  try {
    let data = await fromYahoo(symbol, range, interval);
    if (adjusted) data = applyAdjustment(data);
    return sendJSON(res, data);
  } catch (e) {
    errors.push(`yahoo: ${e.message}`);
  }
  // Stooq is daily-only — use it as an accuracy backstop for daily/weekly/monthly.
  if (['1d', '1wk', '1mo', '3mo'].includes(interval)) {
    try {
      const data = await fromStooq(symbol);
      data.note = 'Intraday feed unavailable from backup source; showing accurate end-of-day data.';
      return sendJSON(res, data);
    } catch (e) {
      errors.push(`stooq: ${e.message}`);
    }
  }
  return sendJSON(
    res,
    {
      error: 'upstream_unavailable',
      symbol,
      message:
        'Could not fetch real market data for "' + symbol + '". Check the ticker and your ' +
        'internet connection, then retry. (No fabricated data is shown.)',
      detail: errors
    },
    502
  );
}

async function handleSearch(res, query) {
  const q = (query.get('q') || '').trim().slice(0, 40);
  if (!q) return sendJSON(res, { quotes: [] });
  try {
    const quotes = await searchSymbols(q);
    return sendJSON(res, { quotes });
  } catch (e) {
    return sendJSON(res, { quotes: [], error: e.message }, 200);
  }
}

// --- static serving ----------------------------------------------------------
function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  let parsed;
  try {
    parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const p = parsed.pathname;
  if (p === '/api/chart') return void handleChart(res, parsed.searchParams).catch((e) => sendJSON(res, { error: 'server_error', message: e.message }, 500));
  if (p === '/api/search') return void handleSearch(res, parsed.searchParams).catch((e) => sendJSON(res, { quotes: [], error: e.message }, 500));
  if (p === '/api/health') return void sendJSON(res, { ok: true, time: Date.now() });
  serveStatic(res, p);
});

// Only start the HTTP server when run directly (so verify-data.js can import
// the data functions without booting a conflicting listener).
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    /* eslint-disable no-console */
    console.log(`\n  📈  Chart School is running`);
    console.log(`      →  http://localhost:${PORT}\n`);
    console.log(`  Real data via Yahoo Finance → Stooq (no API key). No fabricated data.`);
    console.log(`  Verify accuracy any time:  node verify-data.js AAPL\n`);
    console.log(`  Press Ctrl+C to stop.\n`);
  });
}

// Export internals for the verifier script.
module.exports = { fromYahoo, fromStooq, searchSymbols, applyAdjustment };

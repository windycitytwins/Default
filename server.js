'use strict';

/**
 * Chart School — zero-dependency server.
 *
 * Responsibilities:
 *   1. Serve the static front-end in /public.
 *   2. Proxy live market data so the browser never has to fight CORS.
 *        GET /api/chart?symbol=AAPL&range=1y&interval=1d
 *      Data source order:
 *        a) Yahoo Finance  (no key, intraday + daily)
 *        b) Stooq          (no key, daily, very reliable fallback)
 *      If both are unreachable the browser falls back to local demo data,
 *      so the tutor keeps working even with no internet at all.
 *
 * No npm install required. Just: node server.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8123; // avoids 5173 (Vite's default) to prevent clashes
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
  '.webmanifest': 'application/manifest+json'
};

// --- tiny https GET helper that returns the body as a string -----------------
function fetchText(url, headers = {}, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: '*/*',
          ...headers
        }
      },
      (res) => {
        // Follow one level of redirect (Stooq sometimes redirects).
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchText(res.headers.location, headers, timeoutMs).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// --- normalize: Yahoo Finance ------------------------------------------------
async function fromYahoo(symbol, range, interval) {
  const u = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
  );
  u.searchParams.set('range', range);
  u.searchParams.set('interval', interval);
  u.searchParams.set('includePrePost', 'false');

  const raw = await fetchText(u.toString());
  const json = JSON.parse(raw);
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result || !result.timestamp) throw new Error('Yahoo: empty result');

  const q = result.indicators.quote[0];
  const t = result.timestamp;
  const candles = [];
  for (let i = 0; i < t.length; i++) {
    const o = q.open[i];
    const h = q.high[i];
    const l = q.low[i];
    const c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({
      time: t[i] * 1000,
      open: +o,
      high: +h,
      low: +l,
      close: +c,
      volume: q.volume[i] == null ? 0 : +q.volume[i]
    });
  }
  if (candles.length < 2) throw new Error('Yahoo: too few candles');

  const meta = result.meta || {};
  return {
    symbol: (meta.symbol || symbol).toUpperCase(),
    currency: meta.currency || 'USD',
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    interval,
    range,
    source: 'Yahoo Finance',
    name: meta.longName || meta.shortName || '',
    candles
  };
}

// --- normalize: Stooq (daily CSV fallback) -----------------------------------
function stooqSymbol(symbol) {
  const s = symbol.toLowerCase();
  // Stooq wants a market suffix; assume US for plain tickers.
  if (s.includes('.')) return s;
  if (s.startsWith('^')) return s; // index
  return `${s}.us`;
}

async function fromStooq(symbol) {
  const s = stooqSymbol(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`;
  const csv = await fetchText(url);
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 3 || !/^Date,/i.test(lines[0])) throw new Error('Stooq: no data');

  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, o, h, l, c, v] = lines[i].split(',');
    if (!date || o === 'N/D') continue;
    candles.push({
      time: new Date(date + 'T00:00:00Z').getTime(),
      open: +o,
      high: +h,
      low: +l,
      close: +c,
      volume: v ? +v : 0
    });
  }
  if (candles.length < 2) throw new Error('Stooq: too few candles');
  // Keep roughly the last ~2 years of daily candles.
  const trimmed = candles.slice(-520);
  return {
    symbol: symbol.toUpperCase(),
    currency: 'USD',
    exchange: '',
    interval: '1d',
    range: '2y',
    source: 'Stooq',
    name: '',
    candles: trimmed
  };
}

async function handleChart(req, res, query) {
  const symbol = (query.get('symbol') || 'AAPL').trim().toUpperCase().slice(0, 12);
  const range = (query.get('range') || '1y').trim();
  const interval = (query.get('interval') || '1d').trim();

  const send = (payload, status = 200) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(body);
  };

  const errors = [];
  try {
    const data = await fromYahoo(symbol, range, interval);
    return send(data);
  } catch (e) {
    errors.push(`yahoo: ${e.message}`);
  }
  // Intraday isn't available from Stooq, but daily is a fine fallback.
  try {
    const data = await fromStooq(symbol);
    data.note = 'Live intraday feed unavailable; showing end-of-day data.';
    return send(data);
  } catch (e) {
    errors.push(`stooq: ${e.message}`);
  }

  return send(
    {
      error: 'upstream_unavailable',
      symbol,
      message:
        'Could not reach a live data provider from the server. ' +
        'The app will display offline demo data instead.',
      detail: errors
    },
    502
  );
}

// --- static file serving -----------------------------------------------------
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // Prevent path traversal.
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
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
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

  if (parsed.pathname === '/api/chart') {
    handleChart(req, res, parsed.searchParams).catch((e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'server_error', message: e.message }));
    });
    return;
  }

  if (parsed.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, time: Date.now() }));
    return;
  }

  serveStatic(req, res, parsed.pathname);
});

server.listen(PORT, HOST, () => {
  /* eslint-disable no-console */
  console.log(`\n  📈  Chart School is running`);
  console.log(`      →  http://localhost:${PORT}\n`);
  console.log(`  Live data proxied via Yahoo Finance → Stooq (no API key needed).`);
  console.log(`  Press Ctrl+C to stop.\n`);
});

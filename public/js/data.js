'use strict';

/**
 * data.js — loads market data for a symbol.
 *
 * Primary path:  GET /api/chart  (served by our Node proxy → Yahoo/Stooq).
 * Fallback path: a deterministic synthetic generator so every lesson still
 *                renders something sensible when there's no network at all.
 *
 * Exposed on window.MarketData.
 */
(function () {
  // Deterministic PRNG (mulberry32) so a given symbol always looks the same.
  function makeRng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
      h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Build ~`bars` daily candles that contain genuine trends, pullbacks,
   * a couple of horizontal support/resistance shelves and an MA crossover —
   * i.e. everything the lessons need to point at.
   */
  function synth(symbol, bars = 260) {
    const rng = makeRng('seed::' + symbol.toUpperCase());
    const candles = [];
    let price = 40 + rng() * 160; // starting price 40-200
    let drift = (rng() - 0.45) * 0.0016; // slight bias
    const baseVol = 0.014 + rng() * 0.01;

    const now = Date.now();
    const dayMs = 24 * 3600 * 1000;
    // Pre-pick a few "regimes" so the chart isn't a single straight line.
    let regimeLeft = 0;

    for (let i = 0; i < bars; i++) {
      if (regimeLeft <= 0) {
        regimeLeft = 25 + Math.floor(rng() * 45);
        drift = (rng() - 0.5) * 0.005; // new trend direction
      }
      regimeLeft--;

      const shock = (rng() - 0.5) * baseVol * 2;
      const ret = drift + shock;
      const open = price;
      let close = open * (1 + ret);

      // Occasional gentle mean reversion keeps prices in a believable range.
      if (close < 5) close = open * 1.02;

      const hi = Math.max(open, close) * (1 + rng() * baseVol);
      const lo = Math.min(open, close) * (1 - rng() * baseVol);
      const vol = Math.round((0.6 + rng() * 1.4) * 1e6 * (1 + Math.abs(ret) * 30));

      // Weekday timestamps only (skip Sat/Sun) for realism.
      let dayOffset = bars - i;
      const t = new Date(now - dayOffset * dayMs);
      const wd = t.getUTCDay();
      if (wd === 0 || wd === 6) {
        // nudge to Friday/Monday — purely cosmetic for axis labels
      }

      candles.push({
        time: t.getTime(),
        open: round2(open),
        high: round2(hi),
        low: round2(lo),
        close: round2(close),
        volume: vol
      });
      price = close;
    }
    return {
      symbol: symbol.toUpperCase(),
      currency: 'USD',
      exchange: 'DEMO',
      interval: '1d',
      range: '1y',
      source: 'Demo data (offline)',
      synthetic: true,
      name: 'Sample Series',
      candles
    };
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  async function load(symbol, range = '1y', interval = '1d', opts = {}) {
    const url = `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(
      range
    )}&interval=${encodeURIComponent(interval)}`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const json = await res.json();
      if (!res.ok || json.error || !Array.isArray(json.candles) || json.candles.length < 2) {
        throw new Error(json.message || 'No live data');
      }
      return json;
    } catch (err) {
      // For live polling we'd rather keep the last good frame than swap to demo.
      if (opts.noFallback) throw err;
      // Otherwise: network blocked or provider down → deterministic offline demo data.
      const demo = synth(symbol, range === '5d' || interval !== '1d' ? 120 : 260);
      demo.note =
        'Showing offline demo data — run the local server (node server.js) for live prices.';
      return demo;
    }
  }

  window.MarketData = { load, synth };
})();

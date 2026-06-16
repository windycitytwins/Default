'use strict';

/**
 * indicators.js — pure technical-analysis math.
 * Everything here is side-effect free so it's easy to test and reuse.
 * Exposed on window.TA.
 */
(function () {
  const TA = {};

  /** Simple Moving Average. Returns an array aligned to `values`
   *  with `null` for the warm-up period. */
  TA.sma = function (values, period) {
    const out = new Array(values.length).fill(null);
    if (period <= 0) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  };

  /** Exponential Moving Average. Seeded with an SMA of the first `period`. */
  TA.ema = function (values, period) {
    const out = new Array(values.length).fill(null);
    if (period <= 0 || values.length < period) return out;
    const k = 2 / (period + 1);
    let seed = 0;
    for (let i = 0; i < period; i++) seed += values[i];
    let prev = seed / period;
    out[period - 1] = prev;
    for (let i = period; i < values.length; i++) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  };

  /** Wilder's RSI (0-100). */
  TA.rsi = function (closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;
    let gain = 0;
    let loss = 0;
    for (let i = 1; i <= period; i++) {
      const ch = closes[i] - closes[i - 1];
      if (ch >= 0) gain += ch;
      else loss -= ch;
    }
    let avgGain = gain / period;
    let avgLoss = loss / period;
    out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period + 1; i < closes.length; i++) {
      const ch = closes[i] - closes[i - 1];
      const g = ch > 0 ? ch : 0;
      const l = ch < 0 ? -ch : 0;
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return out;
  };

  /** Detect swing pivots: local highs/lows over a +/- `lookback` window. */
  TA.pivots = function (candles, lookback = 5) {
    const highs = [];
    const lows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      let isHigh = true;
      let isLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].high >= candles[i].high) isHigh = false;
        if (candles[j].low <= candles[i].low) isLow = false;
      }
      if (isHigh) highs.push({ i, price: candles[i].high });
      if (isLow) lows.push({ i, price: candles[i].low });
    }
    return { highs, lows };
  };

  /**
   * Cluster swing pivots into horizontal support/resistance ZONES.
   * Returns levels sorted by "strength" (number of touches), each with a
   * price band [lo, hi] and the candle indices that touched it.
   */
  TA.supportResistance = function (candles, opts = {}) {
    const lookback = opts.lookback || 5;
    const maxLevels = opts.maxLevels || 6;
    const { highs, lows } = TA.pivots(candles, lookback);
    const pts = highs
      .map((p) => ({ ...p, kind: 'res' }))
      .concat(lows.map((p) => ({ ...p, kind: 'sup' })))
      .sort((a, b) => a.price - b.price);
    if (!pts.length) return [];

    // Tolerance scales with price (1.2% band by default).
    const tol = opts.tolerance || 0.012;
    const clusters = [];
    let cur = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const ref = cur[cur.length - 1].price;
      if (Math.abs(pts[i].price - ref) / ref <= tol) {
        cur.push(pts[i]);
      } else {
        clusters.push(cur);
        cur = [pts[i]];
      }
    }
    clusters.push(cur);

    const lastClose = candles[candles.length - 1].close;
    const levels = clusters
      .map((cl) => {
        const prices = cl.map((p) => p.price);
        const lo = Math.min(...prices);
        const hi = Math.max(...prices);
        const mid = prices.reduce((a, b) => a + b, 0) / prices.length;
        return {
          lo,
          hi,
          mid,
          touches: cl.length,
          indices: cl.map((p) => p.i),
          // Below the current price it acts as support, above as resistance.
          role: mid < lastClose ? 'support' : 'resistance'
        };
      })
      .filter((lvl) => lvl.touches >= (opts.minTouches || 2))
      .sort((a, b) => b.touches - a.touches)
      .slice(0, maxLevels);

    return levels;
  };

  /** Classify the prevailing trend from a moving average's slope. */
  TA.trend = function (closes, period = 50) {
    const ma = TA.sma(closes, period);
    const last = ma[ma.length - 1];
    const prev = ma[ma.length - Math.min(period, 20)];
    if (last == null || prev == null) return { dir: 'unknown', strength: 0 };
    const change = (last - prev) / prev;
    let dir = 'sideways';
    if (change > 0.02) dir = 'up';
    else if (change < -0.02) dir = 'down';
    return { dir, strength: change };
  };

  /** Find moving-average crossover points between two series. */
  TA.crossovers = function (fast, slow) {
    const events = [];
    for (let i = 1; i < fast.length; i++) {
      if (fast[i] == null || slow[i] == null || fast[i - 1] == null || slow[i - 1] == null)
        continue;
      const prevDiff = fast[i - 1] - slow[i - 1];
      const diff = fast[i] - slow[i];
      if (prevDiff <= 0 && diff > 0) events.push({ i, type: 'golden' });
      else if (prevDiff >= 0 && diff < 0) events.push({ i, type: 'death' });
    }
    return events;
  };

  TA.closes = (candles) => candles.map((c) => c.close);

  window.TA = TA;
})();

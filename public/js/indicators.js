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

  /** EMA over a series that may contain leading/internal nulls (for MACD signal). */
  function emaNullable(arr, period) {
    const out = new Array(arr.length).fill(null);
    const idxs = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] != null) idxs.push(i);
    if (idxs.length < period) return out;
    const k = 2 / (period + 1);
    let seed = 0;
    for (let j = 0; j < period; j++) seed += arr[idxs[j]];
    let prev = seed / period;
    out[idxs[period - 1]] = prev;
    for (let j = period; j < idxs.length; j++) {
      const i = idxs[j];
      prev = arr[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }

  /** Rolling (population) standard deviation. */
  TA.stdev = function (values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      sumSq += values[i] * values[i];
      if (i >= period) {
        sum -= values[i - period];
        sumSq -= values[i - period] * values[i - period];
      }
      if (i >= period - 1) {
        const m = sum / period;
        out[i] = Math.sqrt(Math.max(0, sumSq / period - m * m));
      }
    }
    return out;
  };

  /** Bollinger Bands → { mid, upper, lower }. */
  TA.bollinger = function (closes, period = 20, mult = 2) {
    const mid = TA.sma(closes, period);
    const sd = TA.stdev(closes, period);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
      if (mid[i] == null || sd[i] == null) continue;
      upper[i] = mid[i] + mult * sd[i];
      lower[i] = mid[i] - mult * sd[i];
    }
    return { mid, upper, lower };
  };

  /** MACD → { macd, signal, hist }. */
  TA.macd = function (closes, fast = 12, slow = 26, signalP = 9) {
    const ef = TA.ema(closes, fast);
    const es = TA.ema(closes, slow);
    const macd = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const signal = emaNullable(macd, signalP);
    const hist = macd.map((m, i) => (m != null && signal[i] != null ? m - signal[i] : null));
    return { macd, signal, hist };
  };

  /** Average True Range (Wilder). */
  TA.atr = function (candles, period = 14) {
    const n = candles.length;
    const out = new Array(n).fill(null);
    if (n < period + 1) return out;
    const tr = new Array(n).fill(0);
    tr[0] = candles[0].high - candles[0].low;
    for (let i = 1; i < n; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      const pc = candles[i - 1].close;
      tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += tr[i];
    let prev = sum / period;
    out[period] = prev;
    for (let i = period + 1; i < n; i++) {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
    return out;
  };

  /** ADX with +DI / −DI (Wilder). Returns { adx, plusDI, minusDI }. */
  TA.adx = function (candles, period = 14) {
    const n = candles.length;
    const adx = new Array(n).fill(null);
    const plusDI = new Array(n).fill(null);
    const minusDI = new Array(n).fill(null);
    if (n < 2 * period + 1) return { adx, plusDI, minusDI };
    const tr = new Array(n).fill(0);
    const pDM = new Array(n).fill(0);
    const mDM = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
      const up = candles[i].high - candles[i - 1].high;
      const down = candles[i - 1].low - candles[i].low;
      pDM[i] = up > down && up > 0 ? up : 0;
      mDM[i] = down > up && down > 0 ? down : 0;
      const h = candles[i].high;
      const l = candles[i].low;
      const pc = candles[i - 1].close;
      tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    }
    let trS = 0;
    let pS = 0;
    let mS = 0;
    for (let i = 1; i <= period; i++) {
      trS += tr[i];
      pS += pDM[i];
      mS += mDM[i];
    }
    const dx = new Array(n).fill(null);
    for (let i = period; i < n; i++) {
      if (i > period) {
        trS = trS - trS / period + tr[i];
        pS = pS - pS / period + pDM[i];
        mS = mS - mS / period + mDM[i];
      }
      const pdi = trS ? (100 * pS) / trS : 0;
      const mdi = trS ? (100 * mS) / trS : 0;
      plusDI[i] = pdi;
      minusDI[i] = mdi;
      const denom = pdi + mdi;
      dx[i] = denom ? (100 * Math.abs(pdi - mdi)) / denom : 0;
    }
    const firstAdx = period * 2 - 1;
    if (firstAdx < n) {
      let s = 0;
      let c = 0;
      for (let i = period; i <= firstAdx; i++) {
        if (dx[i] != null) {
          s += dx[i];
          c++;
        }
      }
      let prev = c ? s / c : 0;
      adx[firstAdx] = prev;
      for (let i = firstAdx + 1; i < n; i++) {
        prev = (prev * (period - 1) + dx[i]) / period;
        adx[i] = prev;
      }
    }
    return { adx, plusDI, minusDI };
  };

  /** Session VWAP (resets each calendar day — meaningful for intraday). */
  TA.vwap = function (candles) {
    const out = new Array(candles.length).fill(null);
    let cumPV = 0;
    let cumV = 0;
    let day = null;
    for (let i = 0; i < candles.length; i++) {
      const d = new Date(candles[i].time);
      const key = d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate();
      if (key !== day) {
        day = key;
        cumPV = 0;
        cumV = 0;
      }
      const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
      const v = candles[i].volume || 0;
      cumPV += tp * v;
      cumV += v;
      out[i] = cumV ? cumPV / cumV : candles[i].close;
    }
    return out;
  };

  /** Detect recent RSI/price divergence over the last `bars` candles. */
  TA.divergence = function (candles, rsiArr, lookback = 5, bars = 60) {
    const n = candles.length;
    const { highs, lows } = TA.pivots(candles, lookback);
    const rh = highs.filter((p) => p.i > n - bars).slice(-2);
    const rl = lows.filter((p) => p.i > n - bars).slice(-2);
    let bearish = false;
    let bullish = false;
    let detail = '';
    if (rh.length === 2) {
      const [a, b] = rh;
      if (b.price > a.price && rsiArr[a.i] != null && rsiArr[b.i] != null && rsiArr[b.i] < rsiArr[a.i]) {
        bearish = true;
        detail = 'Price made a higher high while RSI made a lower high — bearish divergence (momentum fading).';
      }
    }
    if (!bearish && rl.length === 2) {
      const [a, b] = rl;
      if (b.price < a.price && rsiArr[a.i] != null && rsiArr[b.i] != null && rsiArr[b.i] > rsiArr[a.i]) {
        bullish = true;
        detail = 'Price made a lower low while RSI made a higher low — bullish divergence (selling exhausting).';
      }
    }
    return { bullish, bearish, detail };
  };

  /**
   * Percentage ZigZag — the significant swing pivots used for wave analysis.
   * Returns alternating [{ i, price, type:'H'|'L' }] (a reversal of >= pct
   * confirms a new pivot). pct e.g. 0.10 = 10%.
   */
  TA.zigzag = function (candles, pct) {
    pct = pct || 0.12;
    const n = candles.length;
    const pivots = [];
    if (n < 3) return pivots;
    let trend = 0; // 0 unknown, 1 up, -1 down
    let minIdx = 0;
    let minP = candles[0].low;
    let maxIdx = 0;
    let maxP = candles[0].high;
    let extIdx = 0;
    let extPrice = candles[0].close;
    for (let i = 1; i < n; i++) {
      const h = candles[i].high;
      const l = candles[i].low;
      if (trend === 0) {
        if (h > maxP) {
          maxP = h;
          maxIdx = i;
        }
        if (l < minP) {
          minP = l;
          minIdx = i;
        }
        if (h >= minP * (1 + pct)) {
          pivots.push({ i: minIdx, price: minP, type: 'L' });
          trend = 1;
          extIdx = i;
          extPrice = h;
        } else if (l <= maxP * (1 - pct)) {
          pivots.push({ i: maxIdx, price: maxP, type: 'H' });
          trend = -1;
          extIdx = i;
          extPrice = l;
        }
      } else if (trend === 1) {
        if (h > extPrice) {
          extPrice = h;
          extIdx = i;
        } else if (l <= extPrice * (1 - pct)) {
          pivots.push({ i: extIdx, price: extPrice, type: 'H' });
          trend = -1;
          extIdx = i;
          extPrice = l;
        }
      } else {
        if (l < extPrice) {
          extPrice = l;
          extIdx = i;
        } else if (h >= extPrice * (1 + pct)) {
          pivots.push({ i: extIdx, price: extPrice, type: 'L' });
          trend = 1;
          extIdx = i;
          extPrice = h;
        }
      }
    }
    if (trend !== 0) pivots.push({ i: extIdx, price: extPrice, type: trend === 1 ? 'H' : 'L' });
    return pivots;
  };

  TA.closes = (candles) => candles.map((c) => c.close);

  window.TA = TA;
})();

'use strict';

/**
 * screener.js — a swing-trade scoring engine that encodes a specific
 * methodology (educational, not advice):
 *
 *   • Primary lens: the 9 & 21 EMAs, then the 20/50/100/200 SMAs.
 *   • Rewards "accommodative" charts with room to run; flags extended ones.
 *   • Treats a low-volume pullback to a rising EMA/support as a CONSTRUCTIVE
 *     setup (don't get shaken out), not a sell.
 *   • Uses relative strength vs the market (SPX/SPY) as a leadership proxy.
 *   • Flags names breaking down below the 50/100/200 as "avoid / exit".
 *   • Does NOT penalise a high PE or an overbought RSI on a strong leader.
 *
 * Pure functions on window.Screener. Weights sum to 100 → score is 0-100.
 */
(function () {
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);

  /** Market context for relative strength: { ret21, ret63 } from SPY closes. */
  function marketContext(spyCandles) {
    if (!spyCandles || spyCandles.length < 64) return { ret21: 0, ret63: 0 };
    const c = spyCandles.map((x) => x.close);
    const n = c.length;
    return { ret21: pct(c[n - 1], c[n - 22]), ret63: pct(c[n - 1], c[n - 64]) };
  }

  function score(candles, market) {
    const ta = window.TA;
    const n = candles ? candles.length : 0;
    if (!ta || n < 60) return null;
    const closes = candles.map((c) => c.close);
    const price = closes[n - 1];
    market = market || { ret21: 0, ret63: 0 };

    const ema9 = ta.ema(closes, 9);
    const ema21 = ta.ema(closes, 21);
    const e9 = ema9[n - 1];
    const e21 = ema21[n - 1];
    const s20 = ta.sma(closes, 20)[n - 1];
    const s50 = ta.sma(closes, 50)[n - 1];
    const s100 = ta.sma(closes, 100)[n - 1];
    const s200 = ta.sma(closes, 200)[n - 1];
    const rsi = ta.rsi(closes, 14)[n - 1];
    const adxObj = ta.adx(candles, 14);
    const adx = adxObj.adx[n - 1];
    const diUp = adxObj.plusDI[n - 1] >= adxObj.minusDI[n - 1];
    const macd = ta.macd(closes);
    const macdBull = macd.macd[n - 1] != null && macd.signal[n - 1] != null && macd.macd[n - 1] > macd.signal[n - 1];

    const bullets = [];
    let pts = 0;
    const push = (txt, good) => bullets.push({ txt, good });

    // 1) EMA 9/21 structure — primary (max 25)
    const e9Rising = e9 != null && e9 > ema9[Math.max(0, n - 6)];
    let ema = 8;
    let emaTxt = 'Mixed around the 9/21 EMAs.';
    if (price > e9 && e9 > e21 && e9Rising) {
      ema = 25;
      emaTxt = 'Price > EMA 9 > EMA 21, both rising — strong short-term uptrend.';
    } else if (price > e21 && e9 >= e21) {
      ema = 18;
      emaTxt = 'Above a rising EMA 9/21 — constructive.';
    } else if (price > e21) {
      ema = 12;
      emaTxt = 'Above EMA 21 but the EMA 9 is soft.';
    } else if (price < e9 && e9 < e21) {
      ema = 2;
      emaTxt = 'Price < EMA 9 < EMA 21 — short-term downtrend.';
    }
    pts += ema;
    push(emaTxt, ema >= 15);

    // 2) SMA stack 20/50/100/200 (max 20)
    let above = 0;
    [s20, s50, s100, s200].forEach((s) => {
      if (s != null && price > s) above++;
    });
    const stacked = s20 != null && s50 != null && s100 != null && s200 != null && s20 > s50 && s50 > s100 && s100 > s200;
    const sma = (above / 4) * 14 + (stacked ? 6 : 0);
    pts += sma;
    push(`Above ${above}/4 key SMAs${stacked ? '; bullishly stacked (20>50>100>200)' : ''}.`, sma >= 12);

    // 3) Relative strength vs market (max 15)
    const ret63 = pct(price, closes[Math.max(0, n - 64)]);
    const ret21 = pct(price, closes[Math.max(0, n - 22)]);
    const rs63 = ret63 - market.ret63;
    const rsScore = rs63 > 10 ? 15 : rs63 > 3 ? 12 : rs63 > -3 ? 8 : rs63 > -10 ? 4 : 1;
    pts += rsScore;
    push(
      `3-mo return ${ret63.toFixed(0)}% vs market ${market.ret63.toFixed(0)}% (RS ${rs63 >= 0 ? '+' : ''}${rs63.toFixed(0)}%) — ${rs63 > 3 ? 'a leader' : rs63 < -3 ? 'a laggard' : 'in-line'}.`,
      rs63 > 3
    );

    // 4) Accommodative chart + constructive pullback (max 15)
    const extPct = e21 ? pct(price, e21) : 0;
    const recentRet = pct(price, closes[Math.max(0, n - 4)]);
    const vols = candles.map((c) => c.volume);
    const avgVol = mean(vols.slice(-20));
    const recentVol = mean(vols.slice(-3));
    const lowVolPull = recentRet < 0 && avgVol > 0 && recentVol < avgVol * 0.95;
    const nearEma = Math.abs(extPct) < 6;
    let acc = 8;
    let accTxt = `Extension ${extPct.toFixed(0)}% from EMA 21 — neutral.`;
    if (price > e21 && extPct < 8) {
      acc = 13;
      accTxt = `Only ${extPct.toFixed(0)}% above EMA 21 — accommodative, room to run.`;
    }
    if (lowVolPull && price > e21 && nearEma) {
      acc = 15;
      accTxt = 'Low-volume pullback to the rising EMA — constructive swing setup (don’t get shaken out).';
    }
    if (extPct > 20) {
      acc = 5;
      accTxt = `Stretched ${extPct.toFixed(0)}% above EMA 21 — extended, less room.`;
    }
    pts += acc;
    push(accTxt, acc >= 12);

    // 5) Trend strength + MACD (max 12)
    let tm = 4;
    if (adx != null) {
      if (adx >= 25 && diUp && macdBull) tm = 12;
      else if (adx >= 20 && diUp) tm = 9;
      else if (adx >= 25 && !diUp) tm = 2;
      else tm = 5;
    }
    pts += tm;
    push(`ADX ${adx != null ? adx.toFixed(0) : '–'} (${diUp ? 'up' : 'down'}), MACD ${macdBull ? 'bullish' : 'bearish'}.`, tm >= 9);

    // 6) Volume / accumulation (max 8)
    let vol = 4;
    if (avgVol > 0) {
      if (recentVol > avgVol * 1.2 && recentRet > 0) vol = 8;
      else if (recentVol > avgVol * 1.2 && recentRet < 0) vol = 2;
    }
    pts += vol;
    push(vol >= 6 ? 'Recent advance on above-average volume — accumulation.' : vol <= 2 ? 'Heavy-volume selling — distribution risk.' : 'Volume near average.', vol >= 6);

    // 7) RSI (max 5) — don't punish strong leaders for being overbought
    let rsiScore = 3;
    if (rsi != null) {
      if (rsi >= 50 && rsi <= 80) rsiScore = 5;
      else if (rsi > 80) rsiScore = 4;
      else if (rsi < 30) rsiScore = 3;
      else rsiScore = 2;
    }
    pts += rsiScore;

    // Breakdown override (his exit rule)
    const breaking = s50 != null && price < s50 && s100 != null && price < s100 && s200 != null && price < s200 && !diUp;
    let scoreOut = Math.round(pts);
    if (breaking) scoreOut = Math.min(scoreOut, 22);

    let setup;
    if (breaking) setup = 'Breaking down — exit';
    else if (extPct > 20) setup = 'Extended';
    else if (lowVolPull && price > e21 && nearEma) setup = 'Constructive pullback';
    else if (price > e9 && e9 > e21 && stacked && above >= 3) setup = 'Trending up';
    else if (price > e21) setup = 'Uptrend';
    else if (adx != null && adx < 20 && Math.abs(extPct) < 6) setup = 'Basing';
    else setup = 'Weak / downtrend';

    return {
      score: Math.max(0, Math.min(100, scoreOut)),
      setup,
      breaking,
      bullets,
      metrics: { price, rs63, ret63, ret21, extPct, adx, rsi, above, stacked, macdBull, chgPct: pct(price, closes[n - 2]) }
    };
  }

  window.Screener = { score, marketContext };
})();

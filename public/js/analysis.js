'use strict';

/**
 * analysis.js — an educational, rules-based technical signal engine.
 *
 * It scores the factors a chart-reader weighs (trend, moving averages,
 * momentum, support/resistance, volume, range position), explains each one in
 * plain English, and combines them into a rating from Strong Sell → Strong Buy.
 * Run it across several timeframes to see where they agree or diverge.
 *
 * This is NOT financial advice or a prediction — it describes what the chart is
 * signalling right now. Exposed on window.Analysis.
 */
(function () {
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  function ratingFor(score) {
    if (score >= 45) return { label: 'Strong Buy', cls: 'sb' };
    if (score >= 18) return { label: 'Bullish', cls: 'b' };
    if (score > -18) return { label: 'Neutral', cls: 'n' };
    if (score > -45) return { label: 'Bearish', cls: 's' };
    return { label: 'Strong Sell', cls: 'ss' };
  }

  /** Analyse a single candle series → { score, rating, factors[] }. */
  function analyze(candles, horizonLabel, opts) {
    opts = opts || {};
    const ta = window.TA;
    const n = candles ? candles.length : 0;
    if (!ta || n < 20) return null;
    const closes = candles.map((c) => c.close);
    const price = closes[n - 1];
    const rsiArr = ta.rsi(closes, 14);
    const factors = [];

    // --- moving averages ---
    const ma50 = ta.sma(closes, 50);
    const ma200 = ta.sma(closes, 200);
    const m50 = ma50[n - 1];
    const m200 = ma200[n - 1];
    if (m50 != null) {
      const above = price > m50;
      const rising = m50 > ma50[Math.max(0, n - 10)];
      factors.push({
        label: 'Price vs 50-period MA',
        state: above && rising ? 'bull' : !above && !rising ? 'bear' : 'neutral',
        weight: 1.4,
        detail: `Price is ${above ? 'above' : 'below'} a ${rising ? 'rising' : 'falling'} 50-period average (${m50.toFixed(2)}).`
      });
    }
    if (m200 != null) {
      const above = price > m200;
      factors.push({
        label: 'Price vs 200-period MA',
        state: above ? 'bull' : 'bear',
        weight: 1.6,
        detail: `Price is ${above ? 'above' : 'below'} the 200-period average (${m200.toFixed(2)}) — ${above ? 'long-term uptrend bias' : 'long-term downtrend bias'}.`
      });
      if (m50 != null) {
        const golden = m50 >= m200;
        factors.push({
          label: '50 / 200 MA cross',
          state: golden ? 'bull' : 'bear',
          weight: 1.2,
          detail: golden
            ? 'Fast average sits above the slow one (golden-cross regime).'
            : 'Fast average sits below the slow one (death-cross regime).'
        });
      }
    }

    // --- trend structure ---
    const t = ta.trend(closes, Math.min(50, Math.max(10, Math.floor(n / 3))));
    factors.push({
      label: 'Trend structure',
      state: t.dir === 'up' ? 'bull' : t.dir === 'down' ? 'bear' : 'neutral',
      weight: 1.5,
      detail:
        t.dir === 'up'
          ? 'Higher highs and higher lows — an uptrend.'
          : t.dir === 'down'
          ? 'Lower highs and lower lows — a downtrend.'
          : 'Sideways / range-bound — no clear trend.'
    });

    // --- momentum (RSI) ---
    const r = rsiArr[n - 1];
    if (r != null) {
      let state = 'neutral';
      let detail = `RSI ${r.toFixed(0)} — neutral momentum.`;
      if (r > 70) {
        state = 'bear';
        detail = `RSI ${r.toFixed(0)} — overbought; momentum stretched, pullback risk.`;
      } else if (r < 30) {
        state = 'bull';
        detail = `RSI ${r.toFixed(0)} — oversold; selling may be exhausted, bounce potential.`;
      } else if (r >= 55) {
        state = 'bull';
        detail = `RSI ${r.toFixed(0)} — firm momentum.`;
      } else if (r <= 45) {
        state = 'bear';
        detail = `RSI ${r.toFixed(0)} — soft momentum.`;
      }
      factors.push({ label: 'Momentum (RSI)', state, weight: 1.0, detail });
    }

    // --- support / resistance ---
    const levels = ta.supportResistance(candles, {
      lookback: Math.max(4, Math.round(n / 40)),
      maxLevels: 8,
      minTouches: 2
    });
    if (levels.length) {
      let nearest = null;
      let nd = Infinity;
      for (const l of levels) {
        const d = Math.abs(price - l.mid) / price;
        if (d < nd) {
          nd = d;
          nearest = l;
        }
      }
      if (nearest && nd < 0.025) {
        const sup = nearest.role === 'support';
        factors.push({
          label: sup ? 'Testing support' : 'Testing resistance',
          state: sup ? 'bull' : 'bear',
          weight: 1.1,
          detail: `Price is at ${nearest.role} near ${nearest.mid.toFixed(2)} (${nearest.touches} touches) — ${sup ? 'a possible bounce zone' : 'a possible rejection zone'}.`
        });
      } else {
        const resAbove = levels.filter((l) => l.mid > price).sort((a, b) => a.mid - b.mid)[0];
        const supBelow = levels.filter((l) => l.mid < price).sort((a, b) => b.mid - a.mid)[0];
        if (resAbove && supBelow) {
          const up = (resAbove.mid - price) / price;
          const down = (price - supBelow.mid) / price;
          factors.push({
            label: 'Level headroom',
            state: up > down * 1.5 ? 'bull' : down > up * 1.5 ? 'bear' : 'neutral',
            weight: 0.7,
            detail: `Nearest resistance ${resAbove.mid.toFixed(2)} (+${(up * 100).toFixed(1)}%), nearest support ${supBelow.mid.toFixed(2)} (−${(down * 100).toFixed(1)}%).`
          });
        }
      }
    }

    // --- volume confirmation ---
    const vols = candles.map((c) => c.volume);
    const avgVol = mean(vols.slice(-20));
    const recentVol = mean(vols.slice(-3));
    const chg = price - closes[n - 2];
    if (avgVol > 0) {
      const surge = recentVol > avgVol * 1.3;
      let state = 'neutral';
      let detail = 'Volume near its average — no strong conviction signal.';
      if (surge && chg > 0) {
        state = 'bull';
        detail = 'Recent gains came on above-average volume — buying conviction.';
      } else if (surge && chg < 0) {
        state = 'bear';
        detail = 'Recent losses came on above-average volume — selling conviction.';
      }
      factors.push({ label: 'Volume', state, weight: 0.8, detail });
    }

    // --- MACD ---
    const macd = ta.macd(closes);
    const ml = macd.macd[n - 1];
    const sg = macd.signal[n - 1];
    const hst = macd.hist[n - 1];
    const hstPrev = macd.hist[n - 2];
    if (ml != null && sg != null) {
      const bull = ml > sg;
      const aboveZero = ml > 0;
      const rising = hst != null && hstPrev != null && hst > hstPrev;
      factors.push({
        label: 'MACD',
        state: bull && aboveZero ? 'bull' : !bull && !aboveZero ? 'bear' : 'neutral',
        weight: 1.2,
        detail: `MACD ${bull ? 'above' : 'below'} its signal line${aboveZero ? ', above zero' : ', below zero'}; histogram ${rising ? 'rising' : 'falling'}.`
      });
    }

    // --- Bollinger Bands (%B) ---
    const bb = ta.bollinger(closes, 20, 2);
    if (bb.upper[n - 1] != null) {
      const width = bb.upper[n - 1] - bb.lower[n - 1] || 1;
      const pb = (price - bb.lower[n - 1]) / width;
      let state = 'neutral';
      let detail = `Mid-band (%B ${Math.round(pb * 100)}%) — neutral volatility position.`;
      if (pb > 1) {
        state = 'bear';
        detail = 'Price above the upper Bollinger band — stretched/overbought, mean-reversion risk.';
      } else if (pb < 0) {
        state = 'bull';
        detail = 'Price below the lower band — stretched down, snap-back potential.';
      }
      factors.push({ label: 'Bollinger %B', state, weight: 0.7, detail });
    }

    // --- ADX (trend strength) ---
    const adxObj = ta.adx(candles, 14);
    const adxV = adxObj.adx[n - 1];
    if (adxV != null) {
      const dirUp = adxObj.plusDI[n - 1] >= adxObj.minusDI[n - 1];
      const strong = adxV >= 25;
      factors.push({
        label: 'Trend strength (ADX)',
        state: strong ? (dirUp ? 'bull' : 'bear') : 'neutral',
        weight: strong ? 1.3 : 0.5,
        detail: strong
          ? `ADX ${adxV.toFixed(0)} — a strong ${dirUp ? 'up' : 'down'}trend (${dirUp ? '+DI > −DI' : '−DI > +DI'}).`
          : `ADX ${adxV.toFixed(0)} — weak/choppy; trend signals are less reliable here.`
      });
    }

    // --- VWAP (intraday only) ---
    if (opts.intraday) {
      const v = ta.vwap(candles)[n - 1];
      if (v != null) {
        const above = price > v;
        factors.push({
          label: 'VWAP',
          state: above ? 'bull' : 'bear',
          weight: 1.0,
          detail: `Price ${above ? 'above' : 'below'} today's VWAP (${v.toFixed(2)}) — intraday ${above ? 'buyers' : 'sellers'} in control.`
        });
      }
    }

    // --- RSI divergence ---
    const div = ta.divergence(candles, rsiArr);
    if (div.bearish || div.bullish) {
      factors.push({ label: 'RSI divergence', state: div.bearish ? 'bear' : 'bull', weight: 1.1, detail: div.detail });
    }

    // --- position within range ---
    const hi = Math.max(...closes);
    const lo = Math.min(...closes);
    const pos = (price - lo) / (hi - lo || 1);
    factors.push({
      label: 'Range position',
      state: pos > 0.8 ? 'bull' : pos < 0.2 ? 'bear' : 'neutral',
      weight: 0.6,
      detail: `Trading at ${Math.round(pos * 100)}% of its ${horizonLabel} range (${lo.toFixed(2)}–${hi.toFixed(2)}).`
    });

    // --- composite ---
    let weighted = 0;
    let total = 0;
    for (const f of factors) {
      const v = f.state === 'bull' ? 1 : f.state === 'bear' ? -1 : 0;
      weighted += v * f.weight;
      total += f.weight;
    }
    const score = total ? Math.round((weighted / total) * 100) : 0;
    return { horizon: horizonLabel, price, bars: n, score, rating: ratingFor(score), factors };
  }

  function alignmentText(o) {
    const present = [o.longTerm, o.swing, o.intraday].filter(Boolean);
    const dirs = present.map((h) => (h.score > 18 ? 1 : h.score < -18 ? -1 : 0));
    if (dirs.length && dirs.every((d) => d > 0)) return 'All timeframes align bullish — trend is up across the board.';
    if (dirs.length && dirs.every((d) => d < 0)) return 'All timeframes align bearish — trend is down across the board.';
    const lt = o.longTerm ? o.longTerm.score : 0;
    const sht = o.intraday ? o.intraday.score : o.swing ? o.swing.score : 0;
    if (lt > 18 && sht < -18) return 'Longer-term uptrend, but short-term pulling back — a possible dip within an uptrend.';
    if (lt < -18 && sht > 18) return 'Longer-term downtrend with a short-term bounce — a possible relief rally, not a reversal yet.';
    return 'Mixed signals across timeframes — no clean alignment, so treat any single signal with caution.';
  }

  /** Combine three horizons (each an array of candles, any may be null). */
  function multiHorizon(sets) {
    const out = {
      longTerm: analyze(sets.longTerm, 'long-term'),
      swing: analyze(sets.swing, 'multi-month'),
      intraday: analyze(sets.intraday, 'intraday', { intraday: true })
    };
    const parts = [];
    if (out.longTerm) parts.push([out.longTerm.score, 1.2]);
    if (out.swing) parts.push([out.swing.score, 1.3]);
    if (out.intraday) parts.push([out.intraday.score, 0.7]);
    let w = 0;
    let s = 0;
    for (const [sc, wt] of parts) {
      w += sc * wt;
      s += wt;
    }
    const overallScore = s ? Math.round(w / s) : 0;
    out.overall = { score: overallScore, rating: ratingFor(overallScore) };
    out.alignment = alignmentText(out);
    return out;
  }

  /**
   * A swing-trader trade plan from the (daily) chart: bias, entry zone, a
   * structure/ATR-based stop, resistance targets and the resulting R:R.
   * Educational — a framework, not a recommendation.
   */
  function tradePlan(candles) {
    const ta = window.TA;
    const n = candles ? candles.length : 0;
    if (!ta || n < 60) return null;
    const closes = candles.map((c) => c.close);
    const price = closes[n - 1];
    const ema9 = ta.ema(closes, 9)[n - 1];
    const ema21 = ta.ema(closes, 21)[n - 1];
    const ema50 = ta.ema(closes, 50)[n - 1];
    const sma200 = ta.sma(closes, 200)[n - 1];
    const atr = ta.atr(candles, 14)[n - 1] || price * 0.02;
    const levels = ta.supportResistance(candles, { lookback: 5, maxLevels: 8, minTouches: 2 });
    const piv = ta.pivots(candles, 4);
    const recentLows = piv.lows.filter((p) => p.i > n - 40);
    const swingLow = recentLows.length ? recentLows[recentLows.length - 1].price : price - 2 * atr;

    const bullish = price > ema21 && ema21 >= ema50;
    const notes = [];
    if (!bullish) {
      return {
        bias: price < ema50 ? 'bearish' : 'neutral',
        ok: false,
        setup: price < (sma200 || 0) ? 'No long setup — below the 200-day; stand aside' : 'No clean long setup — wait for price to reclaim the rising EMAs',
        notes: [
          'Price is not above a rising EMA 9/21/50 stack — an experienced swing trader waits rather than forcing a long.',
          'Re-evaluate if it reclaims the EMA 21 and the ribbon turns up.'
        ]
      };
    }

    const extPct = ((price - ema21) / ema21) * 100;
    let entryLow;
    let entryHigh;
    let setup;
    if (extPct > 8) {
      setup = 'Buy the pullback to the rising EMA ribbon';
      entryLow = Math.min(ema21, ema50);
      entryHigh = ema9;
      notes.push(`Extended ${extPct.toFixed(0)}% above EMA 21 — wait for a pullback into the ${entryLow.toFixed(2)}–${entryHigh.toFixed(2)} ribbon rather than chasing.`);
    } else {
      setup = 'Buy at / near the EMA support zone';
      entryLow = Math.min(ema21, price) * 0.992;
      entryHigh = Math.max(ema9, price) * 1.004;
      notes.push('Price is sitting on the rising EMA ribbon — a constructive entry zone (don’t get shaken out by low-volume dips).');
    }
    const entryMid = (entryLow + entryHigh) / 2;

    // stop: below the more relevant of swing low / EMA 50, ATR-buffered, risk-capped
    let stop = Math.min(swingLow, ema50) - 0.25 * atr;
    if (entryMid - stop > 2.5 * atr) {
      stop = entryMid - 2 * atr;
      notes.push('Structure stop was wide, so the plan caps risk near 2×ATR.');
    }
    if (stop >= entryMid) stop = entryMid - 1.5 * atr;
    const risk = entryMid - stop;

    // a worthwhile first target is at least ~1R above the entry
    const minT1 = entryMid + Math.max(risk, entryMid * 0.01);
    const resAbove = levels.filter((l) => l.mid >= minT1).map((l) => l.mid).sort((a, b) => a - b);
    let t1 = resAbove[0] != null ? resAbove[0] : entryMid + 2 * risk;
    let t2 = resAbove.find((m) => m > t1 * 1.01);
    if (t2 == null) t2 = Math.max(t1 + 1.5 * risk, entryMid + 3 * risk);
    const rr = risk > 0 ? (t1 - entryMid) / risk : 0;
    notes.push(`Stop below structure at ${stop.toFixed(2)} (the recent swing low / EMA 50). Risk ≈ ${risk.toFixed(2)}/share.`);
    notes.push(`Targets at overhead resistance: T1 ${t1.toFixed(2)}, T2 ${t2.toFixed(2)} — first target ≈ ${rr.toFixed(1)}R.`);
    if (rr < 1.5) notes.push('R:R to the first target is below ~1.5 — many swing traders would pass or wait for a better entry.');

    return {
      bias: 'bullish',
      ok: true,
      setup,
      entry: { low: Math.min(entryLow, entryHigh), high: Math.max(entryLow, entryHigh), mid: entryMid },
      stop,
      targets: [t1, t2],
      risk,
      rr,
      atr,
      notes
    };
  }

  window.Analysis = { analyze, multiHorizon, tradePlan, ratingFor };
})();

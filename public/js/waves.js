'use strict';

/**
 * waves.js — a rules-based Elliott Wave auto-counter (BETA, educational).
 *
 * Elliott Wave is inherently subjective: many valid counts exist and it is NOT
 * predictive. This finds the chart's significant swings (ZigZag) and fits the
 * most plausible 5-wave impulse (or A-B-C correction), validating the three
 * hard rules and checking alternation / Fibonacci relationships. One
 * interpretation, not financial advice. Exposed on window.Waves.
 */
(function () {
  function detect(candles, opts) {
    opts = opts || {};
    const ta = window.TA;
    if (!ta || !candles || candles.length < 30) return { found: false, pivots: [], note: 'Need more history (try a higher timeframe) for a wave count.' };
    const pct = opts.pct || (candles.length > 220 ? 0.1 : candles.length > 120 ? 0.085 : 0.07);
    const piv = ta.zigzag(candles, pct);
    if (piv.length < 4) return { found: false, pivots: piv, pct, note: 'Too few significant swings at this sensitivity — Elliott counts read best on weekly/monthly charts.' };
    const lastClose = candles[candles.length - 1].close;
    const imp = tryImpulse(piv, lastClose);
    if (imp) return { found: true, pivots: piv, pct, ...imp };
    const corr = tryCorrection(piv);
    if (corr) return { found: true, pivots: piv, pct, ...corr };
    return { found: false, pivots: piv, pct, note: 'No clean 5-wave or A-B-C structure at this sensitivity. Counts are subjective — try weekly/monthly data.' };
  }

  function score(s, sign) {
    const p = s.map((x) => x.price);
    const w1 = Math.abs(p[1] - p[0]);
    const w3 = Math.abs(p[3] - p[2]);
    const w5 = Math.abs(p[5] - p[4]);
    const r1 = sign > 0 ? p[2] > p[0] : p[2] < p[0]; // W2 retrace < 100% of W1
    const r2 = !(w3 < w1 && w3 < w5); // W3 not the shortest
    const r3 = sign > 0 ? p[4] > p[1] : p[4] < p[1]; // W4 doesn't overlap W1
    const rules = [
      { name: 'W2 retraces < 100% of W1', ok: r1 },
      { name: 'W3 is not the shortest wave', ok: r2 },
      { name: 'W4 does not overlap W1', ok: r3 }
    ];
    return { sign, rules, score: (r1 ? 1 : 0) + (r2 ? 1 : 0) + (r3 ? 1 : 0), w1, w3, w5, p, seg: s };
  }

  function tryImpulse(piv, lastClose) {
    let best = null;
    for (let end = piv.length; end >= 6; end--) {
      const s = piv.slice(end - 6, end);
      const t = s.map((x) => x.type).join('');
      let r = null;
      if (t === 'LHLHLH') r = score(s, 1);
      else if (t === 'HLHLHL') r = score(s, -1);
      if (r && (!best || r.score > best.score || (r.score === best.score && s[5].i > best.seg[5].i))) best = r;
      if (best && best.score === 3) break;
    }
    // Rule 1 (W2 < 100% of W1) is mandatory — a deeper retrace invalidates the
    // wave-1 low entirely; require it plus at least one other rule.
    if (!best || best.score < 2 || !best.rules[0].ok) return null;
    return finishImpulse(best, lastClose);
  }

  function finishImpulse(b, lastClose) {
    const { sign, rules, p, w1, w3, w5, seg } = b;
    const w2retr = Math.abs(p[1] - p[2]) / (w1 || 1);
    const w4retr = Math.abs(p[3] - p[4]) / (w3 || 1);
    const w3ext = w3 / (w1 || 1);
    const longest = w3 >= w1 && w3 >= w5 ? 3 : w1 >= w5 ? 1 : 5;
    const alternation = Math.abs(w2retr - w4retr) > 0.15;
    const dir = sign > 0 ? 'bullish' : 'bearish';
    const labels = ['0', '1', '2', '3', '4', '5'];
    const waves = seg.map((pv, k) => ({ label: labels[k], i: pv.i, price: pv.price, type: pv.type }));
    const whole = Math.abs(p[5] - p[0]);
    const dn = sign > 0;
    // Has price pushed beyond the labelled Wave 5? Then the count is stale — the
    // move is still extending, or this is just a lower-degree structure.
    const extending = sign > 0 ? lastClose > p[5] * 1.02 : lastClose < p[5] * 0.98;
    let targets = [];
    let summary;
    if (extending) {
      summary =
        `A ${dir} 5-wave structure fits these swings, but price has since pushed ${sign > 0 ? 'above' : 'below'} the labelled Wave 5 ` +
        `(now ${lastClose.toFixed(2)} vs Wave 5 at ${p[5].toFixed(2)}). So this is a lower-degree count and the move is likely still ` +
        `extending — switch to a higher timeframe (5Y · weekly or Max · monthly) for the dominant wave structure.`;
    } else {
      targets = [
        { label: 'Wave-A 38.2% retrace', price: dn ? p[5] - 0.382 * whole : p[5] + 0.382 * whole },
        { label: 'Wave-A 61.8% retrace', price: dn ? p[5] - 0.618 * whole : p[5] + 0.618 * whole },
        { label: 'Wave-4 support zone', price: p[4] }
      ];
      summary =
        `Possible ${dir} 5-wave impulse — ${b.score}/3 hard rules satisfied. ` +
        `Wave ${longest} is the extended wave (W3 ≈ ${w3ext.toFixed(2)}× W1). ` +
        `Wave 2 retraced ${(w2retr * 100).toFixed(0)}%, Wave 4 ${(w4retr * 100).toFixed(0)}% — alternation ${alternation ? 'present' : 'weak'}. ` +
        `With Wave 5 in place, a 3-wave (A-B-C) correction is the textbook next move.`;
    }
    return { type: 'impulse', dir, score: b.score, rules, waves, targets, w2retr, w4retr, w3ext, longest, alternation, extending, summary };
  }

  function tryCorrection(piv) {
    for (let end = piv.length; end >= 4; end--) {
      const s = piv.slice(end - 4, end);
      const t = s.map((x) => x.type).join('');
      if (t === 'HLHL' || t === 'LHLH') {
        const down = t === 'HLHL';
        const labels = ['0', 'A', 'B', 'C'];
        const waves = s.map((pv, k) => ({ label: labels[k], i: pv.i, price: pv.price, type: pv.type }));
        const a = Math.abs(s[1].price - s[0].price);
        const c = Math.abs(s[3].price - s[2].price);
        const summary = `Possible A-B-C ${down ? 'corrective decline' : 'corrective rally'} (C ≈ ${(c / (a || 1)).toFixed(2)}× A). Corrections unfold in 3 waves; the larger trend may resume once C completes.`;
        return { type: 'correction', dir: down ? 'down' : 'up', score: 1, rules: [], waves, targets: [], summary };
      }
    }
    return null;
  }

  window.Waves = { detect };
})();

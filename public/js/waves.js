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
    let usePiv = piv;
    let usePct = pct;
    let imp = tryImpulse(piv, lastClose, candles);
    // Steep, barely-subdivided runs (e.g. parabolic movers) may not show 5 clean
    // swings at the default sensitivity — retry once at a finer ZigZag.
    if (!imp) {
      const finer = +(pct * 0.6).toFixed(3);
      const pivF = ta.zigzag(candles, finer);
      const impF = pivF.length >= 6 ? tryImpulse(pivF, lastClose, candles) : null;
      if (impF) {
        imp = impF;
        usePiv = pivF;
        usePct = finer;
      }
    }
    if (imp) return { found: true, pivots: usePiv, pct: usePct, ...imp };
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

  function waveVolumes(seg, candles) {
    const v = [];
    for (let k = 0; k < seg.length - 1; k++) {
      const a = Math.min(seg[k].i, seg[k + 1].i);
      const b = Math.max(seg[k].i, seg[k + 1].i);
      let sum = 0;
      let c = 0;
      for (let i = a; i <= b; i++) {
        sum += (candles[i] && candles[i].volume) || 0;
        c++;
      }
      v.push(c ? sum / c : 0);
    }
    return v;
  }

  function tryImpulse(piv, lastClose, candles) {
    let best = null;
    for (let end = piv.length; end >= 6; end--) {
      const s = piv.slice(end - 6, end);
      const t = s.map((x) => x.type).join('');
      let r = null;
      if (t === 'LHLHLH') r = score(s, 1);
      else if (t === 'HLHLHL') r = score(s, -1);
      // Rule 1 (W2 < 100% of W1) is mandatory.
      if (!r || !r.rules[0].ok) continue;
      // Volume bias toward the textbook signature (Wave 3 carries peak volume).
      const wv = waveVolumes(s, candles);
      const peak = wv.indexOf(Math.max.apply(null, wv));
      r.volBonus = (peak === 2 ? 1 : 0) + (wv[2] > wv[0] && wv[2] > wv[4] ? 0.5 : 0);
      // PRIMARY: the most dominant (largest price span) valid 5-wave wins, so we
      // capture the major move — not a tiny sub-structure. Volume/score/recency
      // only break ties between counts of comparable size.
      r.amp = Math.abs(s[5].price - s[0].price);
      let better = false;
      if (!best) better = true;
      else if (r.amp > best.amp * 1.2) better = true;
      else if (r.amp >= best.amp * 0.8) {
        if (r.score > best.score) better = true;
        else if (r.score === best.score && r.volBonus > best.volBonus) better = true;
        else if (r.score === best.score && r.volBonus === best.volBonus && s[5].i > best.seg[5].i) better = true;
      }
      if (better) best = r;
    }
    if (!best || best.score < 2) return null;
    return finishImpulse(best, lastClose, candles);
  }

  function finishImpulse(b, lastClose, candles) {
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
        `(now ${lastClose.toFixed(2)} vs Wave 5 at ${p[5].toFixed(2)}). So this is a lower-degree sub-count and the move extended past it — ` +
        `the dominant impulse is larger. Zoom out (or you may already be looking at the top degree, with the move still unfolding).`;
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
        `If complete, this whole 5-wave move may itself be Wave 1 of a HIGHER degree — a larger Wave 2 (≈38–62% retrace) would typically follow before the next impulse.`;
    }

    // Volume-by-wave (the Elliott guideline: W3 should carry peak volume; a
    // Wave-5 that prints on lighter volume than W3 is a classic exhaustion signal).
    const wv = waveVolumes(seg, candles); // [W1..W5]
    const maxV = Math.max.apply(null, wv) || 1;
    const peakWave = wv.indexOf(maxV) + 1;
    const w3v = wv[2] || 0;
    const w5v = wv[4] || 0;
    const w5div = w5v > 0 && w3v > 0 && w5v < w3v * 0.9;
    let volNote;
    if (peakWave === 3 && w5div) volNote = `Volume peaked on Wave 3 (textbook), and Wave 5 ran ~${Math.round((1 - w5v / w3v) * 100)}% lighter than Wave 3 — a classic exhaustion divergence near the end of an impulse.`;
    else if (peakWave === 3) volNote = `Volume peaked on Wave 3 (textbook — the strongest wave). Wave 5 volume held up, so a weaker exhaustion signal.`;
    else volNote = `Heaviest volume was in Wave ${peakWave}, not Wave 3 — atypical; a clean impulse usually carries peak volume in Wave 3.`;
    const waveVol = wv.map((v) => v / maxV);

    return { type: 'impulse', dir, score: b.score, rules, waves, targets, w2retr, w4retr, w3ext, longest, alternation, extending, waveVol, peakWave, w5div, volNote, summary };
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

'use strict';

/**
 * lessons.js — the interactive curriculum.
 *
 * Each lesson is a sequence of steps. A step has:
 *   title  — short heading
 *   html   — the explanation shown in the side panel
 *   setup(chart, data, util)   — (optional) configures the live chart so it
 *                                illustrates the concept being taught
 *   exercise                   — (optional) a quiz or click-on-chart task
 *
 * Crucially, setup() derives its annotations from the *real* candles that are
 * loaded, so the lessons stay correct for whatever symbol the user picks.
 *
 * Exposed as window.LESSONS.
 */
(function () {
  const C = {
    ma20: '#46b3ff',
    ma50: '#ffb020',
    ma200: '#e36bf0',
    sup: 'rgba(38,161,123,0.18)',
    supLabel: 'rgba(120,230,190,0.95)',
    res: 'rgba(224,86,106,0.18)',
    resLabel: 'rgba(255,160,170,0.95)',
    note: '#7aa2ff',
    gold: '#ffd166',
    warn: '#e0566a',
    good: '#26a17b'
  };

  // ---- small helpers used by several lessons -------------------------------
  const util = {
    closes: (d) => d.candles.map((c) => c.close),
    last: (d) => d.candles[d.candles.length - 1],
    // pick a recent candle with a clear body AND visible wicks to dissect
    illustrative(d) {
      const cs = d.candles;
      let best = cs.length - 1;
      let bestScore = -1;
      for (let i = Math.max(0, cs.length - 45); i < cs.length; i++) {
        const c = cs[i];
        const range = c.high - c.low;
        if (range <= 0) continue;
        const body = Math.abs(c.close - c.open) / range;
        const upWick = (c.high - Math.max(c.open, c.close)) / range;
        const loWick = (Math.min(c.open, c.close) - c.low) / range;
        // want a moderate body and two visible wicks
        const score = Math.min(upWick, loWick) * 2 + (body > 0.25 && body < 0.7 ? 1 : 0) + range;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      return best;
    },
    recentGreen(d) {
      const cs = d.candles;
      for (let i = cs.length - 1; i >= Math.max(0, cs.length - 30); i--)
        if (cs[i].close > cs[i].open) return i;
      return cs.length - 1;
    },
    recentRed(d) {
      const cs = d.candles;
      for (let i = cs.length - 1; i >= Math.max(0, cs.length - 30); i--)
        if (cs[i].close < cs[i].open) return i;
      return cs.length - 2;
    },
    maxVolIndex(d, from, to) {
      let idx = from;
      let mv = -1;
      for (let i = from; i <= to; i++)
        if (d.candles[i].volume > mv) {
          mv = d.candles[i].volume;
          idx = i;
        }
      return idx;
    }
  };

  // Reset the chart to a clean, sensible default before each step configures it.
  function base(chart, data, opts = {}) {
    chart.clearTeaching();
    chart.setMode(opts.mode || 'candles');
    chart.toggle('volume', opts.volume !== false);
    chart.toggle('rsi', !!opts.rsi);
    if (opts.focusLast) {
      const n = data.candles.length;
      chart.focusRange(Math.max(0, n - opts.focusLast), n - 1, 0.04);
    } else {
      chart.resetView();
    }
  }

  const LESSONS = [
    // ===================================================================== 1
    {
      id: 'basics',
      icon: '🕯️',
      title: 'Reading a Candlestick',
      summary: 'What each candle tells you: open, high, low, close, body & wicks.',
      steps: [
        {
          title: 'A chart is a story of prices',
          html: `<p>Every chart is just a record of <b>what price did over time</b>. The
            x-axis is time (each candle here is one day), the y-axis is price.</p>
            <p>We use <b>candlesticks</b> because a single candle packs in four prices at
            once. Hover anywhere on the chart to see them in the tooltip.</p>
            <p>Let's zoom in and take one candle apart.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 60 });
          }
        },
        {
          title: 'Anatomy of one candle',
          html: `<p>The highlighted candle has four prices:</p>
            <ul>
              <li><b>Open</b> — price at the start of the period</li>
              <li><b>Close</b> — price at the end</li>
              <li><b>High / Low</b> — the most extreme prices reached</li>
            </ul>
            <p>The thick part is the <b>body</b> (open→close). The thin lines are
            <b>wicks</b> (a.k.a. shadows) — they reach up to the high and down to the low.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 14, volume: false });
            const i = util.illustrative(data);
            const c = data.candles[i];
            chart.setAnnotations([
              { index: i, price: c.high, text: 'Upper wick → the HIGH', color: C.note, dx: 54, dy: -28 },
              { index: i, price: Math.max(c.open, c.close), text: c.close >= c.open ? 'Top of body = CLOSE' : 'Top of body = OPEN', color: C.good, dx: 60, dy: 6 },
              { index: i, price: Math.min(c.open, c.close), text: c.close >= c.open ? 'Bottom of body = OPEN' : 'Bottom of body = CLOSE', color: C.warn, dx: -60, dy: 4 },
              { index: i, price: c.low, text: 'Lower wick → the LOW', color: C.note, dx: -54, dy: 30 }
            ]);
            chart.setHighlights([{ from: i, to: i, color: 'rgba(255,255,255,0.06)' }]);
          }
        },
        {
          title: 'Green vs red',
          html: `<p>Colour tells you direction at a glance:</p>
            <ul>
              <li><b style="color:#26a17b">Green / up</b> — close is <b>above</b> the open (price rose)</li>
              <li><b style="color:#e0566a">Red / down</b> — close is <b>below</b> the open (price fell)</li>
            </ul>
            <p>A long body = strong, decisive move. A tiny body with long wicks =
            indecision (buyers and sellers fought to a draw).</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 40 });
            const g = util.recentGreen(data);
            const r = util.recentRed(data);
            chart.setAnnotations([
              { index: g, price: data.candles[g].high, text: 'Green: closed UP', color: C.good, dx: 30, dy: -26 },
              { index: r, price: data.candles[r].low, text: 'Red: closed DOWN', color: C.warn, dx: -30, dy: 26 }
            ]);
          },
          exercise: {
            type: 'quiz',
            prompt: 'A candle is green when…',
            choices: [
              'The close is higher than the open',
              'The close is lower than the open',
              'The high equals the low'
            ],
            answer: 0,
            explain: 'Green means price finished the period above where it started (close > open).'
          }
        }
      ]
    },

    // ===================================================================== 2
    {
      id: 'trends',
      icon: '📈',
      title: 'Trends & Structure',
      summary: 'Up, down or sideways — and how swing highs/lows define a trend.',
      steps: [
        {
          title: 'The trend is your friend',
          html: `<p>Before any indicator, ask one question: <b>which way is price
            generally moving?</b> There are only three answers:</p>
            <ul>
              <li><b style="color:#26a17b">Uptrend</b> — a staircase of <b>higher highs</b> and <b>higher lows</b></li>
              <li><b style="color:#e0566a">Downtrend</b> — <b>lower highs</b> and <b>lower lows</b></li>
              <li><b>Sideways / range</b> — bouncing between roughly flat levels</li>
            </ul>
            <p>The markers below pin the recent <b>swing highs (▼)</b> and
            <b>swing lows (▲)</b> — the pivots that define structure.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 110 });
            const { s, e } = { s: chart.visStart, e: chart.visStart + chart.visCount };
            const piv = window.TA.pivots(data.candles, 4);
            const markers = [];
            piv.highs.filter((p) => p.i >= s && p.i < e).slice(-4).forEach((p) =>
              markers.push({ index: p.i, side: 'above', color: C.warn, text: 'H' })
            );
            piv.lows.filter((p) => p.i >= s && p.i < e).slice(-4).forEach((p) =>
              markers.push({ index: p.i, side: 'below', color: C.good, text: 'L' })
            );
            chart.setMarkers(markers);
            const t = window.TA.trend(util.closes(data), 40);
            const label =
              t.dir === 'up' ? 'Recent structure: UPTREND ↗' :
              t.dir === 'down' ? 'Recent structure: DOWNTREND ↘' :
              'Recent structure: SIDEWAYS / RANGE →';
            chart.setHighlights([{ from: chart.visStart, to: e - 1, color: 'rgba(122,162,255,0.05)', label }]);
          }
        },
        {
          title: 'Why structure matters',
          html: `<p>Trends persist more often than they reverse, so traders try to
            trade <i>with</i> the trend. The structure also tells you when a trend may
            be <b>breaking</b>:</p>
            <ul>
              <li>An uptrend is intact while it keeps making higher lows.</li>
              <li>The first <b>lower low</b> after a series of higher lows is an early
              warning the uptrend may be ending.</li>
            </ul>
            <p>Read the swing markers left-to-right and check: are the ▲ lows climbing
            or falling?</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 110 });
            const piv = window.TA.pivots(data.candles, 4);
            const s = chart.visStart;
            const e = s + chart.visCount;
            const markers = [];
            piv.highs.filter((p) => p.i >= s && p.i < e).forEach((p) =>
              markers.push({ index: p.i, side: 'above', color: C.warn })
            );
            piv.lows.filter((p) => p.i >= s && p.i < e).forEach((p) =>
              markers.push({ index: p.i, side: 'below', color: C.good })
            );
            chart.setMarkers(markers);
          },
          exercise: {
            type: 'quiz',
            prompt: 'A healthy uptrend is best described as…',
            choices: [
              'Lower highs and lower lows',
              'Higher highs and higher lows',
              'A flat line with no swings'
            ],
            answer: 1,
            explain: 'Uptrends climb in a staircase: each push up makes a higher high, each dip a higher low.'
          }
        }
      ]
    },

    // ===================================================================== 3
    {
      id: 'sr',
      icon: '🧱',
      title: 'Support & Resistance',
      summary: 'The price “floors” and “ceilings” where moves tend to stall.',
      steps: [
        {
          title: 'Floors and ceilings',
          html: `<p><b>Support</b> is a price area where falling prices have tended to
            <b>stop and bounce</b> — a floor where buyers step in.
            <b>Resistance</b> is the opposite: a ceiling where rallies have stalled and
            sellers took over.</p>
            <p>The shaded bands below are levels detected from the real chart — places
            price touched <b>more than once</b>. The more touches, the more significant.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 130 });
            const levels = window.TA.supportResistance(data.candles, { lookback: 5, maxLevels: 5, minTouches: 2 });
            levels.forEach((lvl, k) => {
              const isSup = lvl.role === 'support';
              chart.setZone('sr' + k, {
                lo: lvl.lo,
                hi: lvl.hi,
                color: isSup ? C.sup : C.res,
                label: `${isSup ? 'Support' : 'Resistance'} · ${lvl.touches} touches`,
                labelColor: isSup ? C.supLabel : C.resLabel
              });
            });
          }
        },
        {
          title: 'Role reversal',
          html: `<p>Here's the powerful part: once a level <b>breaks</b>, it often
            flips role. Old <b>resistance</b> that price climbs above frequently becomes
            new <b>support</b> on the way back down — and vice-versa.</p>
            <p>This is why traders watch these zones closely: they're decision points
            where a move either continues (breakout) or reverses (rejection).</p>
            <p style="opacity:.8">Tip: think of them as <b>zones</b>, not exact prices.
            Price is messy; a level is a neighbourhood, not a pixel.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 130 });
            const levels = window.TA.supportResistance(data.candles, { lookback: 5, maxLevels: 4, minTouches: 2 });
            levels.forEach((lvl, k) => {
              const isSup = lvl.role === 'support';
              chart.setZone('sr' + k, {
                lo: lvl.lo, hi: lvl.hi,
                color: isSup ? C.sup : C.res,
                label: isSup ? 'Support' : 'Resistance',
                labelColor: isSup ? C.supLabel : C.resLabel
              });
            });
          }
        },
        {
          title: 'Your turn',
          html: `<p><b>Click on the chart</b> at a price where you think there's a
            support or resistance level — somewhere price has reacted more than once.</p>
            <p>I'll check it against the levels detected from the data.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 130 });
          },
          exercise: {
            type: 'click',
            prompt: 'Click a price level where the chart shows support or resistance.',
            check(payload, data) {
              const levels = window.TA.supportResistance(data.candles, { lookback: 5, maxLevels: 6, minTouches: 2 });
              if (!levels.length) return { ok: true, message: 'Good eye — keep practising on other charts!' };
              let best = null;
              let bestDist = Infinity;
              for (const lvl of levels) {
                const d = Math.abs(payload.price - lvl.mid) / lvl.mid;
                if (d < bestDist) {
                  bestDist = d;
                  best = lvl;
                }
              }
              const within = bestDist <= 0.02; // within 2%
              return {
                ok: within,
                level: best,
                message: within
                  ? `✅ Nice — that's right on a ${best.role} zone near ${best.mid.toFixed(2)} ` +
                    `(${best.touches} touches).`
                  : `Close! The nearest detected level is a ${best.role} zone around ` +
                    `${best.mid.toFixed(2)}. Look for prices that were touched repeatedly.`
              };
            }
          }
        }
      ]
    },

    // ===================================================================== 4
    {
      id: 'ma',
      icon: '➰',
      title: 'Moving Averages',
      summary: 'Smoothing the noise — trend direction, crossovers & dynamic support.',
      steps: [
        {
          title: 'Smoothing the noise',
          html: `<p>A <b>moving average (MA)</b> plots the average closing price over the
            last N periods, sliding forward each day. It strips out daily noise so the
            underlying trend is obvious.</p>
            <p>Below: <b style="color:#46b3ff">SMA&nbsp;20</b> (fast, ~1 month) and
            <b style="color:#ffb020">SMA&nbsp;50</b> (slower, ~2.5 months).</p>
            <ul>
              <li>Price <b>above</b> a rising MA → bullish bias</li>
              <li>Price <b>below</b> a falling MA → bearish bias</li>
              <li>A <b>shorter</b> MA hugs price; a <b>longer</b> MA is smoother &amp; laggier</li>
            </ul>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 130 });
            const closes = util.closes(data);
            chart.setOverlay('ma20', { data: window.TA.sma(closes, 20), color: C.ma20, label: 'SMA 20', width: 1.8 });
            chart.setOverlay('ma50', { data: window.TA.sma(closes, 50), color: C.ma50, label: 'SMA 50', width: 1.8 });
          }
        },
        {
          title: 'SMA vs EMA',
          html: `<p>Two common flavours:</p>
            <ul>
              <li><b>SMA</b> (simple) weights every day equally.</li>
              <li><b>EMA</b> (exponential) weights <b>recent</b> days more, so it turns
              faster and reacts sooner to new moves.</li>
            </ul>
            <p>The dashed line is the <b style="color:#46b3ff">EMA&nbsp;20</b> over the
            solid <b style="color:#ffb020">SMA&nbsp;20</b> — notice the EMA reacts a touch
            quicker at turns. Neither is “better”; faster = more signals but more noise.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 110 });
            const closes = util.closes(data);
            chart.setOverlay('sma20', { data: window.TA.sma(closes, 20), color: C.ma50, label: 'SMA 20', width: 1.8 });
            chart.setOverlay('ema20', { data: window.TA.ema(closes, 20), color: C.ma20, label: 'EMA 20', width: 1.8, dash: [5, 4] });
          }
        },
        {
          title: 'Crossovers: golden & death',
          html: `<p>When a faster MA crosses a slower one, momentum may be shifting:</p>
            <ul>
              <li><b style="color:#26a17b">Golden cross</b> — fast crosses <b>above</b>
              slow → bullish signal</li>
              <li><b style="color:#e0566a">Death cross</b> — fast crosses <b>below</b>
              slow → bearish signal</li>
            </ul>
            <p>The markers show where SMA&nbsp;20 crossed SMA&nbsp;50 on this chart. MAs
            <b>lag</b> (they're built from past prices), so treat crossovers as
            confirmation, not a crystal ball.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 150 });
            const closes = util.closes(data);
            const f = window.TA.sma(closes, 20);
            const sl = window.TA.sma(closes, 50);
            chart.setOverlay('ma20', { data: f, color: C.ma20, label: 'SMA 20', width: 1.8 });
            chart.setOverlay('ma50', { data: sl, color: C.ma50, label: 'SMA 50', width: 1.8 });
            const crosses = window.TA.crossovers(f, sl);
            const s = chart.visStart;
            const e = s + chart.visCount;
            const markers = crosses
              .filter((c) => c.i >= s && c.i < e)
              .map((c) => ({
                index: c.i,
                side: c.type === 'golden' ? 'below' : 'above',
                color: c.type === 'golden' ? C.good : C.warn,
                text: c.type === 'golden' ? 'Golden' : 'Death'
              }));
            chart.setMarkers(markers);
            const lastCross = crosses[crosses.length - 1];
            if (lastCross) {
              chart.setAnnotations([
                {
                  index: lastCross.i,
                  price: data.candles[lastCross.i].close,
                  text: (lastCross.type === 'golden' ? 'Most recent: golden cross' : 'Most recent: death cross'),
                  color: lastCross.type === 'golden' ? C.good : C.warn,
                  dx: -70,
                  dy: lastCross.type === 'golden' ? 40 : -40
                }
              ]);
            }
          },
          exercise: {
            type: 'quiz',
            prompt: 'A “golden cross” is generally read as…',
            choices: [
              'A bearish signal (fast MA crosses below slow MA)',
              'A bullish signal (fast MA crosses above slow MA)',
              'A guarantee the price will go up'
            ],
            answer: 1,
            explain: 'Golden cross = faster MA crossing above the slower one, a bullish momentum signal (not a guarantee!).'
          }
        },
        {
          title: 'MAs as dynamic support/resistance',
          html: `<p>In a strong trend, price often <b>pulls back to a moving average and
            bounces</b> — the MA acts like support (in an uptrend) or resistance (in a
            downtrend) that <i>moves with price</i>.</p>
            <p>The 50- and 200-day MAs are the ones big institutions watch most, so they
            can become self-fulfilling. Watch how price interacts with the
            <b style="color:#ffb020">SMA&nbsp;50</b> below.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 150 });
            const closes = util.closes(data);
            chart.setOverlay('ma50', { data: window.TA.sma(closes, 50), color: C.ma50, label: 'SMA 50', width: 2 });
            if (closes.length > 200)
              chart.setOverlay('ma200', { data: window.TA.sma(closes, 200), color: C.ma200, label: 'SMA 200', width: 2 });
          }
        }
      ]
    },

    // ===================================================================== 5
    {
      id: 'volume',
      icon: '📊',
      title: 'Volume',
      summary: 'The fuel gauge — does conviction back the price move?',
      steps: [
        {
          title: 'Volume = conviction',
          html: `<p>The bars at the bottom are <b>volume</b>: how many shares traded each
            period. Volume is the <b>fuel</b> behind a move.</p>
            <ul>
              <li>A breakout on <b>high</b> volume is more trustworthy — lots of
              participants agree.</li>
              <li>A move on <b>low</b> volume can be a head-fake that fizzles.</li>
              <li><b>Volume spikes</b> often mark climaxes, news, or turning points.</li>
            </ul>
            <p>The highlighted bar is the biggest volume day in view.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 110, volume: true });
            const s = chart.visStart;
            const e = s + chart.visCount - 1;
            const vi = util.maxVolIndex(data, s, e);
            chart.setHighlights([{ from: vi, to: vi, color: 'rgba(255,209,102,0.12)' }]);
            chart.setAnnotations([
              { index: vi, price: data.candles[vi].high, text: 'Volume spike →\nconviction behind the move', color: C.gold, dx: 40, dy: -34 }
            ]);
          },
          exercise: {
            type: 'quiz',
            prompt: 'A breakout above resistance is more convincing when it happens on…',
            choices: ['Low volume', 'High volume', 'No volume'],
            answer: 1,
            explain: 'High volume means many participants back the move, making the breakout more reliable.'
          }
        }
      ]
    },

    // ===================================================================== 6
    {
      id: 'rsi',
      icon: '⚡',
      title: 'Momentum (RSI)',
      summary: 'Is the move overstretched? Reading the Relative Strength Index.',
      steps: [
        {
          title: 'Overbought & oversold',
          html: `<p>The <b>RSI</b> (Relative Strength Index) panel below oscillates
            between 0 and 100 and measures momentum:</p>
            <ul>
              <li>Above <b>70</b> → <b style="color:#e0566a">overbought</b> (move may be
              overstretched, due a pause/pullback)</li>
              <li>Below <b>30</b> → <b style="color:#26a17b">oversold</b> (selling may be
              exhausted, due a bounce)</li>
              <li>Around <b>50</b> → neutral momentum</li>
            </ul>
            <p>Important: in a <b>strong trend</b>, RSI can stay overbought/oversold for a
            long time. “Overbought” is not an automatic “sell”.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 130, rsi: true });
            const rsi = window.TA.rsi(util.closes(data), 14);
            const s = chart.visStart;
            const e = s + chart.visCount;
            let ob = -1;
            let os = -1;
            for (let i = e - 1; i >= s; i--) {
              if (ob < 0 && rsi[i] != null && rsi[i] > 70) ob = i;
              if (os < 0 && rsi[i] != null && rsi[i] < 30) os = i;
            }
            const ann = [];
            if (ob >= 0) ann.push({ index: ob, price: data.candles[ob].high, text: 'RSI > 70 here:\noverbought', color: C.warn, dx: -60, dy: -28 });
            if (os >= 0) ann.push({ index: os, price: data.candles[os].low, text: 'RSI < 30 here:\noversold', color: C.good, dx: 50, dy: 28 });
            chart.setAnnotations(ann);
          }
        },
        {
          title: 'Divergence (bonus)',
          html: `<p>A subtle, powerful signal: <b>divergence</b>. When price makes a
            <b>higher high</b> but RSI makes a <b>lower high</b>, momentum is fading even
            though price rose — a possible reversal warning (and vice-versa at bottoms).</p>
            <p>Compare the slope of the price swings with the slope of the RSI peaks
            below. They should usually agree; when they disagree, pay attention.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 130, rsi: true });
          },
          exercise: {
            type: 'quiz',
            prompt: 'An RSI reading of 78 suggests the asset is…',
            choices: ['Oversold', 'Neutral', 'Overbought'],
            answer: 2,
            explain: 'Above 70 is the overbought zone — momentum is stretched, though strong trends can stay there a while.'
          }
        }
      ]
    },

    // ===================================================================== 7
    {
      id: 'together',
      icon: '🎯',
      title: 'Putting It Together',
      summary: 'Combine the tools, then test yourself on the live chart.',
      steps: [
        {
          title: 'Confluence beats any single signal',
          html: `<p>No indicator works alone. Skilled chart reading is about
            <b>confluence</b> — several clues pointing the same way:</p>
            <ul>
              <li>Trend direction (structure + MAs)</li>
              <li>Price reacting at a <b>support/resistance</b> zone</li>
              <li><b>Volume</b> confirming the move</li>
              <li><b>RSI</b> not screaming overbought/oversold against you</li>
            </ul>
            <p>The chart now shows everything together. Take a moment to read it
            top-down: trend → level → trigger.</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 150, volume: true, rsi: true });
            const closes = util.closes(data);
            chart.setOverlay('ma20', { data: window.TA.sma(closes, 20), color: C.ma20, label: 'SMA 20' });
            chart.setOverlay('ma50', { data: window.TA.sma(closes, 50), color: C.ma50, label: 'SMA 50' });
            const levels = window.TA.supportResistance(data.candles, { lookback: 5, maxLevels: 3, minTouches: 2 });
            levels.forEach((lvl, k) => {
              const isSup = lvl.role === 'support';
              chart.setZone('sr' + k, { lo: lvl.lo, hi: lvl.hi, color: isSup ? C.sup : C.res, label: isSup ? 'Support' : 'Resistance', labelColor: isSup ? C.supLabel : C.resLabel });
            });
          }
        },
        {
          title: 'Final check',
          html: `<p>Use the live chart on the left to answer. Switch symbols any time
            with the box at the top — every lesson re-derives itself from real data, so
            keep exploring after you finish!</p>`,
          setup(chart, data) {
            base(chart, data, { focusLast: 150, volume: true, rsi: true });
            const closes = util.closes(data);
            chart.setOverlay('ma50', { data: window.TA.sma(closes, 50), color: C.ma50, label: 'SMA 50' });
          },
          exercise: {
            type: 'quiz',
            prompt: 'You see a breakout above a well-tested resistance zone on heavy volume, price above a rising 50-day MA. This is generally…',
            choices: [
              'A bearish setup — expect a fall',
              'A bullish confluence — trend, level and volume agree',
              'Meaningless without RSI at exactly 50'
            ],
            answer: 1,
            explain: 'Trend up + resistance broken + volume confirming = bullish confluence. No setup is certain, but the clues align.'
          }
        }
      ]
    }
  ];

  window.LESSONS = LESSONS;
})();

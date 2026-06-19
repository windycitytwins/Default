'use strict';

/**
 * app.js — wires the chart, the data layer and the lesson curriculum into the
 * interactive tutor UI: symbol loading, lesson/step navigation, quizzes,
 * click-on-chart exercises and a free "Explore" sandbox.
 */
(function () {
  const LS_KEY = 'chartSchool.v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };

  const state = {
    data: null,
    symbol: 'AAPL',
    range: '1y',
    interval: '1d',
    adjusted: false,
    lessonIdx: 0,
    stepIdx: 0,
    view: 'explore',
    sbCollapsed: true, // chart-dominant by default (analysis panel hidden)
    explore: { mode: 'candles', emaband: true, ema9: false, ema21: false, ema50: true, ma20: true, ma50: true, ma100: true, ma200: true, fibema: false, bb: false, vwap: false, volprofile: false, volume: true, rsi: false, macd: false, sr: false, fib: false, log: false, ew: false, ewPct: null }
  };

  let chart;
  const C = { ma20: '#46b3ff', ma50: '#ffb020', ma200: '#e36bf0', ema: '#5be0c0' };
  const DEFAULT_WATCHLIST = ['NVDA', 'AAPL', 'MSFT', 'META', 'AMZN', 'GOOGL', 'AMD', 'AVGO', 'TSLA', 'NFLX', 'PLTR', 'COIN', 'MSTR', 'SMCI', 'CRM', 'UBER', 'CIFR', 'QQQ', 'SPY'];
  state.watchlist = DEFAULT_WATCHLIST.slice();

  // ---- persistence ---------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ symbol: state.symbol, lessonIdx: state.lessonIdx, stepIdx: state.stepIdx, view: state.view, sbCollapsed: state.sbCollapsed, watchlist: state.watchlist })
      );
    } catch (_) {}
  }
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (s.symbol) state.symbol = s.symbol;
      if (Number.isInteger(s.lessonIdx)) state.lessonIdx = s.lessonIdx;
      if (Number.isInteger(s.stepIdx)) state.stepIdx = s.stepIdx;
      if (s.view) state.view = s.view;
      // chart-dominant unless the user explicitly opened the panel before
      state.sbCollapsed = s.sbCollapsed !== false;
      if (state.sbCollapsed) state.view = 'explore';
      if (Array.isArray(s.watchlist) && s.watchlist.length) state.watchlist = s.watchlist;
    } catch (_) {}
  }

  // Manual drawings persist per ticker (anchored by timestamp, so they survive
  // timeframe changes and live updates).
  const DRAW_KEY = 'chartSchool.draw.v1';
  function loadDrawingStore() {
    try {
      return JSON.parse(localStorage.getItem(DRAW_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }
  function drawingsFor(sym) {
    return loadDrawingStore()[sym] || [];
  }
  function saveDrawingsFor(sym, arr) {
    const store = loadDrawingStore();
    if (arr && arr.length) store[sym] = arr;
    else delete store[sym];
    try {
      localStorage.setItem(DRAW_KEY, JSON.stringify(store));
    } catch (_) {}
  }

  // ---- data ----------------------------------------------------------------
  function renderCurrentView() {
    if (state.view === 'lessons') renderStep();
    else if (state.view === 'signals') prepSignals();
    else if (state.view === 'screener') renderWatchlist();
    else if (state.view === 'research') renderResearch();
    else if (state.view === 'markets') prepMarkets();
    else applyExplore();
  }

  async function loadSymbol(sym) {
    state.symbol = (sym || state.symbol).toUpperCase().trim();
    $('#symbolInput').value = state.symbol;
    // Opened as a standalone file (no server) → honest sample data + banner.
    if (location.protocol === 'file:') {
      useSampleData();
      save();
      return;
    }
    hideError();
    setStatus('Loading ' + state.symbol + '…', 'muted');
    try {
      const data = await window.MarketData.load(state.symbol, state.range, state.interval, {
        adjusted: state.adjusted
      });
      state.data = data;
      chart.setData(data);
      chart.loadDrawings(drawingsFor(state.symbol));
      renderHeader();
      markUpdated(data);
      updateWatchActive();
      // Always show the EMA/SMA suite on the trading chart (lessons set their own).
      if (state.view !== 'lessons') applyExplore(true);
      renderCurrentView();
    } catch (err) {
      showError(err);
    }
    save();
  }

  // Explicit, clearly-labelled sample data — only when the user opts in.
  function useSampleData() {
    hideError();
    const data = window.MarketData.loadDemo(state.symbol, state.range, state.interval);
    state.data = data;
    chart.setData(data);
    renderHeader();
    markUpdated(data);
    updateWatchActive();
    if (state.view !== 'lessons') applyExplore(true);
    renderCurrentView();
  }

  function showError(err) {
    const ov = $('#chartError');
    const isNoServer = err && err.kind === 'no_server';
    $('#errTitle').textContent = isNoServer ? 'Local data server not reachable' : 'Couldn’t load real data for ' + state.symbol;
    $('#errMsg').textContent = err && err.message ? err.message : 'Unknown error.';
    const det = $('#errDetail');
    if (err && err.detail && err.detail.length) {
      det.textContent = err.detail.join('  •  ');
      det.style.display = 'block';
    } else det.style.display = 'none';
    ov.classList.add('show');
    setStatus('No data — real feed unavailable', 'warn');
    $('#liveDot').style.display = 'none';
    $('#liveText').textContent = '';
  }
  function hideError() {
    $('#chartError').classList.remove('show');
  }

  function renderHeader() {
    const d = state.data;
    if (!d) return;
    const last = d.candles[d.candles.length - 1];
    const prev = d.candles[d.candles.length - 2] || last;
    // For intraday data the last bar IS the live price. For daily data the last
    // bar is a completed (often prior-day) close, so prefer the live quote.
    const intraday = /(m|h)$/.test(d.interval || state.interval || '');
    const haveLive = typeof d.regularMarketPrice === 'number' && isFinite(d.regularMarketPrice);
    const price = !intraday && haveLive ? d.regularMarketPrice : last.close;
    const prevRef =
      typeof d.previousClose === 'number' && isFinite(d.previousClose) ? d.previousClose : prev.close;
    const chg = price - prevRef;
    const pct = prevRef ? (chg / prevRef) * 100 : 0;
    const up = chg >= 0;
    $('#hdrSymbol').textContent = d.symbol;
    $('#hdrName').textContent = d.name || d.exchange || '';
    $('#hdrPrice').textContent = price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const chgEl = $('#hdrChange');
    chgEl.textContent = `${up ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)} (${up ? '+' : ''}${pct.toFixed(2)}%)`;
    chgEl.className = 'hdr-change ' + (up ? 'pos' : 'neg');

    // mark the live price on the chart (daily views only; intraday ends live)
    chart.setLivePrice(!intraday && haveLive ? d.regularMarketPrice : null);

    let label = `Source: ${d.source}`;
    let tone = d.synthetic ? 'warn' : 'good';
    if (d.note) label += ' · ' + d.note;
    setStatus(label, tone);
  }

  function setStatus(text, tone) {
    const s = $('#dataStatus');
    s.textContent = text;
    s.className = 'data-status ' + (tone || 'muted');
  }
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2400);
  }
  // Copy the chart (with any Elliott Wave / indicator overlays) to the clipboard,
  // falling back to a PNG download where clipboard image-write isn't available.
  async function exportChart() {
    const blob = await chart.toPNG();
    if (!blob) {
      toast('Couldn’t capture the chart');
      return;
    }
    const fname = `${state.symbol}_${state.range}_${new Date().toISOString().slice(0, 10)}.png`;
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('📋 Chart copied — paste it anywhere');
        return;
      } catch (_) {
        /* clipboard blocked → download instead */
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('⬇ Chart image downloaded');
  }

  // Export the loaded candles (OHLCV) as a CSV file — handy for spreadsheets.
  function exportCsv() {
    const d = state.data;
    if (!d || !d.candles || !d.candles.length) {
      toast('No data to export yet');
      return;
    }
    const rows = ['Date,Open,High,Low,Close,Volume'];
    for (const c of d.candles) {
      const dt = new Date(c.time || c.t || 0);
      const stamp = isFinite(dt.getTime()) ? dt.toISOString().slice(0, /(m|h)$/.test(d.interval || '') ? 16 : 10).replace('T', ' ') : '';
      rows.push([stamp, c.open, c.high, c.low, c.close, c.volume || 0].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.symbol || state.symbol}_${state.range}_${state.interval}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`⬇ ${d.candles.length} rows exported to CSV`);
  }

  // ---- live polling --------------------------------------------------------
  let refreshing = false;
  function markUpdated(data) {
    const banner = $('#sampleBanner');
    if (banner) banner.style.display = data.synthetic ? 'flex' : 'none';
    const dot = $('#liveDot');
    const txt = $('#liveText');
    if (data.synthetic) {
      dot.style.display = 'none';
      txt.textContent = '';
      return;
    }
    const now = new Date().toLocaleTimeString();
    const lastBar = data.candles[data.candles.length - 1];
    const asOf = lastBar ? new Date(lastBar.time).toLocaleDateString() : '';
    dot.style.display = 'inline-block';
    const st = data.marketState;
    // honest labelling — only call it LIVE when the market is actually open
    if (st === 'REGULAR') {
      dot.classList.remove('idle');
      txt.textContent = `LIVE · updated ${now}`;
    } else if (st === 'PRE') {
      dot.classList.add('idle');
      txt.textContent = `Pre-market · ${now}`;
    } else if (st === 'POST') {
      dot.classList.add('idle');
      txt.textContent = `After-hours · ${now}`;
    } else if (st === 'CLOSED') {
      dot.classList.add('idle');
      txt.textContent = `Market closed · last close ${asOf}`;
    } else {
      dot.classList.remove('idle');
      txt.textContent = `Updated ${now}`;
    }
  }
  function flashPrice(prev, next) {
    if (next === prev) return;
    const e = $('#hdrPrice');
    e.classList.remove('flash-up', 'flash-down');
    void e.offsetWidth; // restart the CSS animation
    e.classList.add(next > prev ? 'flash-up' : 'flash-down');
  }
  async function refreshLive() {
    // never poll over sample data or while an error is shown
    if (refreshing || document.hidden || !state.data || state.data.synthetic) return;
    // only intraday views tick meaningfully — don't hammer providers for daily+
    if (!/(m|h)$/.test(state.interval)) return;
    refreshing = true;
    const sym = state.symbol;
    try {
      // load() throws on any failure, so a transient hiccup keeps the last good frame
      const data = await window.MarketData.load(state.symbol, state.range, state.interval, { adjusted: state.adjusted });
      if (sym !== state.symbol) return; // user switched symbols mid-fetch
      const prevClose = state.data.candles[state.data.candles.length - 1].close;
      state.data = data;
      chart.updateData(data); // preserves zoom/pan, follows the latest bar if at the edge
      // recompute Explore overlays against fresh data; lessons keep their
      // (index-stable) annotations as-is to avoid flicker while reading
      if (state.view === 'explore') applyExplore(true);
      renderHeader();
      markUpdated(data);
      flashPrice(prevClose, data.candles[data.candles.length - 1].close);
    } catch (_) {
      // keep last good data; do nothing
    } finally {
      refreshing = false;
    }
  }

  // Lightweight live-price refresh for daily/weekly views (no full re-fetch).
  async function refreshQuote() {
    if (document.hidden || !state.data || state.data.synthetic) return;
    const sym = state.symbol;
    try {
      const q = await window.MarketData.quote(sym);
      if (sym !== state.symbol) return;
      if (q.symbol && q.symbol.toUpperCase() !== sym) return;
      const prevShown =
        typeof state.data.regularMarketPrice === 'number'
          ? state.data.regularMarketPrice
          : state.data.candles[state.data.candles.length - 1].close;
      state.data.regularMarketPrice = q.price;
      if (q.previousClose != null) state.data.previousClose = q.previousClose;
      if (q.marketState) state.data.marketState = q.marketState;
      renderHeader();
      markUpdated(state.data);
      flashPrice(prevShown, q.price);
    } catch (_) {
      /* keep last good price */
    }
  }

  // ---- lesson navigation ---------------------------------------------------
  function flatSteps() {
    const out = [];
    window.LESSONS.forEach((lesson, li) =>
      lesson.steps.forEach((step, si) => out.push({ li, si, lesson, step }))
    );
    return out;
  }
  function globalIndex() {
    let g = 0;
    for (let li = 0; li < state.lessonIdx; li++) g += window.LESSONS[li].steps.length;
    return g + state.stepIdx;
  }

  function renderLessonList() {
    const list = $('#lessonList');
    list.innerHTML = '';
    window.LESSONS.forEach((lesson, li) => {
      const item = el('button', 'lesson-item' + (li === state.lessonIdx ? ' active' : ''));
      item.innerHTML = `<span class="li-icon">${lesson.icon}</span>
        <span class="li-text"><span class="li-title">${lesson.title}</span>
        <span class="li-sum">${lesson.summary}</span></span>`;
      item.addEventListener('click', () => {
        state.view = 'lessons';
        syncTabs();
        state.lessonIdx = li;
        state.stepIdx = 0;
        renderStep();
        save();
      });
      list.appendChild(item);
    });
  }

  function renderStep() {
    if (state.view !== 'lessons') return;
    const lesson = window.LESSONS[state.lessonIdx];
    const step = lesson.steps[state.stepIdx];
    renderLessonList();

    $('#stepLessonTitle').innerHTML = `${lesson.icon} ${lesson.title}`;
    $('#stepTitle').textContent = step.title;
    $('#stepBody').innerHTML = step.html;

    // configure the live chart for this step
    if (state.data && step.setup) {
      try {
        chart.enableClickToMark(false);
        step.setup(chart, state.data, {});
      } catch (e) {
        console.error('step setup failed', e);
      }
    }

    renderExercise(step);

    // progress + nav
    const steps = flatSteps();
    const g = globalIndex();
    $('#progressFill').style.width = ((g + 1) / steps.length) * 100 + '%';
    $('#progressText').textContent = `Step ${g + 1} of ${steps.length}`;
    $('#stepCount').textContent = `${state.stepIdx + 1}/${lesson.steps.length}`;
    $('#prevBtn').disabled = g === 0;
    $('#nextBtn').textContent = g === steps.length - 1 ? 'Finish ✓' : 'Next →';
    save();
  }

  function renderExercise(step) {
    const box = $('#exerciseBox');
    box.innerHTML = '';
    chart.enableClickToMark(false);
    // drop any click handler left over from a previous exercise step
    if (state._clickHandler) {
      chart.off('click', state._clickHandler);
      state._clickHandler = null;
    }
    if (!step.exercise) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    const ex = step.exercise;

    if (ex.type === 'quiz') {
      box.appendChild(el('div', 'ex-tag', '✦ Quick check'));
      box.appendChild(el('div', 'ex-prompt', ex.prompt));
      const choices = el('div', 'ex-choices');
      let done = false;
      ex.choices.forEach((choice, i) => {
        const b = el('button', 'ex-choice', choice);
        b.addEventListener('click', () => {
          if (done) return;
          done = true;
          const correct = i === ex.answer;
          Array.from(choices.children).forEach((c, ci) => {
            c.classList.add('locked');
            if (ci === ex.answer) c.classList.add('correct');
            if (ci === i && !correct) c.classList.add('wrong');
          });
          const fb = el('div', 'ex-feedback ' + (correct ? 'ok' : 'no'),
            (correct ? '✅ Correct. ' : '❌ Not quite. ') + ex.explain);
          box.appendChild(fb);
        });
        choices.appendChild(b);
      });
      box.appendChild(choices);
    }

    if (ex.type === 'click') {
      box.appendChild(el('div', 'ex-tag', '✦ Your turn'));
      box.appendChild(el('div', 'ex-prompt', ex.prompt));
      const fb = el('div', 'ex-feedback muted', 'Click anywhere on the chart…');
      box.appendChild(fb);
      chart.enableClickToMark(true);
      const handler = (payload) => {
        const res = ex.check(payload, state.data);
        fb.className = 'ex-feedback ' + (res.ok ? 'ok' : 'no');
        fb.textContent = res.message;
        // draw what they clicked + the nearest real level
        chart.setHLine('userMark', { price: payload.price, color: res.ok ? '#26a17b' : '#7aa2ff', label: 'you', dash: [4, 3] });
        if (res.level)
          chart.setZone('answerZone', {
            lo: res.level.lo, hi: res.level.hi,
            color: res.level.role === 'support' ? 'rgba(38,161,123,0.22)' : 'rgba(224,86,106,0.22)',
            label: res.level.role, labelColor: '#fff'
          });
      };
      state._clickHandler = handler;
      chart.on('click', handler);
    }
  }

  function go(delta) {
    const steps = flatSteps();
    let g = globalIndex() + delta;
    g = Math.max(0, Math.min(steps.length - 1, g));
    const target = steps[g];
    state.lessonIdx = target.li;
    state.stepIdx = target.si;
    renderStep();
  }

  // ---- explore sandbox -----------------------------------------------------
  function applyExplore(keepView) {
    if (!state.data) return;
    const ex = state.explore;
    const ta = window.TA;
    chart.clearTeaching();
    chart.setMode(ex.mode);
    chart.toggle('volume', ex.volume);
    chart.toggle('rsi', ex.rsi);
    chart.toggle('macd', ex.macd);
    chart.toggle('volProfile', ex.volprofile);
    chart.setLogScale(ex.log);
    if (!keepView) chart.resetView();
    const candles = state.data.candles;
    const closes = candles.map((c) => c.close);
    // EMA 9/21 trend-coloured ribbon (drawn under the lines)
    if (ex.emaband)
      chart.setEmaBand('ema921', {
        fast: ta.ema(closes, 9), slow: ta.ema(closes, 21),
        up: 'rgba(38,161,123,0.16)', down: 'rgba(224,86,106,0.16)',
        fastColor: 'rgba(120,230,170,0.95)', slowColor: 'rgba(120,170,255,0.95)',
        legend: [{ period: 9, color: '#78e6aa' }, { period: 21, color: '#8ab4ff' }]
      });
    if (ex.ema9) chart.setOverlay('ema9', { data: ta.ema(closes, 9), color: '#2ec27e', label: 'EMA 9', dash: [5, 4], group: 'EMA', period: 9 });
    if (ex.ema21) chart.setOverlay('ema21', { data: ta.ema(closes, 21), color: '#46b3ff', label: 'EMA 21', dash: [5, 4], group: 'EMA', period: 21 });
    if (ex.ema50) chart.setOverlay('ema50', { data: ta.ema(closes, 50), color: '#b083ff', label: 'EMA 50', width: 1.6, group: 'EMA', period: 50 });
    if (ex.ma20) chart.setOverlay('ma20', { data: ta.sma(closes, 20), color: '#9be36b', label: 'SMA 20', group: 'SMA', period: 20 });
    if (ex.ma50) chart.setOverlay('ma50', { data: ta.sma(closes, 50), color: '#5b8cff', label: 'SMA 50', group: 'SMA', period: 50 });
    if (ex.ma100 && closes.length > 100) chart.setOverlay('ma100', { data: ta.sma(closes, 100), color: '#ffb020', label: 'SMA 100', group: 'SMA', period: 100 });
    if (ex.ma200 && closes.length > 200) chart.setOverlay('ma200', { data: ta.sma(closes, 200), color: '#e0566a', label: 'SMA 200', group: 'SMA', period: 200 });
    // Fibonacci EMA ribbon (8/13/21/34/55) — a multi-length trend gauge: price
    // riding above a fanned-out, evenly-spaced ribbon = strong trend; tangled = chop.
    if (ex.fibema)
      [[8, '#2ee6a0'], [13, '#46c9ff'], [21, '#6aa9ff'], [34, '#b083ff'], [55, '#e0566a']].forEach(([p, col]) => {
        if (closes.length > p) chart.setOverlay('fib' + p, { data: ta.ema(closes, p), color: col, width: 1.3, label: 'EMA ' + p, group: 'Fib EMA', period: p });
      });
    if (ex.bb) {
      const b = ta.bollinger(closes, 20, 2);
      chart.setBand('bb', { upper: b.upper, lower: b.lower, mid: b.mid, color: 'rgba(120,160,255,0.07)', lineColor: 'rgba(150,180,255,0.6)' });
    }
    if (ex.vwap) chart.setOverlay('vwap', { data: ta.vwap(candles), color: '#ffd166', label: 'VWAP', width: 1.6 });
    if (ex.sr) {
      const levels = window.TA.supportResistance(state.data.candles, { lookback: 5, maxLevels: 6, minTouches: 2 });
      levels.forEach((lvl, k) => {
        const isSup = lvl.role === 'support';
        chart.setZone('sr' + k, {
          lo: lvl.lo, hi: lvl.hi,
          color: isSup ? 'rgba(38,161,123,0.16)' : 'rgba(224,86,106,0.16)',
          label: `${isSup ? 'Support' : 'Resistance'} · ${lvl.touches}×`,
          labelColor: isSup ? 'rgba(120,230,190,.95)' : 'rgba(255,160,170,.95)'
        });
      });
    }
    // Auto Fibonacci retracement on the DOMINANT swing — the extreme high and
    // low of the loaded data (the move a trader would actually draw in TV).
    if (ex.fib && candles.length) {
      let hi = -Infinity, lo = Infinity, hiI = 0, loI = 0;
      candles.forEach((c, i) => {
        if (c.high > hi) { hi = c.high; hiI = i; }
        if (c.low < lo) { lo = c.low; loI = i; }
      });
      // 0% sits at the most recent extreme (start = the earlier one), so it works
      // for both up-swings (retrace from the high) and down-swings (from the low).
      const lastIsHigh = hiI > loI;
      const start = lastIsHigh ? { t: candles[loI].time, price: lo } : { t: candles[hiI].time, price: hi };
      const end = lastIsHigh ? { t: candles[hiI].time, price: hi } : { t: candles[loI].time, price: lo };
      chart.setAutoFib(start, end, 'rgba(150,180,255,0.9)');
    } else {
      chart.setAutoFib(null);
    }
    const ewControls = $('#ewControls');
    if (ewControls) ewControls.style.display = ex.ew ? 'block' : 'none';
    if (ex.ew && window.Waves) applyElliottWave();
    else renderEwRead(null);
  }

  // Detect + draw the Elliott Wave count at the current (auto or manual) swing %.
  function applyElliottWave() {
    if (!state.data || !window.Waves) return;
    const ex = state.explore;
    const w = window.Waves.detect(state.data.candles, ex.ewPct ? { pct: ex.ewPct } : {});
    if (w.pivots && w.pivots.length >= 2) chart.setPolyline('zz', { points: w.pivots.map((p) => ({ i: p.i, price: p.price })), color: 'rgba(180,200,255,0.4)', width: 1.2 });
    else chart.clearPolylines();
    chart.setMarkers(w.found && w.waves ? w.waves.map((wv) => ({ index: wv.i, side: wv.type === 'H' ? 'above' : 'below', color: wv.type === 'H' ? '#46b3ff' : '#e0566a', text: wv.label })) : []);
    const slider = $('#ewSensitivity');
    const val = $('#ewSensVal');
    if (slider && val) {
      const usedPct = Math.round((w.pct || 0.08) * 100);
      if (ex.ewPct == null) {
        slider.value = usedPct;
        val.textContent = 'auto (' + usedPct + '%)';
      } else {
        val.textContent = slider.value + '%';
      }
    }
    renderEwRead(w);
  }

  function renderEwRead(w) {
    const box = $('#ewRead');
    if (!box) return;
    if (!w) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.style.display = 'block';
    if (!w.found) {
      box.innerHTML = `<div class="ew-h">🌊 Elliott Wave <small>(beta)</small></div><div class="ew-cav">${w.note || 'No clean wave structure found.'} Tip: try the <b>5Y · weekly</b> or <b>Max · monthly</b> timeframe.</div>`;
      return;
    }
    const rules = (w.rules || []).map((r) => `<div class="ew-rule ${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✗'} ${r.name}</div>`).join('');
    const targets = (w.targets || []).map((t) => `<div class="ew-tgt"><span>${t.label}</span><b>${t.price.toFixed(2)}</b></div>`).join('');
    const vol = w.waveVol && w.waveVol.length
      ? `<div class="ew-h2">Volume per wave</div><div class="ew-vols">${w.waveVol
          .map((rv, k) => `<div class="ew-vol ${k === w.peakWave - 1 ? 'peak' : ''}"><span class="ew-volbar"><i style="height:${Math.max(6, Math.round(rv * 100))}%"></i></span><b>${k + 1}</b></div>`)
          .join('')}</div><div class="ew-cav">${w.volNote || ''}</div>`
      : '';
    box.innerHTML =
      `<div class="ew-h">🌊 Elliott Wave <small>(beta · ${(w.pct * 100).toFixed(0)}% swings)</small></div>` +
      `<div class="ew-sum">${w.summary}</div>` +
      (rules ? `<div class="ew-rules">${rules}</div>` : '') +
      vol +
      (targets ? `<div class="ew-h2">Fib targets for the next move</div><div class="ew-tgts">${targets}</div>` : '') +
      `<div class="ew-cav">Elliott counts are subjective and not predictive — one interpretation, educational only. Best read on weekly/monthly charts.</div>`;
  }

  function syncTabs() {
    const views = ['lessons', 'explore', 'signals', 'screener', 'research', 'markets'];
    const tabIds = { lessons: 'tabLessons', explore: 'tabExplore', signals: 'tabSignals', screener: 'tabScreener', research: 'tabResearch', markets: 'tabMarkets' };
    const viewIds = { lessons: 'lessonsView', explore: 'exploreView', signals: 'signalsView', screener: 'screenerView', research: 'researchView', markets: 'marketsView' };
    views.forEach((v) => {
      $('#' + tabIds[v]).classList.toggle('active', state.view === v);
      $('#' + viewIds[v]).style.display = state.view === v ? (v === 'explore' ? 'block' : 'flex') : 'none';
    });
  }

  // ---- screener (swing-trade watchlist ranker) -----------------------------
  let screening = false;
  function renderWatchlist() {
    const box = $('#wlChips');
    box.innerHTML = '';
    state.watchlist.forEach((sym) => {
      const chip = el('span', 'wl-chip', `${sym}<button class="wl-x" data-sym="${sym}" aria-label="remove">×</button>`);
      chip.querySelector('.wl-x').addEventListener('click', (e) => {
        e.stopPropagation();
        removeWatch(sym);
      });
      chip.addEventListener('click', () => loadSymbol(sym));
      box.appendChild(chip);
    });
  }
  function addWatch(sym) {
    sym = (sym || '').toUpperCase().trim().slice(0, 12);
    const ri = $('#wlRailInput');
    const si = $('#wlInput');
    if (ri) ri.value = '';
    if (si) si.value = '';
    if (!sym || state.watchlist.includes(sym)) return;
    state.watchlist.push(sym);
    renderWatchlist();
    renderWatchRail();
    save();
    if (location.protocol !== 'file:')
      window.MarketData
        .quote(sym)
        .then((q) => {
          if (q && isFinite(q.price)) {
            _wlQuotes[sym] = q;
            renderWatchRail();
          }
        })
        .catch(() => {});
  }
  function removeWatch(sym) {
    state.watchlist = state.watchlist.filter((s) => s !== sym);
    renderWatchlist();
    renderWatchRail();
    save();
  }

  // ---- right-edge watchlist rail (live quotes) -----------------------------
  const _wlQuotes = {}; // sym -> { price, changePct }
  function renderWatchRail() {
    const list = $('#wlRailList');
    if (!list) return;
    list.innerHTML = '';
    state.watchlist.forEach((sym) => {
      const q = _wlQuotes[sym];
      const chg = q && isFinite(q.changePct) ? q.changePct : null;
      const cls = chg == null ? 'flat' : chg >= 0 ? 'pos' : 'neg';
      const last = q && isFinite(q.price) ? q.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
      const chgTxt = chg == null ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
      const row = el('div', 'wl-row' + (sym === state.symbol ? ' active' : ''));
      row.dataset.sym = sym;
      row.innerHTML = `<span class="wl-sym">${sym}</span><span class="wl-last">${last}</span><span class="wl-chg ${cls}">${chgTxt}</span><button class="wl-row-x" title="remove" aria-label="remove">×</button>`;
      row.addEventListener('click', () => loadSymbol(sym));
      row.querySelector('.wl-row-x').addEventListener('click', (e) => {
        e.stopPropagation();
        removeWatch(sym);
      });
      list.appendChild(row);
    });
  }
  function updateWatchActive() {
    document.querySelectorAll('#wlRailList .wl-row').forEach((r) => r.classList.toggle('active', r.dataset.sym === state.symbol));
  }
  let _wlRefreshing = false;
  async function refreshWatchQuotes() {
    if (_wlRefreshing || location.protocol === 'file:' || !state.watchlist.length) return;
    _wlRefreshing = true;
    try {
      await mapPool(state.watchlist.slice(), 4, async (sym) => {
        try {
          const q = await window.MarketData.quote(sym);
          if (q && isFinite(q.price)) _wlQuotes[sym] = q;
        } catch (_) {}
        return null;
      });
      renderWatchRail();
    } finally {
      _wlRefreshing = false;
    }
  }
  // concurrency-limited async map
  async function mapPool(items, limit, fn, onProgress) {
    const out = new Array(items.length);
    let idx = 0;
    let done = 0;
    const worker = async () => {
      while (idx < items.length) {
        const i = idx++;
        try {
          out[i] = await fn(items[i]);
        } catch (_) {
          out[i] = null;
        }
        done++;
        if (onProgress) onProgress(done, items.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }
  async function runScreener() {
    if (screening) return;
    screening = true;
    const box = $('#screenerResult');
    const isFile = location.protocol === 'file:';
    const fetchBars = (sym) =>
      isFile
        ? Promise.resolve(window.MarketData.loadDemo(sym, '1y', '1d'))
        : window.MarketData.load(sym, '1y', '1d', { quote: false });
    box.innerHTML = '<div class="sig-loading">Fetching market (SPY)…</div>';
    let market = { ret21: 0, ret63: 0 };
    try {
      const spy = await fetchBars('SPY');
      market = window.Screener.marketContext(spy.candles);
    } catch (_) {}
    const list = state.watchlist.slice();
    box.innerHTML = `<div class="sig-loading">Scoring 0/${list.length}…</div>`;
    const datas = await mapPool(list, 4, fetchBars, (done, total) => {
      box.innerHTML = `<div class="sig-loading">Scoring ${done}/${total}…</div>`;
    });
    const rows = [];
    list.forEach((sym, i) => {
      const d = datas[i];
      if (!d || !Array.isArray(d.candles) || d.candles.length < 60) return;
      const r = window.Screener.score(d.candles, market);
      if (r) rows.push({ sym, ...r, synthetic: d.synthetic });
    });
    rows.sort((a, b) => b.score - a.score);
    renderScreener(box, rows, isFile);
    screening = false;
  }
  function scoreClass(s) {
    return s >= 70 ? 'sb' : s >= 55 ? 'b' : s >= 40 ? 'n' : s >= 25 ? 's' : 'ss';
  }
  function renderScreener(box, rows, synthetic) {
    if (!rows.length) {
      box.innerHTML = '<div class="sig-error">Couldn’t score any names — check tickers / connection and run again.</div>';
      return;
    }
    const head =
      (synthetic ? '<div class="sig-sample">⚠ Sample data — start the live server for a real screen.</div>' : '') +
      '<div class="scr-head"><span>#</span><span>Symbol</span><span>Score</span><span>Setup</span><span>RS</span></div>';
    box.innerHTML = head + rows.map((r, i) => rowHtml(r, i)).join('');
    box.querySelectorAll('.scr-row').forEach((rowEl) => {
      rowEl.addEventListener('click', () => {
        const sym = rowEl.dataset.sym;
        loadSymbol(sym);
        const det = rowEl.nextElementSibling;
        if (det && det.classList.contains('scr-detail')) det.classList.toggle('open');
      });
    });
  }
  function rowHtml(r, i) {
    const cls = scoreClass(r.score);
    const rs = r.metrics.rs63;
    const bullets = r.bullets.map((b) => `<div class="scr-b ${b.good ? 'g' : 'x'}"><span>${b.good ? '▲' : '·'}</span>${b.txt}</div>`).join('');
    return (
      `<div class="scr-row" data-sym="${r.sym}">` +
      `<span class="scr-rank">${i + 1}</span>` +
      `<span class="scr-sym">${r.sym}<small>${r.metrics.chgPct >= 0 ? '+' : ''}${r.metrics.chgPct.toFixed(1)}%</small></span>` +
      `<span class="rating ${cls} scr-score">${r.score}</span>` +
      `<span class="scr-setup ${r.breaking ? 'bad' : ''}">${r.setup}</span>` +
      `<span class="scr-rs ${rs >= 0 ? 'pos' : 'neg'}">${rs >= 0 ? '+' : ''}${rs.toFixed(0)}%</span>` +
      `</div>` +
      `<div class="scr-detail"><div class="scr-bullets">${bullets}</div></div>`
    );
  }

  // ---- research (key stats + deep links + SEC EDGAR) -----------------------
  function researchLinks(sym) {
    const s = encodeURIComponent(sym);
    return [
      ['EarningsWhispers', `https://www.earningswhispers.com/stocks/${s}`],
      ['Analyst ratings (Benzinga)', `https://www.benzinga.com/quote/${s}`],
      ['Expected move (Options AI)', `https://tools.optionsai.com/expected-move/${s}`],
      ['Finviz', `https://finviz.com/quote.ashx?t=${s}`],
      ['Dataroma (ownership)', `https://www.dataroma.com/m/stock.php?sym=${s}`],
      ['SEC EDGAR filings', `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${s}&type=&dateb=&owner=include&count=40`]
    ];
  }
  function fmtBig(v) {
    return v == null ? '—' : v;
  }
  // --- persistent research worksheet (the "blueprint") ---
  const RES_KEY = 'chartSchool.research.v1';
  let researchStore = null;
  let resSaveTimer = null;
  function loadResearchStore() {
    if (researchStore) return researchStore;
    try {
      researchStore = JSON.parse(localStorage.getItem(RES_KEY) || '{}');
    } catch (_) {
      researchStore = {};
    }
    return researchStore;
  }
  function saveResearchStore() {
    clearTimeout(resSaveTimer);
    resSaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(RES_KEY, JSON.stringify(researchStore));
      } catch (_) {}
    }, 400);
  }
  function getResearchRec(sym) {
    const store = loadResearchStore();
    if (!store[sym]) store[sym] = { date: new Date().toLocaleDateString(), fields: {}, checks: {}, notes: '', auto: null, edgar: null };
    const r = store[sym];
    r.fields = r.fields || {};
    r.checks = r.checks || {};
    return r;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function autoGrow(t) {
    t.style.height = 'auto';
    t.style.height = Math.min(180, Math.max(30, t.scrollHeight)) + 'px';
  }
  function renderAutoStats(auto) {
    const box = $('#rschStats');
    if (!auto) {
      box.innerHTML = location.protocol === 'file:' ? '<div class="ctrl-note">Start the live server for key stats & SEC data.</div>' : '<div class="ctrl-note">Loading key stats…</div>';
      return;
    }
    const rows = window.BLUEPRINT.stats.map((s) => [s.label, auto[s.key]]).filter((r) => r[1] != null && r[1] !== '' && r[1] !== '—');
    box.innerHTML = rows.length ? rows.map(([k, v]) => `<div class="rsch-stat"><span>${k}</span><b>${esc(v)}</b></div>`).join('') : '<div class="ctrl-note">Key stats unavailable for this ticker.</div>';
  }
  function bpGroupHtml(g, rec) {
    if (g.checklist) {
      const items = g.checklist.map((it) => `<label class="bp-check"><input type="checkbox" data-cid="${it.id}" ${rec.checks[it.id] ? 'checked' : ''}/><span>${it.label}</span></label>`).join('');
      return `<div class="bp-group"><h4>${g.title}</h4>${items}</div>`;
    }
    const fields = g.fields.map((f) => {
      const ai = rec.aiFilled && rec.aiFilled[f.id];
      return `<label class="bp-field${ai ? ' ai' : ''}"><span>${f.label}${ai ? ' <i class="ai-tag">AI</i>' : ''}</span><textarea data-fid="${f.id}" rows="1" placeholder="${esc(f.ph || '')}">${esc(rec.fields[f.id] || '')}</textarea></label>`;
    }).join('');
    return `<div class="bp-group"><h4>${g.title}</h4>${fields}</div>`;
  }
  function bpSectionHtml(sec, rec) {
    const auto = sec.auto === 'financials' ? '<div id="bpAutoFin" class="bp-auto"></div>' : '';
    return `<details class="bp-sec" open><summary class="bp-sec-head"><span>${sec.icon} ${sec.title}</span><i>${sec.q}</i></summary>${auto}${sec.groups.map((g) => bpGroupHtml(g, rec)).join('')}</details>`;
  }
  function renderFinancialsAuto(e) {
    const box = document.getElementById('bpAutoFin');
    if (!box) return;
    if (!e) {
      box.innerHTML = '<div class="ctrl-note">SEC financials unavailable (US-listed companies only).</div>';
      return;
    }
    const filings = e.filings && e.filings.length
      ? e.filings.slice(0, 6).map((f) => `<a class="rsch-filing" href="${f.url}" target="_blank" rel="noopener"><span class="rsch-form">${f.form}</span><span class="rsch-fdate">${f.date}</span><span class="rsch-fdesc">${esc(f.desc || '')}</span></a>`).join('')
      : '<div class="ctrl-note">No recent filings.</div>';
    box.innerHTML = `<div class="bp-auto-h">⚙ Auto · from SEC EDGAR</div>${renderFinancials(e.financials)}<div class="rsch-filings">${filings}${e.edgarUrl ? `<a class="rsch-link" href="${e.edgarUrl}" target="_blank" rel="noopener">All filings ↗</a>` : ''}</div>`;
  }
  function renderBlueprintBody(rec) {
    const body = $('#blueprintBody');
    body.innerHTML =
      window.BLUEPRINT.sections.map((sec) => bpSectionHtml(sec, rec)).join('') +
      `<details class="bp-sec" open><summary class="bp-sec-head"><span>📝 Notes</span></summary><div class="bp-group"><textarea class="bp-note" data-note="1" rows="3" placeholder="Free-form notes…">${esc(rec.notes || '')}</textarea></div></details>`;
    body.querySelectorAll('textarea[data-fid]').forEach((t) => {
      autoGrow(t);
      t.addEventListener('input', () => {
        rec.fields[t.dataset.fid] = t.value;
        autoGrow(t);
        saveResearchStore();
      });
    });
    body.querySelectorAll('input[data-cid]').forEach((c) =>
      c.addEventListener('change', () => {
        rec.checks[c.dataset.cid] = c.checked;
        saveResearchStore();
      })
    );
    const note = body.querySelector('textarea[data-note]');
    if (note) {
      autoGrow(note);
      note.addEventListener('input', () => {
        rec.notes = note.value;
        autoGrow(note);
        saveResearchStore();
      });
    }
    if (rec.edgar) renderFinancialsAuto(rec.edgar);
  }
  function aiFieldList() {
    const out = [];
    window.BLUEPRINT.sections.forEach((sec) => sec.groups.forEach((g) => (g.fields || []).forEach((f) => out.push({ id: f.id, label: f.label, prompt: f.ph, section: sec.title }))));
    return out;
  }
  function updateAiStatus() {
    const status = $('#aiStatus');
    if (!status) return;
    const rec = getResearchRec(state.symbol);
    if (state.aiEnabled === false) {
      status.innerHTML = 'AI auto-research is off — enable it with your Anthropic key: <code>ANTHROPIC_API_KEY=sk-ant-… node server.js</code>';
      status.className = 'ai-status warn';
    } else if (rec.aiMeta) {
      status.textContent = `Last AI draft: ${rec.aiMeta.model} · ${rec.aiMeta.date} — verify before acting.`;
      status.className = 'ai-status muted';
    } else {
      status.textContent = state.aiEnabled ? 'One click fills the whole worksheet (AI first-draft, then verify).' : '';
      status.className = 'ai-status muted';
    }
  }
  async function runAiResearch() {
    const sym = state.symbol;
    const rec = getResearchRec(sym);
    const btn = $('#aiResearchBtn');
    const status = $('#aiStatus');
    if (location.protocol === 'file:') {
      status.textContent = 'Start the live server (node server.js) to use AI auto-research.';
      status.className = 'ai-status warn';
      return;
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = `✨ Researching ${sym}…`;
    status.textContent = 'Asking Claude to draft the due diligence (grounded in SEC/Nasdaq data)… ~10-20s';
    status.className = 'ai-status';
    try {
      const r = await window.MarketData.aiResearch(sym, aiFieldList());
      if (sym !== state.symbol) return;
      const obj = r.fields || {};
      rec.aiFilled = rec.aiFilled || {};
      Object.keys(obj).forEach((id) => {
        if (typeof obj[id] === 'string' && obj[id].trim()) {
          rec.fields[id] = obj[id].trim();
          rec.aiFilled[id] = true;
        }
      });
      rec.aiMeta = { model: r.model, date: new Date().toLocaleString() };
      saveResearchStore();
      renderBlueprintBody(rec);
      status.textContent = `✓ Drafted by ${r.model} — verify before acting. Edit any field to refine.`;
      status.className = 'ai-status good';
    } catch (e) {
      status.textContent = (e && e.message) || 'AI research failed.';
      status.className = 'ai-status warn';
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
  function renderResearch() {
    const sym = state.symbol;
    const rec = getResearchRec(sym);
    $('#rschSym').textContent = sym;
    $('#rschName').textContent = (state.data && state.data.name) || rec.name || '';
    $('#rschDate').textContent = 'Worksheet started ' + rec.date + ' · auto-saved on this device';
    $('#rschLinks').innerHTML = researchLinks(sym).map(([label, url]) => `<a class="rsch-link" href="${url}" target="_blank" rel="noopener">${label} ↗</a>`).join('');
    renderAutoStats(rec.auto);
    renderBlueprintBody(rec);
    updateAiStatus();
    if (state._rschSym !== sym || !rec.auto) {
      state._rschSym = sym;
      fetchResearchData(sym, rec);
    }
  }
  async function fetchResearchData(sym, rec) {
    if (location.protocol === 'file:') return;
    try {
      const p = await window.MarketData.profile(sym);
      if (sym !== state.symbol) return;
      rec.auto = {
        price: p.price != null ? Number(p.price).toFixed(2) : null,
        marketCap: p.marketCap, sector: p.sector, industry: p.industry, exchange: p.exchange,
        avgVolume: p.avgVolume, week52: p.week52, peRatio: p.peRatio, forwardPE: p.forwardPE,
        yield: p.yield, eps: p.eps, oneYrTarget: p.oneYrTarget
      };
      renderAutoStats(rec.auto);
      saveResearchStore();
    } catch (_) {
      if (!rec.auto) renderAutoStats({});
    }
    try {
      const e = await window.MarketData.edgar(sym);
      if (sym !== state.symbol) return;
      rec.name = e.name || rec.name;
      rec.edgar = { name: e.name, filings: e.filings, financials: e.financials, edgarUrl: e.edgarUrl };
      renderFinancialsAuto(rec.edgar);
      saveResearchStore();
    } catch (_) {
      renderFinancialsAuto(null);
    }
  }
  function abbrNum(n) {
    const a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return String(Math.round(n));
  }
  function renderFinancials(fin) {
    if (!fin || (!fin.revenue.length && !fin.netIncome.length && !fin.eps.length)) return '<div class="ctrl-note">Financial facts not available.</div>';
    const line = (label, arr, money) => {
      if (!arr || !arr.length) return '';
      const cells = arr.map((x) => `<span><i>${x.fy}</i>${money ? '$' + abbrNum(x.val) : x.val.toFixed(2)}</span>`).join('');
      return `<div class="rsch-finrow"><b>${label}</b><div class="rsch-fincells">${cells}</div></div>`;
    };
    return line('Revenue', fin.revenue, true) + line('Net income', fin.netIncome, true) + line('Diluted EPS', fin.eps, false);
  }

  // ---- markets (sector heat map) -------------------------------------------
  const SECTORS = [
    ['XLK', 'Technology'], ['XLC', 'Communication'], ['XLY', 'Consumer Disc.'], ['XLF', 'Financials'],
    ['XLV', 'Health Care'], ['XLI', 'Industrials'], ['XLP', 'Consumer Staples'], ['XLE', 'Energy'],
    ['XLU', 'Utilities'], ['XLB', 'Materials'], ['XLRE', 'Real Estate']
  ];
  let sectorsLoaded = false;
  function prepMarkets() {
    if (!sectorsLoaded) runSectorMap();
  }
  function heatClass(p) {
    if (p >= 2) return 'h2';
    if (p >= 0.5) return 'h1';
    if (p > -0.5) return 'h0';
    if (p > -2) return 'hm1';
    return 'hm2';
  }
  async function runSectorMap() {
    const box = $('#mktMap');
    box.innerHTML = '<div class="sig-loading">Loading sector ETFs…</div>';
    const isFile = location.protocol === 'file:';
    const fetchBars = (sym) => (isFile ? Promise.resolve(window.MarketData.loadDemo(sym, '6mo', '1d')) : window.MarketData.load(sym, '6mo', '1d', { quote: false }));
    const datas = await mapPool(SECTORS.map((s) => s[0]), 4, fetchBars);
    const tiles = [];
    SECTORS.forEach((s, i) => {
      const d = datas[i];
      if (!d || !d.candles || d.candles.length < 6) return;
      const c = d.candles.map((x) => x.close);
      const n = c.length;
      const day = ((c[n - 1] - c[n - 2]) / c[n - 2]) * 100;
      const wk = ((c[n - 1] - c[Math.max(0, n - 6)]) / c[Math.max(0, n - 6)]) * 100;
      tiles.push({ sym: s[0], name: s[1], day, wk });
    });
    tiles.sort((a, b) => b.wk - a.wk);
    if (!tiles.length) {
      box.innerHTML = '<div class="sig-error">Couldn’t load sector data — try again.</div>';
      return;
    }
    sectorsLoaded = true;
    box.innerHTML = tiles
      .map(
        (t) =>
          `<button class="mkt-tile ${heatClass(t.wk)}" data-sym="${t.sym}"><span class="mkt-name">${t.name}</span><span class="mkt-sym">${t.sym}</span><span class="mkt-chg">${t.wk >= 0 ? '+' : ''}${t.wk.toFixed(1)}%<small> 1w</small></span><span class="mkt-day">${t.day >= 0 ? '+' : ''}${t.day.toFixed(1)}% today</span></button>`
      )
      .join('');
    box.querySelectorAll('.mkt-tile').forEach((tile) => tile.addEventListener('click', () => loadSymbol(tile.dataset.sym)));
  }

  // ---- glossary modal ------------------------------------------------------
  function renderGlossary() {
    const body = $('#glossaryBody');
    if (body.dataset.built) return;
    body.innerHTML = (window.GLOSSARY || [])
      .map(
        (sec) =>
          `<div class="gl-sec"><h3>${sec.icon} ${sec.title}</h3>` +
          sec.items
            .map(
              (it) =>
                `<div class="gl-item"><div class="gl-term">${it.term}</div><div class="gl-def">${it.html}</div>` +
                (it.links ? '<div class="gl-links">' + it.links.map((l) => `<a href="${l.url}" target="_blank" rel="noopener">${l.label} ↗</a>`).join('') + '</div>' : '') +
                `</div>`
            )
            .join('') +
          `</div>`
      )
      .join('');
    body.dataset.built = '1';
  }
  function openGlossary() {
    renderGlossary();
    $('#glossaryModal').style.display = 'flex';
  }
  function closeGlossary() {
    $('#glossaryModal').style.display = 'none';
  }

  // ---- signals (multi-timeframe technical read) ----------------------------
  let analyzing = false;
  function prepSignals() {
    $('#sigSymbol').textContent = state.symbol;
    $('#analyzeSym').textContent = state.symbol;
    if (state._sigSymbol !== state.symbol) runAnalysis();
  }
  function sigMeter(score) {
    const pct = Math.max(0, Math.min(100, (score + 100) / 2));
    const cls = score >= 18 ? 'pos' : score <= -18 ? 'neg' : 'neu';
    return (
      `<div class="sig-meter"><div class="sig-meter-track"><div class="sig-meter-zero"></div>` +
      `<div class="sig-meter-dot ${cls}" style="left:${pct}%"></div></div>` +
      `<span class="sig-score ${cls}">${score > 0 ? '+' : ''}${score}</span></div>`
    );
  }
  function sigCard(h, title, subtitle) {
    if (!h)
      return `<div class="sig-card"><div class="sig-card-head"><span class="sig-title">${title}</span><span class="rating n">N/A</span></div><div class="sig-empty">No data for this timeframe right now.</div></div>`;
    const rows = h.factors
      .map((f) => {
        const ic = f.state === 'bull' ? '▲' : f.state === 'bear' ? '▼' : '■';
        return `<div class="sig-factor ${f.state}"><span class="sig-ic">${ic}</span><div><div class="sig-f-label">${f.label}</div><div class="sig-f-detail">${f.detail}</div></div></div>`;
      })
      .join('');
    return `<div class="sig-card"><div class="sig-card-head"><span class="sig-title">${title} <small>${subtitle}</small></span><span class="rating ${h.rating.cls}">${h.rating.label}</span></div>${sigMeter(h.score)}<div class="sig-factors">${rows}</div></div>`;
  }
  function f2(n) {
    return n == null ? '—' : Number(n).toFixed(2);
  }
  function tradePlanHtml(p) {
    if (!p) return '';
    if (!p.ok) {
      return `<div class="tp-card neutral"><div class="tp-head"><span>Trade plan</span><span class="rating ${p.bias === 'bearish' ? 's' : 'n'}">${p.bias}</span></div><div class="tp-setup">${p.setup}</div><div class="tp-notes">${p.notes.map((n) => `<div>• ${n}</div>`).join('')}</div></div>`;
    }
    const rrCls = p.rr >= 2 ? 'g' : p.rr >= 1.5 ? '' : 'x';
    return (
      `<div class="tp-card"><div class="tp-head"><span>Trade plan <small>(swing · daily)</small></span><span class="rating b">${p.setup}</span></div>` +
      `<div class="tp-levels">` +
      `<div class="tp-lvl entry"><span>Entry</span><b>${f2(p.entry.low)}–${f2(p.entry.high)}</b></div>` +
      `<div class="tp-lvl stop"><span>Stop</span><b>${f2(p.stop)}</b></div>` +
      `<div class="tp-lvl t1"><span>Target 1</span><b>${f2(p.targets[0])}</b></div>` +
      `<div class="tp-lvl t2"><span>Target 2</span><b>${f2(p.targets[1])}</b></div>` +
      `<div class="tp-lvl rr ${rrCls}"><span>R : R (T1)</span><b>${p.rr.toFixed(1)} : 1</b></div>` +
      `</div>` +
      `<div class="tp-notes">${p.notes.map((n) => `<div>• ${n}</div>`).join('')}</div></div>`
    );
  }
  function drawTradePlan(p) {
    ['tpStop', 'tpT1', 'tpT2'].forEach((id) => chart.removeHLine(id));
    chart.removeZone('tpEntry');
    if (!p || !p.ok) {
      chart.requestRender();
      return;
    }
    chart.setZone('tpEntry', { lo: p.entry.low, hi: p.entry.high, color: 'rgba(38,161,123,0.18)', label: 'Entry', labelColor: 'rgba(120,230,190,0.95)' });
    chart.setHLine('tpStop', { price: p.stop, color: '#e0566a', label: 'Stop', dash: [6, 4] });
    chart.setHLine('tpT1', { price: p.targets[0], color: '#5b8cff', label: 'T1', dash: [6, 4] });
    chart.setHLine('tpT2', { price: p.targets[1], color: '#46b3ff', label: 'T2', dash: [2, 4] });
  }
  function renderSignals(box, r, plan, synthetic) {
    box.innerHTML =
      (synthetic ? '<div class="sig-sample">⚠ Sample data — start the live server for a real read.</div>' : '') +
      tradePlanHtml(plan) +
      `<div class="sig-overall ${r.overall.rating.cls}"><div class="sig-overall-top"><span>Overall technical read</span><span class="rating ${r.overall.rating.cls} big">${r.overall.rating.label}</span></div>${sigMeter(r.overall.score)}<div class="sig-align">${r.alignment}</div></div>` +
      sigCard(r.longTerm, 'Long-term', 'weekly · 5y') +
      sigCard(r.swing, 'Multi-month', 'daily · 1y') +
      sigCard(r.intraday, 'Intraday', 'today · 2-min');
    drawTradePlan(plan);
  }
  async function runAnalysis() {
    if (analyzing) return;
    analyzing = true;
    const sym = state.symbol;
    state._sigSymbol = sym;
    const box = $('#signalsResult');
    box.innerHTML = `<div class="sig-loading">Analyzing ${sym} across timeframes…</div>`;
    const isFile = location.protocol === 'file:';
    const get = (range, interval) =>
      isFile ? Promise.resolve(window.MarketData.loadDemo(sym, range, interval)) : window.MarketData.load(sym, range, interval);
    const res = await Promise.allSettled([get('5y', '1wk'), get('1y', '1d'), get('1d', '2m')]);
    if (sym !== state.symbol) {
      analyzing = false;
      return; // user switched symbols mid-analysis
    }
    const candlesOf = (x) =>
      x.status === 'fulfilled' && x.value && Array.isArray(x.value.candles) && x.value.candles.length >= 20
        ? x.value.candles
        : null;
    const sets = { longTerm: candlesOf(res[0]), swing: candlesOf(res[1]), intraday: candlesOf(res[2]) };
    if (!sets.longTerm && !sets.swing && !sets.intraday) {
      box.innerHTML = `<div class="sig-error">Couldn’t fetch data to analyze ${sym}. Check the ticker and your connection, then click Analyze again.</div>`;
      analyzing = false;
      return;
    }
    const firstOk = res.find((x) => x.status === 'fulfilled');
    const synthetic = isFile || (firstOk && firstOk.value && firstOk.value.synthetic);
    const plan = sets.swing ? window.Analysis.tradePlan(sets.swing) : null;
    renderSignals(box, window.Analysis.multiHorizon(sets), plan, synthetic);
    analyzing = false;
  }

  // ---- wiring --------------------------------------------------------------
  function bindUI() {
    $('#loadBtn').addEventListener('click', () => loadSymbol($('#symbolInput').value));
    $('#exportChartBtn').addEventListener('click', exportChart);
    $('#symbolInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadSymbol($('#symbolInput').value);
    });
    document.querySelectorAll('.chip[data-sym]').forEach((c) =>
      c.addEventListener('click', () => loadSymbol(c.dataset.sym))
    );
    // Interval ribbon (TradingView-style: 1m … 4h, D, W, M). Each button sets the
    // bar size + a sensible amount of history; the server resamples odd sizes.
    document.querySelectorAll('.tf-btn[data-interval]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.tf-btn').forEach((b) => b.classList.toggle('active', b === btn));
        state.interval = btn.dataset.interval;
        state.range = btn.dataset.range;
        await loadSymbol(state.symbol);
        // intraday: a recent window reads better than thousands of squished bars
        if (/(m|h)$/.test(state.interval)) chart.resetView();
        else chart.showAll();
      });
    });
    $('#csvExportBtn').addEventListener('click', exportCsv);

    $('#tabLessons').addEventListener('click', () => {
      state.view = 'lessons';
      syncTabs();
      renderStep();
      save();
    });
    $('#tabExplore').addEventListener('click', () => {
      state.view = 'explore';
      syncTabs();
      applyExplore();
      save();
    });
    $('#tabSignals').addEventListener('click', () => {
      state.view = 'signals';
      syncTabs();
      prepSignals();
      save();
    });
    $('#analyzeBtn').addEventListener('click', () => {
      state._sigSymbol = null;
      runAnalysis();
    });
    $('#tabScreener').addEventListener('click', () => {
      state.view = 'screener';
      syncTabs();
      renderWatchlist();
      save();
    });
    $('#wlAddBtn').addEventListener('click', () => addWatch($('#wlInput').value));
    $('#wlInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addWatch($('#wlInput').value);
    });
    $('#runScreenerBtn').addEventListener('click', runScreener);
    $('#tabResearch').addEventListener('click', () => {
      state.view = 'research';
      syncTabs();
      renderResearch();
      save();
    });
    $('#aiResearchBtn').addEventListener('click', runAiResearch);
    $('#tabMarkets').addEventListener('click', () => {
      state.view = 'markets';
      syncTabs();
      prepMarkets();
      save();
    });
    $('#mktRunBtn').addEventListener('click', runSectorMap);
    $('#learnBtn').addEventListener('click', openGlossary);
    $('#glossaryClose').addEventListener('click', closeGlossary);
    $('#glossaryModal').addEventListener('click', (e) => {
      if (e.target.id === 'glossaryModal') closeGlossary();
    });

    $('#prevBtn').addEventListener('click', () => go(-1));
    $('#nextBtn').addEventListener('click', () => go(1));

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (state.view !== 'lessons') return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    });

    // explore toggles (preserve zoom/pan when toggling)
    document.querySelectorAll('[data-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.toggle;
        if (key === 'mode') state.explore.mode = input.checked ? 'line' : 'candles';
        else state.explore[key] = input.checked;
        applyExplore(true);
      });
    });

    $('#resetViewBtn').addEventListener('click', () => chart.resetView());

    // Elliott Wave sensitivity slider
    $('#ewSensitivity').addEventListener('input', () => {
      state.explore.ewPct = +$('#ewSensitivity').value / 100;
      $('#ewSensVal').textContent = $('#ewSensitivity').value + '%';
      applyElliottWave();
    });
    $('#ewAutoBtn').addEventListener('click', () => {
      state.explore.ewPct = null;
      applyElliottWave();
    });

    // adjusted-prices toggle (requires a reload)
    const adj = $('#adjustedToggle');
    if (adj)
      adj.addEventListener('change', () => {
        state.adjusted = adj.checked;
        loadSymbol(state.symbol);
      });

    bindDrawTools();
    bindSidebar();
    bindWatchRail();
    bindIndicatorsPanel();

    // error overlay actions
    $('#errRetry').addEventListener('click', () => loadSymbol(state.symbol));
    $('#errSample').addEventListener('click', useSampleData);
  }

  // Wire the left drawing rail to the chart's drawing engine.
  function bindDrawTools() {
    const rail = $('.draw-rail');
    if (!rail || !chart) return;
    const toolBtns = rail.querySelectorAll('.dr-btn[data-tool]');
    const setActive = (btn) => toolBtns.forEach((b) => b.classList.toggle('active', b === btn));
    toolBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        chart.setTool(btn.dataset.tool);
        setActive(btn);
      });
    });
    // colour palette — sets the colour for new drawings, and recolours the
    // selected one (so a red box = resistance, a green box = support).
    const colorBtns = rail.querySelectorAll('.dr-color[data-color]');
    const colorInput = $('#drawColorInput');
    const setColor = (c, fromInput) => {
      chart.setDrawColor(c);
      chart.recolorSelected(c);
      colorBtns.forEach((b) => b.classList.toggle('active', b.dataset.color === c));
      if (colorInput && !fromInput) colorInput.value = c;
    };
    colorBtns.forEach((b) => b.addEventListener('click', () => setColor(b.dataset.color)));
    if (colorInput) colorInput.addEventListener('input', () => setColor(colorInput.value, true));

    const magnetBtn = rail.querySelector('[data-action="magnet"]');
    magnetBtn.addEventListener('click', () => {
      const on = !magnetBtn.classList.contains('on');
      magnetBtn.classList.toggle('on', on);
      chart.setMagnet(on);
      toast(on ? '🧲 Magnet on — anchors snap to OHLC' : 'Magnet off');
    });
    rail.querySelector('[data-action="undo"]').addEventListener('click', () => chart.undoDrawing());
    rail.querySelector('[data-action="clear"]').addEventListener('click', () => {
      if (chart.getDrawings().length && confirm('Remove all drawings on this chart?')) chart.clearDrawings();
    });
    // after a shape is finished the chart reverts to the cursor — reflect that
    chart.on('toolend', () => setActive(rail.querySelector('[data-tool="cursor"]')));
    // persist drawings per ticker whenever they change
    chart.on('drawingschange', (arr) => saveDrawingsFor(state.symbol, arr));
  }

  // Collapse the analysis panel for a full-width, TradingView-style chart.
  // Collapsed → the chart shows the indicator suite; open → the selected tab.
  function bindSidebar() {
    const layout = $('.layout');
    const reopen = $('#sidebarReopen');
    const toggle = $('#sidebarToggle');
    if (!layout || !reopen || !toggle) return;
    const apply = () => {
      layout.classList.toggle('sb-collapsed', state.sbCollapsed);
      reopen.style.display = state.sbCollapsed ? 'block' : 'none';
    };
    toggle.addEventListener('click', () => {
      state.sbCollapsed = true;
      state.view = 'explore';
      apply();
      syncTabs();
      applyExplore(true);
      save();
    });
    reopen.addEventListener('click', () => {
      state.sbCollapsed = false;
      if (state.view === 'explore') state.view = 'lessons';
      apply();
      syncTabs();
      renderCurrentView();
      save();
    });
    apply();
  }

  // The "ƒ Indicators" toolbar popover (chart controls live here, TV-style).
  function bindIndicatorsPanel() {
    const btn = $('#indicatorsBtn');
    const pop = $('#indicatorsPanel');
    if (!btn || !pop) return;
    const setOpen = (open) => {
      pop.style.display = open ? 'flex' : 'none';
      btn.classList.toggle('on', open);
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(pop.style.display === 'none');
    });
    $('#indicatorsClose').addEventListener('click', () => setOpen(false));
    document.addEventListener('click', (e) => {
      if (pop.style.display !== 'none' && !pop.contains(e.target) && e.target !== btn) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pop.style.display !== 'none') setOpen(false);
    });
  }

  // Wire the right-edge watchlist (add, refresh, collapse) + initial render.
  function bindWatchRail() {
    const layout = $('.layout');
    const reopen = $('#wlReopen');
    if (!layout || !reopen || !$('#wlPane')) return;
    $('#wlRailInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addWatch(e.target.value);
    });
    $('#wlRefresh').addEventListener('click', refreshWatchQuotes);
    const setCollapsed = (on) => {
      layout.classList.toggle('wl-collapsed', on);
      reopen.style.display = on ? 'block' : 'none';
    };
    $('#wlCollapse').addEventListener('click', () => setCollapsed(true));
    reopen.addEventListener('click', () => setCollapsed(false));
    renderWatchRail();
  }

  // ---- boot ----------------------------------------------------------------
  async function boot() {
    restore();
    chart = new window.StockChart($('#chart'), { initialBars: 130 });
    bindUI();
    renderLessonList();
    syncTabs();
    // detect whether AI auto-research is enabled on the server
    window.MarketData.health().then((h) => {
      state.aiEnabled = !!h.aiEnabled;
      if (state.view === 'research') updateAiStatus();
    });

    await loadSymbol(state.symbol); // also renders the current view (lessons/explore/signals)
    refreshWatchQuotes();

    // live auto-refresh every ~18s (gentle; server also caches): intraday views
    // re-fetch the full chart, daily views just refresh the live quote price.
    const tick = () => (/(m|h)$/.test(state.interval) ? refreshLive() : refreshQuote());
    setInterval(tick, 18000);
    // watchlist quotes on a gentler cadence, only while visible
    setInterval(() => {
      if (!document.hidden && !$('.layout').classList.contains('wl-collapsed')) refreshWatchQuotes();
    }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) tick();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

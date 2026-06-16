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
    view: 'lessons',
    explore: { mode: 'candles', ma20: false, ma50: false, ma200: false, ema20: false, volume: true, rsi: false, sr: false }
  };

  let chart;
  const C = { ma20: '#46b3ff', ma50: '#ffb020', ma200: '#e36bf0', ema: '#5be0c0' };

  // ---- persistence ---------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ symbol: state.symbol, lessonIdx: state.lessonIdx, stepIdx: state.stepIdx, view: state.view })
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
    } catch (_) {}
  }

  // ---- data ----------------------------------------------------------------
  function renderCurrentView() {
    if (state.view === 'lessons') renderStep();
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
      renderHeader();
      markUpdated(data);
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
    const chg = last.close - prev.close;
    const pct = (chg / prev.close) * 100;
    const up = chg >= 0;
    $('#hdrSymbol').textContent = d.symbol;
    $('#hdrName').textContent = d.name || d.exchange || '';
    $('#hdrPrice').textContent = last.close.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const chgEl = $('#hdrChange');
    chgEl.textContent = `${up ? '▲' : '▼'} ${Math.abs(chg).toFixed(2)} (${up ? '+' : ''}${pct.toFixed(2)}%)`;
    chgEl.className = 'hdr-change ' + (up ? 'pos' : 'neg');

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

  // ---- live polling --------------------------------------------------------
  let refreshing = false;
  const STATE_LABEL = { REGULAR: 'open', PRE: 'pre-market', PREPRE: 'pre-market', POST: 'after-hours', POSTPOST: 'after-hours', CLOSED: 'closed' };
  function markUpdated(data) {
    const live = !data.synthetic;
    const banner = $('#sampleBanner');
    if (banner) banner.style.display = data.synthetic ? 'flex' : 'none';
    const dot = $('#liveDot');
    const txt = $('#liveText');
    if (!live) {
      dot.style.display = 'none';
      txt.textContent = '';
      return;
    }
    const ms = data.marketState && STATE_LABEL[data.marketState];
    const now = new Date().toLocaleTimeString();
    dot.style.display = 'inline-block';
    dot.classList.toggle('idle', data.marketState && data.marketState !== 'REGULAR');
    txt.textContent = ms ? `Market ${ms} · updated ${now}` : `LIVE · updated ${now}`;
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
    chart.clearTeaching();
    chart.setMode(state.explore.mode);
    chart.toggle('volume', state.explore.volume);
    chart.toggle('rsi', state.explore.rsi);
    if (!keepView) chart.resetView();
    const closes = state.data.candles.map((c) => c.close);
    if (state.explore.ma20) chart.setOverlay('ma20', { data: window.TA.sma(closes, 20), color: C.ma20, label: 'SMA 20' });
    if (state.explore.ma50) chart.setOverlay('ma50', { data: window.TA.sma(closes, 50), color: C.ma50, label: 'SMA 50' });
    if (state.explore.ma200 && closes.length > 200) chart.setOverlay('ma200', { data: window.TA.sma(closes, 200), color: C.ma200, label: 'SMA 200' });
    if (state.explore.ema20) chart.setOverlay('ema20', { data: window.TA.ema(closes, 20), color: C.ema, label: 'EMA 20', dash: [5, 4] });
    if (state.explore.sr) {
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
  }

  function syncTabs() {
    $('#tabLessons').classList.toggle('active', state.view === 'lessons');
    $('#tabExplore').classList.toggle('active', state.view === 'explore');
    $('#lessonsView').style.display = state.view === 'lessons' ? 'flex' : 'none';
    $('#exploreView').style.display = state.view === 'explore' ? 'block' : 'none';
  }

  // ---- wiring --------------------------------------------------------------
  function bindUI() {
    $('#loadBtn').addEventListener('click', () => loadSymbol($('#symbolInput').value));
    $('#symbolInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loadSymbol($('#symbolInput').value);
    });
    document.querySelectorAll('.chip[data-sym]').forEach((c) =>
      c.addEventListener('click', () => loadSymbol(c.dataset.sym))
    );
    $('#rangeSelect').addEventListener('change', (e) => {
      const v = e.target.value;
      const map = {
        '1d': ['1d', '2m'], '5d': ['5d', '15m'], '1mo': ['1mo', '30m'],
        '6mo': ['6mo', '1d'], '1y': ['1y', '1d'], '5y': ['5y', '1wk'], 'max': ['max', '1mo']
      };
      [state.range, state.interval] = map[v] || ['1y', '1d'];
      loadSymbol(state.symbol);
    });

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

    $('#prevBtn').addEventListener('click', () => go(-1));
    $('#nextBtn').addEventListener('click', () => go(1));

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (state.view !== 'lessons') return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    });

    // explore toggles
    document.querySelectorAll('[data-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.dataset.toggle;
        if (key === 'mode') state.explore.mode = input.checked ? 'line' : 'candles';
        else state.explore[key] = input.checked;
        applyExplore();
      });
    });

    $('#resetViewBtn').addEventListener('click', () => chart.resetView());

    // adjusted-prices toggle (requires a reload)
    const adj = $('#adjustedToggle');
    if (adj)
      adj.addEventListener('change', () => {
        state.adjusted = adj.checked;
        loadSymbol(state.symbol);
      });

    // error overlay actions
    $('#errRetry').addEventListener('click', () => loadSymbol(state.symbol));
    $('#errSample').addEventListener('click', useSampleData);
  }

  // ---- boot ----------------------------------------------------------------
  async function boot() {
    restore();
    chart = new window.StockChart($('#chart'), { initialBars: 130 });
    bindUI();
    renderLessonList();
    syncTabs();
    await loadSymbol(state.symbol);
    if (state.view === 'lessons') renderStep();
    else applyExplore();

    // live auto-refresh: poll every ~20s (gentle on free sources; server also
    // caches), and immediately when the tab regains focus
    setInterval(refreshLive, 20000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshLive();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

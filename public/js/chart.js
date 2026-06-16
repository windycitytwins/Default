'use strict';

/**
 * chart.js — a small, dependency-free candlestick charting engine built on
 * <canvas>, designed specifically for *teaching*. Beyond drawing candles it
 * can render the things a tutor needs to point at:
 *
 *   • moving-average / indicator line overlays
 *   • horizontal levels and shaded support/resistance zones
 *   • markers pinned to individual candles (e.g. "golden cross")
 *   • callout annotations connected to a price/candle anchor
 *   • highlighted candle ranges ("look at this pullback")
 *   • a crosshair with an OHLC tooltip
 *   • click → {index, price} mapping for interactive exercises
 *   • drag to pan, wheel to zoom
 *
 * Exposed as window.StockChart.
 */
(function () {
  const THEME = {
    bg: '#0e1320',
    grid: 'rgba(255,255,255,0.05)',
    axis: '#8a93a6',
    text: '#c7cedb',
    up: '#26a17b',
    down: '#e0566a',
    upWick: '#26a17b',
    downWick: '#e0566a',
    crosshair: 'rgba(255,255,255,0.35)',
    volUp: 'rgba(38,161,123,0.45)',
    volDown: 'rgba(224,86,106,0.45)'
  };

  function fmtPrice(n) {
    if (n == null || isNaN(n)) return '–';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
    if (Math.abs(n) >= 100) return n.toFixed(2);
    return n.toFixed(2);
  }
  function fmtVol(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(ms, withYear) {
    const d = new Date(ms);
    const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    return withYear ? `${base} '${String(d.getFullYear()).slice(2)}` : base;
  }

  class StockChart {
    constructor(container, opts = {}) {
      this.container = container;
      this.opts = opts;
      this.theme = Object.assign({}, THEME, opts.theme || {});
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sc-canvas';
      container.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this.candles = [];
      this.mode = 'candles'; // 'candles' | 'line'
      this.flags = { volume: true, rsi: false };

      this.overlays = new Map(); // id -> {data:[null|num], color, width, label, dash}
      this.hlines = new Map(); // id -> {price, color, label, dash}
      this.zones = new Map(); // id -> {lo, hi, color, label}
      this.markers = []; // {index, side, color, text, shape}
      this.annotations = []; // {index, price, text, color, dx, dy}
      this.highlights = []; // {from, to, color, label}

      this.visStart = 0;
      this.visCount = 120;
      this.hover = null; // {index, x, y}
      this.listeners = { click: [], hover: [] };
      this.clickMode = false;

      this._pad = { top: 14, right: 64, bottom: 26, left: 8 };
      this._setupEvents();
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(container);
      this._resize();
    }

    // ---- public API --------------------------------------------------------
    setData(data) {
      this.meta = data;
      this.candles = data.candles || [];
      this.visCount = Math.min(this.candles.length, this.opts.initialBars || 130);
      this.visStart = Math.max(0, this.candles.length - this.visCount);
      this._recalcRSI();
      this.requestRender();
      return this;
    }
    /** Refresh candles in place for live polling, preserving the user's zoom/pan
     *  (and following the latest bar only if they were already viewing it). */
    updateData(data) {
      const prevLen = this.candles.length;
      const wasAtRight = this.visStart + this.visCount >= prevLen;
      this.meta = data;
      this.candles = data.candles || [];
      if (wasAtRight) this.visStart = Math.max(0, this.candles.length - this.visCount);
      this.clampView();
      this._recalcRSI();
      this.requestRender();
      return this;
    }
    clampView() {
      if (!this.candles.length) return;
      this.visCount = Math.max(10, Math.min(this.visCount, this.candles.length));
      this.visStart = Math.max(0, Math.min(this.visStart, this.candles.length - this.visCount));
    }
    setMode(m) {
      this.mode = m;
      this.requestRender();
    }
    toggle(flag, on) {
      this.flags[flag] = on;
      if (flag === 'rsi' && on) this._recalcRSI();
      this.requestRender();
    }
    setOverlay(id, cfg) {
      this.overlays.set(id, cfg);
      this.requestRender();
    }
    removeOverlay(id) {
      this.overlays.delete(id);
      this.requestRender();
    }
    clearOverlays() {
      this.overlays.clear();
      this.requestRender();
    }
    setHLine(id, cfg) {
      this.hlines.set(id, cfg);
      this.requestRender();
    }
    removeHLine(id) {
      this.hlines.delete(id);
      this.requestRender();
    }
    setZone(id, cfg) {
      this.zones.set(id, cfg);
      this.requestRender();
    }
    clearZones() {
      this.zones.clear();
      this.requestRender();
    }
    setMarkers(arr) {
      this.markers = arr || [];
      this.requestRender();
    }
    clearMarkers() {
      this.markers = [];
      this.requestRender();
    }
    setAnnotations(arr) {
      this.annotations = arr || [];
      this.requestRender();
    }
    clearAnnotations() {
      this.annotations = [];
      this.requestRender();
    }
    setHighlights(arr) {
      this.highlights = arr || [];
      this.requestRender();
    }
    clearHighlights() {
      this.highlights = [];
      this.requestRender();
    }
    /** Clear everything a lesson might have drawn. */
    clearTeaching() {
      this.overlays.clear();
      this.hlines.clear();
      this.zones.clear();
      this.markers = [];
      this.annotations = [];
      this.highlights = [];
      this.requestRender();
    }
    enableClickToMark(on) {
      this.clickMode = on;
      this.canvas.style.cursor = on ? 'crosshair' : 'default';
    }
    on(evt, cb) {
      if (this.listeners[evt]) this.listeners[evt].push(cb);
      return this;
    }
    off(evt, cb) {
      if (this.listeners[evt]) this.listeners[evt] = this.listeners[evt].filter((f) => f !== cb);
    }

    /** Move the visible window so [from,to] is comfortably in view. */
    focusRange(from, to, padFrac = 0.25) {
      if (this.candles.length === 0) return;
      from = Math.max(0, from);
      to = Math.min(this.candles.length - 1, to);
      const span = Math.max(8, to - from);
      const pad = Math.round(span * padFrac);
      this.visStart = Math.max(0, from - pad);
      const end = Math.min(this.candles.length, to + pad + 1);
      this.visCount = Math.max(10, end - this.visStart);
      this.requestRender();
    }
    resetView() {
      this.visCount = Math.min(this.candles.length, this.opts.initialBars || 130);
      this.visStart = Math.max(0, this.candles.length - this.visCount);
      this.requestRender();
    }

    // ---- geometry helpers --------------------------------------------------
    _layout() {
      const W = this.cssW;
      const H = this.cssH;
      const p = this._pad;
      const innerH = H - p.top - p.bottom;
      let volH = this.flags.volume ? Math.max(46, innerH * 0.16) : 0;
      let rsiH = this.flags.rsi ? Math.max(54, innerH * 0.2) : 0;
      const gap = (this.flags.volume || this.flags.rsi) ? 8 : 0;
      const priceH = innerH - volH - rsiH - (this.flags.volume ? gap : 0) - (this.flags.rsi ? gap : 0);
      const x = p.left;
      const w = W - p.left - p.right;
      let y = p.top;
      const price = { x, y, w, h: priceH };
      y += priceH + (this.flags.volume ? gap : 0);
      const vol = this.flags.volume ? { x, y, w, h: volH } : null;
      if (this.flags.volume) y += volH;
      y += this.flags.rsi ? gap : 0;
      const rsi = this.flags.rsi ? { x, y, w, h: rsiH } : null;
      return { price, vol, rsi, W, H };
    }
    _visible() {
      const s = this.visStart;
      const e = Math.min(this.candles.length, s + this.visCount);
      return { s, e };
    }
    _step(rect) {
      return rect.w / this.visCount;
    }
    _xOf(i, rect) {
      return rect.x + (i - this.visStart + 0.5) * this._step(rect);
    }
    _iOf(px, rect) {
      return Math.round((px - rect.x) / this._step(rect) - 0.5) + this.visStart;
    }

    _priceScale() {
      const { s, e } = this._visible();
      let min = Infinity;
      let max = -Infinity;
      for (let i = s; i < e; i++) {
        const c = this.candles[i];
        if (c.low < min) min = c.low;
        if (c.high > max) max = c.high;
      }
      // include visible overlay (MA) values so lines never clip off-screen
      for (const ov of this.overlays.values()) {
        for (let i = s; i < e; i++) {
          const v = ov.data[i];
          if (v == null) continue;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (!isFinite(min) || !isFinite(max)) {
        min = 0;
        max = 1;
      }
      const span = max - min || max || 1;
      min -= span * 0.08;
      max += span * 0.08;
      return { min, max };
    }

    // ---- rendering ---------------------------------------------------------
    requestRender() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.render();
      });
    }

    render() {
      const ctx = this.ctx;
      const L = this._layout();
      ctx.clearRect(0, 0, this.cssW, this.cssH);
      ctx.fillStyle = this.theme.bg;
      ctx.fillRect(0, 0, this.cssW, this.cssH);
      if (!this.candles.length) {
        ctx.fillStyle = this.theme.axis;
        ctx.font = '13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Loading…', this.cssW / 2, this.cssH / 2);
        return;
      }
      const scale = this._priceScale();
      this._scale = scale;
      this._L = L;
      const yOf = (price) =>
        L.price.y + L.price.h - ((price - scale.min) / (scale.max - scale.min)) * L.price.h;
      this._yOf = yOf;
      this._priceOf = (py) =>
        scale.min + ((L.price.y + L.price.h - py) / L.price.h) * (scale.max - scale.min);

      this._drawGrid(L, scale, yOf);
      this._drawZones(L, yOf);
      this._drawHighlights(L);
      if (this.mode === 'candles') this._drawCandles(L, yOf);
      else this._drawLine(L, yOf);
      this._drawOverlays(L, yOf);
      this._drawHLines(L, yOf);
      if (this.flags.volume && L.vol) this._drawVolume(L.vol);
      if (this.flags.rsi && L.rsi) this._drawRSI(L.rsi);
      this._drawMarkers(L, yOf);
      this._drawAnnotations(L, yOf);
      this._drawPriceAxis(L, scale, yOf);
      this._drawTimeAxis(L);
      this._drawCrosshair(L, yOf);
      this._drawLastPrice(L, yOf);
    }

    _drawGrid(L, scale, yOf) {
      const ctx = this.ctx;
      ctx.strokeStyle = this.theme.grid;
      ctx.lineWidth = 1;
      const ticks = this._priceTicks(scale, 6);
      ctx.beginPath();
      for (const t of ticks) {
        const y = Math.round(yOf(t)) + 0.5;
        ctx.moveTo(L.price.x, y);
        ctx.lineTo(L.price.x + L.price.w, y);
      }
      ctx.stroke();
    }

    _priceTicks(scale, count) {
      const range = scale.max - scale.min;
      const rough = range / count;
      const mag = Math.pow(10, Math.floor(Math.log10(rough)));
      const norm = rough / mag;
      let step;
      if (norm < 1.5) step = 1;
      else if (norm < 3) step = 2;
      else if (norm < 7) step = 5;
      else step = 10;
      step *= mag;
      const ticks = [];
      const start = Math.ceil(scale.min / step) * step;
      for (let v = start; v <= scale.max; v += step) ticks.push(v);
      return ticks;
    }

    _drawZones(L, yOf) {
      const ctx = this.ctx;
      for (const [, z] of this.zones) {
        const yHi = yOf(z.hi);
        const yLo = yOf(z.lo);
        const top = Math.min(yHi, yLo);
        const h = Math.max(2, Math.abs(yLo - yHi));
        ctx.fillStyle = z.color || 'rgba(120,160,255,0.16)';
        ctx.fillRect(L.price.x, top, L.price.w, h);
        if (z.label) {
          ctx.fillStyle = z.labelColor || 'rgba(200,220,255,0.9)';
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(z.label, L.price.x + 8, top + 13);
        }
      }
    }

    _drawHighlights(L) {
      const ctx = this.ctx;
      for (const h of this.highlights) {
        const x0 = this._xOf(h.from, L.price) - this._step(L.price) / 2;
        const x1 = this._xOf(h.to, L.price) + this._step(L.price) / 2;
        ctx.fillStyle = h.color || 'rgba(255,205,80,0.12)';
        ctx.fillRect(x0, L.price.y, x1 - x0, L.price.h + (L.vol ? L.vol.h + 8 : 0));
        if (h.label) {
          ctx.fillStyle = h.labelColor || 'rgba(255,224,150,0.95)';
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(h.label, (x0 + x1) / 2, L.price.y + 12);
        }
      }
    }

    _drawCandles(L, yOf) {
      const ctx = this.ctx;
      const { s, e } = this._visible();
      const step = this._step(L.price);
      const bw = Math.max(1, Math.min(step * 0.7, 18));
      for (let i = s; i < e; i++) {
        const c = this.candles[i];
        const x = this._xOf(i, L.price);
        const up = c.close >= c.open;
        const col = up ? this.theme.up : this.theme.down;
        ctx.strokeStyle = up ? this.theme.upWick : this.theme.downWick;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, yOf(c.high));
        ctx.lineTo(Math.round(x) + 0.5, yOf(c.low));
        ctx.stroke();
        const yO = yOf(c.open);
        const yC = yOf(c.close);
        const top = Math.min(yO, yC);
        const bh = Math.max(1, Math.abs(yC - yO));
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(x - bw / 2), Math.round(top), Math.round(bw), Math.max(1, Math.round(bh)));
      }
    }

    _drawLine(L, yOf) {
      const ctx = this.ctx;
      const { s, e } = this._visible();
      ctx.strokeStyle = '#5b8cff';
      ctx.lineWidth = 1.8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (let i = s; i < e; i++) {
        const x = this._xOf(i, L.price);
        const y = yOf(this.candles[i].close);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // soft fill under the line
      const grad = ctx.createLinearGradient(0, L.price.y, 0, L.price.y + L.price.h);
      grad.addColorStop(0, 'rgba(91,140,255,0.18)');
      grad.addColorStop(1, 'rgba(91,140,255,0)');
      ctx.lineTo(this._xOf(e - 1, L.price), L.price.y + L.price.h);
      ctx.lineTo(this._xOf(s, L.price), L.price.y + L.price.h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    _drawOverlays(L, yOf) {
      const ctx = this.ctx;
      const { s, e } = this._visible();
      ctx.save();
      ctx.beginPath();
      ctx.rect(L.price.x, L.price.y, L.price.w, L.price.h);
      ctx.clip();
      for (const [, ov] of this.overlays) {
        ctx.strokeStyle = ov.color;
        ctx.lineWidth = ov.width || 1.6;
        ctx.setLineDash(ov.dash || []);
        ctx.beginPath();
        let started = false;
        for (let i = s; i < e; i++) {
          const v = ov.data[i];
          if (v == null) {
            started = false;
            continue;
          }
          const x = this._xOf(i, L.price);
          const y = yOf(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    }

    _drawHLines(L, yOf) {
      const ctx = this.ctx;
      for (const [, ln] of this.hlines) {
        const y = Math.round(yOf(ln.price)) + 0.5;
        if (y < L.price.y - 2 || y > L.price.y + L.price.h + 2) continue;
        ctx.strokeStyle = ln.color || '#ffd166';
        ctx.lineWidth = ln.width || 1.4;
        ctx.setLineDash(ln.dash || [6, 4]);
        ctx.beginPath();
        ctx.moveTo(L.price.x, y);
        ctx.lineTo(L.price.x + L.price.w, y);
        ctx.stroke();
        ctx.setLineDash([]);
        const tag = (ln.label ? ln.label + '  ' : '') + fmtPrice(ln.price);
        ctx.font = '11px system-ui, sans-serif';
        const tw = ctx.measureText(tag).width + 10;
        ctx.fillStyle = ln.color || '#ffd166';
        ctx.fillRect(L.price.x + L.price.w - tw, y - 8, tw, 16);
        ctx.fillStyle = '#0e1320';
        ctx.textAlign = 'right';
        ctx.fillText(tag, L.price.x + L.price.w - 5, y + 4);
      }
    }

    _drawVolume(rect) {
      const ctx = this.ctx;
      const { s, e } = this._visible();
      let maxV = 0;
      for (let i = s; i < e; i++) if (this.candles[i].volume > maxV) maxV = this.candles[i].volume;
      if (maxV <= 0) maxV = 1;
      const step = this._step(rect);
      const bw = Math.max(1, Math.min(step * 0.7, 18));
      for (let i = s; i < e; i++) {
        const c = this.candles[i];
        const h = (c.volume / maxV) * (rect.h - 4);
        const x = this._xOf(i, rect);
        ctx.fillStyle = c.close >= c.open ? this.theme.volUp : this.theme.volDown;
        ctx.fillRect(Math.round(x - bw / 2), rect.y + rect.h - h, Math.round(bw), h);
      }
      ctx.fillStyle = this.theme.axis;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Volume', rect.x + 4, rect.y + 11);
    }

    _recalcRSI() {
      if (!this.candles.length || !window.TA) {
        this._rsi = null;
        return;
      }
      this._rsi = window.TA.rsi(window.TA.closes(this.candles), 14);
    }

    _drawRSI(rect) {
      const ctx = this.ctx;
      if (!this._rsi) this._recalcRSI();
      const rsi = this._rsi;
      const { s, e } = this._visible();
      const yOf = (v) => rect.y + rect.h - (v / 100) * rect.h;
      // bands
      ctx.fillStyle = 'rgba(224,86,106,0.08)';
      ctx.fillRect(rect.x, yOf(100), rect.w, yOf(70) - yOf(100));
      ctx.fillStyle = 'rgba(38,161,123,0.08)';
      ctx.fillRect(rect.x, yOf(30), rect.w, yOf(0) - yOf(30));
      ctx.strokeStyle = this.theme.grid;
      ctx.setLineDash([4, 4]);
      [30, 50, 70].forEach((lvl) => {
        const y = Math.round(yOf(lvl)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(rect.x, y);
        ctx.lineTo(rect.x + rect.w, y);
        ctx.stroke();
        ctx.fillStyle = this.theme.axis;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(lvl), rect.x + rect.w + 30, y + 3);
      });
      ctx.setLineDash([]);
      ctx.strokeStyle = '#b083ff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      let started = false;
      for (let i = s; i < e; i++) {
        const v = rsi[i];
        if (v == null) {
          started = false;
          continue;
        }
        const x = this._xOf(i, rect);
        const y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = this.theme.axis;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('RSI (14)', rect.x + 4, rect.y + 11);
    }

    _drawMarkers(L, yOf) {
      const ctx = this.ctx;
      const { s, e } = this._visible();
      for (const m of this.markers) {
        if (m.index < s || m.index >= e) continue;
        const c = this.candles[m.index];
        const x = this._xOf(m.index, L.price);
        const above = m.side !== 'below';
        const y = above ? yOf(c.high) - 14 : yOf(c.low) + 14;
        ctx.fillStyle = m.color || '#ffd166';
        // triangle
        ctx.beginPath();
        if (above) {
          ctx.moveTo(x, y + 8);
          ctx.lineTo(x - 6, y);
          ctx.lineTo(x + 6, y);
        } else {
          ctx.moveTo(x, y - 8);
          ctx.lineTo(x - 6, y);
          ctx.lineTo(x + 6, y);
        }
        ctx.closePath();
        ctx.fill();
        if (m.text) {
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          const tw = ctx.measureText(m.text).width + 10;
          const ty = above ? y - 9 : y + 9;
          ctx.fillStyle = m.color || '#ffd166';
          ctx.fillRect(x - tw / 2, above ? ty - 13 : ty, tw, 15);
          ctx.fillStyle = '#0e1320';
          ctx.fillText(m.text, x, above ? ty - 2 : ty + 11);
        }
      }
    }

    _drawAnnotations(L, yOf) {
      const ctx = this.ctx;
      const { s, e } = this._visible();
      for (const a of this.annotations) {
        if (a.index < s || a.index >= e) continue;
        const ax = this._xOf(a.index, L.price);
        const ay = a.price != null ? yOf(a.price) : yOf(this.candles[a.index].close);
        const dx = a.dx == null ? 40 : a.dx;
        const dy = a.dy == null ? -36 : a.dy;
        const bx = ax + dx;
        const by = ay + dy;
        ctx.strokeStyle = a.color || '#7aa2ff';
        ctx.fillStyle = a.color || '#7aa2ff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ax, ay, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '12px system-ui, sans-serif';
        const lines = String(a.text).split('\n');
        let maxw = 0;
        lines.forEach((l) => (maxw = Math.max(maxw, ctx.measureText(l).width)));
        const padX = 8;
        const lh = 15;
        const boxW = maxw + padX * 2;
        const boxH = lines.length * lh + 8;
        let boxX = dx >= 0 ? bx : bx - boxW;
        let boxY = by - boxH / 2;
        boxX = Math.max(L.price.x + 2, Math.min(boxX, L.price.x + L.price.w - boxW - 2));
        boxY = Math.max(L.price.y + 2, Math.min(boxY, L.price.y + L.price.h - boxH - 2));
        ctx.fillStyle = 'rgba(20,26,40,0.92)';
        ctx.strokeStyle = a.color || '#7aa2ff';
        this._roundRect(boxX, boxY, boxW, boxH, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = a.textColor || '#e8edf6';
        ctx.textAlign = 'left';
        lines.forEach((l, i) => ctx.fillText(l, boxX + padX, boxY + 16 + i * lh));
      }
    }

    _roundRect(x, y, w, h, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    _drawPriceAxis(L, scale, yOf) {
      const ctx = this.ctx;
      ctx.fillStyle = this.theme.text;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      for (const t of this._priceTicks(scale, 6)) {
        const y = yOf(t);
        if (y < L.price.y - 4 || y > L.price.y + L.price.h + 4) continue;
        ctx.fillText(fmtPrice(t), L.price.x + L.price.w + 6, y + 4);
      }
    }

    _drawTimeAxis(L) {
      const ctx = this.ctx;
      const { s, e } = this._visible();
      ctx.fillStyle = this.theme.text;
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const minGap = 70;
      let lastX = -Infinity;
      let lastYear = null;
      const y = L.price.y + L.price.h + (L.vol ? L.vol.h + 8 : 0) + (L.rsi ? L.rsi.h + 8 : 0) + 16;
      for (let i = s; i < e; i++) {
        const x = this._xOf(i, L.price);
        if (x - lastX < minGap) continue;
        const d = new Date(this.candles[i].time);
        const yr = d.getFullYear();
        ctx.fillText(fmtDate(this.candles[i].time, yr !== lastYear), x, y);
        lastYear = yr;
        lastX = x;
      }
    }

    _drawLastPrice(L, yOf) {
      const ctx = this.ctx;
      const last = this.candles[this.candles.length - 1];
      if (!last) return;
      const y = yOf(last.close);
      if (y < L.price.y || y > L.price.y + L.price.h) return;
      const up = last.close >= last.open;
      ctx.strokeStyle = up ? this.theme.up : this.theme.down;
      ctx.setLineDash([2, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L.price.x, y);
      ctx.lineTo(L.price.x + L.price.w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const tag = fmtPrice(last.close);
      ctx.font = 'bold 11px system-ui, sans-serif';
      const tw = ctx.measureText(tag).width + 10;
      ctx.fillStyle = up ? this.theme.up : this.theme.down;
      ctx.fillRect(L.price.x + L.price.w, y - 8, tw, 16);
      ctx.fillStyle = '#0e1320';
      ctx.textAlign = 'left';
      ctx.fillText(tag, L.price.x + L.price.w + 5, y + 4);
    }

    _drawCrosshair(L, yOf) {
      if (!this.hover) return;
      const ctx = this.ctx;
      const { s, e } = this._visible();
      const i = Math.max(s, Math.min(e - 1, this.hover.index));
      const c = this.candles[i];
      if (!c) return;
      const x = this._xOf(i, L.price);
      ctx.strokeStyle = this.theme.crosshair;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, L.price.y);
      const bottom =
        L.price.y + L.price.h + (L.vol ? L.vol.h + 8 : 0) + (L.rsi ? L.rsi.h + 8 : 0);
      ctx.lineTo(x, bottom);
      if (this.hover.y >= L.price.y && this.hover.y <= L.price.y + L.price.h) {
        ctx.moveTo(L.price.x, this.hover.y);
        ctx.lineTo(L.price.x + L.price.w, this.hover.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // price tag on axis
      if (this.hover.y >= L.price.y && this.hover.y <= L.price.y + L.price.h) {
        const p = this._priceOf(this.hover.y);
        const tag = fmtPrice(p);
        ctx.font = '11px system-ui, sans-serif';
        const tw = ctx.measureText(tag).width + 10;
        ctx.fillStyle = '#2a3550';
        ctx.fillRect(L.price.x + L.price.w, this.hover.y - 8, tw, 16);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(tag, L.price.x + L.price.w + 5, this.hover.y + 4);
      }
      this._drawTooltip(L, i, c, x);
    }

    _drawTooltip(L, i, c, x) {
      const ctx = this.ctx;
      const up = c.close >= c.open;
      const chg = i > 0 ? c.close - this.candles[i - 1].close : 0;
      const chgPct = i > 0 ? (chg / this.candles[i - 1].close) * 100 : 0;
      const rows = [
        [fmtDate(c.time, true), ''],
        ['O', fmtPrice(c.open)],
        ['H', fmtPrice(c.high)],
        ['L', fmtPrice(c.low)],
        ['C', fmtPrice(c.close)],
        ['Vol', fmtVol(c.volume)],
        ['Chg', `${chg >= 0 ? '+' : ''}${fmtPrice(chg)} (${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%)`]
      ];
      // include overlay values
      for (const [id, ov] of this.overlays) {
        const v = ov.data[i];
        if (v != null) rows.push([ov.label || id, fmtPrice(v), ov.color]);
      }
      ctx.font = '11px system-ui, sans-serif';
      let w = 0;
      rows.forEach((r) => {
        w = Math.max(w, ctx.measureText(r[0]).width + ctx.measureText(r[1]).width);
      });
      const boxW = w + 34;
      const boxH = rows.length * 15 + 10;
      let bx = x + 14;
      if (bx + boxW > L.price.x + L.price.w) bx = x - boxW - 14;
      bx = Math.max(L.price.x + 2, bx);
      const by = L.price.y + 6;
      ctx.fillStyle = 'rgba(16,21,33,0.94)';
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      this._roundRect(bx, by, boxW, boxH, 6);
      ctx.fill();
      ctx.stroke();
      rows.forEach((r, idx) => {
        const ry = by + 16 + idx * 15;
        ctx.textAlign = 'left';
        ctx.fillStyle = r[2] || (idx === 0 ? '#aeb8cc' : '#8a93a6');
        ctx.font = idx === 0 ? 'bold 11px system-ui' : '11px system-ui';
        ctx.fillText(r[0], bx + 9, ry);
        ctx.textAlign = 'right';
        ctx.fillStyle = idx === 0 ? '#aeb8cc' : up && idx >= 1 ? '#dfe6f2' : '#dfe6f2';
        if (r[2]) ctx.fillStyle = r[2];
        ctx.fillText(r[1], bx + boxW - 9, ry);
      });
    }

    // ---- events ------------------------------------------------------------
    _setupEvents() {
      const c = this.canvas;
      let dragging = false;
      let moved = false;
      let lastX = 0;
      let downStart = 0;

      c.addEventListener('mousemove', (ev) => {
        const r = c.getBoundingClientRect();
        const px = ev.clientX - r.left;
        const py = ev.clientY - r.top;
        if (dragging) {
          const dxPix = px - lastX;
          const step = this._step(this._L ? this._L.price : { w: this.cssW });
          const shift = Math.round(-dxPix / step);
          if (shift !== 0) {
            this.visStart = Math.max(
              0,
              Math.min(this.candles.length - this.visCount, this.visStart + shift)
            );
            lastX = px;
            moved = true;
          }
        }
        const idx = this._L ? this._iOf(px, this._L.price) : 0;
        this.hover = { index: idx, x: px, y: py };
        this._emit('hover', { index: idx, price: this._priceOf ? this._priceOf(py) : 0 });
        this.requestRender();
      });
      c.addEventListener('mouseleave', () => {
        this.hover = null;
        dragging = false;
        this.requestRender();
      });
      c.addEventListener('mousedown', (ev) => {
        const r = c.getBoundingClientRect();
        lastX = ev.clientX - r.left;
        downStart = lastX;
        dragging = !this.clickMode;
        moved = false;
        if (!this.clickMode) c.style.cursor = 'grabbing';
      });
      window.addEventListener('mouseup', (ev) => {
        if (!dragging && !this.clickMode) return;
        const wasDrag = moved;
        dragging = false;
        c.style.cursor = this.clickMode ? 'crosshair' : 'default';
        if (!wasDrag) {
          const r = c.getBoundingClientRect();
          const px = ev.clientX - r.left;
          const py = ev.clientY - r.top;
          if (px >= 0 && px <= this.cssW && py >= 0 && py <= this.cssH && this._L) {
            const idx = this._iOf(px, this._L.price);
            const price = this._priceOf(py);
            this._emit('click', { index: idx, price, x: px, y: py });
          }
        }
      });
      c.addEventListener(
        'wheel',
        (ev) => {
          if (!this._L) return;
          ev.preventDefault();
          const r = c.getBoundingClientRect();
          const px = ev.clientX - r.left;
          const anchorI = this._iOf(px, this._L.price);
          const factor = ev.deltaY > 0 ? 1.12 : 0.89;
          let newCount = Math.round(this.visCount * factor);
          newCount = Math.max(20, Math.min(this.candles.length, newCount));
          const rel = (anchorI - this.visStart) / this.visCount;
          this.visCount = newCount;
          this.visStart = Math.round(anchorI - rel * newCount);
          this.visStart = Math.max(0, Math.min(this.candles.length - this.visCount, this.visStart));
          this.requestRender();
        },
        { passive: false }
      );
    }

    _emit(evt, payload) {
      (this.listeners[evt] || []).forEach((f) => f(payload));
    }

    _resize() {
      const rect = this.container.getBoundingClientRect();
      this.cssW = Math.max(320, rect.width);
      this.cssH = Math.max(260, rect.height);
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(this.cssW * dpr);
      this.canvas.height = Math.round(this.cssH * dpr);
      this.canvas.style.width = this.cssW + 'px';
      this.canvas.style.height = this.cssH + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.requestRender();
    }

    destroy() {
      this._ro.disconnect();
      this.canvas.remove();
    }
  }

  window.StockChart = StockChart;
})();

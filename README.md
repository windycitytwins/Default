# 📈 Chart School

An **interactive tutor that teaches you how to read stock charts** — using
**live market data**. Pick any ticker and work through guided lessons that
draw directly on the real chart: candlesticks, trends, support & resistance,
moving averages, volume, and RSI.

## What's inside

- **A live, interactive candlestick chart** (custom-built on `<canvas>`, no
  charting libraries) with drag-to-pan, scroll-to-zoom, a crosshair + OHLC
  tooltip, moving-average overlays, shaded support/resistance zones, crossover
  markers and callout annotations.
- **A 7-lesson curriculum**, each step illustrated on the *real* chart and
  punctuated with quick quizzes and a click-on-the-chart exercise:
  1. 🕯️ **Reading a Candlestick** — open/high/low/close, body & wicks, green vs red
  2. 📈 **Trends & Structure** — higher highs/lows, swing points
  3. 🧱 **Support & Resistance** — floors, ceilings, role reversal *(+ interactive task)*
  4. ➰ **Moving Averages** — SMA vs EMA, golden/death crosses, dynamic support
  5. 📊 **Volume** — conviction behind a move
  6. ⚡ **Momentum (RSI)** — overbought/oversold, divergence
  7. 🎯 **Putting It Together** — reading with confluence + a final check
- **An Explore sandbox** — toggle any indicator on any symbol and practise.
- **Live data with zero setup** — a tiny Node proxy fetches prices from
  **Yahoo Finance**, falling back to **Stooq**, with **no API key required**.
  If there's no internet at all, the app still works on realistic offline
  demo data so the lessons never break.

## Run it

Requires **Node.js 18+**. No `npm install` needed — there are no dependencies.

```bash
node server.js
```

Then open **http://localhost:5173**.

> Tip: change the port with `PORT=8080 node server.js`.

### Using it

- Type a ticker (e.g. `AAPL`, `MSFT`, `NVDA`, `SPY`, `BTC-USD`) and press **Load**,
  or click a quick-pick chip. Change the timeframe with the dropdown.
- Walk the **Lessons** tab with **Next / Prev** (or the ← → arrow keys).
- Switch to **Explore** to toggle indicators freely.
- Every lesson re-derives its annotations from whatever symbol is loaded, so
  try the same lesson on a trending stock vs a choppy one.

## How live data works

The browser never calls a data provider directly (that would hit CORS limits).
Instead it asks our own server:

```
GET /api/chart?symbol=AAPL&range=1y&interval=1d
```

`server.js` fetches that server-side from Yahoo Finance → Stooq, normalizes it
to candles, and returns JSON. The data layer in the browser falls back to a
deterministic synthetic series if the server can't reach a provider.

## Project layout

```
server.js              Zero-dependency static server + live-data proxy
public/
  index.html           App shell
  css/styles.css       Dark, financial-app styling
  js/
    indicators.js      SMA, EMA, RSI, pivots, support/resistance, crossovers
    data.js            Loads /api/chart; deterministic offline fallback
    chart.js           Canvas charting engine (candles, overlays, annotations)
    lessons.js         The interactive curriculum
    app.js             UI wiring: navigation, quizzes, exercises, Explore
```

---

*Educational tool only — not financial advice.*

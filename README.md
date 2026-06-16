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
- **Real, accurate live & historical data — free, no API key.** A tiny Node
  proxy fetches prices from **Yahoo Finance** (the same feed behind
  finance.yahoo.com), with **Stooq** as an accuracy backstop. It uses
  retries, host rotation and a cookie warm-up to be reliable, and supports
  **split/dividend-adjusted** prices and **every timeframe** from 1-minute
  intraday to monthly/max history.
- **Honest by design.** It **never shows fabricated data as real** — if a
  fetch fails you get a clear error + Retry, and synthetic "sample data" only
  appears if you explicitly ask for it (with a loud banner).
- **Verify it yourself:** `node verify-data.js AAPL` prints the latest bars so
  you can cross-check against Yahoo/Google.

## Run it

### Option A — just look at it (no setup)

Open **`chart-school.html`** (a single self-contained file) directly in your
browser. It runs the full tutor on realistic offline demo data — no server, no
install. Great for a quick look.

### Option B — live market data

Requires **Node.js 18+**. No `npm install` needed — there are no dependencies.

```bash
node server.js
```

Then open **http://localhost:8123**.

First, confirm you're getting real, accurate data (compare to finance.yahoo.com):

```bash
node verify-data.js AAPL          # daily; also: node verify-data.js TSLA 5d 15m
```

> Tip: change the port with `PORT=8080 node server.js`.
> Build/refresh the standalone file with `node build-standalone.js`.

## Reliability & accuracy

- **Keyless by default — no token, no signup.** Data is pulled from several free
  sources in rotation and the app uses whichever is responding:
  **Yahoo Finance** (full cookie + crumb handshake) → **Nasdaq** (official API) →
  **Stooq**. Numbers match finance.yahoo.com.
- **Server-side caching + gentle request rates** keep us under the providers'
  anti-scraping throttles, so you rarely get rate-limited in the first place.
- **It never fabricates data.** If every real source fails you get a clear error
  with the reason; "sample data" only appears if you explicitly choose it.
- **Inherent caveat (honest):** no *free + keyless + unlimited + 100%-reliable*
  feed exists. With several sources in rotation, a total block is uncommon — but
  if every source throttles your IP at once, wait ~10–30 min (the blocks are
  temporary). There is **no hard daily cap**.
- **Optional, still-free** bulletproofing if you ever want zero waiting: a free
  Twelve Data key (https://twelvedata.com/pricing) used first when present:
  ```bash
  TWELVEDATA_KEY=your_key node server.js
  ```
- Diagnose any time: `node verify-data.js SYMBOL` prints a per-provider report
  (HTTP status + response). Also `GET /api/diagnose?symbol=AAPL`.

> Note: intraday (1-/2-/15-min) data is served by Yahoo; Nasdaq & Stooq cover
> daily/weekly/monthly. So daily & historical have the most keyless redundancy.

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

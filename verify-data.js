'use strict';

/**
 * verify-data.js — prove the data is real & accurate.
 *
 *   node verify-data.js AAPL
 *   node verify-data.js MSFT 5d 15m
 *
 * Fetches via the exact same providers the app uses and prints the most recent
 * bars so you can compare them against finance.yahoo.com / Google Finance.
 */
const { fromYahoo, fromStooq } = require('./server.js');

const symbol = (process.argv[2] || 'AAPL').toUpperCase();
const range = process.argv[3] || '1mo';
const interval = process.argv[4] || '1d';

function fmt(n) {
  return n == null ? '—' : Number(n).toFixed(2);
}
function fmtVol(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}
function printRows(data) {
  const rows = data.candles.slice(-7);
  console.log(`\n  Source:    ${data.source}`);
  if (data.name) console.log(`  Name:      ${data.name}`);
  if (data.exchange) console.log(`  Exchange:  ${data.exchange} ${data.currency ? '(' + data.currency + ')' : ''}`);
  console.log(`  Fetched:   ${new Date(data.fetchedAt || Date.now()).toLocaleString()}`);
  console.log(`  Bars:      ${data.candles.length} total · showing last ${rows.length}\n`);
  console.log('  ' + ['Date/Time', 'Open', 'High', 'Low', 'Close', 'Volume'].map((h, i) => (i === 0 ? h.padEnd(20) : h.padStart(10))).join(''));
  console.log('  ' + '-'.repeat(80));
  for (const c of rows) {
    const d = new Date(c.time);
    const label = interval.match(/m|h/) ? d.toLocaleString() : d.toISOString().slice(0, 10);
    console.log(
      '  ' +
        label.padEnd(20) +
        fmt(c.open).padStart(10) +
        fmt(c.high).padStart(10) +
        fmt(c.low).padStart(10) +
        fmt(c.close).padStart(10) +
        fmtVol(c.volume).padStart(10)
    );
  }
  const last = data.candles[data.candles.length - 1];
  console.log(`\n  ✅ Latest close: ${data.currency || '$'} ${fmt(last.close)}  (as of ${new Date(last.time).toLocaleString()})`);
  console.log(`\n  Cross-check this against:`);
  console.log(`     https://finance.yahoo.com/quote/${symbol}`);
  console.log(`     https://www.google.com/finance/quote/${symbol}\n`);
}

(async () => {
  console.log(`\n  Verifying real data for ${symbol}  (range=${range}, interval=${interval})…`);
  try {
    const data = await fromYahoo(symbol, range, interval);
    printRows(data);
  } catch (e) {
    console.log(`\n  Yahoo failed (${e.message}); trying Stooq backup…`);
    try {
      const data = await fromStooq(symbol);
      printRows(data);
    } catch (e2) {
      console.error(`\n  ❌ Could not fetch real data: ${e2.message}`);
      console.error(`     Check the ticker symbol and your internet connection.\n`);
      process.exit(1);
    }
  }
})();

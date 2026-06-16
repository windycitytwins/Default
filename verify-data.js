'use strict';

/**
 * verify-data.js — prove the data is real & accurate, and diagnose failures.
 *
 *   node verify-data.js AAPL
 *   node verify-data.js MSFT 5d 15m
 *
 * On success it prints the latest real bars (cross-check against Yahoo/Google).
 * On failure it prints a per-provider report (HTTP status + response snippet)
 * so the exact cause is visible.
 */
const { loadChart, diagnose } = require('./server.js');

const symbol = (process.argv[2] || 'AAPL').toUpperCase();
const range = process.argv[3] || '1mo';
const interval = process.argv[4] || '1d';

const f2 = (n) => (n == null ? '—' : Number(n).toFixed(2));
const fv = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n || 0));

function printBars(data) {
  const rows = data.candles.slice(-7);
  console.log(`\n  ✅ SUCCESS — real data via ${data.source}`);
  if (data.name) console.log(`     ${data.name}  ${data.exchange ? '· ' + data.exchange : ''} ${data.currency ? '(' + data.currency + ')' : ''}`);
  console.log(`     ${data.candles.length} bars · fetched ${new Date(data.fetchedAt || Date.now()).toLocaleString()}\n`);
  console.log('  ' + ['Date/Time', 'Open', 'High', 'Low', 'Close', 'Volume'].map((h, i) => (i === 0 ? h.padEnd(21) : h.padStart(11))).join(''));
  console.log('  ' + '-'.repeat(86));
  for (const c of rows) {
    const d = new Date(c.time);
    const label = /m|h/.test(interval) ? d.toLocaleString() : d.toISOString().slice(0, 10);
    console.log('  ' + label.padEnd(21) + f2(c.open).padStart(11) + f2(c.high).padStart(11) + f2(c.low).padStart(11) + f2(c.close).padStart(11) + fv(c.volume).padStart(11));
  }
  const last = data.candles[data.candles.length - 1];
  console.log(`\n  Latest close: ${f2(last.close)}  (as of ${new Date(last.time).toLocaleString()})`);
  console.log(`  Cross-check:  https://finance.yahoo.com/quote/${symbol}\n`);
}

function printDiagnostics(report) {
  console.log(`\n  ❌ Could not fetch real data for ${symbol}. Per-provider report:\n`);
  for (const a of report.attempts) {
    if (a.ok) {
      console.log(`     ✓ ${a.provider}: OK (${a.bars} bars, ${a.ms}ms) latest close ${f2(a.latest.close)}`);
    } else {
      console.log(`     ✗ ${a.provider}: ${a.error}  [HTTP ${a.status}, ${a.ms}ms]`);
      if (a.snippet) console.log(`        ↳ ${a.snippet}`);
    }
  }
  console.log('');
  console.log('  All free keyless sources are throttling your IP at this moment.');
  console.log('  These blocks are temporary and provider-side. Options:');
  console.log('    • Wait ~10–30 min and retry — the app rotates across Yahoo, Nasdaq');
  console.log('      and Stooq, so a total outage like this is uncommon.');
  if (!report.twelveDataKey) {
    console.log('    • (Optional, still free) a Twelve Data key removes the wait entirely:');
    console.log('        https://twelvedata.com/pricing → TWELVEDATA_KEY=key node server.js');
  }
  console.log('');
}

(async () => {
  console.log(`\n  Verifying real data for ${symbol}  (range=${range}, interval=${interval})…`);
  try {
    const { data } = await loadChart(symbol, range, interval);
    printBars(data);
    process.exit(0);
  } catch (_) {
    try {
      const report = await diagnose(symbol);
      printDiagnostics(report);
    } catch (e) {
      console.error('  Diagnostics failed:', e.message);
    }
    process.exit(1);
  }
})();

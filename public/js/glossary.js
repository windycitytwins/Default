'use strict';

/**
 * glossary.js — an in-app reference library: concise explainers for the terms
 * and "how to read it" topics a trader needs, each linking out to authoritative
 * sources. Educational only. Exposed on window.GLOSSARY.
 */
(function () {
  const GLOSSARY = [
    {
      title: 'Chart reading',
      icon: '📊',
      items: [
        { term: 'Candlestick', html: 'One bar showing the <b>open, high, low, close</b> for a period. The body is open→close; the wicks reach the high and low. Green = closed up, red = closed down.' },
        { term: 'Support & resistance', html: 'Price areas where falling prices have tended to bounce (support / floor) or rallies have stalled (resistance / ceiling). Broken levels often flip role.' },
        { term: 'Moving average (SMA/EMA)', html: 'The average price over N periods, sliding forward. EMA weights recent prices more, so it turns faster. The 9/21 EMAs and 50/200 SMAs are the most watched.' },
        { term: 'RSI', html: 'Momentum oscillator (0–100). >70 overbought, <30 oversold — but strong trends can stay stretched for a while.', links: [{ label: 'Technical analysis (Investopedia)', url: 'https://www.investopedia.com/terms/t/technicalanalysis.asp' }] }
      ]
    },
    {
      title: 'Fundamentals',
      icon: '💵',
      items: [
        { term: 'EPS (earnings per share)', html: 'Net income ÷ shares outstanding. The headline number markets react to each quarter; compare actual vs the analyst estimate.' },
        { term: 'P/E ratio', html: 'Price ÷ EPS — how many dollars you pay per dollar of earnings. High P/E ≠ avoid: the best-performing growth names usually stay "expensive."' },
        { term: 'Market cap', html: 'Share price × shares outstanding — the company\'s total equity value. Drives whether it\'s a large/mid/small cap.' },
        { term: 'How to read an earnings report', html: 'Check revenue & EPS vs estimates, guidance for next quarter, margins, and the conference-call tone — guidance often moves the stock more than the print itself.', links: [{ label: 'Decoding earnings reports (Investopedia)', url: 'https://www.investopedia.com/articles/fundamental-analysis/10/decoding-earnings-reports.asp' }, { label: 'How to read an earnings report (Nasdaq)', url: 'https://www.nasdaq.com/articles/how-to-read-an-earnings-report-2021-04-23' }] },
        { term: 'How to read a balance sheet', html: 'Assets = Liabilities + Equity. Watch cash, debt levels, and the trend over time — a fortress balance sheet survives downturns; a leveraged one is fragile.', links: [{ label: 'How to read a balance sheet (HBS)', url: 'https://online.hbs.edu/blog/post/how-to-read-a-balance-sheet' }, { label: 'Reading the balance sheet (Investopedia)', url: 'https://www.investopedia.com/articles/04/031004.asp' }] }
      ]
    },
    {
      title: 'SEC filings',
      icon: '📄',
      items: [
        { term: '10-K / 10-Q', html: 'Annual (10-K) and quarterly (10-Q) reports — the full audited/unaudited financials, risk factors and management discussion. The primary source of truth.' },
        { term: '8-K', html: 'A "current report" filed for material events between quarters — earnings, M&A, executive changes, big contracts. Often the catalyst.' },
        { term: 'S-1', html: 'The IPO registration statement — read before a company goes public.' },
        { term: 'Form 4 / 13F', html: 'Form 4 = insider buys/sells (executives, directors). 13F = quarterly holdings of large institutions/hedge funds. Both reveal "smart money" activity.' },
        { term: 'Where to find them', html: 'Every public filing is free on SEC EDGAR. (This app pulls recent filings for the loaded ticker in the Research tab.)', links: [{ label: 'SEC forms explained (Investopedia)', url: 'https://www.investopedia.com/articles/fundamental-analysis/08/sec-forms.asp' }, { label: 'SEC EDGAR (all filings)', url: 'https://www.sec.gov/edgar.shtml' }] }
      ]
    },
    {
      title: 'Events & catalysts',
      icon: '📅',
      items: [
        { term: 'Earnings dates', html: 'When a company reports. Volatility spikes around them — many traders avoid holding short-dated options through earnings.', links: [{ label: 'Earnings calendar (EarningsWhispers)', url: 'https://earningswhispers.com/' }] },
        { term: 'Expected move', html: 'The market-implied price swing for an earnings event, derived from options pricing — useful for sizing and for picking option strikes.', links: [{ label: 'Expected move (Options AI)', url: 'https://tools.optionsai.com/expected-move' }] },
        { term: 'Analyst rating changes', html: 'Upgrades/downgrades and price-target revisions can move a stock, especially from influential firms.', links: [{ label: 'Upgrades/downgrades (Benzinga)', url: 'https://www.benzinga.com/analyst-stock-ratings/upgrades' }] },
        { term: 'IPO lockup expiration', html: 'After an IPO, insiders are barred from selling for ~90–180 days. When the lockup expires, new supply can pressure the price.', links: [{ label: 'Lockup expirations (MarketBeat)', url: 'https://www.marketbeat.com/ipos/lockup-expirations/' }] },
        { term: 'Rights & warrants', html: 'Securities giving the holder the right to buy shares at a set price — common with SPACs and capital raises; they can dilute or reward.', links: [{ label: 'Rights & warrants (Investopedia)', url: 'https://www.investopedia.com/articles/investing/062713/investing-stock-rights-and-warrants.asp' }] }
      ]
    },
    {
      title: 'Macro',
      icon: '🏦',
      items: [
        { term: 'The Fed & interest rates', html: 'When the Federal Reserve raises rates, borrowing costs rise and future earnings are discounted more heavily — usually a headwind for stocks (especially growth). Cuts tend to be a tailwind.', links: [{ label: 'How the Fed impacts stocks (US News)', url: 'https://money.usnews.com/investing/stock-market-news/articles/how-fed-decisions-impact-the-stock-market' }, { label: 'How interest rates affect stocks (Investopedia)', url: 'https://www.investopedia.com/investing/how-interest-rates-affect-stock-market/' }] },
        { term: 'Economic calendar', html: 'CPI, jobs, GDP, FOMC meetings — scheduled data that moves the whole market. Know what\'s coming this week.', links: [{ label: 'Economic calendar (MarketWatch)', url: 'https://www.marketwatch.com/economy-politics/calendar' }] }
      ]
    },
    {
      title: 'Tools',
      icon: '🔧',
      items: [
        { term: 'Stock screeners', html: 'Filter the whole market by technicals/fundamentals to find tradable setups. (This app\'s Screener ranks your watchlist; Finviz scans the full market.)', links: [{ label: 'Finviz screener', url: 'https://finviz.com/screener.ashx' }, { label: 'Finviz heat map', url: 'https://finviz.com/map.ashx' }] },
        { term: 'Smart-money tracking', html: 'Follow notable hedge-fund and insider buying/selling for ideas and conviction checks.', links: [{ label: 'Dataroma (super-investor holdings)', url: 'https://www.dataroma.com/m/home.php' }] },
        { term: 'Learn anything', html: 'When a term or concept is unfamiliar, Investopedia is the fastest way to get up to speed.', links: [{ label: 'Investopedia', url: 'https://www.investopedia.com/' }] }
      ]
    }
  ];

  window.GLOSSARY = GLOSSARY;
})();

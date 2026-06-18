'use strict';

/**
 * blueprint.js — the "Stock Research Blueprint" schema: a structured
 * due-diligence worksheet. Quantitative fields are auto-filled from data; the
 * qualitative fields are prompts for the user's own research. Saved per ticker.
 * Exposed on window.BLUEPRINT.
 */
(function () {
  const BLUEPRINT = {
    // header key-stats (auto-filled from /api/profile where available)
    stats: [
      { key: 'price', label: 'Price' },
      { key: 'marketCap', label: 'Market cap' },
      { key: 'sector', label: 'Sector' },
      { key: 'industry', label: 'Industry' },
      { key: 'exchange', label: 'Exchange' },
      { key: 'avgVolume', label: 'Avg volume' },
      { key: 'week52', label: '52-wk range' },
      { key: 'peRatio', label: 'P/E' },
      { key: 'forwardPE', label: 'Fwd P/E' },
      { key: 'yield', label: 'Div yield' },
      { key: 'eps', label: 'EPS' },
      { key: 'oneYrTarget', label: '1-yr target' }
    ],
    sections: [
      {
        id: 'business', icon: '🧩', title: 'Business Model', q: 'Could you explain it to a 12-year-old?',
        groups: [
          { title: 'What they actually do', fields: [
            { id: 'biz_what', label: 'In plain English', ph: 'What do they sell, and to whom?' },
            { id: 'biz_customers', label: 'Customers', ph: 'DTC / B2B? Who actually pays?' },
            { id: 'biz_geo', label: 'Geography', ph: 'Where do they operate / grow?' }
          ] },
          { title: 'Revenue engine', fields: [
            { id: 'rev_streams', label: 'Streams', ph: 'How do they make money? (subscriptions, ads, hardware…)' },
            { id: 'rev_recurring', label: 'Recurring?', ph: 'Is revenue recurring / sticky?' },
            { id: 'rev_pricing', label: 'Pricing power', ph: 'Can they raise prices without losing customers?' },
            { id: 'rev_topcust', label: 'Customer concentration', ph: 'Any single customer > 10% of revenue?' }
          ] },
          { title: 'Source reading', checklist: [
            { id: 'src_10k', label: 'Read the 10-K / annual report “Business” section' },
            { id: 'src_deck', label: 'Latest investor presentation' },
            { id: 'src_calls', label: 'Listen to the last 2 earnings calls' },
            { id: 'src_product', label: 'Try the product / read customer reviews' }
          ] }
        ]
      },
      {
        id: 'mgmt', icon: '👤', title: 'Founder & Management', q: 'Would you trust them with your own money?',
        groups: [
          { title: 'Who’s driving', fields: [
            { id: 'm_ceo', label: 'CEO', ph: 'Who runs it? Background?' },
            { id: 'm_founder', label: 'Founder-led?', ph: 'Still founder-led? Tenure?' },
            { id: 'm_track', label: 'Track record', ph: 'What have they built / delivered before?' }
          ] },
          { title: 'Skin in the game', fields: [
            { id: 'm_own', label: 'Insider ownership', ph: '% owned by insiders' },
            { id: 'm_buys', label: 'Insider buys/sells', ph: 'Recent Form 4 activity (size & direction)' },
            { id: 'm_recent', label: 'Recent action', ph: 'Notable recent insider/institutional moves' }
          ] },
          { title: 'Capital allocation', fields: [
            { id: 'm_history', label: 'History', ph: 'Buybacks, dividends, M&A — done well or poorly?' },
            { id: 'm_promise', label: 'Promises / plan', ph: 'What have they said they’ll do with cash?' }
          ] }
        ]
      },
      {
        id: 'financials', icon: '💹', title: 'Financials', q: 'Is the machine actually making money?',
        auto: 'financials',
        groups: [
          { title: 'Income statement', fields: [
            { id: 'f_revgrowth', label: 'Revenue growth', ph: 'YoY growth %, accelerating or slowing?' },
            { id: 'f_gross', label: 'Gross margin', ph: 'Gross margin % and trend' },
            { id: 'f_op', label: 'Operating margin', ph: 'Op. margin % and trend' },
            { id: 'f_profit', label: 'Profitable?', ph: 'GAAP profit? Path to profitability?' }
          ] },
          { title: 'Balance sheet', fields: [
            { id: 'f_cash', label: 'Cash vs debt', ph: 'Net cash or net debt?' },
            { id: 'f_leverage', label: 'Debt / EBITDA', ph: 'Leverage ratio — manageable?' }
          ] },
          { title: 'Cash flow & quality', fields: [
            { id: 'f_fcf', label: 'Free cash flow', ph: 'FCF positive? FCF margin?' },
            { id: 'f_sbc', label: 'Stock-based comp', ph: 'SBC as % of revenue — dilution risk?' },
            { id: 'f_returns', label: 'ROIC / ROE', ph: 'Returns on capital' }
          ] }
        ]
      },
      {
        id: 'moat', icon: '🏰', title: 'Moat & Competition', q: 'Why can’t someone richer just copy this?',
        groups: [
          { title: 'Moat type', fields: [
            { id: 'moat_network', label: 'Network effects', ph: 'Does it get better with more users?' },
            { id: 'moat_switch', label: 'Switching costs', ph: 'Painful for customers to leave?' },
            { id: 'moat_cost', label: 'Cost / scale advantage', ph: 'Cheaper at scale than rivals?' },
            { id: 'moat_ip', label: 'IP / regulation', ph: 'Patents, licenses, regulatory barriers?' }
          ] },
          { title: 'The battlefield', fields: [
            { id: 'comp_share', label: 'Market share', ph: 'Leader, challenger, or minnow?' },
            { id: 'comp_1', label: 'Competitor 1', ph: 'Name & threat' },
            { id: 'comp_2', label: 'Competitor 2', ph: 'Name & threat' },
            { id: 'comp_3', label: 'Competitor 3', ph: 'Name & threat (incl. Big Tech)' }
          ] },
          { title: 'Reality checks', fields: [
            { id: 'moat_power', label: 'Pricing power', ph: 'Proven ability to raise prices?' },
            { id: 'moat_disrupt', label: 'Disruption risk', ph: 'Could it be disrupted (incl. by AI)?' }
          ] }
        ]
      },
      {
        id: 'industry', icon: '🌊', title: 'Industry & Growth', q: 'Is the tide rising or falling?',
        groups: [
          { title: 'Market size', fields: [
            { id: 'ind_tam', label: 'TAM', ph: 'Total addressable market $' },
            { id: 'ind_growth', label: 'Industry growth', ph: 'Industry growing how fast?' },
            { id: 'ind_room', label: 'Room to run', ph: 'How much penetration is left?' }
          ] },
          { title: 'Tailwinds / headwinds', fields: [
            { id: 'ind_tail', label: 'Tailwinds', ph: 'Secular trends in its favor' },
            { id: 'ind_head', label: 'Headwinds', ph: 'Trends working against it' },
            { id: 'ind_cyclical', label: 'Cyclical?', ph: 'Sensitive to the economy / rates?' },
            { id: 'ind_drivers', label: 'Growth drivers', ph: 'What specifically drives the next leg?' }
          ] },
          { title: 'Reality checks', fields: [
            { id: 'ind_tamlegit', label: 'Is the TAM legit?', ph: 'Is management’s TAM realistic?' },
            { id: 'ind_peers', label: 'Are peers growing?', ph: 'Is the whole space growing, or just them?' }
          ] }
        ]
      },
      {
        id: 'valuation', icon: '⚖️', title: 'Valuation', q: 'Are you cheap or expensive? What’s the price?',
        groups: [
          { title: 'Multiples', fields: [
            { id: 'v_pe', label: 'P/E', ph: 'vs history & peers' },
            { id: 'v_evebitda', label: 'EV/EBITDA', ph: '' },
            { id: 'v_pfcf', label: 'P/FCF', ph: '' },
            { id: 'v_ps', label: 'P/S', ph: 'for unprofitable growth' }
          ] },
          { title: 'What’s priced in', fields: [
            { id: 'v_implied', label: 'Implied expectations', ph: 'What growth must happen to justify today’s price?' }
          ] },
          { title: 'Scenarios', fields: [
            { id: 'v_bear', label: 'Bear case ($)', ph: 'Downside price & why' },
            { id: 'v_base', label: 'Base case ($)', ph: 'Most-likely price & why' },
            { id: 'v_bull', label: 'Bull case ($)', ph: 'Upside price & why' }
          ] }
        ]
      },
      {
        id: 'risks', icon: '🚩', title: 'Risks & Red Flags', q: 'How does this kill me?',
        groups: [
          { title: 'Business risks', fields: [
            { id: 'r_biggest', label: 'Biggest risk', ph: 'The one thing that breaks the thesis' },
            { id: 'r_keycust', label: 'Key-customer risk', ph: 'Dependence on one customer/partner' },
            { id: 'r_concentration', label: 'Concentration', ph: 'Single product / supplier / geography risk' },
            { id: 'r_reputation', label: 'Reputation / regulatory', ph: 'Legal, regulatory, headline risk' }
          ] },
          { title: 'Accounting red flags', checklist: [
            { id: 'r_recv', label: 'Receivables growing faster than revenue?' },
            { id: 'r_restate', label: 'Restatements / auditor change / late filing?' },
            { id: 'r_adjusted', label: 'Heavy reliance on “adjusted” numbers?' },
            { id: 'r_insider', label: 'Unusual insider selling?' },
            { id: 'r_dilution', label: 'Rising share count / dilution?' }
          ] },
          { title: 'Steelman the bear', fields: [
            { id: 'r_bear', label: 'Strongest bear argument', ph: 'Write the most convincing case AGAINST owning it.' }
          ] }
        ]
      }
    ]
  };

  window.BLUEPRINT = BLUEPRINT;
})();

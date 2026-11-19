// Token Radar dashboard (radar-4 fit, board edition 4). Plain script, no
// framework, no network. Reads window.RADAR from ../data.js (written by
// main.ts from the same board that board.json carries) and renders: the
// evidence for the board in three numbers, a glance table of the ten
// rows with the highest expected value (issuance probability x value),
// the ranked board itself — sorted by fitted value at issuance, with
// P(token) beside every value and low-issuance rows dimmed — sortable
// columns, search + category + chain + watchlist filters, a per-protocol
// detail view with the model's arithmetic, both uncertainty ranges, the
// issuance score and the netted farm plan (expected profit, P(profit),
// break-even capital), field-derived watch notes, the method scatter
// over the issued comparables, and the audit of every protocol that did
// not make the board. Both models are fitted on the snapshot's own
// protocols; the model panel below states them and their validation.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + Number(n).toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(3); }
  // Money with cents where cents are the whole story (expected profits
  // at these plan sizes are single dollars; $0 would hide the sign).
  function fmtUsdC(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) < 10) return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    return fmtUsd(n);
  }
  function fmtSignedUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + fmtUsdC(n);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watchOnly = true;
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchOnly) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var s = params.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', r.chains.join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else if (key === 'p') { av = a.p_token; bv = b.p_token; }
      else if (key === 'ev') { av = a.ev_usd; bv = b.ev_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'ring', 'aria-hidden': 'true' }),
        el('div', null,
          el('div', { class: 'brand-name', text: 'Token Radar' }),
          el('div', { class: 'brand-tag', text: 'pre-token launch radar · model ' + DATA.model_version + ' · board edition ' + DATA.board_edition })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama sealed input' }),
        el('span', { text: 'offline build' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Which pre-token protocol is worth farming next?' }),
        el('p', null,
          'Every protocol in the sealed snapshot that records ',
          el('b', { text: 'no token yet' }),
          ' is ranked by the value a fitted model puts on its launch — fitted on the snapshot\'s own issued protocols, never hand-set — with the model\'s issuance probability beside every value and a farm plan netted to expected profit. The ',
          el('b', { text: DATA.watchlist_size + ' watchlist protocols' }),
          ' are all here; the radar adds ' + DATA.early_size + ' earlier finds below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : '—' }), top ? el('em', { text: top.name }) : null),
        el('div', { class: 'fact' }, el('span', { text: 'Audited off-board' }), el('b', { text: String(DATA.audit.length) }))
      )
    );
  }

function evidencePanel() {
  var v = DATA.validation;
  var tiles = [
    ['×' + v.fitted_typical_miss.toFixed(2), 'typical out-of-sample miss of the value fit',
      'a bare power law misses by ×' + v.power_typical_miss.toFixed(2) + ', the hand-set radar-2 by ×' + v.radar2_typical_miss.toFixed(2) + ' — at ' + v.comps + ' comparables those gaps are inside the noise, and the model panel shows the intervals'],
    [Math.round(v.fitted_precision_top30 * 100) + '%', 'of the model\u2019s top 30% are truly top 30%',
      'chance is 30%; the out-of-fold rank correlation is ' + v.fitted_spearman.toFixed(2) + '. The ranking is this model\u2019s weak sense — its prices and plans are the strong one'],
    [v.ptoken_auc.toFixed(2), 'AUC of the issuance model, out of sample',
      'Brier ' + v.ptoken_brier.toFixed(3) + ' against ' + v.ptoken_brier_base.toFixed(3) + ' for the base rate. P(token) reads as the share of like-shaped protocols that have already issued'],
  ];
  return el('section', { class: 'panel evidence', 'aria-label': 'The evidence for this board' },
    el('h2', {}, 'The evidence, up front'),
    el('div', { class: 'evidence-grid' },
      ...tiles.map(([big, label, sub]) => el('div', { class: 'evidence-tile' },
        el('b', { class: 'num' }, big),
        el('span', { class: 'evidence-label' }, label),
        el('span', { class: 'sub' }, sub)))),
    el('p', { class: 'sub' }, 'The honest range on every value: across the validation folds, launches landed between ÷' + Math.round(1 / v.pi_lo_factor) + ' and ×' + Math.round(v.pi_hi_factor) + ' of the fitted value (an 80% prediction interval, from the out-of-sample residuals). The band printed on each row is narrower — fit uncertainty only — and the model panel keeps the two apart. ' + DATA.board_size + ' protocols are ranked; ' + DATA.audit.length + ' more are audited off-board with their reasons.'));
}

function glancePanel() {
  // The attention table: the ten rows where value and issuance odds
  // combine highest. The board below never reorders — this is a lens on
  // it, labelled as one.
  var byEv = DATA.rows.slice().sort(function (a, b) { return b.ev_usd - a.ev_usd || (a.slug < b.slug ? -1 : 1); }).slice(0, 10);
  var vc = DATA.verdict_counts;
  var farms = DATA.rows.filter(function (r) { return r.plan.verdict === 'farm'; }).slice(0, 5);
  var tbody = el('tbody');
  byEv.forEach(function (r, i) {
    tbody.appendChild(el('tr', { tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
      el('td', { class: 'num', text: String(i + 1) }),
      el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · board rank #' + r.rank }))),
      el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
      el('td', { class: 'num', text: r.p_token.toFixed(2) }),
      el('td', { class: 'num', text: fmtUsd(r.ev_usd) }),
      el('td', null, el('span', { class: 'verdict ' + r.plan.verdict, text: r.plan.verdict }))
    ));
  });
  return el('section', { class: 'panel glance', 'aria-label': 'The ten rows that matter most' },
    el('div', { class: 'strip-col picks' },
      el('h2', { text: 'The ten that matter most — by expected value' }),
      el('p', { class: 'sub', text: 'Expected value = P(token) × fitted value at issuance. The board below stays ranked by value alone, as the brief asks; this table is where the two facts combine. Several of the board\u2019s top values are absent here — their issuance odds are too low to carry the expectation.' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'glance-table' },
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: '#' }), el('th', { scope: 'col', text: 'Protocol' }),
          el('th', { scope: 'col', text: 'Value at issuance' }), el('th', { scope: 'col', text: 'P(token)' }),
          el('th', { scope: 'col', text: 'Expected value' }), el('th', { scope: 'col', text: 'Verdict' })
        )),
        tbody
      ))
    ),
    el('div', { class: 'strip-col' },
      el('h2', { text: 'The census' }),
      el('div', { class: 'census' },
        el('div', null, el('b', { class: 'num', text: String(vc.farm) }), el('span', { text: 'farm' })),
        el('div', null, el('b', { class: 'num', text: String(vc.thin) }), el('span', { text: 'thin' })),
        el('div', null, el('b', { class: 'num', text: String(vc.skip) }), el('span', { text: 'skip' }))
      ),
      el('p', { class: 'sub', text: 'of ' + DATA.board_size + ' rows, judged on expected profit at each plan\u2019s own capital ($250\u2013$5,000 by TVL tier), after gas and a 4%-a-year opportunity cost. Farm = expected profit above zero; thin = P(profit) at least ' + Math.round(DATA.validation.thin_pprofit * 100) + '% anyway; skip = neither.' }),
      el('h2', { text: 'Farm-grade, first five' }),
      el('div', { class: 'pick-list' }, farms.map(function (r) {
        return el('button', { class: 'pick', type: 'button', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'pick-rank num', text: '#' + r.rank }),
          el('span', { class: 'pick-name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category || 'Uncategorised' })),
          el('span', { class: 'pick-nums num', text: 'P(profit) ' + Math.round(r.plan.p_profit * 100) + '% · breaks even from ' + (r.plan.min_capital_usd === null ? 'no size' : fmtUsd(r.plan.min_capital_usd)) })
        );
      }))
    )
  );
}

function guidePanel() {
  const items = [
    ['The ranking answers the brief', 'The board is sorted by fitted value at issuance — what a launch would be worth — because that is the question asked. It never reorders by anything else; the expected-value table above is a labelled lens, not a second ranking.'],
    ['P(token) is a second fact, not a discount', 'It is the share of like-shaped protocols that have already issued, learned from the snapshot itself. Rows under 0.30 are dimmed: their value may be real, but history says protocols shaped like them usually have not launched. Curators sit at the top of the value ranking and low here — both facts are on the row\u2019s face.'],
    ['Verdicts are expected profit, not optimism', 'Farm means the plan\u2019s expected profit is positive at its own capital after gas and opportunity cost; thin means P(profit) still reaches ' + Math.round(DATA.validation.thin_pprofit * 100) + '%. Every detail view shows the smallest capital that breaks even in expectation — or states plainly that no size breaks even.'],
  ];
  return el('section', { class: 'panel guide', 'aria-label': 'How to read this board' },
    el('h2', {}, 'How to read this board in two minutes'),
    el('div', { class: 'guide-grid' },
      ...items.map(([head, body]) => el('div', { class: 'guide-item' },
        el('h3', {}, head), el('p', { class: 'sub' }, body)))));
}

  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); renderTable(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); }));
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); renderTable(); });
    var watch = el('input', { type: 'checkbox', id: 'watch', checked: state.watchOnly ? 'checked' : null });
    watch.addEventListener('change', function () { state.watchOnly = watch.checked; writeHash(); renderTable(); });
    var clear = el('button', { class: 'btn ghost', type: 'button', text: 'Reset', onclick: function () {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render();
    } });
    return el('div', { class: 'controls', id: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('label', { class: 'check', for: 'watch' }, watch, 'Watchlist only'),
      clear,
      el('span', { class: 'count', id: 'count', text: '' })
    );
  }

  function sortHead(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        renderTable();
      } }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▾' : ' ▴' }) : null));
  }

  function signalDots(row) {
    // Five signal cells: growth sign, age over 1y, multi-chain, watchlist, TVL over floor.
    var on = [
      row.change_7d !== null && row.change_7d > 0,
      row.age_days !== null && row.age_days >= 365,
      row.chains.length > 1,
      row.watchlist,
      row.tvl_usd >= DATA.floor_usd
    ];
    return el('span', { class: 'spark', 'aria-hidden': 'true' }, on.map(function (o) { return el('i', { class: o ? 'on' : '', style: 'height:' + (o ? 16 : 7) + 'px' }); }));
  }

  var tableHost = el('div', { id: 'table-host' });
  function renderTable() {
    var list = sorted(filtered());
    var count = document.getElementById('count');
    if (count) count.textContent = list.length + ' of ' + DATA.board_size + ' rows';
    tableHost.textContent = '';
    if (list.length === 0) {
      tableHost.appendChild(el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'Nothing matches that filter set' }),
        el('p', { text: 'Loosen the search, pick another category or chain, or reset the filters.' }),
        el('button', { class: 'btn', type: 'button', text: 'Reset filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchOnly = false; writeHash(); render();
        } })
      )));
      return;
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; }));
    var tbody = el('tbody');
    list.forEach(function (r) {
      tbody.appendChild(el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        class: r.p_token < 0.3 ? 'lowp' : '',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.length ? r.chains.slice(0, 3).join(', ') : 'chain n/a') })
        )),
        el('td', null,
          el('span', { class: 'badge ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'watchlist' : 'early find' }),
          r.notes && r.notes.length ? el('span', { class: 'notesmark', text: 'watch notes' }) : null
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, signalDots(r)),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          r.band ? el('span', { class: 'bandline', text: 'band ' + fmtUsd(r.band.p10) + ' – ' + fmtUsd(r.band.p90) }) : null
        )),
        el('td', { class: 'num' }, el('span', { text: r.p_token.toFixed(2) }),
          r.p_token < 0.3 ? el('span', { class: 'ptag', text: 'unlikely' }) : null),
        el('td', null,
          el('span', { class: 'verdict ' + r.plan.verdict, text: r.plan.verdict }),
          el('span', { class: 'bandline', text: 'P(profit) ' + Math.round(r.plan.p_profit * 100) + '%' })
        )
      ));
    });
    tableHost.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Ranked by fitted value at issuance under model ' + DATA.model_version + ' — the board never reorders. P(token) is the issuance model\u2019s score (the share of like-shaped protocols that have already issued); rows under 0.30 are dimmed and tagged. The verdict is the row\u2019s farm plan read on expected profit at its own capital, with P(profit) under it; a watch-notes tag marks rows whose own fields carry a caveat, spelled out in the detail view. The band under each value is the 10th–90th percentile across 200 bootstrap refits. Signal cells, left to right: growing this week, over a year tokenless, multi-chain, watchlist member, TVL above the floor.' }),
          el('thead', null, el('tr', null,
            sortHead('rank', 'Rank'), sortHead('name', 'Protocol'), el('th', { scope: 'col', text: 'Radar' }),
            sortHead('tvl', 'TVL'), sortHead('growth', '7d'), sortHead('age', 'Age'),
            el('th', { scope: 'col', text: 'Signal' }), sortHead('implied', 'Implied value'),
            sortHead('p', 'P(token)'), el('th', { scope: 'col', text: 'Verdict' })
          )),
          tbody
        )
      )
    ));
  }

  function scatter() {
    // Log-log plot of the issued comparables (TVL vs actual market cap)
    // with the fitted size curve. Numbers only — the SVG is built as a
    // string from numeric fields, never from names.
    var W = 640, H = 380, L = 64, R = 16, T = 14, B = 44;
    var x0 = 6, x1 = 10.6, y0 = 5, y1 = 10.6;
    function X(v) { return L + ((Math.log10(Math.max(1, v)) - x0) / (x1 - x0)) * (W - L - R); }
    function Y(v) { return T + (1 - (Math.log10(Math.max(1, v)) - y0) / (y1 - y0)) * (H - T - B); }
    var s = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter of issued comparables: TVL against market cap, with the fitted size curve">';
    [6, 7, 8, 9, 10].forEach(function (e) {
      var px = X(Math.pow(10, e));
      s += '<line x1="' + px + '" y1="' + T + '" x2="' + px + '" y2="' + (H - B) + '" class="grid"/>';
      s += '<text x="' + px + '" y="' + (H - B + 18) + '" class="ax" text-anchor="middle">$' + (e === 6 ? '1M' : e === 7 ? '10M' : e === 8 ? '100M' : e === 9 ? '1B' : '10B') + '</text>';
      var py = Y(Math.pow(10, e + 1 <= 10 ? e + 1 : e));
      s += '<line x1="' + L + '" y1="' + py + '" x2="' + (W - R) + '" y2="' + py + '" class="grid"/>';
      s += '<text x="' + (L - 6) + '" y="' + (py + 4) + '" class="ax" text-anchor="end">$' + (e + 1 === 6 ? '1M' : e + 1 === 7 ? '10M' : e + 1 === 8 ? '100M' : e + 1 === 9 ? '1B' : e + 1 === 10 ? '10B' : '100B') + '</text>';
    });
    var m = DATA.model;
    var lx1 = Math.pow(10, x0), lx2 = Math.pow(10, x1);
    var ly1 = Math.pow(10, m.intercept + m.tvl_slope * x0);
    var ly2 = Math.pow(10, m.intercept + m.tvl_slope * x1);
    s += '<line x1="' + X(lx1) + '" y1="' + Y(ly1) + '" x2="' + X(lx2) + '" y2="' + Y(ly2) + '" class="fitline"/>';
    DATA.comps.forEach(function (c) {
      s += '<circle cx="' + X(c.tvl_usd).toFixed(1) + '" cy="' + Y(c.mcap_usd).toFixed(1) + '" r="3.2" class="dot"/>';
    });
    s += '<text x="' + (W - R) + '" y="' + (H - 6) + '" class="ax" text-anchor="end">TVL (log) →</text>';
    s += '<text x="' + (L - 44) + '" y="' + (T + 4) + '" class="ax">market cap (log)</text>';
    s += '</svg>';
    var host = el('div', { class: 'scatter-host' });
    host.innerHTML = s;
    return host;
  }

  function auditPanel() {
    var tbody = el('tbody');
    DATA.audit.forEach(function (a) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: a.name }), el('span', { class: 'sub', text: a.category || 'Uncategorised' }))),
        el('td', { class: 'num', text: fmtUsd(a.tvl_usd) }),
        el('td', null, el('span', { class: 'sub', text: a.reason }))
      ));
    });
    return el('section', { class: 'panel audit' },
      el('h2', { text: 'Full-universe audit — the ' + DATA.audit.length + ' pre-token protocols not on the board' }),
      el('p', { class: 'sub', text: 'The snapshot holds ' + (DATA.board_size + DATA.audit.length) + ' protocols that record no token. The board ranks ' + DATA.board_size + ' of them; every other one is named here with the reason it was set aside, so an exclusion can be checked instead of trusted. The reasons apply the board\'s own reading: a launch radar prices protocols awaiting their own launch, not wrapped, staked or bridged products of protocols that already have one.' }),
      el('div', { class: 'table-wrap audit-wrap' }, el('table', null,
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is not ranked' })
        )),
        tbody
      ))
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var v = DATA.validation;
    function vrow(name, med, miss, w2) {
      return el('tr', null,
        el('td', { text: name }),
        el('td', { class: 'num', text: med.toFixed(3) }),
        el('td', { class: 'num', text: 'x' + miss.toFixed(2) }),
        el('td', { class: 'num', text: Math.round(w2 * 100) + '%' })
      );
    }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The models, stated in full — radar-4 (fitted, not hand-set)' }),
      el('div', { class: 'formula', text: 'log10(value at issuance) = ' + m.intercept.toFixed(3) + ' + ' + m.tvl_slope.toFixed(3) + ' x log10(TVL) + ' + m.age_coef.toFixed(3) + ' x age + ' + m.chain_coef.toFixed(3) + ' x chains' }),
      el('p', { class: 'sub', text: 'Fitted by least squares on the ' + m.comps + ' protocols in this snapshot that already issued a token and pass the board\'s own reading (no wrapped or staked products of another protocol, no exchange fronts, no versioned duplicates). Age runs 0 to 1 over ' + m.maturity_days + ' days tokenless (unknown age counts as ' + m.unknown_age_days + ' days); chains are capped at ' + m.chain_cap + '. tools/fit.mjs in the repo reproduces every constant and every validation figure from the snapshot.' }),
      el('p', { class: 'sub', text: 'What the fit found: value grows far slower than TVL (slope ' + m.tvl_slope.toFixed(3) + ', not 1 — among issued protocols the median market value is 0.87x TVL for the smallest third, 0.25x for the middle third, 0.08x for the largest). The 7-day change carried no usable signal: left free it fitted negative, and the model\'s one sign rule — growth may not hurt — dropped the term, so a hot week is displayed but never priced.' }),
      el('h3', { text: 'Out-of-sample validation — ' + v.folds + ' folds over the ' + v.comps + ' comparables, each fold priced by a fit that never saw it' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'vtable' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Model' }), el('th', { scope: 'col', text: 'Median |log10 error|' }),
            el('th', { scope: 'col', text: 'Typical miss' }), el('th', { scope: 'col', text: 'Within 2x' })
          )),
          el('tbody', null,
            vrow('radar-4 (this board)', v.fitted_median_log_err, v.fitted_typical_miss, v.fitted_within_2x),
            vrow('bare power law (intercept + log TVL)', v.power_median_log_err, v.power_typical_miss, v.power_within_2x),
            vrow('radar-3 spec (with family offsets)', v.offsets_median_log_err, Math.pow(10, v.offsets_median_log_err), v.offsets_within_2x),
            vrow('radar-2 (hand-set, first entry)', v.radar2_median_log_err, v.radar2_typical_miss, v.radar2_within_2x),
            vrow('naive (one median multiple)', v.naive_median_log_err, v.naive_typical_miss, v.naive_within_2x)
          )
        )
      ),
      el('p', { class: 'sub', text: 'Read the table sceptically, the way it was produced. On these folds the family offsets flatter themselves (' + v.offsets_median_log_err.toFixed(3) + '); over 20 repetitions of 5-fold cross-validation the verdict reverses — ' + v.offsets_repeated_median.toFixed(3) + ' with offsets against ' + v.fitted_repeated_median.toFixed(3) + ' without, worse at every shrinkage level tried — so radar-4 dropped them. The same repeated test applied term by term: power law alone ' + v.power_repeated_median.toFixed(3) + ', the full spec ' + v.fitted_repeated_median.toFixed(3) + '; a paired bootstrap puts the full spec\u2019s edge over the bare power law at ' + v.paired_mean_diff_vs_power.toFixed(3) + ' of mean error, 95% CI [' + v.paired_ci_lo.toFixed(3) + ', ' + v.paired_ci_hi.toFixed(3) + '] — indistinguishable from zero. Age and chains stay because they price maturity and sprawl in the direction the full-sample fit gives, at no measured out-of-sample cost; the claim made for them is no stronger than that. One more caveat: the spec was chosen on these same resamples, so the repeated figures are mildly optimistic for the chosen spec; a nested-CV estimate was not run. Leave-one-out gives ' + v.loo_median_log_err.toFixed(3) + '; time splits give ' + v.time_split_old_to_new.toFixed(3) + ' and ' + v.time_split_new_to_old.toFixed(3) + '.' }),
      el('h3', { text: 'The issuance model — P(token)' }),
      el('p', { class: 'sub', text: 'A logistic regression over the snapshot\u2019s ' + (v.ptoken_positives + v.ptoken_negatives) + ' clearly-labelled protocols (' + v.ptoken_positives + ' issued, ' + v.ptoken_negatives + ' standalone pre-token) scores the probability that a protocol with a row\u2019s fields has a token, from log TVL, age, chain count and category family. Out of sample: AUC ' + v.ptoken_auc.toFixed(3) + ', Brier ' + v.ptoken_brier.toFixed(3) + ' against ' + v.ptoken_brier_base.toFixed(3) + ' for always predicting the base rate, and predicted deciles track the actual issued share (tools/fit.mjs prints the table). It reads as a cross-section — the share of like-shaped protocols that have already issued — not as a forecast or a schedule. Families are used here and not in the value fit, deliberately: the questions differ (who issues at all, versus what an issue is worth), and each model kept only the terms that survived its own test — an age-by-family interaction was also tried for this model and rejected on the same cross-validation (AUC ' + '0.707 against ' + v.ptoken_auc.toFixed(3) + ').' }),
      el('p', { class: 'sub', text: 'Two ranges ride on every row and are never merged: the bootstrap band (fit uncertainty, from 200 seeded refits) and the prediction interval (the folds\u2019 residual 10th–90th percentiles, ÷' + Math.round(1 / v.pi_lo_factor) + ' to ×' + Math.round(v.pi_hi_factor) + '), which is what P(profit) integrates over. A pre-registered robust challenger to the previous fit (Huber with empirical-Bayes shrinkage) was run under rules fixed in advance in an earlier edition and rejected; the write-up stays in tools/fit.mjs. What no refit fixes: revenue and fees, float and unlock design, funding and backers — the variables practitioners weight most — are not among the snapshot\u2019s ten fields. Every value here is a TVL-conditional value: what the market has historically paid for this much TVL, of this age and sprawl.' }),
      el('h3', { text: 'The evidence, plotted — issued comparables and the fitted size curve' }),
      scatter(),
      el('p', { class: 'sub', text: 'One function scores every row; no name is special-cased. Protocols whose token already trades are not ranked: their market cap is a fact, not a model output. The board says a protocol records no token — the snapshot is a record, not proof that none exists. Every board row sits inside the comparables\u2019 TVL range ($5M–$10.2B), so no row is an extrapolation in size; the only protocols above that range are exchange fronts, audited off-board below.' })
    );
  }

  function liveStrip() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains[0] || '') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'sub', text: 'already trades — not ranked' }))
      ));
    });
    return el('section', { class: 'panel live' },
      el('div', { class: 'table-wrap' }, el('table', null,
        el('caption', { text: 'Set aside: the largest live-token protocols in the same snapshot, shown at market value so the pre-token ranking is never confused with prices that already exist.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Live protocol' }), el('th', { scope: 'col', text: 'TVL' }),
          el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Status' })
        )),
        tbody
      ))
    );
  }

  function biggestDriver(row) {
    // Which fitted term moves this row most, in log space — the honest
    // one-line answer to "why is it ranked here and not at its TVL rank".
    var terms = [
      { name: 'the age term', f: row.age_factor },
      { name: 'the chain-count term', f: row.chain_factor }
    ];
    var best = terms[0];
    terms.forEach(function (t) { if (Math.abs(Math.log10(t.f)) > Math.abs(Math.log10(best.f))) best = t; });
    if (Math.abs(Math.log10(best.f)) < 0.02) {
      return 'No secondary term moves this row materially — the size curve is the whole story: value grows at ' + DATA.model.tvl_slope.toFixed(3) + ' of TVL\'s pace, so big protocols rank far below their TVL rank and small ones above it.';
    }
    var dir = best.f >= 1 ? 'lifts' : 'pulls down';
    return 'Against the size curve, ' + best.name + ' is the term that moves this row most: it ' + dir + ' the value by ' + fmtMult(best.f) + '. The size curve itself is the rest of the story — value grows at ' + DATA.model.tvl_slope.toFixed(3) + ' of TVL\'s pace, so big protocols rank far below their TVL rank and small ones above it.';
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); renderTable(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.watchlist ? 'watchlist' : 'early find below the floor') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains.join(', ') || 'chain n/a') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How this value is derived' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Size curve (fitted slope ' + DATA.model.tvl_slope.toFixed(3) + ' on log TVL)' }), el('b', { class: 'num', text: fmtMult(row.size_factor) })),
        el('div', null, el('span', { text: 'Growth factor (7d ' + fmtPct(row.change_7d) + ' — the fit dropped this term)' }), el('b', { class: 'num', text: fmtMult(row.growth_factor) })),
        el('div', null, el('span', { text: 'Age factor (' + fmtAge(row.age_days) + ' tokenless)' }), el('b', { class: 'num', text: fmtMult(row.age_factor) })),
        el('div', null, el('span', { text: 'Chain factor (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')' }), el('b', { class: 'num', text: fmtMult(row.chain_factor) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied launch value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('div', { class: 'eq rankvs' },
        el('div', null, el('span', { text: 'Rank by TVL alone' }), el('b', { class: 'num', text: '#' + row.tvl_rank + ' of ' + DATA.board_size })),
        el('div', null, el('span', { text: 'Rank under the model' }), el('b', { class: 'num', text: '#' + row.rank + ' (' + (row.tvl_rank - row.rank > 0 ? '+' : '') + (row.tvl_rank - row.rank) + ' vs TVL)' }))
      ),
      el('p', { class: 'sub', text: biggestDriver(row) }),
      el('p', { class: 'sub', text: 'An implied value is this entry\u2019s model claim, not a price prediction.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Will it issue at all? — the issuance model' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'P(token) — share of like-shaped protocols that have already issued' }), el('b', { class: 'num', text: row.p_token.toFixed(2) })),
        el('div', { class: 'total' }, el('span', { text: 'Expected value (P × value at issuance)' }), el('b', { class: 'num', text: fmtUsd(row.ev_usd) }))
      ),
      el('p', { class: 'sub', text: 'A cross-section, not a forecast and not a schedule: the model learned from the snapshot\u2019s labelled protocols (AUC ' + DATA.validation.ptoken_auc.toFixed(2) + ' out of sample) which shapes — size, age, sprawl, family — have historically come with a token. It cannot see announcements, points programmes or intent.' })
    ));
    if (row.band) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'How sure is the model? — two ranges, two meanings' }),
        el('div', { class: 'eq' },
          el('div', null, el('span', { text: 'Fit band (10th–90th pct of 200 bootstrap refits)' }), el('b', { class: 'num', text: fmtUsd(row.band.p10) + ' – ' + fmtUsd(row.band.p90) })),
          el('div', null, el('span', { text: 'Rank band across the same refits' }), el('b', { class: 'num', text: '#' + row.band.rank_lo + ' – #' + row.band.rank_hi })),
          el('div', null, el('span', { text: 'Prediction interval (80%, from out-of-sample residuals)' }), el('b', { class: 'num', text: fmtUsd(row.pi_lo) + ' – ' + fmtUsd(row.pi_hi) }))
        ),
        el('p', { class: 'sub', text: 'The fit band is parameter uncertainty: resample the comparables, refit, and this is where the value lands. The prediction interval is wider because it also carries how far real launches landed from fits like this one (the folds\u2019 residuals). Planning uses the second; the first is shown so the two are never confused.' })
      ));
    }
    if (row.notes && row.notes.length) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'What to watch — notes from this row\'s own fields' }),
        el('ul', { class: 'watch-notes' }, row.notes.map(function (n) { return el('li', { text: n }); })),
        el('p', { class: 'sub', text: 'Notes are derived from the snapshot fields and the fit\'s own findings, never from the protocol\'s name. A note is not a verdict: it marks what the model cannot price, so the reader prices it instead.' })
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — ' + row.farm_steps.length + ' steps · verdict: ' + row.plan.verdict }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'Capital the plan deploys' }), el('b', { class: 'num', text: fmtUsd(row.plan.capital) })),
        el('div', null, el('span', { text: 'Gas cost (2025 levels, ' + row.plan.weeks + ' weekly epochs)' }), el('b', { class: 'num', text: fmtUsdC(row.plan.cost_usd) })),
        el('div', null, el('span', { text: 'Opportunity cost of the capital (' + Math.round(DATA.opp_rate * 100) + '% a year over the hold)' }), el('b', { class: 'num', text: fmtUsdC(row.plan.opp_cost_usd) })),
        el('div', null, el('span', { text: 'Attention the plan takes' }), el('b', { class: 'num', text: row.plan.hours.toFixed(1) + ' hours' })),
        el('div', null, el('span', { text: 'Break-even launch value (if a token launches)' }), el('b', { class: 'num', text: fmtUsd(row.plan.breakeven_usd) })),
        el('div', null, el('span', { text: 'Expected profit at this capital' }), el('b', { class: 'num', text: fmtSignedUsd(row.plan.expected_net_usd) })),
        el('div', null, el('span', { text: 'P(this plan ends in profit)' }), el('b', { class: 'num', text: Math.round(row.plan.p_profit * 100) + '%' })),
        el('div', null, el('span', { text: 'Smallest capital that breaks even in expectation' }), el('b', { class: 'num', text: row.plan.min_capital_usd === null ? 'no size breaks even' : fmtUsd(row.plan.min_capital_usd) })),
        el('div', { class: 'total' }, el('span', { text: 'Verdict' }), el('b', { class: 'num', text: row.plan.verdict.toUpperCase() }))
      ),
      el('p', { class: 'sub', text: 'Netting, with its assumptions stated: a launch is assumed to distribute ' + Math.round(DATA.alloc_share * 100) + '% of its value to farmers, this wallet\u2019s slice is pro-rata to the capital it keeps in the protocol against TVL, and the capital itself is charged ' + Math.round(DATA.opp_rate * 100) + '% a year for the hold. Expected profit weights the slice by P(token) — a launch that never happens pays nothing — and P(profit) integrates that over the fit\u2019s own out-of-sample residuals. Farm = expected profit above zero; thin = P(profit) at least ' + Math.round(DATA.validation.thin_pprofit * 100) + '% anyway; skip = neither. "No size breaks even" means the expected yield per dollar sits under the opportunity-cost rate, so deploying more only scales the loss. Real distributions are rarely purely pro-rata; treat the verdict as a cost discipline, not a promise.' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('div', null, el('b', { text: action }), tail ? el('span', { class: 'cost', text: tail }) : null));
      }))
    ));
    if (!dialog.isConnected) app.appendChild(dialog);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    renderTable();
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(evidencePanel());
    shell.appendChild(glancePanel());
    shell.appendChild(guidePanel());
    shell.appendChild(controls());
    shell.appendChild(tableHost);
    shell.appendChild(modelPanel());
    shell.appendChild(auditPanel());
    shell.appendChild(liveStrip());
    shell.appendChild(el('footer', { class: 'foot' },
      el('p', { text: 'Source: the sealed snapshot named in data.js (' + DATA.source + '). The page runs fully offline; every number shown is derived from that snapshot by the stated model.' }),
      el('p', { text: 'Implied values are a ranking device for farming attention, not investment advice and not a promise that any protocol will issue a token.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    renderTable();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
    // Slash jumps to the search box from anywhere outside a form field.
    if (e.key === '/' && !dialog.open) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        var q = document.getElementById('q');
        if (q) { e.preventDefault(); q.focus(); }
      }
    }
  });
})();

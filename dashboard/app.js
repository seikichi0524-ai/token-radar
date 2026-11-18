// Token Radar dashboard (radar-3 fit, board edition 2). Plain script, no
// framework, no network. Reads window.RADAR from ../data.js (written by
// main.ts from the same board that board.json carries) and renders: the
// ranked board with bootstrap value bands and farm verdicts, sortable
// columns, search + category + chain + watchlist filters, a per-protocol
// detail view with the fitted model's arithmetic recomputed in the page,
// the netted farm plan, the method scatter over the issued comparables,
// and the audit of every pre-token protocol that did not make the board.
// The model is fitted on the snapshot's own issued protocols; the model
// panel below states the fit and its out-of-sample validation.
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

  // The radar-3 model, recomputed in the page from the row's own figures.
  // This mirrors impliedValue in lib/model.ts term for term — same feature
  // transforms, same fitted constants, same order of operations — so the
  // detail view can show its work and verify the number board.json carries.
  function groupOf(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('dex') >= 0) return 'dexs';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) return 'derivatives';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'lending';
    if (c.indexOf('launchpad') >= 0) return 'launchpad';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('chain') >= 0) return 'chain';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'curators';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'staking';
    if (c.indexOf('basis') >= 0) return 'basis';
    if (c.indexOf('yield') >= 0) return 'yield';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('farm') >= 0 || c.indexOf('leveraged') >= 0) return 'farm';
    if (c.indexOf('index') >= 0 || c.indexOf('insurance') >= 0) return 'indexes';
    if (c.indexOf('locker') >= 0 || c.indexOf('services') >= 0) return 'locker';
    return 'other';
  }
  function dampedGrowth(row) {
    var m = DATA.model;
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var pct = Math.min(m.growth_cap, Math.max(m.growth_floor, raw));
    return (Math.abs(pct) <= 25 ? pct : Math.sign(pct) * (25 + Math.sqrt(Math.abs(pct) - 25) * 5)) / 100;
  }
  function impliedOf(row) {
    var m = DATA.model;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var ageT = Math.min(age, m.maturity_days) / m.maturity_days;
    var chains = Math.min(row.chains.length, m.chain_cap);
    var offset = m.group_offsets[groupOf(row.category)] || 0;
    var logv = m.intercept +
      m.tvl_slope * Math.log10(Math.max(1, row.tvl_usd)) +
      m.growth_coef * dampedGrowth(row) +
      m.age_coef * ageT +
      m.chain_coef * chains +
      offset;
    return Math.max(1, Math.round(Math.pow(10, logv)));
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
          ' is scored by one model whose numbers are not hand-picked: they are fitted on the snapshot\'s own already-issued protocols, then tested on issued protocols the fit never saw. The ',
          el('b', { text: DATA.watchlist_size + ' watchlist protocols' }),
          ' are all here; the radar adds ' + DATA.early_size + ' earlier finds below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. Every row carries a bootstrap value band and a farm plan netted to a break-even launch value with a farm, thin or skip verdict for a small wallet. Select any row for its arithmetic and farm plan.'
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
          el('span', { class: 'verdict ' + r.plan.verdict, text: r.plan.verdict })
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, signalDots(r)),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          r.band ? el('span', { class: 'bandline', text: 'band ' + fmtUsd(r.band.p10) + ' – ' + fmtUsd(r.band.p90) }) : null
        ))
      ));
    });
    tableHost.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Ranked by implied launch value under model ' + DATA.model_version + '. The chip under each radar badge is the farm verdict for the row\'s own plan (break-even against its bootstrap band). The band under each value is the 10th–90th percentile across 200 bootstrap refits. Signal cells, left to right: growing this week, over a year tokenless, multi-chain, watchlist member, TVL above the floor.' }),
          el('thead', null, el('tr', null,
            sortHead('rank', 'Rank'), sortHead('name', 'Protocol'), el('th', { scope: 'col', text: 'Radar' }),
            sortHead('tvl', 'TVL'), sortHead('growth', '7d'), sortHead('age', 'Age'),
            el('th', { scope: 'col', text: 'Signal' }), sortHead('implied', 'Implied value')
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
    var groups = Object.keys(m.group_offsets).sort();
    function vrow(name, med, miss, w2) {
      return el('tr', null,
        el('td', { text: name }),
        el('td', { class: 'num', text: med.toFixed(3) }),
        el('td', { class: 'num', text: 'x' + miss.toFixed(2) }),
        el('td', { class: 'num', text: Math.round(w2 * 100) + '%' })
      );
    }
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The model, stated in full — radar-3 (fitted, not hand-set)' }),
      el('div', { class: 'formula', text: 'log10(implied) = ' + m.intercept.toFixed(3) + ' + ' + m.tvl_slope.toFixed(3) + ' x log10(TVL) + ' + m.age_coef.toFixed(3) + ' x age + ' + m.chain_coef.toFixed(3) + ' x chains + family offset' }),
      el('p', { class: 'sub', text: 'Fitted by least squares on the ' + m.comps + ' protocols in this snapshot that already issued a token and pass the board\'s own reading (no wrapped or staked products of another protocol, no exchange fronts, no versioned duplicates). Age runs 0 to 1 over ' + m.maturity_days + ' days tokenless (unknown age counts as ' + m.unknown_age_days + ' days); chains are capped at ' + m.chain_cap + '. Family offsets are each family\'s mean residual, shrunk toward zero by n/(n+' + m.shrink_k + '). tools/fit.mjs in the repo reproduces every constant from the snapshot.' }),
      el('p', { class: 'sub', text: 'What the fit found: value grows far slower than TVL (slope ' + m.tvl_slope.toFixed(3) + ', not 1 — among issued protocols the median market value is 0.87x TVL for the smallest third, 0.25x for the middle third, 0.08x for the largest). The 7-day change carried no usable signal: left free it fitted negative, and the model\'s one sign rule — growth may not hurt — dropped the term, so a hot week is displayed but never priced. Age and chain reach price slightly negative once size is accounted for; the effects are small and they are what the evidence says.' }),
      el('h3', { text: 'Out-of-sample validation — ' + v.folds + ' folds over the ' + v.comps + ' comparables, each fold priced by a fit that never saw it' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'vtable' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Model' }), el('th', { scope: 'col', text: 'Median |log10 error|' }),
            el('th', { scope: 'col', text: 'Typical miss' }), el('th', { scope: 'col', text: 'Within 2x' })
          )),
          el('tbody', null,
            vrow('radar-3 (this board)', v.fitted_median_log_err, v.fitted_typical_miss, v.fitted_within_2x),
            vrow('radar-2 (hand-set, previous entry)', v.radar2_median_log_err, v.radar2_typical_miss, v.radar2_within_2x),
            vrow('naive (one median multiple)', v.naive_median_log_err, v.naive_typical_miss, v.naive_within_2x)
          )
        )
      ),
      el('p', { class: 'sub', text: 'Three more reads of the same fit: leave-one-out over all ' + v.comps + ' comparables gives a median error of ' + v.loo_median_log_err.toFixed(3) + '; time splits by listing age (the walk-forward analogue a single snapshot allows) give ' + v.time_split_old_to_new.toFixed(3) + ' fitting the older half and scoring the newer, and ' + v.time_split_new_to_old.toFixed(3) + ' the other way; read as a ranking, the out-of-fold Spearman correlation is ' + v.fitted_spearman.toFixed(3) + '. The folds disagree in size, as small samples do — the direction never does.' }),
      el('p', { class: 'sub', text: 'A challenger was specified before it was run — a robust Huber refit with empirical-Bayes family offsets — under a pre-registered adoption rule (median error better by 0.03 or more, a paired-bootstrap 95% interval for the gain excluding zero, no ranking loss). It failed all three (' + v.challenger_median_log_err.toFixed(3) + ' median error, Spearman ' + v.challenger_spearman.toFixed(3) + '): its shrinkage collapsed the family offsets the data supports. So the constants above are unchanged from the previous entry, and the experiment is in tools/fit.mjs for anyone to re-run. What the model cannot see, no refit fixes: revenue and fees, float and unlock design, funding and backers — the variables practitioners weight most — are not among the snapshot\'s ten fields. Every value here is a TVL-conditional value: what the market has historically paid for this much TVL of this type and age.' }),
      el('h3', { text: 'The evidence, plotted — issued comparables and the fitted size curve' }),
      scatter(),
      el('h3', { text: 'Fitted family offsets (multipliers on the size curve)' }),
      el('div', { class: 'mult-grid' }, groups.map(function (g) {
        return el('div', { class: 'mult' }, el('span', { text: g }), el('b', { text: 'x' + Math.pow(10, m.group_offsets[g]).toFixed(2) }));
      })),
      el('p', { class: 'sub', text: 'One function scores every row; no name is special-cased, and the detail view recomputes each row in this page so the arithmetic can be checked against board.json. Protocols whose token already trades are not ranked: their market cap is a fact, not a model output. The board says a protocol records no token — the snapshot is a record, not proof that none exists.' })
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
    var check = impliedOf(row);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'How this value is derived' }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'TVL (snapshot)' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Size curve (fitted slope ' + DATA.model.tvl_slope.toFixed(3) + ' on log TVL)' }), el('b', { class: 'num', text: fmtMult(row.size_factor) })),
        el('div', null, el('span', { text: 'Family offset (' + row.group + ')' }), el('b', { class: 'num', text: fmtMult(row.group_factor) })),
        el('div', null, el('span', { text: 'Growth factor (7d ' + fmtPct(row.change_7d) + ' — the fit dropped this term)' }), el('b', { class: 'num', text: fmtMult(row.growth_factor) })),
        el('div', null, el('span', { text: 'Age factor (' + fmtAge(row.age_days) + ' tokenless)' }), el('b', { class: 'num', text: fmtMult(row.age_factor) })),
        el('div', null, el('span', { text: 'Chain factor (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')' }), el('b', { class: 'num', text: fmtMult(row.chain_factor) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied launch value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Recomputed in this page: ' + fmtUsd(check) + (check === row.implied_value_usd ? ' — matches board.json exactly.' : ' — differs from board.json; treat the board as stale.') + ' An implied value is this entry\'s model claim, not a price prediction.' })
    ));
    if (row.band) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'How sure is the model? — bootstrap band' }),
        el('div', { class: 'eq' },
          el('div', null, el('span', { text: 'Value band (10th–90th pct of 200 refits)' }), el('b', { class: 'num', text: fmtUsd(row.band.p10) + ' – ' + fmtUsd(row.band.p90) })),
          el('div', null, el('span', { text: 'Rank band across the same refits' }), el('b', { class: 'num', text: '#' + row.band.rank_lo + ' – #' + row.band.rank_hi }))
        ),
        el('p', { class: 'sub', text: 'The comparables were resampled with replacement 200 times (seeded, reproducible — tools/fit.mjs) and the model refitted each time; the band is where this row\'s value and rank landed in the middle 80% of refits. It measures fit uncertainty only — the model\'s typical out-of-sample miss (x' + DATA.validation.fitted_typical_miss.toFixed(2) + ') is wider, and both are shown because they answer different questions.' })
      ));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — ' + row.farm_steps.length + ' steps · verdict: ' + row.plan.verdict }),
      el('div', { class: 'eq' },
        el('div', null, el('span', { text: 'Capital the plan deploys' }), el('b', { class: 'num', text: fmtUsd(row.plan.capital) })),
        el('div', null, el('span', { text: 'Plan cost (gas at 2025 levels, ' + row.plan.weeks + ' weekly epochs)' }), el('b', { class: 'num', text: fmtUsd(row.plan.cost_usd) })),
        el('div', null, el('span', { text: 'Attention the plan takes' }), el('b', { class: 'num', text: row.plan.hours.toFixed(1) + ' hours' })),
        el('div', null, el('span', { text: 'Break-even launch value' }), el('b', { class: 'num', text: fmtUsd(row.plan.breakeven_usd) })),
        el('div', { class: 'total' }, el('span', { text: 'Verdict for this wallet size' }), el('b', { class: 'num', text: row.plan.verdict.toUpperCase() }))
      ),
      el('p', { class: 'sub', text: 'Netting, with its assumption stated: a launch is assumed to distribute ' + Math.round(DATA.alloc_share * 100) + '% of its value to farmers, and this wallet\'s slice is pro-rata to the capital it keeps in the protocol against TVL. Break-even is the launch value at which that slice repays the plan\'s cost. Farm = break-even at or below the band\'s low end; thin = at or below the central estimate; skip = above it — the plan costs more than this wallet\'s evidence supports. Real distributions are rarely purely pro-rata; treat the verdict as a cost discipline, not a promise.' }),
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

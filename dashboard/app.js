// Token Radar dashboard (radar-2). Plain script, no framework, no network.
// Reads window.RADAR from ../data.js (written by main.ts from the same board
// that board.json carries) and renders: the ranked board, sortable columns,
// search + category + chain + watchlist filters, a per-protocol detail view
// with the model's arithmetic recomputed in the page, and the farm plan.
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

  // The radar-2 model, recomputed in the page from the row's own figures.
  // This mirrors impliedValue in lib/model.ts term for term, so the detail
  // view can show its work and verify the number board.json carries.
  function categoryMultiple(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('dex') >= 0) return 0.34;
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) return 0.33;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 0.31;
    if (c.indexOf('launchpad') >= 0) return 0.30;
    if (c.indexOf('rwa') >= 0) return 0.29;
    if (c.indexOf('chain') >= 0) return 0.29;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 0.27;
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 0.26;
    if (c.indexOf('basis') >= 0) return 0.25;
    if (c.indexOf('yield') >= 0) return 0.23;
    if (c.indexOf('bridge') >= 0) return 0.22;
    if (c.indexOf('farm') >= 0 || c.indexOf('leveraged') >= 0) return 0.21;
    if (c.indexOf('index') >= 0) return 0.20;
    if (c.indexOf('insurance') >= 0) return 0.20;
    if (c.indexOf('locker') >= 0 || c.indexOf('services') >= 0) return 0.19;
    return 0.24;
  }
  function impliedOf(row) {
    var m = DATA.model;
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var pct = Math.min(m.growth_cap, Math.max(m.growth_floor, raw));
    var damped = Math.abs(pct) <= 25 ? pct : Math.sign(pct) * (25 + Math.sqrt(Math.abs(pct) - 25) * 5);
    var growth = 1 + (damped / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var breadth = row.chains.length <= 1 ? 1 : Math.min(m.breadth_cap, 1 + (row.chains.length - 1) * m.breadth_per_chain);
    var scale = 1;
    if (row.tvl_usd > m.scale_start_usd) scale = Math.max(m.scale_floor, 1 - 0.09 * Math.log10(row.tvl_usd / m.scale_start_usd));
    return Math.max(1, Math.round(row.tvl_usd * categoryMultiple(row.category) * growth * maturity * breadth * scale));
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
          el('div', { class: 'brand-tag', text: 'pre-token launch radar · model ' + DATA.model_version })
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
          ' is scored by one stated model — TVL, 7-day growth, years running tokenless, category economics and chain reach — and ranked by the value its launch would carry if its record held. The ',
          el('b', { text: DATA.watchlist_size + ' watchlist protocols' }),
          ' are all here; the radar adds ' + DATA.early_size + ' earlier finds below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. Select any row for its arithmetic and farm plan.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : '—' }), top ? el('em', { text: top.name }) : null),
        el('div', { class: 'fact' }, el('span', { text: 'Live tokens set aside' }), el('b', { text: String(DATA.live_size) }))
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
        el('td', null, el('span', { class: 'badge ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'watchlist' : 'early find' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, signalDots(r)),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      ));
    });
    tableHost.appendChild(el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Ranked by implied launch value under model ' + DATA.model_version + '. Signal cells, left to right: growing this week, over a year tokenless, multi-chain, watchlist member, TVL above the floor.' }),
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

  function modelPanel() {
    var m = DATA.model;
    var cats = ['Dexs', 'Derivatives', 'Lending', 'Launchpad', 'RWA', 'Chain', 'Risk Curators', 'Liquid Staking', 'Basis Trading', 'Yield', 'Bridge', 'Leveraged Farming', 'Other'];
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The model, stated in full — radar-2' }),
      el('div', { class: 'formula', text: 'implied = round( TVL x category_multiple x growth_factor x maturity_factor x breadth_factor x scale_factor )' }),
      el('p', { class: 'sub', text: 'growth_factor damps the clamped 7-day change (' + m.growth_floor + '% to +' + m.growth_cap + '%, weight ' + m.growth_weight + ', square-root tail past 25%). maturity_factor runs ' + m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range).toFixed(2) + ' over ' + m.maturity_days + ' days tokenless (unknown age counts as ' + m.unknown_age_days + ' days). breadth_factor adds ' + (m.breadth_per_chain * 100) + '% per extra chain, capped at x' + m.breadth_cap + '. scale_factor compresses TVL above $1B logarithmically, floored at x' + m.scale_floor + '. One function scores every row; no name is special-cased, and the detail view recomputes each row in this page so the arithmetic can be checked against board.json.' }),
      el('div', { class: 'mult-grid' }, cats.map(function (c) {
        return el('div', { class: 'mult' }, el('span', { text: c }), el('b', { text: 'x' + categoryMultiple(c === 'Other' ? null : c).toFixed(2) }));
      })),
      el('p', { class: 'sub', text: 'Protocols whose token already trades are not ranked: their market cap is a fact, not a model output. The board says a protocol records no token — the snapshot is a record, not proof that none exists.' })
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
        el('div', null, el('span', { text: 'Category multiple (' + (row.category || 'other') + ')' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Growth factor (7d ' + fmtPct(row.change_7d) + ')' }), el('b', { class: 'num', text: fmtMult(row.growth_factor) })),
        el('div', null, el('span', { text: 'Maturity factor (' + fmtAge(row.age_days) + ' tokenless)' }), el('b', { class: 'num', text: fmtMult(row.maturity_factor) })),
        el('div', null, el('span', { text: 'Breadth factor (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')' }), el('b', { class: 'num', text: fmtMult(row.breadth_factor) })),
        el('div', null, el('span', { text: 'Scale factor' }), el('b', { class: 'num', text: fmtMult(row.scale_factor) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied launch value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Recomputed in this page: ' + fmtUsd(check) + (check === row.implied_value_usd ? ' — matches board.json exactly.' : ' — differs from board.json; treat the board as stale.') + ' An implied value is this entry\'s model claim, not a price prediction.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — ' + row.farm_steps.length + ' steps' }),
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

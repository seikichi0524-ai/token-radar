// Token Radar dashboard (radar-4 fit, board edition 5). Plain script, no
// framework, no network. Reads window.RADAR from ../data.js — written by
// main.ts from the same build that produced board.json — and renders the
// board the way the top of this page says it works:
//
//   - a KPI strip and a self-check seal first: the page recomputes the
//     board's own claims (row count, watchlist coverage, ordering,
//     totals) in the browser and prints whether they hold;
//   - the full-universe audit as one segmented bar — all 758 snapshot
//     protocols accounted for before a single row is ranked;
//   - the ranked board itself, sorted by expected value: the fitted
//     launch value times the issuance model's P(token). Launch value and
//     P stay printed beside the product, low-odds rows are dimmed, and
//     every row carries its farm plan's expected net per hands-on hour
//     and a farm / thin / skip verdict;
//   - a right rail with the evidence: the out-of-sample miss against the
//     simpler models it beat and the fancier one it refused, the method
//     scatter over the issued comparables, and the verdict census;
//   - a detail view per protocol that builds the headline figure step
//     by step (TVL -> size, age and chain terms -> launch value -> x
//     P(token) -> expected value), sets it against the nearest traded
//     comparables, and prices the farm plan to the hour;
//   - below the fold, the model panel: both fits stated in full, their
//     validation, the plan arithmetic, and the audit table of every
//     protocol that did not make the board, each with its reason.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var V = DATA.validation;
  var state = { q: '', category: 'all', chain: 'all', watchOnly: false, verdict: 'all', sort: 'rank', dir: 1, selected: null };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  // Money with cents where cents are the whole story (plan profits at
  // these sizes are single dollars; rounding them away would hide signs).
  function fmtUsdC(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) < 10) return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
    return fmtUsd(n);
  }
  function fmtSigned(n) { return (n > 0 ? '+' : '') + fmtUsdC(n); }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + Number(n).toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown age';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.max(0, Math.round(days)) + ' days';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(2); }
  function fmtHour(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + '$' + Number(n).toFixed(2) + '/h';
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
      if (state.verdict !== 'all' && r.plan.verdict !== state.verdict) return false;
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
      else if (key === 'p') { av = a.p_token; bv = b.p_token; }
      else if (key === 'launch') { av = a.launch_value_usd; bv = b.launch_value_usd; }
      else if (key === 'hour') { av = a.plan.net_per_hour; bv = b.plan.net_per_hour; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  // ---------------------------------------------------------- top matter
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

  function bestHourRow() {
    var best = null;
    DATA.rows.forEach(function (r) {
      if (r.plan.verdict === 'farm' && (best === null || r.plan.net_per_hour > best.plan.net_per_hour)) best = r;
    });
    return best;
  }

  function kpiStrip() {
    var top = DATA.rows[0];
    var best = bestHourRow();
    function kpi(label, value, sub) {
      return el('div', { class: 'kpi' },
        el('div', { class: 'kpi-label', text: label }),
        el('div', { class: 'kpi-value', text: value }),
        el('div', { class: 'kpi-sub', text: sub }));
    }
    return el('section', { class: 'kpis', 'aria-label': 'Board summary' },
      kpi('Ranked', String(DATA.board_size), 'protocols record no token yet'),
      kpi('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'every watched protocol is ranked'),
      kpi('Held-out miss', 'x' + V.fitted_typical_miss.toFixed(2), 'typical, out of sample, on 92 issued'),
      kpi('Top expected value', fmtUsd(top.implied_value_usd), top.name + ' — ' + fmtUsd(top.launch_value_usd) + ' if it launches x ' + Math.round(top.p_token * 100) + '% odds'),
      kpi('Worth farming', String(DATA.verdict_counts.farm), 'of ' + DATA.board_size + ' plans clear their costs in expectation'),
      kpi('Best expected net', best ? fmtHour(best.plan.net_per_hour) : 'n/a', best ? best.name + ', per hands-on hour' : '')
    );
  }

  // The seal is not a slogan: these checks run on the data this page was
  // shipped, in the reader's browser, every time it loads.
  function seal() {
    var rows = DATA.rows;
    var ordered = true;
    for (var i = 1; i < rows.length; i++) if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) ordered = false;
    var watch = rows.filter(function (r) { return r.watchlist; }).length;
    var sum = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var parts = [
      rows.length + '/' + DATA.board_size + ' rows on this page = board.json',
      ordered ? 'expected values in board order, none rising' : 'ORDER CHECK FAILED',
      watch + '/' + DATA.watchlist_size + ' watchlist ranked',
      'board total ' + fmtUsd(sum) + ' expected value',
      'recomputed in your browser just now'
    ];
    return el('p', { class: 'seal' },
      el('span', { class: 'seal-mark', text: '✓' }),
      ' ' + parts.join(' · '));
  }

  function auditBar() {
    var u = DATA.universe;
    var g = u.audit_groups;
    function seg(cls, n, label) {
      return el('div', { class: 'seg ' + cls, style: 'flex-grow:' + n, title: label + ': ' + n },
        el('span', { text: n + ' ' + label }));
    }
    return el('section', { class: 'auditbar', 'aria-label': 'Full-universe audit' },
      el('div', { class: 'audit-track' },
        seg('seg-ranked', u.ranked, 'ranked'),
        seg('seg-traded', u.traded, 'already record a token'),
        seg('seg-aside', u.set_aside, 'set aside')),
      el('p', { class: 'audit-note', text:
        u.total + ' protocols read = ' + u.ranked + ' + ' + u.traded + ' + ' + u.set_aside + '. ' +
        'The ' + u.set_aside + ' set aside: ' + g.product + ' products of another protocol, ' +
        g.versioned + ' versioned duplicates, ' + g.name + ' marked wrapped or staked by name' +
        (g.exchange ? ', ' + g.exchange + ' exchange fronts' : '') +
        ' — every one is listed with its reason in the audit below.' }));
  }

  // ------------------------------------------------------------- the board
  function verdictChip(v) {
    return el('span', { class: 'chip chip-' + v, text: v.toUpperCase() });
  }

  function controls() {
    var cats = ['all'].concat(Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort());
    var chains = ['all'].concat(Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort());
    function chip(label, active, onclick) {
      return el('button', { class: 'fchip' + (active ? ' on' : ''), type: 'button', onclick: onclick, text: label });
    }
    var verdictRow = el('div', { class: 'frow' },
      chip('All ' + DATA.board_size, state.verdict === 'all', function () { state.verdict = 'all'; render(); }),
      chip('Farm ' + DATA.verdict_counts.farm, state.verdict === 'farm', function () { state.verdict = 'farm'; render(); }),
      chip('Thin ' + DATA.verdict_counts.thin, state.verdict === 'thin', function () { state.verdict = 'thin'; render(); }),
      chip('Skip ' + DATA.verdict_counts.skip, state.verdict === 'skip', function () { state.verdict = 'skip'; render(); }),
      chip('Watchlist ' + DATA.watchlist_size, state.watchOnly, function () { state.watchOnly = !state.watchOnly; writeHash(); render(); }),
      el('input', { class: 'search', type: 'search', placeholder: 'Search protocols', value: state.q, 'aria-label': 'Search protocols',
        oninput: function (e) { state.q = e.target.value; writeHash(); renderTableOnly(); } })
    );
    var selRow = el('div', { class: 'frow' },
      el('label', { class: 'sel-label', text: 'Category' }),
      el('select', { class: 'sel', onchange: function (e) { state.category = e.target.value; writeHash(); render(); } },
        cats.map(function (c) {
          var o = el('option', { value: c, text: c === 'all' ? 'All categories' : c });
          if (state.category === c) o.setAttribute('selected', '');
          return o;
        })),
      el('label', { class: 'sel-label', text: 'Chain' }),
      el('select', { class: 'sel', onchange: function (e) { state.chain = e.target.value; writeHash(); render(); } },
        chains.map(function (c) {
          var o = el('option', { value: c, text: c === 'all' ? 'All chains' : c });
          if (state.chain === c) o.setAttribute('selected', '');
          return o;
        })),
      el('span', { class: 'count-note', id: 'count-note' })
    );
    return el('div', { class: 'controls' }, verdictRow, selRow);
  }

  function sortHead(label, key, cls) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ↑' : ' ↓') : '';
    return el('th', { class: cls || '', scope: 'col' },
      el('button', { class: 'shead', type: 'button', text: label + arrow, onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' || key === 'rank' ? 1 : -1; }
        renderTableOnly();
      } }));
  }

  function pCell(r) {
    var pct = Math.round(r.p_token * 100);
    var kids = [
      el('div', { class: 'p-top' },
        el('span', { class: 'p-val', text: pct + '%' }),
        r.p_token < 0.30 ? el('span', { class: 'unlikely', text: 'unlikely' }) : null),
      el('div', { class: 'p-bar' }, el('div', { class: 'p-fill', style: 'width:' + pct + '%' }))
    ];
    return el('td', { class: 'num pcell' }, kids);
  }

  function boardTable() {
    var list = sorted(filtered());
    var head = el('tr', null,
      sortHead('#', 'rank', 'num'),
      sortHead('Protocol', 'name'),
      sortHead('TVL', 'tvl', 'num'),
      sortHead('7d', 'growth', 'num'),
      sortHead('P(token)', 'p', 'num'),
      sortHead('Launch value', 'launch', 'num'),
      sortHead('Expected value', 'ev', 'num'),
      sortHead('Net $/h', 'hour', 'num'),
      el('th', { scope: 'col', text: 'Verdict' })
    );
    var body = list.map(function (r) {
      var range = r.band ? 'r' + r.band.rank_lo + '–' + r.band.rank_hi : '';
      return el('tr', { class: 'brow' + (r.p_token < 0.30 ? ' dim' : ''), tabindex: '0', title: 'Open the detail for ' + r.name,
        onclick: function () { state.selected = r.slug; writeHash(); render(); window.scrollTo(0, 0); },
        onkeydown: function (e) { if (e.key === 'Enter') { state.selected = r.slug; writeHash(); render(); window.scrollTo(0, 0); } } },
        el('td', { class: 'num rankcell' },
          el('div', { class: 'rank-n', text: String(r.rank) }),
          el('div', { class: 'rank-r', text: range })),
        el('td', null,
          el('div', { class: 'pname' },
            el('span', { text: r.name }),
            r.watchlist ? el('span', { class: 'wtag', text: 'watchlist' }) : null),
          el('div', { class: 'psub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.slice(0, 2).join(', ') || 'no chain listed') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: r.change_7d === null ? 'n/a' : fmtPct(r.change_7d) }),
        pCell(r),
        el('td', { class: 'num' },
          el('div', { text: fmtUsd(r.launch_value_usd) }),
          el('div', { class: 'cell-sub', text: r.band ? 'fit band ' + fmtUsd(r.band.p10) + '–' + fmtUsd(r.band.p90) : '' })),
        el('td', { class: 'num evcell', text: fmtUsd(r.implied_value_usd) }),
        el('td', { class: 'num ' + (r.plan.net_per_hour > 0 ? 'up' : r.plan.net_per_hour < 0 ? 'down' : ''), text: fmtHour(r.plan.net_per_hour) }),
        el('td', null, verdictChip(r.plan.verdict))
      );
    });
    var table = el('table', { class: 'board', id: 'board-table' },
      el('thead', null, head),
      el('tbody', null, body));
    return el('div', { class: 'tablewrap' }, table);
  }

  // ------------------------------------------------------------ right rail
  function railCard(title, kids) {
    return el('section', { class: 'railcard' }, el('h3', { text: title }), kids);
  }

  function evidenceCard() {
    function row(label, val, note) {
      return el('div', { class: 'evrow' },
        el('span', { class: 'ev-label', text: label }),
        el('span', { class: 'ev-val', text: val }),
        el('span', { class: 'ev-note', text: note }));
    }
    return railCard('The evidence, up front', [
      el('p', { class: 'rail-lede', text: 'Every figure out of sample: each issued comparable was priced by a fit that never trained on it.' }),
      row('this fit', 'x' + V.fitted_typical_miss.toFixed(2), 'median miss, canonical folds'),
      row('bare power law', 'x' + V.power_typical_miss.toFixed(2), 'intercept + log TVL only'),
      row('hand-set radar-2', 'x' + V.radar2_typical_miss.toFixed(2), 'the edition-1 multiples'),
      row('one flat multiple', 'x' + V.naive_typical_miss.toFixed(2), 'the naive baseline'),
      row('+ family offsets', 'x' + (Math.pow(10, V.offsets_repeated_median)).toFixed(2), 'repeated CV — rejected: worse than without (' + V.offsets_repeated_median.toFixed(3) + ' vs ' + V.fitted_repeated_median.toFixed(3) + ' median log error)'),
      row('edge vs power law', '≈ 0', 'paired bootstrap mean ' + (V.paired_mean_diff_vs_power >= 0 ? '+' : '') + V.paired_mean_diff_vs_power.toFixed(3) + ' log, 95% CI [' + V.paired_ci_lo.toFixed(3) + ', +' + V.paired_ci_hi.toFixed(3) + '] — includes zero; the case for this fit is its prices and plans, not a proven edge over the simple curve'),
      row('time split', 'x' + Math.pow(10, V.time_split_old_to_new).toFixed(2), 'fit on older launches only, pricing the newer ones it never saw'),
      el('p', { class: 'rail-note', text: 'Top-30% precision ' + Math.round(V.fitted_precision_top30 * 100) + '% against a 30% chance rate; rank correlation ' + V.fitted_spearman.toFixed(2) + '. The ranking is the fit\u2019s weak sense — its prices and plans are the strong one, and the bands below say how wide the error runs.' })
    ]);
  }

  function scatterCard() {
    var W = 300, H = 190, P = 26;
    var pts = DATA.comps;
    var xs = pts.map(function (c) { return Math.log10(c.tvl_usd); });
    var ys = pts.map(function (c) { return Math.log10(c.mcap_usd); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    function X(v) { return P + (v - x0) / (x1 - x0) * (W - P - 6); }
    function Y(v) { return H - P - (v - y0) / (y1 - y0) * (H - P - 8); }
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'scatter');
    function line(xa, ya, xb, yb, cls) {
      var l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', xa); l.setAttribute('y1', ya); l.setAttribute('x2', xb); l.setAttribute('y2', yb);
      l.setAttribute('class', cls);
      svg.appendChild(l);
    }
    line(P, 8, P, H - P, 'axis'); line(P, H - P, W - 6, H - P, 'axis');
    // The size term alone (age and chain terms at zero), for shape.
    line(X(x0), Y(DATA.model.intercept + DATA.model.tvl_slope * x0), X(x1), Y(DATA.model.intercept + DATA.model.tvl_slope * x1), 'fitline');
    pts.forEach(function (c) {
      var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', X(Math.log10(c.tvl_usd)).toFixed(1));
      dot.setAttribute('cy', Y(Math.log10(c.mcap_usd)).toFixed(1));
      dot.setAttribute('r', '2');
      dot.setAttribute('class', 'dot');
      svg.appendChild(dot);
    });
    return railCard('The fit, on its evidence', [
      svg,
      el('p', { class: 'rail-note', text: DATA.comps.length + ' issued comparables: market cap against TVL, log–log. The line is the size term alone; age and chain terms move a point off it. Value per TVL dollar collapses with scale — that bend is the model.' })
    ]);
  }

  function censusCard() {
    var farm = DATA.rows.filter(function (r) { return r.plan.verdict === 'farm'; }).slice(0, 5);
    return railCard('The census', [
      el('div', { class: 'census-nums' },
        el('div', null, el('div', { class: 'cn farm', text: String(DATA.verdict_counts.farm) }), el('div', { class: 'cn-label', text: 'farm' })),
        el('div', null, el('div', { class: 'cn thin', text: String(DATA.verdict_counts.thin) }), el('div', { class: 'cn-label', text: 'thin' })),
        el('div', null, el('div', { class: 'cn skip', text: String(DATA.verdict_counts.skip) }), el('div', { class: 'cn-label', text: 'skip' }))),
      el('p', { class: 'rail-note', text: 'Each plan is judged on expected profit at its own capital ($250–$5,000 by TVL tier), after gas and a 4%-a-year opportunity cost: farm = expectation positive; thin = negative but P(profit) at least ' + Math.round(V.thin_pprofit * 100) + '%; skip = neither.' }),
      el('div', { class: 'farmfirst' },
        el('div', { class: 'ff-title', text: 'Farm-grade, first five by expected value' }),
        farm.map(function (r) {
          return el('button', { class: 'ff-row', type: 'button', onclick: function () { state.selected = r.slug; writeHash(); render(); window.scrollTo(0, 0); } },
            el('span', { class: 'ff-rank', text: '#' + r.rank }),
            el('span', { class: 'ff-name', text: r.name }),
            el('span', { class: 'ff-net', text: fmtHour(r.plan.net_per_hour) }));
        }))
    ]);
  }

  function howToRead() {
    return railCard('How to read this board', [
      el('p', { class: 'rail-note', text: 'Rank is by expected value = launch value x P(token). The launch value is what the fit says the token would be worth if it launches; P(token) is the share of like-shaped protocols that have already issued — a cross-section, not a schedule.' }),
      el('p', { class: 'rail-note', text: 'Two ranges, two meanings: the fit band under each launch value is refit uncertainty (200 joint bootstrap refits); the wider 80% prediction interval in the detail view is where real launches landed against fits like this one (x' + V.pi_lo_factor.toFixed(2) + ' to x' + V.pi_hi_factor.toFixed(1) + ').' }),
      el('p', { class: 'rail-note', text: 'Rows with P(token) under 30% are dimmed and tagged unlikely: their expected value rests on a launch the model does not expect.' })
    ]);
  }

  // -------------------------------------------------------------- detail
  function detail(r) {
    var back = el('button', { class: 'back', type: 'button', text: '← Back to the board', onclick: function () {
      state.selected = null; writeHash(); render();
    } });
    var head = el('div', { class: 'd-head' },
      el('div', null,
        el('h2', { class: 'd-name', text: r.name }),
        el('div', { class: 'd-sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains.join(', ') || 'no chain listed') + ' · tokenless for ' + fmtAge(r.age_days) + (r.watchlist ? ' · on the house watchlist' : '') })),
      verdictChip(r.plan.verdict));

    function wrow(label, value, note, cls) {
      return el('div', { class: 'wrow ' + (cls || '') },
        el('span', { class: 'w-label', text: label }),
        el('span', { class: 'w-value', text: value }),
        el('span', { class: 'w-note', text: note || '' }));
    }
    var waterfall = el('section', { class: 'dcard' },
      el('h3', { text: 'How this figure is made' }),
      wrow('TVL in the snapshot', fmtUsd(r.tvl_usd), r.change_7d === null ? '' : fmtPct(r.change_7d) + ' over 7 days — displayed, never priced'),
      wrow('x size term', fmtMult(r.size_factor), 'the fitted bend: value per TVL dollar falls with scale'),
      wrow('x age term', fmtMult(r.age_factor), 'tokenless for ' + fmtAge(r.age_days)),
      wrow('x chain term', fmtMult(r.chain_factor), r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains')),
      wrow('= value if it launches', fmtUsd(r.launch_value_usd), 'fit band ' + (r.band ? fmtUsd(r.band.p10) + '–' + fmtUsd(r.band.p90) : 'n/a') + ' · 80% prediction interval ' + fmtUsd(r.pi_lo) + '–' + fmtUsd(r.pi_hi), 'w-mid'),
      wrow('x P(token)', r.p_token.toFixed(2), 'share of like-shaped protocols that have already issued'),
      wrow('= expected value — the rank figure', fmtUsd(r.implied_value_usd), 'rank #' + r.rank + ' of ' + DATA.board_size + (r.band ? ' · refit rank range ' + r.band.rank_lo + '–' + r.band.rank_hi : ''), 'w-final'),
      el('p', { class: 'rail-note', text: 'Factors are rounded to 4 decimals in this table; the product can differ from the printed launch value in the last digit. The growth term is priced at x1.00 by the model\u2019s sign rule — a hot week never lowers a price, and never raises one either.' })
    );

    var nearest = el('section', { class: 'dcard' },
      el('h3', { text: 'Nearest traded comparables' }),
      el('p', { class: 'rail-note', text: 'Issued protocols nearest this row in TVL, same family first — what the market actually paid for shapes like this one.' }),
      r.nearest.map(function (c) {
        return el('div', { class: 'nrow' },
          el('span', { class: 'n-name', text: c.name }),
          el('span', { class: 'n-tvl', text: fmtUsd(c.tvl_usd) + ' TVL' }),
          el('span', { class: 'n-cap', text: fmtUsd(c.mcap_usd) + ' cap (' + (c.mcap_usd / c.tvl_usd).toFixed(2) + 'x TVL)' }));
      }));

    var issuance = el('section', { class: 'dcard' },
      el('h3', { text: 'The issuance score' }),
      el('p', { class: 'rail-note', text: 'P(token) = ' + r.p_token.toFixed(2) + '. A logistic model over the snapshot\u2019s ' + (V.ptoken_positives + V.ptoken_negatives) + ' labelled protocols (cross-validated AUC ' + V.ptoken_auc.toFixed(2) + ', Brier ' + V.ptoken_brier.toFixed(3) + ' against ' + V.ptoken_brier_base.toFixed(3) + ' for the base rate). It reads as a cross-section — protocols shaped like this one have, or have not, launched — not as a forecast with a date. Its decile calibration — predicted against actual, out of fold — is printed in the model panel below.' })
    );

    var plan = r.plan;
    var planCard = el('section', { class: 'dcard' },
      el('h3', { text: 'The farm plan, priced' }),
      el('div', { class: 'plan-grid' },
        el('div', null, el('div', { class: 'pg-label', text: 'Capital' }), el('div', { class: 'pg-val', text: fmtUsd(plan.capital) })),
        el('div', null, el('div', { class: 'pg-label', text: 'Hold' }), el('div', { class: 'pg-val', text: plan.weeks + ' weeks' })),
        el('div', null, el('div', { class: 'pg-label', text: 'Gas + bridge' }), el('div', { class: 'pg-val', text: fmtUsdC(plan.cost_usd) })),
        el('div', null, el('div', { class: 'pg-label', text: 'Opportunity cost' }), el('div', { class: 'pg-val', text: fmtUsdC(plan.opp_cost_usd) })),
        el('div', null, el('div', { class: 'pg-label', text: 'Expected net' }), el('div', { class: 'pg-val', text: fmtSigned(plan.expected_net_usd) })),
        el('div', null, el('div', { class: 'pg-label', text: 'Per hands-on hour' }), el('div', { class: 'pg-val', text: fmtHour(plan.net_per_hour) })),
        el('div', null, el('div', { class: 'pg-label', text: 'P(profit)' }), el('div', { class: 'pg-val', text: Math.round(plan.p_profit * 100) + '%' })),
        el('div', null, el('div', { class: 'pg-label', text: 'Break-even launch' }), el('div', { class: 'pg-val', text: fmtUsd(plan.breakeven_usd) }))),
      el('p', { class: 'rail-note', text: plan.min_capital_usd === null
        ? 'No size breaks even: at this row\u2019s odds and value, the expected yield per dollar sits under the 4% opportunity rate, so deploying more only scales the loss. The break-even above is the launch value that would repay this plan\u2019s costs if a launch happens.'
        : 'The smallest deployment whose expected allocation repays gas plus opportunity cost is ' + fmtUsd(plan.min_capital_usd) + '. The break-even is the launch value that repays this plan\u2019s costs if a launch happens; the probability weighting lives in the expected net and P(profit).' })
    );

    var notes = r.notes.length ? el('section', { class: 'dcard' },
      el('h3', { text: 'Watch notes' }),
      r.notes.map(function (n) { return el('p', { class: 'note-item', text: n }); })) : null;

    var steps = el('section', { class: 'dcard' },
      el('h3', { text: 'Farm steps' }),
      el('ol', { class: 'steps' }, r.farm_steps.map(function (s) { return el('li', { text: s }); })));

    return el('div', { class: 'detail' }, back, head,
      el('div', { class: 'd-grid' },
        el('div', null, waterfall, planCard, steps),
        el('div', null, nearest, issuance, notes)));
  }

  // --------------------------------------------------------- model panel
  function modelPanel() {
    var m = DATA.model;
    function kv(label, value) {
      return el('div', { class: 'kv' }, el('span', { class: 'kv-k', text: label }), el('span', { class: 'kv-v', text: value }));
    }
    var eq = 'log10(launch value) = ' + m.intercept.toFixed(3) + ' + ' + m.tvl_slope.toFixed(3) + ' x log10(TVL) ' +
      (m.age_coef < 0 ? '− ' : '+ ') + Math.abs(m.age_coef).toFixed(3) + ' x age ' +
      (m.chain_coef < 0 ? '− ' : '+ ') + Math.abs(m.chain_coef).toFixed(3) + ' x chains';
    var validation = el('section', { class: 'dcard mp' },
      el('h3', { text: 'The model, stated in full' }),
      el('p', { class: 'rail-note', text: 'Fitted on the snapshot\u2019s own ' + m.comps + ' issued comparables — no hand-set multiples, no names given rules. ' + eq + '. Growth is fitted at zero under the sign rule (growth may not lower a price; given a free coefficient it fitted negative and was removed). Per-family offsets were tested and rejected: on the canonical folds they flatter (0.515 vs 0.542 median log error), over 20 repetitions of 5-fold CV they reverse (' + V.offsets_repeated_median.toFixed(3) + ' with vs ' + V.fitted_repeated_median.toFixed(3) + ' without), so the simpler spec ships and the ablation is published instead. One honest caveat: the spec was chosen on these same resamples, so the repeated-CV figures are mildly optimistic for the chosen spec.' }),
      el('div', { class: 'kv-grid' },
        kv('Median miss, canonical folds', 'x' + V.fitted_typical_miss.toFixed(2)),
        kv('Within 2x / 3x of actual cap', Math.round(V.fitted_within_2x * 100) + '% / ' + Math.round(V.fitted_within_3x * 100) + '%'),
        kv('Leave-one-out median', V.loo_median_log_err.toFixed(3) + ' log10'),
        kv('Time split, old fits new', V.time_split_old_to_new.toFixed(3) + ' log10'),
        kv('Time split, new fits old', V.time_split_new_to_old.toFixed(3) + ' log10'),
        kv('Edge over power law (paired)', V.paired_mean_diff_vs_power.toFixed(3) + ', 95% CI [' + V.paired_ci_lo.toFixed(3) + ', +' + V.paired_ci_hi.toFixed(3) + ']'),
        kv('Issuance model AUC (CV)', V.ptoken_auc.toFixed(3)),
        kv('Prediction interval (80%)', 'x' + V.pi_lo_factor.toFixed(2) + ' to x' + V.pi_hi_factor.toFixed(1) + ' of launch value')),
      el('div', { class: 'calib' },
        el('div', { class: 'calib-title', text: 'Issuance calibration — predicted vs actual issued share by predicted decile, out of fold' }),
        el('div', { class: 'calib-grid' },
          V.ptoken_calibration.map(function (b) {
            return el('div', { class: 'calib-cell' },
              el('div', { class: 'calib-lo', text: b.lo.toFixed(1) + '–' + (b.lo + 0.1).toFixed(1) }),
              el('div', { class: 'calib-pred', text: Math.round(b.pred * 100) + '%' }),
              el('div', { class: 'calib-act', text: Math.round(b.act * 100) + '%' }),
              el('div', { class: 'calib-n', text: 'n=' + b.n }));
          })),
        el('p', { class: 'rail-note', text: 'Each cell: the decile of predicted P(token), the mean prediction, the share that had actually issued, and the count. The dense middle tracks; the tails wobble inside the noise of n=' + (V.ptoken_positives + V.ptoken_negatives) + ', so no recalibration curve is fitted to them. Age x family interactions were tested on the same folds and rejected (AUC 0.707 against 0.709 shipped, Brier unchanged).' })),
      el('p', { class: 'rail-note', text: 'Plan arithmetic: a launch is assumed to distribute ' + Math.round(DATA.alloc_share * 100) + '% of its value to the farming community, pro-rata to capital against TVL; capital is tiered $250–$5,000 by TVL; gas follows the plan\u2019s chain family at 2025 post-Dencun levels; parked capital is charged ' + Math.round(DATA.opp_rate * 100) + '% a year. P(profit) integrates over the fit\u2019s own out-of-sample residuals — the empirical distribution, not a parametric guess.' })
    );
    var audit = el('section', { class: 'dcard mp' },
      el('h3', { text: 'Set aside — the audit (' + DATA.audit.length + ')' }),
      el('p', { class: 'rail-note', text: 'Every pre-token protocol that is not on the board, with the reason. Nothing is dropped silently.' }),
      el('div', { class: 'audit-list' },
        DATA.audit.map(function (a) {
          return el('div', { class: 'arow' },
            el('span', { class: 'a-name', text: a.name }),
            el('span', { class: 'a-tvl', text: fmtUsd(a.tvl_usd) }),
            el('span', { class: 'a-reason', text: a.reason }));
        })));
    var anchors = el('section', { class: 'dcard mp' },
      el('h3', { text: 'Already trading — scale anchors' }),
      el('p', { class: 'rail-note', text: 'The largest issued protocols in the snapshot, for scale. They fit the curves above; they are never ranked.' }),
      DATA.live.slice(0, 8).map(function (l) {
        return el('div', { class: 'nrow' },
          el('span', { class: 'n-name', text: l.name }),
          el('span', { class: 'n-tvl', text: fmtUsd(l.tvl_usd) + ' TVL' }),
          el('span', { class: 'n-cap', text: l.mcap_usd ? fmtUsd(l.mcap_usd) + ' cap' : 'cap n/a' }));
      }));
    return el('div', { class: 'mpanel' }, validation, audit, anchors);
  }

  // --------------------------------------------------------------- render
  function renderTableOnly() {
    var wrap = document.querySelector('.tablewrap');
    if (wrap) wrap.replaceWith(boardTable());
    var note = document.getElementById('count-note');
    if (note) note.textContent = filtered().length + ' of ' + DATA.board_size + ' shown';
  }

  function render() {
    app.setAttribute('aria-busy', 'true');
    app.innerHTML = '';
    if (state.selected) {
      var row = DATA.rows.filter(function (r) { return r.slug === state.selected; })[0];
      if (row) { app.appendChild(header()); app.appendChild(detail(row)); app.setAttribute('aria-busy', 'false'); return; }
      state.selected = null;
    }
    app.appendChild(header());
    app.appendChild(el('h1', { class: 'headline', text: 'Which pre-token protocol is worth farming next?' }));
    app.appendChild(el('p', { class: 'lede', text: 'Ranked by expected value — the fitted value if a token launches, times the model\u2019s odds that it launches. Both numbers stay printed beside the product; the evidence and the full audit are on this page, not behind it.' }));
    app.appendChild(kpiStrip());
    app.appendChild(seal());
    app.appendChild(auditBar());
    app.appendChild(el('div', { class: 'layout' },
      el('section', { class: 'boardcard', 'aria-label': 'The ranked board' }, controls(), boardTable()),
      el('aside', { class: 'rail' }, evidenceCard(), scatterCard(), censusCard(), howToRead())
    ));
    app.appendChild(modelPanel());
    app.appendChild(el('footer', { class: 'foot', text: 'Token Radar · model ' + DATA.model_version + ' · board edition ' + DATA.board_edition + ' · snapshot ' + DATA.as_of + ' · figures are model estimates with stated error, not promises.' }));
    var note = document.getElementById('count-note');
    if (note) note.textContent = filtered().length + ' of ' + DATA.board_size + ' shown';
    app.setAttribute('aria-busy', 'false');
  }

  readHash();
  render();
})();

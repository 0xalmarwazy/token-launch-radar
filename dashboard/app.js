// Token Radar dashboard: renders window.RADAR (written by main.ts as data.js)
// into a sortable, filterable board with a detail view per protocol. No fetch,
// no network, no framework: the whole dataset is already on the page.
//
// The page states the model it runs on: a comps-fitted valuation, validated out
// of sample on the snapshot's own tokenized protocols. The model strip names the
// fit, the validation panel names the out-of-sample numbers, and each detail
// view names the row's own comps, multiple and farm economics.
//
// Deep links, for screenshots and sharing:
//   #detail=<slug>  opens one protocol's detail view
//   #cat=<category> #chain=<chain> #q=<text> #wl=1  set the filters

(function () {
  'use strict';

  var RADAR = window.RADAR;
  if (!RADAR || !Array.isArray(RADAR.rows)) {
    document.getElementById('rows').innerHTML =
      '<tr><td colspan="8">No board data: data.js did not load.</td></tr>';
    return;
  }

  /* ---------- small helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    if (n == null || !isFinite(n)) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function signedMoney(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pct(v) {
    if (v == null || !isFinite(v)) return '<span class="flat">—</span>';
    var cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
    var sign = v > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + v.toFixed(1) + '%</span>';
  }

  function ageLabel(days) {
    if (days == null) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }

  function chainsLabel(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3);
  }

  function verdictBadge(v, net) {
    var cls = v === 'FARM' ? 'farm' : v === 'THIN' ? 'thin' : 'skip';
    var label = v === 'FARM' ? 'FARM' : v === 'THIN' ? 'THIN' : 'SKIP';
    return '<span class="verdict ' + cls + '">' + label + '</span>' +
      '<br><span class="net">' + signedMoney(net) + ' net</span>';
  }

  /* ---------- state ---------- */

  var state = { q: '', cat: '', chain: '', wl: false, sort: 'rank', dir: 1, selected: null };

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    var p = new URLSearchParams(h);
    state.q = p.get('q') || '';
    state.cat = p.get('cat') || '';
    state.chain = p.get('chain') || '';
    state.wl = p.get('wl') === '1';
    state.selected = p.get('detail') || null;
  }

  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.chain) p.set('chain', state.chain);
    if (state.wl) p.set('wl', '1');
    if (state.selected) p.set('detail', state.selected);
    var next = p.toString();
    var current = window.location.hash.replace(/^#/, '');
    if (next !== current) {
      history.replaceState(null, '', next ? '#' + next : window.location.pathname);
    }
  }

  /* ---------- header, model strip, validation, filters ---------- */

  function renderStats() {
    var farms = 0;
    RADAR.rows.forEach(function (r) { if (r.verdict === 'FARM') farms++; });
    var el = document.getElementById('stats');
    el.innerHTML =
      '<div><dt>Snapshot</dt><dd>' + esc(RADAR.as_of) + '</dd></div>' +
      '<div><dt>Watchlist</dt><dd>' + RADAR.watchlist_size + '</dd></div>' +
      '<div><dt>Board rows</dt><dd>' + RADAR.board_size + '</dd></div>' +
      '<div><dt>Early finds</dt><dd>' + RADAR.early_size + '</dd></div>' +
      '<div><dt>Comps fitted</dt><dd>' + RADAR.fit.comps + '</dd></div>' +
      '<div><dt>Worth farming</dt><dd>' + farms + '</dd></div>';
  }

  function renderModel() {
    var fit = RADAR.fit;
    var top = RADAR.rows[0];
    var earlyTop = null;
    for (var i = 0; i < RADAR.rows.length; i++) {
      if (!RADAR.rows[i].on_watchlist) { earlyTop = RADAR.rows[i]; break; }
    }
    var topCats = fit.categories.slice(0, 4).map(function (c) {
      return esc(c.category) + ' ' + c.fitted_ratio.toFixed(2) + '× (' + c.comps + ')';
    }).join(', ');
    document.getElementById('model').innerHTML =
      '<strong>How the value is scored — fitted from the market, not assumed.</strong> ' +
      'The model prices each pre-token protocol off the snapshot\'s own ' + fit.comps + ' tokenized comparables: ' +
      'each category\'s median market-cap-to-TVL multiple, shrunk toward the global median of ' +
      '<code>' + fit.global_ratio.toFixed(3) + '×</code> so a thin category cannot set its own price, ' +
      'then scaled by a size curve fitted on log market cap against log TVL ' +
      '(slope <code>' + fit.size_slope.toFixed(2) + '</code>: the market pays a lower multiple as protocols grow). ' +
      'Small overlays follow for seven-day growth, tenure with no token and chain breadth. ' +
      'Category multiples, most comps first: ' + topCats + '. ' +
      'Every row is a protocol whose record shows no token; the ' + RADAR.watchlist_size + ' on the watchlist are the floor, ' +
      'and the ' + RADAR.early_size + ' below it are the radar\'s own finds. ' +
      'Top of the board: <strong>' + esc(top.name) + '</strong> at ' + money(top.implied_value_usd) +
      (earlyTop
        ? '; top early find: <strong>' + esc(earlyTop.name) + '</strong> at rank ' + earlyTop.rank + ', ' + money(earlyTop.implied_value_usd) + '.'
        : '.');
  }

  function renderValidation() {
    var v = RADAR.validation;
    var fit = RADAR.fit;
    var ts = v.time_split;
    var catRows = fit.categories.slice(0, 6).map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.comps + '</td>' +
        '<td class="num">' + c.median_ratio.toFixed(2) + '×</td>' +
        '<td class="num"><strong>' + c.fitted_ratio.toFixed(2) + '×</strong></td></tr>';
    }).join('');
    document.getElementById('validation').innerHTML =
      '<h2>Out-of-sample validation — the model tested on the market caps it never saw</h2>' +
      '<div class="val-grid">' +
      '<div class="val-cell"><div class="k">5-fold cross-validation</div><div class="v">' + v.cv.median_factor_error.toFixed(2) + '×</div>' +
      '<div class="d">median error predicting held-out comps\' market caps, n=' + v.cv.n +
      '; ' + Math.round(v.cv.within_2x * 100) + '% within 2×, ' + Math.round(v.cv.within_3x * 100) + '% within 3×</div></div>' +
      (ts
        ? '<div class="val-cell"><div class="k">Time split — fit on the past, tested on the future</div><div class="v">' + ts.median_factor_error.toFixed(2) + '×</div>' +
          '<div class="d">fitted on ' + ts.train_n + ' comps listed before ' + esc(ts.split_date) +
          ', tested on the ' + ts.test_n + ' listed after; ' + Math.round(ts.within_3x * 100) + '% within 3×</div></div>'
        : '') +
      '<div class="val-cell"><div class="k">Bootstrap of the global multiple</div><div class="v">' +
      v.bootstrap.median.toFixed(3) + '×</div>' +
      '<div class="d">90% interval ' + v.bootstrap.median_low.toFixed(3) + '×–' + v.bootstrap.median_high.toFixed(3) +
      '× over ' + v.bootstrap.draws + ' resamples of the comps</div></div>' +
      '<div class="val-cell"><div class="k">Flat 0.30× multiple, same test</div><div class="v">' + v.baseline_median_factor_error.toFixed(2) + '×</div>' +
      '<div class="d">the previous version\'s model, scored the same way: the comps fit cuts the median error from ' +
      v.baseline_median_factor_error.toFixed(2) + '× to ' + v.cv.median_factor_error.toFixed(2) + '×</div></div>' +
      '</div>' +
      '<table class="cat-table"><thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Median multiple</th><th class="num">Fitted multiple</th></tr></thead>' +
      '<tbody>' + catRows + '</tbody></table>' +
      '<p class="val-note">Fitted multiples shrink each category\'s median toward the global median (prior weight 8 comps) and clamp to half–twice the global, so one outlier comp cannot decide a category. ' +
      fit.excluded + ' tokenized protocols were excluded from the fit: exchanges, versioned pools carrying a parent\'s token, and ratios outside 0.001×–20×.</p>';
  }

  function fillSelect(id, values) {
    var sel = document.getElementById(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
  }

  function renderFilters() {
    var cats = {};
    var chains = {};
    RADAR.rows.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      (r.chains || []).forEach(function (c) { chains[c] = 1; });
    });
    fillSelect('cat', Object.keys(cats).sort());
    fillSelect('chain', Object.keys(chains).sort());
    document.getElementById('q').value = state.q;
    document.getElementById('cat').value = state.cat;
    document.getElementById('chain').value = state.chain;
    document.getElementById('wl').checked = state.wl;
  }

  /* ---------- board ---------- */

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = RADAR.rows.filter(function (r) {
      if (state.wl && !r.on_watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av == null && bv == null) return a.rank - b.rank;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') {
        var c = av.localeCompare(bv);
        return (c !== 0 ? c : a.rank - b.rank) * dir;
      }
      return (av - bv || a.rank - b.rank) * dir;
    });
    return rows;
  }

  function rankBadge(rank) {
    var cls = rank === 1 ? ' top1' : rank === 2 ? ' top2' : rank === 3 ? ' top3' : '';
    return '<span class="rank-badge' + cls + '">' + rank + '</span>';
  }

  function renderBoard() {
    var rows = filteredRows();
    var tbody = document.getElementById('rows');
    document.getElementById('empty').hidden = rows.length > 0;
    document.getElementById('count').textContent =
      rows.length + ' of ' + RADAR.rows.length + ' protocols';
    var html = '';
    rows.forEach(function (r) {
      var sel = state.selected === r.slug ? ' class="selected"' : '';
      html +=
        '<tr data-slug="' + esc(r.slug) + '"' + sel + '>' +
        '<td>' + rankBadge(r.rank) + '</td>' +
        '<td class="name-cell"><span class="name">' + esc(r.name) + '</span>' +
        (r.on_watchlist ? '<span class="star" title="On the watchlist">★</span>' : '') +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong></td>' +
        '<td class="num">' + verdictBadge(r.verdict, r.net_ev_usd) + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
    var heads = document.querySelectorAll('#board thead th[data-sort]');
    heads.forEach(function (th) {
      var k = th.getAttribute('data-sort');
      th.classList.toggle('sorted', k === state.sort);
      th.textContent = th.textContent.replace(/ [▲▼]$/, '');
      if (k === state.sort) th.textContent += state.dir === 1 ? ' ▲' : ' ▼';
    });
  }

  /* ---------- detail ---------- */

  function findRow(slug) {
    for (var i = 0; i < RADAR.rows.length; i++) {
      if (RADAR.rows[i].slug === slug) return RADAR.rows[i];
    }
    return null;
  }

  function renderDetail() {
    var panel = document.getElementById('detail');
    var r = state.selected ? findRow(state.selected) : null;
    if (!r) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }
    var m = r.model;
    var f = r.farm;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var comps = m.nearest.map(function (c) {
      return '<li><strong>' + esc(c.name) + '</strong> <span class="slug">' + esc(c.slug) + '</span> — ' + c.ratio.toFixed(2) + '× market cap / TVL</li>';
    }).join('');
    var verdictNote = r.verdict === 'FARM'
      ? 'Worth farming: the expected value clears the costs by more than $100.'
      : r.verdict === 'THIN'
        ? 'Marginal: the expected value barely clears the costs.'
        : 'Not worth it at this size: the costs eat the whole expected value.';
    panel.hidden = false;
    panel.innerHTML =
      '<div class="detail-head"><h2>' + esc(r.name) + ' <span class="slug">#' + r.rank + ' · ' + esc(r.slug) + '</span></h2>' +
      '<button class="close" id="close-detail" type="button">Close ✕</button></div>' +
      '<div class="badges">' +
      '<span class="badge pre">No token recorded</span>' +
      (r.on_watchlist ? '<span class="badge watch">★ On the watchlist</span>' : '<span class="badge">Early find — below the watchlist floor</span>') +
      '<span class="badge">' + esc(r.category || 'No category') + '</span>' +
      '<span class="badge">' + esc(chainsLabel(r.chains)) + '</span>' +
      '<span class="badge verdict-badge ' + (r.verdict === 'FARM' ? 'farm' : r.verdict === 'THIN' ? 'thin' : 'skip') + '">' + r.verdict + ' · ' + signedMoney(r.net_ev_usd) + ' net EV</span>' +
      '</div>' +
      '<div class="detail-grid">' +
      '<div class="cell"><div class="k">Implied value</div><div class="v">' + moneyFull(r.implied_value_usd) + '</div></div>' +
      '<div class="cell"><div class="k">TVL</div><div class="v">' + moneyFull(r.tvl_usd) + '</div></div>' +
      '<div class="cell"><div class="k">7-day change</div><div class="v">' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</div></div>' +
      '<div class="cell"><div class="k">Tracked since</div><div class="v small">' + esc(r.listed_at || 'Unknown') + ' · ' + ageLabel(r.age_days) + '</div></div>' +
      '</div>' +
      '<div class="model-break"><strong>How ' + moneyFull(r.implied_value_usd) + ' is reached:</strong> ' +
      'TVL ' + moneyFull(r.tvl_usd) + ' × the fitted <code>' + (r.category || 'no-category') + ' multiple ' + m.category_ratio.toFixed(2) + '×</code> ' +
      '(' + m.category_comps + ' comp' + (m.category_comps === 1 ? '' : 's') + ' in this category, shrunk toward the global ' + m.global_ratio.toFixed(2) + '×) ' +
      '× the size factor <code>' + m.size_factor.toFixed(2) + '</code> (curve slope ' + m.size_slope.toFixed(2) + ') ' +
      '= <code>' + moneyFull(m.comps_value_usd) + ' comps value</code>, ' +
      'then × <code>' + m.growth_multiplier.toFixed(2) + ' growth</code> × ' +
      '<code>' + m.tenure_multiplier.toFixed(2) + ' tenure</code> × ' +
      '<code>' + m.breadth_multiplier.toFixed(2) + ' breadth</code> across ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + '.</div>' +
      '<div class="comps"><h3>Nearest comparables</h3><ul>' + comps + '</ul>' +
      '<p class="comp-note">Same-category comps first, by TVL distance. The fitted multiple is the category median shrunk toward the global median, so one outlier comp cannot set the price.</p></div>' +
      '<div class="econ"><h3>Farm economics — netted to the dollar</h3>' +
      '<table class="econ-table"><tbody>' +
      '<tr><td>Position</td><td class="num">$' + f.capital_usd + ' capital, ' + f.hold_days + ' days, ' + f.tx_count + ' transactions</td></tr>' +
      '<tr><td>Costs</td><td class="num">$' + f.gas_total_usd + ' gas + $' + f.time_cost_usd + ' time (' + f.minutes + ' min at $25/hr) + $' + f.opportunity_cost_usd + ' opportunity = <strong>$' + f.cost_total_usd + '</strong></td></tr>' +
      '<tr><td>Airdrop pool</td><td class="num">7% of ' + money(r.implied_value_usd) + ' = ' + money(f.pool_usd) + '</td></tr>' +
      '<tr><td>Farmers sharing it</td><td class="num">~' + f.farmers.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '</td></tr>' +
      '<tr><td>Expected value</td><td class="num"><strong>$' + f.ev_mid_usd + '</strong> (range $' + f.ev_low_usd + '–$' + f.ev_high_usd + ')</td></tr>' +
      '<tr><td>Net expected value</td><td class="num"><strong>' + signedMoney(f.net_ev_usd) + '</strong> — ' + verdictNote + '</td></tr>' +
      '</tbody></table></div>' +
      '<div class="farm"><h3>Farm plan — six steps</h3><ol>' + steps + '</ol></div>';
    document.getElementById('close-detail').addEventListener('click', function () {
      state.selected = null;
      writeHash();
      renderDetail();
      renderBoard();
    });
  }

  /* ---------- live view ---------- */

  function renderLive() {
    var html = '';
    RADAR.live.forEach(function (l) {
      html +=
        '<tr>' +
        '<td class="name-cell"><span class="name">' + esc(l.name) + '</span><br><span class="slug">' + esc(l.slug) + '</span></td>' +
        '<td>' + esc(l.category || '—') + '</td>' +
        '<td class="num">' + money(l.tvl_usd) + '</td>' +
        '<td class="num"><strong>' + money(l.mcap_usd) + '</strong></td>' +
        '<td class="num">' + pct(l.change_7d) + '</td>' +
        '</tr>';
    });
    document.getElementById('live-rows').innerHTML = html;
  }

  /* ---------- wire up ---------- */

  function renderAll() {
    renderBoard();
    renderDetail();
  }

  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value;
    writeHash();
    renderBoard();
  });
  document.getElementById('cat').addEventListener('change', function (e) {
    state.cat = e.target.value;
    writeHash();
    renderBoard();
  });
  document.getElementById('chain').addEventListener('change', function (e) {
    state.chain = e.target.value;
    writeHash();
    renderBoard();
  });
  document.getElementById('wl').addEventListener('change', function (e) {
    state.wl = e.target.checked;
    writeHash();
    renderBoard();
  });
  document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) {
        state.dir = -state.dir;
      } else {
        state.sort = k;
        state.dir = k === 'name' || k === 'category' ? 1 : -1;
      }
      renderBoard();
    });
  });
  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.selected = tr.getAttribute('data-slug');
    writeHash();
    renderAll();
    document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  window.addEventListener('hashchange', function () {
    readHash();
    document.getElementById('q').value = state.q;
    document.getElementById('cat').value = state.cat;
    document.getElementById('chain').value = state.chain;
    document.getElementById('wl').checked = state.wl;
    renderAll();
  });

  readHash();
  renderStats();
  renderModel();
  renderValidation();
  renderFilters();
  renderAll();
})();

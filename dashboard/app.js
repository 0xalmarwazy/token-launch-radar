// Token Radar dashboard: renders window.RADAR (written by main.ts as data.js)
// into a sortable, filterable board with a detail view per protocol. No fetch,
// no network, no framework: the whole dataset is already on the page.
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

  /* ---------- header, model strip, filters ---------- */

  function renderStats() {
    var el = document.getElementById('stats');
    el.innerHTML =
      '<div><dt>Snapshot</dt><dd>' + esc(RADAR.as_of) + '</dd></div>' +
      '<div><dt>Watchlist</dt><dd>' + RADAR.watchlist_size + '</dd></div>' +
      '<div><dt>Board rows</dt><dd>' + RADAR.board_size + '</dd></div>' +
      '<div><dt>Early finds</dt><dd>' + RADAR.early_size + '</dd></div>' +
      '<div><dt>Floor</dt><dd>' + money(RADAR.floor_usd) + '</dd></div>';
  }

  function renderModel() {
    var m = RADAR.model;
    var top = RADAR.rows[0];
    var earlyTop = null;
    for (var i = 0; i < RADAR.rows.length; i++) {
      if (!RADAR.rows[i].on_watchlist) { earlyTop = RADAR.rows[i]; break; }
    }
    document.getElementById('model').innerHTML =
      '<strong>How the value is scored.</strong> ' +
      '<code>implied = TVL × ' + m.base_multiple + ' × growth × tenure × breadth</code> — ' +
      'growth from the 7-day TVL change (clamped ' + m.growth_floor + '% to +' + m.growth_cap + '%, weight ' + m.growth_weight + '), ' +
      'tenure from days listed with no token (0.70 at day zero to 1.00 at three years), ' +
      'breadth from chains run (+' + Math.round(m.breadth_per_chain * 100) + '% each, capped at six). ' +
      'Every row is a protocol whose record shows no token; the ' + RADAR.watchlist_size + ' on the watchlist are the floor, ' +
      'and the ' + RADAR.early_size + ' below it are the radar\'s own finds. ' +
      'Top of the board: <strong>' + esc(top.name) + '</strong> at ' + money(top.implied_value_usd) +
      (earlyTop
        ? '; top early find: <strong>' + esc(earlyTop.name) + '</strong> at rank ' + earlyTop.rank + ', ' + money(earlyTop.implied_value_usd) + '.'
        : '.');
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
        '<td class="num">' + r.farm_steps.length + ' steps</td>' +
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
    var m = RADAR.model;
    var base = Math.round(r.tvl_usd * m.base_multiple);
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    panel.hidden = false;
    panel.innerHTML =
      '<div class="detail-head"><h2>' + esc(r.name) + ' <span class="slug">#' + r.rank + ' · ' + esc(r.slug) + '</span></h2>' +
      '<button class="close" id="close-detail" type="button">Close ✕</button></div>' +
      '<div class="badges">' +
      '<span class="badge pre">No token recorded</span>' +
      (r.on_watchlist ? '<span class="badge watch">★ On the watchlist</span>' : '<span class="badge">Early find — below the watchlist floor</span>') +
      '<span class="badge">' + esc(r.category || 'No category') + '</span>' +
      '<span class="badge">' + esc(chainsLabel(r.chains)) + '</span>' +
      '</div>' +
      '<div class="detail-grid">' +
      '<div class="cell"><div class="k">Implied value</div><div class="v">' + moneyFull(r.implied_value_usd) + '</div></div>' +
      '<div class="cell"><div class="k">TVL</div><div class="v">' + moneyFull(r.tvl_usd) + '</div></div>' +
      '<div class="cell"><div class="k">7-day change</div><div class="v">' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</div></div>' +
      '<div class="cell"><div class="k">Tracked since</div><div class="v small">' + esc(r.listed_at || 'Unknown') + ' · ' + ageLabel(r.age_days) + '</div></div>' +
      '</div>' +
      '<div class="model-break"><strong>How ' + moneyFull(r.implied_value_usd) + ' is reached:</strong> ' +
      '<code>' + moneyFull(base) + ' base</code> (TVL × ' + m.base_multiple + ') × ' +
      '<code>' + r.growth_multiplier.toFixed(2) + ' growth</code> × ' +
      '<code>' + r.tenure_multiplier.toFixed(2) + ' tenure</code> × ' +
      '<code>' + r.breadth_multiplier.toFixed(2) + ' breadth</code> across ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + '.</div>' +
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
  renderFilters();
  renderAll();
})();

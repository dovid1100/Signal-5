'use strict';
// ============================================================
//  ui.js — All rendering logic for SIGNAL
// ============================================================

// ── State ────────────────────────────────────────────────────
window.activeSignalId  = null;
window.activeTab       = 'feed';
window.activeFilter    = 'all';
window.historyRange    = '7d';
window.historySortBy   = 'time';
window.analyticsPeriod = 'allTime';
window.activeChartMode = 'line';
window.searchQuery     = '';

// ============================================================
//  DAILY BRIEF
// ============================================================
let _briefTimer = null;

function showDailyBrief() {
  const overlay = document.getElementById('briefOverlay');
  if (!overlay) return;

  function updateBrief() {
    const open = isMarketOpen();
    const statusEl = document.getElementById('briefStatus');
    const cdEl     = document.getElementById('briefCd');
    const lblEl    = document.getElementById('briefCdLabel');
    if (statusEl) statusEl.textContent = open ? 'Market Open' : 'Market Closed';
    const ms  = open ? (nextScanAt ? nextScanAt - Date.now() : 0) : msUntilNextMarketOpen();
    const tot = Math.floor(Math.max(0, ms) / 1000);
    const hh  = Math.floor(tot / 3600), mm = Math.floor((tot % 3600) / 60), ss = tot % 60;
    if (cdEl) cdEl.textContent = hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
    if (lblEl) lblEl.textContent = open ? 'until next scan' : 'until market open';
  }

  updateBrief();
  if (_briefTimer) clearInterval(_briefTimer);
  _briefTimer = setInterval(() => {
    if (overlay.style.display === 'none') { clearInterval(_briefTimer); return; }
    updateBrief();
  }, 1000);

  const sigs = getSignalsToday().sort((a, b) =>
    ({ critical: 0, high: 1, medium: 2 }[a.urgency] - { critical: 0, high: 1, medium: 2 }[b.urgency])
  );
  if (sigs.length > 0) {
    const top = sigs[0];
    const tickerEl  = document.getElementById('briefTicker');
    const moveEl    = document.getElementById('briefMove');
    const headEl    = document.getElementById('briefHeadline');
    const sigEl     = document.getElementById('briefSignal');
    if (tickerEl) tickerEl.textContent = top.ticker;
    if (moveEl) { moveEl.textContent = `${top.move >= 0 ? '+' : ''}${top.move}%`; moveEl.className = `brief-move ${top.move >= 0 ? 'val-green' : 'val-red'}`; }
    if (headEl) headEl.textContent = top.headline;
    if (sigEl) sigEl.style.display = '';
  }
  overlay.style.display = 'flex';
}

function dismissBrief() {
  const o = document.getElementById('briefOverlay');
  if (o) {
    o.style.opacity = '0';
    o.style.transition = 'opacity .3s';
    setTimeout(() => { o.style.display = 'none'; o.style.opacity = ''; o.style.transition = ''; }, 300);
  }
  if (_briefTimer) { clearInterval(_briefTimer); _briefTimer = null; }
}

// ============================================================
//  INIT (DOM ready)
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  // Tab clicks
  document.querySelectorAll('.tab[data-tab]').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      window.activeTab = t.dataset.tab;
      const fg = document.getElementById('filterGroup');
      if (fg) fg.style.display = window.activeTab === 'feed' ? '' : 'none';
      haptic('light');
      renderActiveTab();
    });
  });

  // Swipe between tabs (checks vertical dominance to avoid false triggers)
  let swipeStartX = 0, swipeStartY = 0;
  const tabs = ['feed', 'h24', 'history', 'watchlist', 'portfolio', 'analytics', 'settings'];
  const detailArea = document.getElementById('detailArea');
  if (detailArea) {
    detailArea.addEventListener('touchstart', e => {
      swipeStartX = e.touches[0].clientX;
      swipeStartY = e.touches[0].clientY;
    }, { passive: true });
    detailArea.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - swipeStartX;
      const dy = e.changedTouches[0].clientY - swipeStartY;
      // Only horizontal swipe — must be wider than tall
      if (Math.abs(dx) < 120 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const cur  = tabs.indexOf(window.activeTab);
      const next = dx < 0 ? Math.min(cur + 1, tabs.length - 1) : Math.max(cur - 1, 0);
      if (next !== cur) {
        const t = document.querySelector(`[data-tab="${tabs[next]}"]`);
        if (t) t.click();
      }
    }, { passive: true });
  }

  // Filter chips
  document.querySelectorAll('.chip[data-filter]').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-filter]').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
      window.activeFilter = c.dataset.filter;
      haptic('light');
      renderFeed();
      window.renderSidebar();
    });
  });

  renderFeed();
  window.renderSidebar();
  showDailyBrief();

  setInterval(() => {
    if (window.activeTab === 'h24')       render24h();
    if (window.activeTab === 'analytics') window.renderAnalytics();
  }, 60000);
});

// ============================================================
//  SIDEBAR
// ============================================================
window.renderSidebar = function() {
  const sidebar = document.getElementById('tickerSidebar');
  if (!sidebar) return;
  const sigs = getSortedTodaySignals().filter(s =>
    window.activeFilter === 'all' || s.urgency === window.activeFilter
  );
  const pins = getPins();
  if (!sigs.length) {
    sidebar.innerHTML = '<div style="padding:12px 5px;text-align:center;font-size:9px;color:var(--muted);line-height:1.9">No<br>signals</div>';
    return;
  }
  sidebar.innerHTML = sigs.map(s => `
    <div class="ticker-item urg-${s.urgency} ${s.id === window.activeSignalId ? 'active' : ''}" data-id="${s.id}" onclick="selectSignal('${s.id}')">
      ${pins.includes(s.id) ? '<div class="t-pin">📌</div>' : ''}
      <div class="t-name">${s.ticker}</div>
      <div class="t-move ${s.move >= 0 ? 'move-up' : 'move-dn'}">${s.move >= 0 ? '+' : ''}${s.move}%</div>
    </div>`).join('');

  document.getElementById('feedBadge').textContent = sigs.length;
  setText('signalCount', getSignalsToday().length);
  const mc = document.getElementById('signalCountMobile');
  if (mc) mc.textContent = getSignalsToday().length + ' signals';
};

window.flashNewSignals = function(ids) {
  ids.forEach(id => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  });
};

// ============================================================
//  DETAIL VIEW
// ============================================================
window.renderDetail = function(id) {
  const sig = loadSignals().find(s => s.id === id);
  if (!sig) return;
  window.activeSignalId = id;
  window.renderSidebar();

  const confClass  = sig.urgency === 'critical' ? 'fill-red' : sig.urgency === 'high' ? 'fill-amber' : 'fill-green';
  const moveClass  = sig.move >= 0 ? 'val-green' : 'val-red';
  const badgeIcon  = sig.urgency === 'critical' ? '⚡' : sig.urgency === 'high' ? '▲' : '●';
  const pinned     = isPinned(id), note = getNote(id);
  const inPortfolio = isInPortfolio(sig.ticker), pos = inPortfolio ? getPosition(sig.ticker) : null;

  const sourcesHtml = sig.sources.map(src => `
    <a class="source-card" href="${src.url}" target="_blank" rel="noopener noreferrer">
      <div class="source-icon">${src.icon}</div>
      <div class="source-body">
        <div class="source-pub-row"><div class="source-pub">${src.pub}</div><div class="source-time-label">${src.time}</div></div>
        <div class="source-hl">${src.headline}</div>
        <span class="source-url">${src.url}</span>
      </div>
      <div class="source-arrow">→</div>
    </a>`).join('');

  let outcomeHtml;
  if (sig.outcome === 'hit') {
    outcomeHtml = `<div class="outcome-card"><div class="outcome-msg">${sig.outcomeMsg}</div><span class="badge-hit">HIT ✓</span></div>`;
  } else if (sig.outcome === 'miss') {
    outcomeHtml = `<div class="outcome-card"><div class="outcome-msg">${sig.outcomeMsg}</div><span class="badge-miss">MISS ✗</span></div>`;
  } else if (sig.outcome === 'unverified') {
    outcomeHtml = `<div class="outcome-card"><div class="outcome-msg">${sig.outcomeMsg}</div><a href="https://finance.yahoo.com/quote/${sig.ticker}" target="_blank" style="font-size:10px;color:var(--blue);text-decoration:none;flex-shrink:0">Verify →</a></div>`;
  } else if (isOutcomeCheckReady(sig)) {
    outcomeHtml = `<div class="outcome-card"><div class="outcome-msg">1 hour passed — ready to check.</div><button class="btn-check" id="outcome-btn-${sig.id}" onclick="checkOutcome('${sig.id}')">Check Outcome</button></div>`;
  } else {
    const remain = Math.max(0, 60 - Math.floor((Date.now() - new Date(sig.scannedAt).getTime()) / 60000));
    outcomeHtml = `<div class="outcome-card"><div class="outcome-msg"><span class="badge-pend">PENDING</span>&nbsp; Check in ${remain} min.</div></div>`;
  }

  document.getElementById('detailArea').innerHTML = `<div class="slide-up">
    ${inPortfolio && pos ? `<div class="portfolio-badge">💼 You own ${pos.shares} shares · avg $${pos.buyPrice}</div>` : ''}
    <div class="signal-hero">
      <div class="hero-badge badge-${sig.urgency}"><div class="badge-icon">${badgeIcon}</div>${sig.urgency.toUpperCase()}</div>
      <div class="hero-info">
        <div class="hero-row"><div class="hero-ticker">${sig.ticker}</div><div class="hero-company">${sig.company}</div></div>
        <div class="hero-headline">${sig.headline}</div>
        <div class="hero-tags">
          <span class="tag ${sig.catalystTag}">${sig.catalyst}</span>
          <span class="tag tag-macro">${sig.time}</span>
          <span class="tag tag-macro">Vol ${sig.volume}</span>
          <span class="tag tag-macro">${sig.marketCap}</span>
        </div>
      </div>
      <div class="hero-metrics">
        <div class="metric-card"><div class="metric-label">Move</div><div class="metric-val ${moveClass}">${sig.move >= 0 ? '+' : ''}${sig.move}%</div><div class="metric-sub">Current</div></div>
        <div class="metric-card"><div class="metric-label">Upside</div><div class="metric-val val-blue">${sig.upside}</div><div class="metric-sub">AI est.</div></div>
        <div class="metric-card" style="grid-column:span 2"><div class="metric-label">Confidence — ${sig.confidence}%</div><div class="conf-track"><div class="conf-fill ${confClass}" style="width:${sig.confidence}%"></div></div></div>
      </div>
    </div>
    <div class="quick-actions">
      <button class="qa-btn ${pinned ? 'pinned' : ''}" onclick="togglePinSignal('${sig.id}')">${pinned ? '📌 Pinned' : '📌 Pin'}</button>
      <button class="qa-btn" onclick="archiveThisSignal('${sig.id}')">✕ Archive</button>
      <button class="qa-btn" onclick="toggleNote('${sig.id}')">✏ Note</button>
      <button class="qa-btn" onclick="goToPortfolioAdd('${sig.ticker}')">💼 Portfolio</button>
    </div>
    <div id="noteSection-${sig.id}" style="display:${note ? '' : 'none'}">
      <div class="note-box"><textarea class="note-input" id="noteInput-${sig.id}" placeholder="Add your thoughts...">${note}</textarea><button class="note-save-btn" onclick="saveNoteFromUI('${sig.id}')">Save note</button></div>
    </div>
    <div class="section" style="animation-delay:.04s">
      <div class="section-title">Price Chart</div>
      <div class="chart-wrap">
        <div class="chart-header">
          <div class="chart-title">${sig.ticker} — since signal</div>
          <div class="chart-toggle">
            <div class="chart-btn ${window.activeChartMode === 'line' ? 'on' : ''}" onclick="switchChart('${sig.id}','line',this)">Line</div>
            <div class="chart-btn ${window.activeChartMode === 'candle' ? 'on' : ''}" onclick="switchChart('${sig.id}','candle',this)">Candle</div>
          </div>
        </div>
        <div class="chart-canvas-wrap" id="chartWrap-${sig.id}">
          <div class="chart-loading" id="chartLoading-${sig.id}">⟳ Loading chart...</div>
          <canvas id="chartCanvas-${sig.id}" class="chart-canvas" style="display:none"></canvas>
        </div>
      </div>
    </div>
    <div class="section" style="animation-delay:.08s"><div class="section-title">Claude's Reasoning</div><div class="reasoning-box">${sig.reasoning}</div></div>
    <div class="section" style="animation-delay:.12s">
      <div class="section-title">${sig.sources.length} Source${sig.sources.length !== 1 ? 's' : ''} — Tap to verify</div>
      <div class="sources-grid">${sourcesHtml}</div>
    </div>
    <div class="section" style="animation-delay:.16s"><div class="section-title">Prediction Outcome</div>${outcomeHtml}</div>
  </div>`;

  document.getElementById('detailArea').scrollTop = 0;
  const el = document.querySelector(`[data-id="${id}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  loadChart(sig.id, sig.ticker, sig.scannedAt);
};

window.togglePinSignal   = id => { togglePin(id); haptic('light'); window.renderDetail(id); window.renderSidebar(); };
window.archiveThisSignal = id => { archiveSignal(id); haptic('light'); renderFeed(); window.renderSidebar(); };
window.toggleNote        = id => { const s = document.getElementById(`noteSection-${id}`); if (s) s.style.display = s.style.display === 'none' ? '' : 'none'; };
window.saveNoteFromUI    = id => {
  const inp = document.getElementById(`noteInput-${id}`);
  if (!inp) return;
  saveNote(id, inp.value);
  const btn = inp.nextElementSibling;
  if (btn) { btn.textContent = '✓ Saved'; setTimeout(() => btn.textContent = 'Save note', 1500); }
};
window.goToPortfolioAdd = ticker => {
  window.activeTab = 'portfolio';
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelector('[data-tab="portfolio"]')?.classList.add('active');
  renderPortfolio(ticker);
};

// ============================================================
//  CHART
// ============================================================
let _chartLock = {}; // prevent concurrent fetches per signal

window.switchChart = (id, mode, btn) => {
  window.activeChartMode = mode;
  document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  const sig = loadSignals().find(s => s.id === id);
  if (sig) loadChart(id, sig.ticker, sig.scannedAt);
};

async function loadChart(id, ticker, scannedAt) {
  if (_chartLock[id]) return; // debounce
  _chartLock[id] = true;

  const loading = document.getElementById(`chartLoading-${id}`);
  const canvas  = document.getElementById(`chartCanvas-${id}`);
  if (!loading || !canvas) { _chartLock[id] = false; return; }

  loading.style.display = 'flex';
  canvas.style.display  = 'none';

  try {
    const data = await fetchOHLCV(ticker, '1d', '5m');
    if (!data || !data.length) { loading.textContent = 'Chart data unavailable'; return; }

    const signalTime = new Date(scannedAt).getTime();
    const filtered   = data.filter(d => d.t >= signalTime - 5 * 60 * 1000);
    const plotData   = filtered.length >= 3 ? filtered : data.slice(-40);

    loading.style.display = 'none';
    canvas.style.display  = 'block';

    // Measure actual rendered size
    const wrap = document.getElementById(`chartWrap-${id}`);
    const w    = (wrap ? wrap.offsetWidth : canvas.offsetWidth) || 320;
    const h    = 148;
    canvas.width  = w;
    canvas.height = h;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    window.activeChartMode === 'candle'
      ? drawCandlestick(ctx, plotData, w, h)
      : drawLineChart(ctx, plotData, w, h);
  } catch (e) {
    loading.textContent = 'Chart unavailable';
  } finally {
    _chartLock[id] = false;
  }
}

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
}

function drawLineChart(ctx, data, w, h) {
  const p  = { t: 8, r: 6, b: 20, l: 44 };
  const pw = w - p.l - p.r, ph = h - p.t - p.b;
  const prices = data.map(d => d.c);
  const minP = Math.min(...prices), maxP = Math.max(...prices), range = maxP - minP || 0.01;
  const isUp = prices[prices.length - 1] >= prices[0];
  const color = isUp ? getCssVar('green') : getCssVar('red');

  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = p.t + (ph / 4) * i;
    ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(p.l + pw, y); ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,230,.28)'; ctx.font = '8px IBM Plex Mono';
    ctx.fillText(`$${(maxP - (range / 4) * i).toFixed(2)}`, 0, y + 3);
  }

  // Fill
  const grad = ctx.createLinearGradient(0, p.t, 0, p.t + ph);
  grad.addColorStop(0, `${color}33`); grad.addColorStop(1, `${color}00`);
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = p.l + (i / (data.length - 1)) * pw;
    const y = p.t + ((maxP - d.c) / range) * ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(p.l + pw, p.t + ph); ctx.lineTo(p.l, p.t + ph); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Line
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((d, i) => {
    const x = p.l + (i / (data.length - 1)) * pw;
    const y = p.t + ((maxP - d.c) / range) * ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Time labels
  ctx.fillStyle = 'rgba(200,210,230,.28)'; ctx.font = '8px IBM Plex Mono';
  [0, Math.floor(data.length / 2), data.length - 1].forEach(i => {
    if (!data[i]) return;
    const x = p.l + (i / (data.length - 1)) * pw;
    ctx.fillText(
      new Date(data[i].t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }),
      x - 14, h - 4
    );
  });
}

function drawCandlestick(ctx, data, w, h) {
  const p  = { t: 8, r: 6, b: 20, l: 44 };
  const pw = w - p.l - p.r, ph = h - p.t - p.b;
  const maxP = Math.max(...data.map(d => d.h));
  const minP = Math.min(...data.map(d => d.l));
  const range = maxP - minP || 0.01;
  const green = getCssVar('green'), red = getCssVar('red');

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = p.t + (ph / 4) * i;
    ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(p.l + pw, y); ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,230,.28)'; ctx.font = '8px IBM Plex Mono';
    ctx.fillText(`$${(maxP - (range / 4) * i).toFixed(2)}`, 0, y + 3);
  }

  const cw = Math.max(2, (pw / data.length) - 1);
  data.forEach((d, i) => {
    const x  = p.l + (i / data.length) * pw + cw / 2;
    const yH = p.t + ((maxP - d.h) / range) * ph;
    const yL = p.t + ((maxP - d.l) / range) * ph;
    const yO = p.t + ((maxP - d.o) / range) * ph;
    const yC = p.t + ((maxP - d.c) / range) * ph;
    const isUp = d.c >= d.o, col = isUp ? green : red;
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();
    ctx.fillStyle = isUp ? `${col}88` : col;
    const bt = Math.min(yO, yC), bh = Math.max(1, Math.abs(yC - yO));
    ctx.fillRect(x - cw / 2, bt, cw, bh); ctx.strokeRect(x - cw / 2, bt, cw, bh);
  });
}

// ============================================================
//  SELECT
// ============================================================
window.selectSignal = id => { haptic('light'); window.renderDetail(id); };
window.selectSignalDetail = id => {
  haptic('light');
  window.renderDetail(id);
  const detail = document.getElementById('detailArea');
  const back = document.createElement('button');
  back.className = 'back-btn'; back.textContent = '← Back';
  back.onclick = () => renderActiveTab();
  detail.insertBefore(back, detail.firstChild);
};

// ============================================================
//  LIVE FEED
// ============================================================
function renderFeed() {
  if (window.activeTab !== 'feed') return;
  let sigs = getSignalsToday();
  if (window.activeFilter !== 'all') sigs = sigs.filter(s => s.urgency === window.activeFilter);
  document.getElementById('feedBadge').textContent = sigs.length;

  if (!sigs.length) {
    window.renderSidebar();
    showRichEmptyState();
    return;
  }
  window.renderSidebar();
  if (!window.activeSignalId || !sigs.find(s => s.id === window.activeSignalId)) {
    window.activeSignalId = getSortedTodaySignals()[0].id;
  }
  window.renderDetail(window.activeSignalId);
}
window.renderFeed = renderFeed;

// ── Rich empty state with diagnostic info ────────────────────
async function showRichEmptyState() {
  const detail = document.getElementById('detailArea');
  if (!detail) return;

  const ms  = msUntilNextMarketOpen();
  const tot = Math.floor(ms / 1000);
  const hh  = Math.floor(tot / 3600), mm = Math.floor((tot % 3600) / 60);
  const cd  = hh > 0 ? `${hh}h ${mm}m` : `${mm}m`;

  // Diagnostic message based on last scan result
  let diagHtml = '';
  const d = window.lastScanDiagnostic;
  if (d) {
    if (d.type === 'error') {
      diagHtml = `<div class="es-diag es-diag-error">
        <div class="es-diag-icon">⚠</div>
        <div class="es-diag-body">
          <div class="es-diag-title">Last scan failed</div>
          <div class="es-diag-msg">${d.msg}</div>
          ${d.msg.includes('401') || d.msg.includes('API key') ? '<div class="es-diag-fix">→ Go to Settings and re-paste your API key</div>' : ''}
          ${d.msg.includes('429') ? '<div class="es-diag-fix">→ Rate limited — wait a minute then try again</div>' : ''}
        </div>
      </div>`;
    } else if (d.type === 'empty' && d.settings) {
      const tips = [];
      if (d.settings.mcap !== 'All ($50M+)') tips.push('Try widening market cap to "All ($50M+)"');
      if (d.settings.minConf > 50) tips.push(`Lower min confidence below ${d.settings.minConf}%`);
      if (d.settings.minMove > 5) tips.push(`Lower min move below ${d.settings.minMove}%`);
      if (!d.settings.marketOpen) tips.push('Market is closed — signals only fire during scan hours');
      diagHtml = `<div class="es-diag es-diag-info">
        <div class="es-diag-icon">📡</div>
        <div class="es-diag-body">
          <div class="es-diag-title">Scan ran — no qualifying signals found</div>
          ${tips.map(t => `<div class="es-diag-fix">→ ${t}</div>`).join('')}
        </div>
      </div>`;
    } else if (d.type === 'duplicate') {
      diagHtml = `<div class="es-diag es-diag-info">
        <div class="es-diag-icon">♻</div>
        <div class="es-diag-body">
          <div class="es-diag-title">Scan ran — signals already seen recently</div>
          <div class="es-diag-fix">→ Same tickers found within the last hour (deduplication active)</div>
        </div>
      </div>`;
    }
  }

  detail.innerHTML = `<div class="es-wrap slide-up">
    <div class="es-header">
      <div class="es-title">No signals yet today</div>
      <div class="es-sub">${isMarketOpen() ? 'Market open · scanning every ' + (getSetting('scanInterval') || 5) + ' min' : 'Market closed · opens in ' + cd}</div>
    </div>
    ${diagHtml}
    <div id="esPerfRow"></div>
    <div id="esPriceRows">${skeletonHTML(4)}</div>
  </div>`;

  try {
    const { priceRows, acc, count } = await buildEmptyStateContent();
    const perfEl  = document.getElementById('esPerfRow');
    const rowsEl  = document.getElementById('esPriceRows');
    if (!perfEl || !rowsEl) return;
    if (acc && count >= 3) {
      perfEl.innerHTML = `<div class="es-perf">
        <div class="es-perf-card"><div class="es-perf-label">Hit Rate 7d</div><div class="es-perf-val val-green" id="esHitRate">—</div></div>
        <div class="es-perf-card"><div class="es-perf-label">Signals</div><div class="es-perf-val val-blue">${acc.total}</div></div>
        <div class="es-perf-card"><div class="es-perf-label">Avg Hit</div><div class="es-perf-val val-green">${acc.avgHitMove !== null ? '+' + acc.avgHitMove + '%' : '—'}</div></div>
      </div>`;
      const el = document.getElementById('esHitRate');
      if (el) animateCount(el, acc.overall, '%');
    }
    rowsEl.innerHTML = count > 0
      ? `<div class="es-section-label">Recent signals — live prices</div>${priceRows}`
      : `<div class="empty-state" style="height:32vh"><div class="empty-icon">📡</div><div class="empty-title">No recent signals</div><div class="empty-body">Scanner runs automatically during scan hours.</div></div>`;
  } catch (e) { console.warn('[SIGNAL] Empty state error:', e); }
}

// ============================================================
//  24H TAB
// ============================================================
function render24h() {
  const et = getNowET(), day = et.getDay(), isWeekend = day === 0 || day === 6;
  const sigs = getSignalsFor24hTab();
  document.getElementById('h24Badge').textContent = sigs.length;
  if (!sigs.length) {
    document.getElementById('detailArea').innerHTML = `<div class="empty-state"><div class="empty-icon">🕐</div><div class="empty-title">${isWeekend ? 'No signals from Friday' : 'No signals in last 24h'}</div></div>`;
    return;
  }
  const groups = {};
  sigs.forEach(s => {
    const et2 = new Date(new Date(s.scannedAt).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const key = et2.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', timeZone: 'America/New_York' }).replace(/:\d\d\s/, ' ');
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  });
  let html = '';
  for (const [label, group] of Object.entries(groups)) {
    html += `<div class="hour-group"><div class="hour-label">${label}</div>`;
    group.forEach(s => {
      const b = s.outcome === 'hit' ? '<span class="srm-badge badge-hit">HIT</span>' : s.outcome === 'miss' ? '<span class="srm-badge badge-miss">MISS</span>' : '<span class="srm-badge badge-pend">PEND</span>';
      html += `<div class="signal-row-mini urg-${s.urgency}" onclick="selectSignalDetail('${s.id}')"><div class="srm-ticker">${s.ticker}</div><div class="srm-headline">${s.headline}</div><div class="srm-move ${s.move >= 0 ? 'move-up' : 'move-dn'}">${s.move >= 0 ? '+' : ''}${s.move}%</div>${b}</div>`;
    });
    html += '</div>';
  }
  document.getElementById('detailArea').innerHTML = `<div class="slide-up">${html}</div>`;
}

// ============================================================
//  HISTORY (with AI search)
// ============================================================
function renderHistory() {
  const rm = { '24h': getSignalsLast24h, '7d': getSignalsLast7d, '30d': getSignalsLast30d };
  let sigs = (rm[window.historyRange] || getSignalsLast7d)();
  if (window.historySortBy === 'move')     sigs = sigs.slice().sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
  else if (window.historySortBy === 'conf') sigs = sigs.slice().sort((a, b) => b.confidence - a.confidence);

  let html = `<div class="search-bar">
    <input class="search-input" id="historySearch" placeholder="🤖 AI search: 'FDA signals this week'..." value="${window.searchQuery}"/>
    <button class="search-btn" id="searchBtn" onclick="runAISearch()">Search</button>
  </div>
  <div id="searchExplanation" style="display:none" class="search-explanation"></div>
  <div class="history-toolbar">
    <div style="display:flex;gap:5px">
      ${['24h','7d','30d'].map(r => `<div class="range-btn ${window.historyRange === r ? 'on' : ''}" onclick="setHistoryRange('${r}')">${r}</div>`).join('')}
    </div>
    <div class="sort-bar">
      <span class="sort-label">Sort:</span>
      ${[['time','Time'],['move','Move%'],['conf','Confidence']].map(([k,v]) => `<div class="sort-btn ${window.historySortBy === k ? 'on' : ''}" onclick="setHistorySort('${k}')">${v}</div>`).join('')}
    </div>
    <span style="font-size:10px;color:var(--muted)">${sigs.length} signals</span>
    <button class="export-btn" onclick="doExportCSV()">↓ CSV</button>
  </div>`;

  if (!sigs.length) {
    html += `<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">No signals in this range</div></div>`;
  } else {
    sigs.forEach(s => {
      const b  = s.outcome === 'hit' ? '<span class="srm-badge badge-hit">HIT</span>' : s.outcome === 'miss' ? '<span class="srm-badge badge-miss">MISS</span>' : '<span class="srm-badge badge-pend">PEND</span>';
      const dt = new Date(s.scannedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
      html += `<div class="signal-row-mini urg-${s.urgency}" onclick="selectSignalDetail('${s.id}')"><div class="srm-ticker">${s.ticker}</div><div class="srm-headline">${s.headline}</div><div class="srm-move ${s.move >= 0 ? 'move-up' : 'move-dn'}">${s.move >= 0 ? '+' : ''}${s.move}%</div>${b}<span style="font-size:9px;color:var(--muted);flex-shrink:0">${dt}</span></div>`;
    });
  }

  document.getElementById('detailArea').innerHTML = `<div class="slide-up">${html}</div>`;

  const inp = document.getElementById('historySearch');
  if (inp) {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') runAISearch(); });
    inp.addEventListener('input', () => { window.searchQuery = inp.value; });
  }
}

window.setHistoryRange = r => { window.historyRange = r; window.searchQuery = ''; renderHistory(); };
window.setHistorySort  = s => { window.historySortBy = s; renderHistory(); };
window.doExportCSV     = () => {
  const rm = { '24h': getSignalsLast24h, '7d': getSignalsLast7d, '30d': getSignalsLast30d };
  exportCSV((rm[window.historyRange] || getSignalsLast7d)());
};

window.runAISearch = async function() {
  const inp = document.getElementById('historySearch');
  const query = inp ? inp.value.trim() : '';
  if (!query) { renderHistory(); return; }
  window.searchQuery = query;
  const btn = document.getElementById('searchBtn');
  if (btn) { btn.textContent = '⟳'; btn.disabled = true; }

  const apiKey = getApiKey();
  if (!apiKey) {
    alert('Enter your API key in Settings first.');
    if (btn) { btn.textContent = 'Search'; btn.disabled = false; }
    return;
  }

  const result = await aiSearch(query, apiKey);
  if (btn) { btn.textContent = 'Search'; btn.disabled = false; }

  // Always show explanation — even on failure
  const expEl = document.getElementById('searchExplanation');
  if (expEl && result.explanation) {
    expEl.style.display = '';
    expEl.textContent = `🤖 ${result.explanation}`;
    expEl.style.borderLeftColor = result.signals.length ? 'var(--blue)' : 'var(--amber)';
  }

  const container = document.querySelector('#detailArea .slide-up');
  if (!container) { renderHistory(); return; }

  // Remove existing rows
  container.querySelectorAll('.signal-row-mini').forEach(r => r.remove());
  const countEl = container.querySelector('.history-toolbar span[style]');
  if (countEl) countEl.textContent = `${result.signals.length} results`;

  if (!result.signals.length) {
    const noRes = document.createElement('div');
    noRes.className = 'empty-state'; noRes.style.height = '30vh';
    noRes.innerHTML = '<div class="empty-icon">🔍</div><div class="empty-title">No matching signals</div>';
    container.appendChild(noRes);
  } else {
    result.signals.forEach(s => {
      const b  = s.outcome === 'hit' ? '<span class="srm-badge badge-hit">HIT</span>' : s.outcome === 'miss' ? '<span class="srm-badge badge-miss">MISS</span>' : '<span class="srm-badge badge-pend">PEND</span>';
      const dt = new Date(s.scannedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
      const row = document.createElement('div');
      row.className = `signal-row-mini urg-${s.urgency}`;
      row.onclick = () => selectSignalDetail(s.id);
      row.innerHTML = `<div class="srm-ticker">${s.ticker}</div><div class="srm-headline">${s.headline}</div><div class="srm-move ${s.move >= 0 ? 'move-up' : 'move-dn'}">${s.move >= 0 ? '+' : ''}${s.move}%</div>${b}<span style="font-size:9px;color:var(--muted);flex-shrink:0">${dt}</span>`;
      container.appendChild(row);
    });
  }
};

// ============================================================
//  WATCHLIST
// ============================================================
window.renderWatchlist = async function() {
  const wl = loadWatchlist(), apiKey = getApiKey();
  document.getElementById('detailArea').innerHTML = `<div class="watchlist-wrap slide-up">
    <div class="watchlist-add">
      <input class="watchlist-input" id="watchlistInput" placeholder="Add ticker (e.g. AAPL)" maxlength="5" oninput="this.value=this.value.toUpperCase()"/>
      <button class="btn-add" onclick="addWatchlistItem()">+ Add</button>
    </div>
    <div id="watchlistItems">${wl.length === 0 ? `<div class="empty-state" style="height:40vh"><div class="empty-icon">👁</div><div class="empty-title">No stocks on watchlist</div><div class="empty-body">Add tickers above to monitor with live prices and news.</div></div>` : skeletonHTML(wl.length)}</div>
  </div>`;

  const inp = document.getElementById('watchlistInput');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') addWatchlistItem(); });
  if (!wl.length) return;

  const prices     = await Promise.allSettled(wl.map(x => fetchStockPrice(x.ticker)));
  const prevCloses = await Promise.allSettled(wl.map(x => fetchPreviousClose(x.ticker)));
  const metas      = await Promise.allSettled(wl.map(x => fetchStockMeta(x.ticker)));
  const priceAlerts = loadPriceAlerts();

  wl.forEach((item, i) => {
    if (!item.addedPrice && prices[i].status === 'fulfilled' && prices[i].value) {
      item.addedPrice = prices[i].value;
    }
  });
  saveWatchlist(wl);

  const container = document.getElementById('watchlistItems');
  if (!container) return;

  container.innerHTML = wl.map((item, i) => {
    const cur  = prices[i].status === 'fulfilled' ? prices[i].value : null;
    const prev = prevCloses[i].status === 'fulfilled' ? prevCloses[i].value : null;
    const meta = metas[i].status === 'fulfilled' ? metas[i].value : {};
    const pct  = cur && prev ? ((cur - prev) / prev * 100).toFixed(2) : null;
    const color = pct === null ? 'var(--muted)' : pct >= 0 ? 'var(--green)' : 'var(--red)';
    const alert = priceAlerts[item.ticker];
    if (cur) checkPriceAlerts(item.ticker, cur);
    return `<div class="watch-card" id="wcard-${item.ticker}">
      <div class="watch-card-header" onclick="openWatchChart('${item.ticker}')" style="cursor:pointer">
        <div class="watch-ticker">${item.ticker}</div>
        ${cur ? `<div class="watch-price">$${cur.toFixed(2)}</div>` : ''}
        <div class="watch-change" style="color:${color}">${pct !== null ? (pct >= 0 ? '+' : '') + pct + '% today' : '—'}</div>
        <button class="watch-remove" onclick="event.stopPropagation();removeWatchlistItem('${item.ticker}')">Remove</button>
      </div>
      <div class="watch-meta">
        ${meta.shortPct ? `<span class="watch-meta-tag">Short: ${meta.shortPct}</span>` : ''}
        ${meta.earningsDate ? `<span class="watch-meta-tag earn">Earnings: ${meta.earningsDate}</span>` : ''}
        ${alert ? `<span class="watch-meta-tag alert">Alert: ${alert.direction === 'above' ? '↑' : '↓'}$${alert.targetPrice} <button onclick="removePriceAlert('${item.ticker}');window.renderWatchlist()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:10px">✕</button></span>` : ''}
      </div>
      <div id="wchart-${item.ticker}" style="display:none"></div>
      <div class="watch-news-actions">
        <button class="watch-news-load-btn" onclick="loadWatchNews('${item.ticker}')">📰 Load News</button>
        <button class="watch-alert-btn" onclick="showPriceAlertForm('${item.ticker}')">🔔 Set Alert</button>
      </div>
      <div class="watch-news" id="wnews-${item.ticker}"></div>
      <div id="walert-form-${item.ticker}" style="display:none" class="watch-alert-form">
        <div style="display:flex;gap:7px;align-items:center;margin-top:8px">
          <select id="walert-dir-${item.ticker}" class="watch-select"><option value="above">Above</option><option value="below">Below</option></select>
          <input id="walert-price-${item.ticker}" type="number" class="watch-price-input" placeholder="Target $" step="0.01" value="${cur ? cur.toFixed(2) : ''}"/>
          <button onclick="saveAlertFromForm('${item.ticker}')" class="watch-save-btn">Save</button>
        </div>
      </div>
    </div>`;
  }).join('');
};

window.addWatchlistItem = () => {
  const inp = document.getElementById('watchlistInput'); if (!inp) return;
  const ticker = inp.value.trim().toUpperCase();
  if (!ticker) { inp.focus(); return; }
  if (addToWatchlist(ticker)) { haptic('light'); inp.value = ''; window.renderWatchlist(); }
  else { inp.style.borderColor = 'var(--red)'; setTimeout(() => inp.style.borderColor = '', 1500); }
};
window.removeWatchlistItem = ticker => { removeFromWatchlist(ticker); haptic('light'); window.renderWatchlist(); };

window.loadWatchNews = async function(ticker) {
  const btn = document.querySelector(`[onclick="loadWatchNews('${ticker}')"]`);
  if (btn) { btn.textContent = '⟳ Loading...'; btn.disabled = true; }
  const apiKey = getApiKey();
  const news = await fetchWatchlistNews(ticker, apiKey);
  const el = document.getElementById(`wnews-${ticker}`); if (!el) return;
  if (btn) btn.style.display = 'none';
  el.innerHTML = !news || !news.length
    ? '<div style="font-size:10px;color:var(--muted);padding:4px 0">No news found.</div>'
    : news.map(n => `<a class="watch-news-item" href="${n.url||'#'}" target="_blank" rel="noopener noreferrer"><div class="watch-news-source">${n.source||''} · ${n.time||''}</div>${n.headline}</a>`).join('');
};

window.openWatchChart = async function(ticker) {
  const wrap = document.getElementById(`wchart-${ticker}`); if (!wrap) return;
  if (wrap.style.display !== 'none') { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  wrap.innerHTML = '<div style="font-size:10px;color:var(--muted);padding:12px 0;text-align:center">⟳ Loading chart...</div>';
  const data = await fetchOHLCV(ticker, '5d', '1d');
  if (!data || !data.length) { wrap.innerHTML = '<div style="font-size:10px;color:var(--muted);padding:8px 0">Chart unavailable</div>'; return; }
  wrap.innerHTML = `<canvas id="wc-${ticker}" style="width:100%;height:120px"></canvas>`;
  setTimeout(() => {
    const canvas = document.getElementById(`wc-${ticker}`); if (!canvas) return;
    const w = canvas.offsetWidth || 300;
    canvas.width = w; canvas.height = 120;
    canvas.style.width = w + 'px'; canvas.style.height = '120px';
    drawLineChart(canvas.getContext('2d'), data, w, 120);
  }, 30);
};

window.showPriceAlertForm = function(ticker) {
  const form = document.getElementById(`walert-form-${ticker}`);
  if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
};
window.saveAlertFromForm = function(ticker) {
  const dir   = document.getElementById(`walert-dir-${ticker}`)?.value;
  const price = document.getElementById(`walert-price-${ticker}`)?.value;
  if (!price || isNaN(price)) return;
  setPriceAlert(ticker, price, dir);
  haptic('light');
  window.renderWatchlist();
};

// ============================================================
//  PORTFOLIO
// ============================================================
async function renderPortfolio(prefillTicker = '') {
  const p = loadPortfolio(), hist = loadPortfolioHistory();
  const prices = await Promise.allSettled(p.positions.map(x => fetchStockPrice(x.ticker)));
  let totalCur = p.cashBalance || 0, totalCost = p.cashBalance || 0;

  const enriched = p.positions.map((pos, i) => {
    const cur    = prices[i].status === 'fulfilled' ? prices[i].value : null;
    const curVal = cur ? pos.shares * cur : pos.shares * pos.buyPrice;
    const cost   = pos.shares * pos.buyPrice;
    const gl     = cur ? parseFloat((curVal - cost).toFixed(2)) : null;
    const glPct  = gl !== null ? (gl / cost * 100).toFixed(2) : null;
    totalCur  += curVal; totalCost += cost;
    return { ...pos, currentPrice: cur, currentValue: parseFloat(curVal.toFixed(2)), costBasis: parseFloat(cost.toFixed(2)), gl, glPct };
  });

  const totalGL = totalCur - totalCost;
  const glColor = totalGL >= 0 ? 'var(--green)' : 'var(--red)';
  const glSign  = totalGL >= 0 ? '+' : '';

  // Only show chart if 2+ data points
  const showChart = hist.length >= 2;

  document.getElementById('detailArea').innerHTML = `<div class="portfolio-wrap slide-up">
    <div class="portfolio-total">
      <div class="portfolio-total-label">Estimated Portfolio Value</div>
      <div class="portfolio-total-val">$${totalCur.toFixed(2)}</div>
      ${totalGL !== 0 ? `<div class="portfolio-total-change" style="color:${glColor}">${glSign}$${Math.abs(totalGL).toFixed(2)} (${glSign}${(totalGL / Math.max(totalCost, 0.01) * 100).toFixed(2)}%)</div>` : ''}
      ${showChart ? `<div class="portfolio-chart-wrap"><canvas id="portfolioChart" style="width:100%;height:100%"></canvas></div>` : '<div style="font-size:10px;color:var(--muted);margin-top:9px">Chart builds over time as prices are tracked.</div>'}
    </div>
    <div class="portfolio-add">
      <div class="portfolio-add-title">Add / Update Position</div>
      <div class="portfolio-add-row">
        <input class="portfolio-input" id="posTickerInput" placeholder="Ticker" maxlength="5" oninput="this.value=this.value.toUpperCase()" value="${prefillTicker}"/>
        <input class="portfolio-input" id="posSharesInput" placeholder="Shares" type="number" min="0" step="any"/>
        <input class="portfolio-input" id="posPriceInput" placeholder="Buy price $" type="number" min="0" step="any"/>
        <button class="btn-add" onclick="addPositionFromUI()">+ Add</button>
      </div>
      <div style="font-size:9px;color:var(--muted);margin-top:6px">Adding an existing ticker averages your cost basis automatically.</div>
    </div>
    ${p.positions.length === 0 ? `<div class="empty-state" style="height:20vh"><div class="empty-icon">💼</div><div class="empty-title">No positions yet</div><div class="empty-body">Add positions above to track your portfolio value.</div></div>` : `
    <div class="section-title" style="margin-bottom:9px">Positions</div>
    ${enriched.map(pos => {
      const glC = pos.gl !== null ? (pos.gl >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--muted)';
      const glS = pos.gl >= 0 ? '+' : '';
      return `<div class="position-row">
        <div class="pos-ticker">${pos.ticker}</div>
        <div class="pos-shares">${pos.shares}sh</div>
        <div class="pos-cost">$${pos.buyPrice}→${pos.currentPrice ? '$' + pos.currentPrice.toFixed(2) : '—'}</div>
        <div class="pos-gl" style="color:${glC}">${pos.gl !== null ? `${glS}$${Math.abs(pos.gl).toFixed(0)}<br><span style="font-size:9px">${glS}${pos.glPct}%</span>` : '—'}</div>
        <button class="pos-remove" onclick="removePositionFromUI('${pos.ticker}')">✕</button>
      </div>`;
    }).join('')}`}
    <div style="margin-top:14px">
      <div class="settings-field-label">Cash / uninvested balance</div>
      <div style="display:flex;gap:7px;margin-top:5px">
        <input class="portfolio-input" id="cashInput" placeholder="$0.00" type="number" min="0" step="any" value="${p.cashBalance || ''}"/>
        <button class="btn-add" onclick="saveCashFromUI()">Save</button>
      </div>
    </div>
    <button class="connect-brokerage-btn" onclick="alert('Brokerage linking coming soon!')">
      🏦 Connect Brokerage <span style="font-size:9px;color:var(--muted)">(coming soon)</span>
    </button>
  </div>`;

  if (showChart) {
    setTimeout(() => {
      const canvas = document.getElementById('portfolioChart'); if (!canvas) return;
      const w = canvas.offsetWidth || 300;
      canvas.width = w; canvas.height = 110;
      canvas.style.width = w + 'px'; canvas.style.height = '110px';
      drawPortfolioChart(canvas.getContext('2d'), hist, w, 110);
    }, 50);
  }

  if (prefillTicker) {
    fetchStockPrice(prefillTicker).then(pr => {
      const priceInput = document.getElementById('posPriceInput');
      if (pr && priceInput) priceInput.value = pr;
    });
  }
}

function drawPortfolioChart(ctx, hist, w, h) {
  if (hist.length < 2) return; // guard against single-point crash
  const p  = { t: 5, r: 5, b: 16, l: 48 };
  const pw = w - p.l - p.r, ph = h - p.t - p.b;
  const vals = hist.map(d => d.v);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = maxV - minV || 1;
  const isUp  = vals[vals.length - 1] >= vals[0];
  const color = isUp ? getCssVar('green') : getCssVar('red');

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = p.t + (ph / 3) * i;
    ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(p.l + pw, y); ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,230,.28)'; ctx.font = '8px IBM Plex Mono';
    ctx.fillText('$' + ((maxV - (range / 3) * i) / 1000).toFixed(1) + 'k', 0, y + 3);
  }

  const grad = ctx.createLinearGradient(0, p.t, 0, p.t + ph);
  grad.addColorStop(0, `${color}33`); grad.addColorStop(1, `${color}00`);
  ctx.beginPath();
  hist.forEach((d, i) => {
    const x = p.l + (i / (hist.length - 1)) * pw;
    const y = p.t + ((maxV - d.v) / range) * ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(p.l + pw, p.t + ph); ctx.lineTo(p.l, p.t + ph); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  hist.forEach((d, i) => {
    const x = p.l + (i / (hist.length - 1)) * pw;
    const y = p.t + ((maxV - d.v) / range) * ph;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

window.addPositionFromUI = () => {
  const t  = document.getElementById('posTickerInput')?.value.trim().toUpperCase();
  const s  = parseFloat(document.getElementById('posSharesInput')?.value);
  const pr = parseFloat(document.getElementById('posPriceInput')?.value);
  if (!t || !s || !pr || s <= 0 || pr <= 0) { alert('Please fill in ticker, shares, and price.'); return; }
  addPosition(t, s, pr); haptic('light'); renderPortfolio();
};
window.removePositionFromUI = ticker => {
  if (confirm(`Remove ${ticker} from portfolio?`)) { removePosition(ticker); haptic('light'); renderPortfolio(); }
};
window.saveCashFromUI = () => {
  const v = parseFloat(document.getElementById('cashInput')?.value) || 0;
  updatePortfolioCash(v); haptic('light'); renderPortfolio();
};

// ============================================================
//  ANALYTICS
// ============================================================
window.renderAnalytics = function() {
  if (window.activeTab !== 'analytics') return;
  const analytics = getAnalytics();
  const data = analytics[window.analyticsPeriod] || analytics.allTime;
  const labels = { allTime: 'All Time', today: 'Today', h24: '24h', d7: '7 Days', d30: '30 Days' };

  let html = `<div class="analytics-wrap slide-up">
    <div class="period-toggle">${Object.entries(labels).map(([k, v]) => `<div class="period-btn ${window.analyticsPeriod === k ? 'on' : ''}" onclick="setAnalyticsPeriod('${k}')">${v}</div>`).join('')}</div>`;

  if (!data) {
    html += `<div class="no-data">No outcomes recorded yet.<br>Outcomes are checked 1 hour after each signal fires.</div>`;
  } else {
    html += `<div class="stat-grid">
      <div class="stat-card"><div class="stat-card-label">Hit Rate</div><div class="stat-card-val val-green" id="analyticsHitRate">—</div><div class="stat-card-sub">${data.total} checked</div></div>
      <div class="stat-card"><div class="stat-card-label">Hits</div><div class="stat-card-val val-green">${data.hits}</div><div class="stat-card-sub">of ${data.total}</div></div>
      <div class="stat-card"><div class="stat-card-label">Misses</div><div class="stat-card-val val-red">${data.misses}</div><div class="stat-card-sub">of ${data.total}</div></div>
      <div class="stat-card"><div class="stat-card-label">Pending</div><div class="stat-card-val val-blue">${data.pending}</div><div class="stat-card-sub">awaiting</div></div>
    </div>`;

    if (data.avgPredicted !== null) {
      html += `<div class="stat-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
        <div class="stat-card"><div class="stat-card-label">Avg Predicted</div><div class="stat-card-val val-blue">${data.avgPredicted !== null ? '+' + data.avgPredicted + '%' : '—'}</div></div>
        <div class="stat-card"><div class="stat-card-label">Avg Hit Move</div><div class="stat-card-val val-green">${data.avgHitMove !== null ? '+' + data.avgHitMove + '%' : '—'}</div></div>
        <div class="stat-card"><div class="stat-card-label">Avg Miss Move</div><div class="stat-card-val val-red">${data.avgMissMove !== null ? data.avgMissMove + '%' : '—'}</div></div>
      </div>`;
    }

    if (data.trend !== null) {
      const td = data.trend >= 0;
      html += `<div style="margin-bottom:16px"><div class="analytics-title">Accuracy Trend</div><div class="trend-badge" style="background:${td ? 'var(--green-dim)' : 'var(--red-dim)'};color:${td ? 'var(--green)' : 'var(--red)'}">${td ? '↑' : '↓'} ${data.trend >= 0 ? '+' : ''}${data.trend}% — accuracy ${td ? 'improving' : 'declining'}</div></div>`;
    }

    const thisWeek = loadSignals().filter(s => new Date(s.scannedAt).getTime() > Date.now()-7*86400000).length;
    const lastWeek = loadSignals().filter(s => { const t=new Date(s.scannedAt).getTime(); return t>Date.now()-14*86400000&&t<=Date.now()-7*86400000; }).length;
    const velDir = thisWeek >= lastWeek;
    html += `<div style="margin-bottom:20px"><div class="analytics-title">Signal Velocity</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div class="stat-card"><div class="stat-card-label">This Week</div><div class="stat-card-val val-blue">${thisWeek}</div><div class="stat-card-sub">signals</div></div>
      <div class="stat-card"><div class="stat-card-label">Last Week</div><div class="stat-card-val" style="color:var(--muted2)">${lastWeek}</div><div class="stat-card-sub">${velDir ? '↑ up' : '↓ down'} from last week</div></div>
    </div></div>`;

    if (data.confTrend !== null) {
      const ct = data.confTrend >= 0;
      html += `<div style="margin-bottom:16px"><div class="analytics-title">Confidence Trend</div><div class="trend-badge" style="background:${ct ? 'var(--blue-dim)' : 'var(--amber-dim)'};color:${ct ? 'var(--blue)' : 'var(--amber)'}">${ct ? '↑' : '↓'} ${data.confTrend >= 0 ? '+' : ''}${data.confTrend}% avg confidence</div></div>`;
    }

    if (data.bestScanHour !== null) {
      const bh = data.bestScanHour, lbl = (bh % 12 || 12) + (bh < 12 ? 'AM' : 'PM');
      html += `<div style="margin-bottom:20px"><div class="analytics-title">Best Time to Scan</div><div class="highlight-card"><div class="highlight-label">Most signals fire at</div><div class="highlight-ticker">${lbl} ET</div><div class="highlight-detail">Run manual scans around this time for best results.</div></div></div>`;
    }

    if (data.best || data.worst) {
      html += `<div class="analytics-section"><div class="analytics-title">Signal Highlights</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">`;
      if (data.best) { const mv = ((data.best.checkPrice - data.best.basePrice) / data.best.basePrice * 100).toFixed(1); html += `<div class="highlight-card"><div class="highlight-label">🏆 Best Signal</div><div class="highlight-ticker">${data.best.ticker}</div><div class="highlight-detail">+${mv}% actual<br>${data.best.catalyst}<br>${new Date(data.best.scannedAt).toLocaleDateString()}</div></div>`; }
      if (data.worst) { const mv = ((data.worst.checkPrice - data.worst.basePrice) / data.worst.basePrice * 100).toFixed(1); html += `<div class="highlight-card"><div class="highlight-label">⚠ Worst Signal</div><div class="highlight-ticker">${data.worst.ticker}</div><div class="highlight-detail">${mv}% actual<br>${data.worst.catalyst}<br>${new Date(data.worst.scannedAt).toLocaleDateString()}</div></div>`; }
      html += `</div></div>`;
    }

    const tierColors = { critical: 'var(--red)', high: 'var(--amber)', medium: 'var(--green)' };
    html += `<div class="analytics-section"><div class="analytics-title">By Confidence Tier</div>`;
    for (const [tier, d] of Object.entries(data.byUrgency)) {
      if (!d) continue;
      html += `<div class="bar-row"><div class="bar-label">${tier.charAt(0).toUpperCase() + tier.slice(1)}</div><div class="bar-track"><div class="bar-fill" style="width:${d.pct}%;background:${tierColors[tier]}"></div></div><div class="bar-pct" style="color:${tierColors[tier]}">${d.pct}%</div><div class="bar-count">${d.total}</div></div>`;
    }

    html += `</div><div class="analytics-section"><div class="analytics-title">By Catalyst Type</div>`;
    for (const [cat, d] of Object.entries(data.byCatalyst).sort((a, b) => b[1].pct - a[1].pct)) {
      const color = d.pct >= 65 ? 'var(--green)' : d.pct >= 45 ? 'var(--amber)' : 'var(--red)';
      html += `<div class="bar-row"><div class="bar-label">${cat}</div><div class="bar-track"><div class="bar-fill" style="width:${d.pct}%;background:${color}"></div></div><div class="bar-pct" style="color:${color}">${d.pct}%</div><div class="bar-count">${d.total}</div></div>`;
    }
    html += `</div>`;

    if (Object.keys(data.byDay).length > 0) {
      html += `<div class="analytics-section"><div class="analytics-title">By Day of Week</div>`;
      for (const day of ['Mon','Tue','Wed','Thu','Fri']) {
        const d = data.byDay[day]; if (!d) continue;
        const color = d.pct >= 65 ? 'var(--green)' : d.pct >= 45 ? 'var(--amber)' : 'var(--red)';
        html += `<div class="bar-row"><div class="bar-label">${day}</div><div class="bar-track"><div class="bar-fill" style="width:${d.pct}%;background:${color}"></div></div><div class="bar-pct" style="color:${color}">${d.pct}%</div><div class="bar-count">${d.total}</div></div>`;
      }
      html += `</div>`;
    }

    if (Object.keys(data.byHour).length > 0) {
      html += `<div class="analytics-section"><div class="analytics-title">By Time of Day (ET)</div>`;
      for (const hh of Object.keys(data.byHour).map(Number).sort((a, b) => a - b)) {
        const d = data.byHour[hh], lbl = `${hh % 12 || 12}${hh < 12 ? 'am' : 'pm'}`;
        const color = d.pct >= 65 ? 'var(--green)' : d.pct >= 45 ? 'var(--amber)' : 'var(--red)';
        html += `<div class="bar-row"><div class="bar-label">${lbl}</div><div class="bar-track"><div class="bar-fill" style="width:${d.pct}%;background:${color}"></div></div><div class="bar-pct" style="color:${color}">${d.pct}%</div><div class="bar-count">${d.total}</div></div>`;
      }
      html += `</div>`;
    }
  }

  html += '</div>';
  document.getElementById('detailArea').innerHTML = html;
  if (data) { const el = document.getElementById('analyticsHitRate'); if (el) animateCount(el, data.overall, '%'); }
};
window.setAnalyticsPeriod = p => { window.analyticsPeriod = p; window.renderAnalytics(); };

// ============================================================
//  SETTINGS
// ============================================================
function renderSettings() {
  const s       = loadSettings();
  const saved   = getApiKey(), isConn = !!saved;
  const theme   = getTheme();
  const notifOk = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const lastScan = (() => { try { return localStorage.getItem(LAST_SCAN_KEY); } catch { return null; } })();
  const scans    = (() => { try { return localStorage.getItem(SCAN_COUNT_KEY) || '0'; } catch { return '0'; } })();
  const lastStr  = lastScan ? new Date(lastScan).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : 'Never';
  const hourOptions = h => Array.from({ length: 24 }, (_, i) => `<option value="${i}" ${i === h ? 'selected' : ''}>${i % 12 || 12}:00 ${i < 12 ? 'AM' : 'PM'}</option>`).join('');

  // Show last error if any
  const errHtml = lastScanError ? `<div style="background:#1a0808;border:1px solid var(--red);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:10px;color:var(--red)"><strong>Last scan error:</strong><br>${lastScanError}</div>` : '';

  document.getElementById('detailArea').innerHTML = `<div class="settings-wrap slide-up">
    ${errHtml}
    <div class="settings-section"><div class="settings-label">API Connection</div>
      <div class="settings-card">
        <div class="settings-field"><div class="settings-field-label">Anthropic API Key</div>
          <input class="settings-input" id="apiKeyInput" type="password" placeholder="sk-ant-api03-••••••••••" autocomplete="off" value="${isConn ? '••••••••••••••••••••' : ''}"/>
        </div>
        <button class="btn-connect-full" id="connectBtn" onclick="connectFromSettings()">${isConn ? '✓ Connected — tap to update' : 'Connect'}</button>
        <div class="connect-status" id="connectStatus">${isConn ? 'Connected.' : ''}</div>
        <div class="settings-meta" style="margin-top:10px">Model: <span>claude-haiku-4-5-20251001</span> · Est. cost/scan: <span>~$0.02–$0.05</span><br>Last scan: <span>${lastStr}</span> · Total scans: <span>${scans}</span></div>
        <div class="settings-hint">Get your key at <a href="https://console.anthropic.com" target="_blank" style="color:var(--blue)">console.anthropic.com</a>. Stored only in this browser.</div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Scanner</div>
      <div class="settings-card">
        <div class="settings-field"><div class="settings-field-label">Scan interval</div>
          <div class="preset-group">${[1,2,5,10].map(v => `<div class="preset-btn ${s.scanInterval === v ? 'on' : ''}" onclick="updateSetting('scanInterval',${v});renderSettings()">${v} min</div>`).join('')}</div>
        </div>
        <div class="settings-field"><div class="settings-field-label">Scan hours</div>
          <div class="preset-group" style="margin-bottom:10px">
            ${HOURS_PRESETS.map(hp => `<div class="preset-btn ${s.hoursPreset === hp.id ? 'on' : ''}" onclick="applyHoursPreset('${hp.id}');renderSettings()">${hp.label}</div>`).join('')}
          </div>
          ${s.hoursPreset === 'custom' ? `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
            <div><div class="settings-field-label">Open</div><select class="time-select" onchange="updateSetting('marketOpenHour',parseInt(this.value));renderSettings()">${hourOptions(s.marketOpenHour||9)}</select></div>
            <div><div class="settings-field-label">Close</div><select class="time-select" onchange="updateSetting('marketCloseHour',parseInt(this.value));renderSettings()">${hourOptions(s.marketCloseHour||16)}</select></div>
          </div>` : `<div style="font-size:10px;color:var(--muted)">${s.hoursPreset === '24h' ? '24h scans all 7 days including weekends.' : s.hoursPreset === 'market' ? 'NYSE market hours: 9:30 AM – 4:00 PM ET, Mon–Fri.' : 'Pre-market + after-hours: 4:00 AM – 8:00 PM ET, Mon–Fri.'}</div>`}
        </div>
        <div class="settings-field"><div class="settings-field-label">Catalysts to scan</div>
          <div class="cat-group">${[['fda','FDA'],['earn','Earnings'],['ma','M&A'],['short','Short Squeeze'],['k8','8-K'],['macro','Other']].map(([k,label]) => `<div class="cat-toggle ${s.catalysts[k] ? 'on' : ''}" onclick="toggleCatalyst('${k}')">${label}</div>`).join('')}</div>
        </div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Signal Filters</div>
      <div class="settings-card">
        <div class="settings-field"><div class="settings-field-label">Market cap range</div>
          <div class="preset-group">${MCAP_PRESETS.map(p => `<div class="preset-btn ${s.mcapPreset === p.id ? 'on' : ''}" onclick="updateSetting('mcapPreset','${p.id}');renderSettings()">${p.label}</div>`).join('')}</div>
        </div>
        <div class="settings-field"><div class="settings-field-label">Minimum confidence: <strong style="color:var(--blue)" id="confVal">${s.minConfidence}%</strong></div>
          <input class="settings-slider" type="range" min="50" max="95" step="5" value="${s.minConfidence}" oninput="document.getElementById('confVal').textContent=this.value+'%'" onchange="updateSetting('minConfidence',parseInt(this.value))"/>
        </div>
        <div class="settings-field"><div class="settings-field-label">Minimum move: <strong style="color:var(--blue)" id="moveVal">${s.minMove}%</strong></div>
          <input class="settings-slider" type="range" min="5" max="30" step="5" value="${s.minMove}" oninput="document.getElementById('moveVal').textContent=this.value+'%'" onchange="updateSetting('minMove',parseInt(this.value))"/>
        </div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Display</div>
      <div class="settings-card">
        <div class="settings-field"><div class="settings-field-label">Theme</div>
          <button class="btn-connect-full" id="themeToggleBtn" onclick="toggleTheme();renderSettings()" style="background:var(--surface3);color:var(--text2);border:1px solid var(--border2)">${theme === 'dark' ? '☀ Switch to Light Mode' : '☾ Switch to Dark Mode'}</button>
        </div>
        <div class="settings-field"><div class="settings-field-label">Accent color</div>
          <div class="color-group">
            ${[['blue','#3EC9FF'],['green','#20E090'],['purple','#B06EFF'],['gold','#FFB020']].map(([name,hex]) => `<div class="color-swatch sw-${name} ${s.accentColor === name ? 'on' : ''}" onclick="updateSetting('accentColor','${name}');renderSettings()" title="${name}" style="background:${hex}"></div>`).join('')}
          </div>
        </div>
        <div class="settings-field"><div class="settings-field-label">Font size</div>
          <div class="preset-group">${['small','medium','large'].map(f => `<div class="preset-btn ${s.fontSize === f ? 'on' : ''}" onclick="updateSetting('fontSize','${f}');renderSettings()">${f.charAt(0).toUpperCase()+f.slice(1)}</div>`).join('')}</div>
        </div>
        <div class="settings-field"><div class="settings-field-label">Compact mode</div>
          <div class="preset-group">
            <div class="preset-btn ${!s.compactMode ? 'on' : ''}" onclick="updateSetting('compactMode',false);renderSettings()">Off</div>
            <div class="preset-btn ${s.compactMode ? 'on' : ''}" onclick="updateSetting('compactMode',true);renderSettings()">On</div>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Notifications</div>
      <div class="settings-card">
        <button class="btn-connect-full" id="notifBtn" onclick="requestNotifFromSettings()" style="background:var(--surface3);color:var(--text2);border:1px solid var(--border2)">${notifOk ? '✓ Notifications enabled' : '🔔 Enable notifications'}</button>
        <div class="settings-hint">Works on desktop and Android Chrome. On iPhone, add to home screen first.</div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Data</div>
      <div class="settings-card">
        <button class="btn-danger" onclick="confirmClearData()">🗑 Clear all signals + history</button>
        <button class="btn-secondary" onclick="confirmResetSettings()">↺ Reset settings to default</button>
      </div>
    </div>
  </div>`;

  const inp = document.getElementById('apiKeyInput');
  if (inp) inp.addEventListener('focus', () => { if (inp.value.startsWith('•')) inp.value = ''; });
}

window.connectFromSettings = () => {
  const inp = document.getElementById('apiKeyInput'); if (!inp) return;
  const val = inp.value.trim();
  if (!val || val.startsWith('•')) {
    const st = document.getElementById('connectStatus');
    if (st) { st.textContent = 'Paste your API key first.'; st.style.color = 'var(--red)'; }
    return;
  }
  try { localStorage.setItem(API_KEY_STORAGE, val); } catch (_) {}
  clearErrorBanner();
  const btn = document.getElementById('connectBtn');
  if (btn) { btn.textContent = '✓ Connected'; btn.style.background = 'var(--green)'; btn.style.color = '#0a0c11'; }
  const st = document.getElementById('connectStatus');
  if (st) { st.textContent = 'API key saved. Try scanning now.'; st.style.color = 'var(--green)'; }
  haptic('medium');
};

window.toggleCatalyst = key => { const s = loadSettings(); s.catalysts[key] = !s.catalysts[key]; saveSettings(s); renderSettings(); };
window.requestNotifFromSettings = async () => {
  const granted = await requestNotificationPermission();
  const btn = document.getElementById('notifBtn');
  if (btn) { btn.textContent = granted ? '✓ Notifications enabled' : '✗ Denied — check browser settings'; btn.style.color = granted ? 'var(--green)' : 'var(--red)'; }
};
window.confirmClearData = () => {
  if (confirm('Clear all signals and history?')) { clearAllData(); renderSettings(); renderFeed(); window.renderSidebar(); }
};
window.confirmResetSettings = () => {
  if (confirm('Reset all settings to default?')) { resetSettings(); renderSettings(); }
};

// ============================================================
//  RENDER ACTIVE TAB
// ============================================================
window.renderActiveTab = () => {
  window.activeSignalId = null;
  const t = window.activeTab;
  if      (t === 'feed')       { renderFeed(); window.renderSidebar(); }
  else if (t === 'h24')        render24h();
  else if (t === 'history')    renderHistory();
  else if (t === 'watchlist')  window.renderWatchlist();
  else if (t === 'portfolio')  renderPortfolio();
  else if (t === 'analytics')  window.renderAnalytics();
  else if (t === 'settings')   renderSettings();
};

// ============================================================
//  SERVICE WORKER
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(r => console.log('[SW] Registered:', r.scope))
      .catch(e => console.warn('[SW] Failed:', e));
  });
}

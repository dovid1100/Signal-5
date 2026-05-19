'use strict';
// ============================================================
//  VERTEX ui.js — All rendering  v3.0
// ============================================================

window.activeTab       = 'watchfile';
window.activeSignalId  = null;
window.historyRange    = '7d';
window.historySortBy   = 'time';
window.analyticsPeriod = 'allTime';
window.activeChartMode = 'line';

// ============================================================
//  INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab[data-tab]').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      window.activeTab = t.dataset.tab;
      haptic('light');
      renderActiveTab();
    });
  });

  // Horizontal swipe between tabs
  let sx = 0, sy = 0;
  const TABS = ['watchfile','signals','history','portfolio','analytics','learn','settings'];
  const area = document.getElementById('detailArea');
  if (area) {
    area.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    area.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) < 120 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const cur = TABS.indexOf(window.activeTab), next = dx < 0 ? Math.min(cur + 1, TABS.length - 1) : Math.max(cur - 1, 0);
      if (next !== cur) document.querySelector(`[data-tab="${TABS[next]}"]`)?.click();
    }, { passive: true });
  }

  renderActiveTab();
  updateMarketStatusDisplay();
});

// ============================================================
//  ROUTE
// ============================================================
window.renderActiveTab = async function(soft=false) {
  const t = window.activeTab;
  if      (t === 'watchfile')  await renderWatchfile();
  else if (t === 'signals')    await renderSignalsFeed();
  else if (t === 'history')    await renderHistory();
  else if (t === 'portfolio')  await renderPortfolio();
  else if (t === 'analytics')  await renderAnalytics();
  else if (t === 'learn')      renderLearn();
  else if (t === 'settings')   await renderSettings();
};

// ============================================================
//  HELPERS
// ============================================================
function getCssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim(); }
function getDetail()  { return document.getElementById('detailArea'); }

// Phase 5: real-time sidebar refresh without full re-render
window.refreshSignalSidebarOnly = async function() {
  const signals = await loadSignalsToday();
  const badge = document.getElementById('signalsBadge');
  if (badge) badge.textContent = signals.length;
  if (window.activeTab === 'signals') renderSignalSidebar(signals);
};

// ============================================================
//  WATCHFILE TAB
// ============================================================
window.renderWatchfile = async function() {
  const detail = getDetail();
  detail.innerHTML = `<div class="wf-header slide-up">
    <div class="wf-title">VERTEX Watchfile</div>
    <div class="wf-subtitle">FDA events tracked automatically + manually</div>
    <div class="wf-add-row">
      <input class="wf-input" id="wfInput" placeholder="Add ticker (e.g. ACMR)" maxlength="5" oninput="this.value=this.value.toUpperCase()"/>
      <button class="btn-accent" onclick="addWatchfileTicker()">+ Add</button>
    </div>
  </div>
  <div id="wfList">${skeletonHTML(3)}</div>`;

  const inp = document.getElementById('wfInput');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') addWatchfileTicker(); });

  const entries = await dbGetAll('watchfile');
  const el = document.getElementById('wfList'); if (!el) return;

  if (!entries.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🔭</div>
      <div class="empty-title">No events tracked yet</div>
      <div class="empty-body">Tap Scan Now to find upcoming FDA events automatically, or add a ticker manually above.</div>
      <button class="btn-accent" style="margin-top:16px" onclick="document.getElementById('scanBtn').click()">▶ Scan Now</button>
    </div>`;
    return;
  }

  const iMeta = {
    decision_day: { label: 'Decision TODAY', color: 'var(--red)',    bg: 'var(--red-dim)',    icon: '⚡' },
    critical:     { label: 'Tomorrow',        color: 'var(--red)',    bg: 'var(--red-dim)',    icon: '⚡' },
    high:         { label: '2–3 Days',         color: 'var(--amber)',  bg: 'var(--amber-dim)',  icon: '▲' },
    medium:       { label: 'This Week',        color: 'var(--accent)', bg: 'var(--accent-dim)', icon: '●' },
    low:          { label: 'Next 2 Weeks',     color: 'var(--muted2)', bg: 'var(--surface3)',   icon: '○' },
    watching:     { label: 'Monitoring',       color: 'var(--muted)',  bg: 'var(--surface3)',   icon: '◌' },
  };

  // Phase 3: recalculate daysUntil dynamically at render time
  const withDays = entries.map(e => ({ ...e, daysUntil: calcDaysUntil(e.pdufaDate), intensity: getFDAIntensity(calcDaysUntil(e.pdufaDate)) }));
  const active   = withDays.filter(e => e.status !== 'resolved').sort((a, b) => {
    const o = { decision_day: 0, critical: 1, high: 2, medium: 3, low: 4, watching: 5 };
    return (o[a.intensity] || 5) - (o[b.intensity] || 5) || a.daysUntil - b.daysUntil;
  });
  const resolved = withDays.filter(e => e.status === 'resolved').slice(0, 5);

  const cardHtml = e => {
    const m = iMeta[e.intensity] || iMeta.watching;
    const pp = e.priceHistory?.slice(-1)[0];
    const chg = pp?.changeDay;
    const hasOpts = (e.optionsActivity || []).some(o => o.type === 'unusual_calls' || o.type === 'unusual_puts');
    const hasIns  = (e.insiderActivity || []).some(i => i.type === 'buying');
    // Phase 3: fix double-negative display
    const rejDisplay = e.expectedMoveDown ? `-${Math.abs(e.expectedMoveDown)}%` : '—';
    return `<div class="wf-card ${e.status === 'resolved' ? 'wf-card-resolved' : ''}" onclick="openWatchfileDetail('${e.id}')">
      <div class="wf-card-top">
        <div class="wf-intensity-pill" style="background:${m.bg};color:${m.color}">${m.icon} ${m.label}</div>
        <div class="wf-ticker-big">${e.ticker}</div>
        <div class="wf-days-left">${e.status === 'resolved' ? 'Done' : e.daysUntil <= 0 ? 'TODAY' : e.daysUntil + 'd'}</div>
      </div>
      <div class="wf-drug-line">${e.drugName || '—'} <span class="wf-for">for</span> ${e.indication || '—'}</div>
      <div class="wf-company-line">${e.company}</div>
      <div class="wf-metrics-row">
        <div class="wf-metric-mini"><span class="wf-metric-label">Approval</span><span class="wf-metric-val" style="color:${e.approvalProbability >= 60 ? 'var(--green)' : e.approvalProbability >= 40 ? 'var(--amber)' : 'var(--red)'}">${e.approvalProbability}%</span></div>
        <div class="wf-metric-mini"><span class="wf-metric-label">If Approved</span><span class="wf-metric-val val-green">+${e.expectedMoveUp || '?'}%</span></div>
        <div class="wf-metric-mini"><span class="wf-metric-label">If Rejected</span><span class="wf-metric-val val-red">${rejDisplay}</span></div>
        ${pp?.price ? `<div class="wf-metric-mini"><span class="wf-metric-label">Price</span><span class="wf-metric-val" style="color:${chg >= 0 ? 'var(--green)' : 'var(--red)'}">$${pp.price.toFixed(2)}</span></div>` : ''}
      </div>
      <div class="wf-badge-row">
        ${hasOpts ? '<span class="wf-badge wf-badge-opts">⚡ Unusual Options</span>' : ''}
        ${hasIns  ? '<span class="wf-badge wf-badge-ins">🟢 Insider Buying</span>' : ''}
        ${e.dilutionRisk ? '<span class="wf-badge wf-badge-dil">⚠ Dilution Risk</span>' : ''}
        ${e.status === 'resolved' ? `<span class="wf-badge" style="background:${e.outcome === 'approved' ? 'var(--green-dim)' : 'var(--red-dim)'};color:${e.outcome === 'approved' ? 'var(--green)' : 'var(--red)'}">→ ${(e.outcome || '').toUpperCase()}</span>` : ''}
      </div>
    </div>`;
  };

  el.innerHTML = active.map(cardHtml).join('')
    + (resolved.length ? `<div class="wf-section-label" style="margin-top:16px">Resolved</div>${resolved.map(cardHtml).join('')}` : '');
};

window.addWatchfileTicker = async function() {
  const inp = document.getElementById('wfInput'); if (!inp) return;
  const t = inp.value.trim().toUpperCase();
  if (!t || !/^[A-Z]{1,5}$/.test(t)) { inp.style.borderColor = 'var(--red)'; setTimeout(() => inp.style.borderColor = '', 1500); return; }
  inp.value = '';
  await addManualFDAWatch(t);
};

// ── Watchfile Detail ──────────────────────────────────────────
window.openWatchfileDetail = async function(id) {
  const e = await dbGet('watchfile', id); if (!e) return;
  // Phase 3: always recalc
  const days = calcDaysUntil(e.pdufaDate);
  const detail = getDetail();
  const confData = (e.confidenceHistory || []).slice(-20);

  const newsHtml = (e.newsHistory || []).slice(-5).reverse().map(n => `
    <div class="intel-item ${n.sentiment === 'positive' ? 'intel-pos' : n.sentiment === 'negative' ? 'intel-neg' : ''}">
      <div class="intel-meta">${n.source || ''} · ${n.ts ? new Date(n.ts).toLocaleDateString() : ''}</div>
      <div class="intel-headline">${n.headline}</div>
      ${n.url ? `<a href="${n.url}" target="_blank" class="intel-link">Read →</a>` : ''}
    </div>`).join('') || '<div class="intel-empty">No news tracked yet. Updates automatically at next check.</div>';

  const optsHtml = (e.optionsActivity || []).slice(-5).map(o => `
    <div class="intel-item ${o.type === 'unusual_calls' ? 'intel-pos' : o.type === 'unusual_puts' ? 'intel-neg' : ''}">
      <strong>${o.type === 'unusual_calls' ? '⬆ Unusual Calls' : o.type === 'unusual_puts' ? '⬇ Unusual Puts' : 'Normal Activity'}</strong>: ${o.description || ''}
      ${o.url ? `<a href="${o.url}" target="_blank" class="intel-link">Source →</a>` : ''}
    </div>`).join('') || '<div class="intel-empty">No options activity tracked yet.</div>';

  const insHtml = (e.insiderActivity || []).map(i => `
    <div class="intel-item ${i.type === 'buying' ? 'intel-pos' : 'intel-neg'}">
      <strong>${i.type === 'buying' ? '🟢 Buying' : '🔴 Selling'}</strong>: ${i.name || ''} ${i.role ? '(' + i.role + ')' : ''} — ${i.shares ? i.shares.toLocaleString() + ' shares' : ''} ${i.value ? '/ $' + (i.value / 1e6).toFixed(1) + 'M' : ''} ${i.date ? 'on ' + i.date : ''}
    </div>`).join('') || '<div class="intel-empty">No insider activity tracked yet.</div>';

  const rejDisplay = e.expectedMoveDown ? `-${Math.abs(e.expectedMoveDown)}%` : '—';

  detail.innerHTML = `<div class="slide-up">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:13px">
      <button class="back-btn" onclick="window.renderWatchfile()">← Watchfile</button>
      <button class="btn-secondary" style="font-size:9px;padding:6px 10px;margin-left:auto" onclick="triggerManualDeepCheck('${e.id}')">↺ Refresh Intel</button>
      <button class="btn-danger" style="font-size:9px;padding:6px 10px;width:auto" onclick="confirmDeleteWatchfile('${e.id}','${e.ticker}')">✕ Remove</button>
    </div>
    <div class="wf-detail-hero">
      <div class="wf-detail-ticker">${e.ticker}</div>
      <div class="wf-detail-company">${e.company}</div>
      <div class="wf-detail-drug">${e.drugName} <span style="color:var(--muted)">for</span> ${e.indication}</div>
      <div class="wf-detail-pdufa">PDUFA: <strong style="color:var(--accent)">${e.pdufaDate}</strong> ${e.status !== 'resolved' ? '(' + days + (days === 1 ? ' day' : ' days') + ' away)' : ''}</div>
    </div>
    <div class="wf-detail-grid">
      <div class="wf-ds"><div class="wf-ds-label">Approval Prob.</div><div class="wf-ds-val" style="color:${e.approvalProbability >= 60 ? 'var(--green)' : e.approvalProbability >= 40 ? 'var(--amber)' : 'var(--red)'}">${e.approvalProbability}%</div></div>
      <div class="wf-ds"><div class="wf-ds-label">On Approval</div><div class="wf-ds-val val-green">+${e.expectedMoveUp || '?'}%</div></div>
      <div class="wf-ds"><div class="wf-ds-label">On Rejection</div><div class="wf-ds-val val-red">${rejDisplay}</div></div>
      <div class="wf-ds"><div class="wf-ds-label">Current Price</div><div class="wf-ds-val">${e.currentPrice ? '$' + e.currentPrice.toFixed(2) : '—'}</div></div>
      <div class="wf-ds"><div class="wf-ds-label">Short Float</div><div class="wf-ds-val">${e.currentShortPct || '—'}</div></div>
      <div class="wf-ds"><div class="wf-ds-label">Float Size</div><div class="wf-ds-val">${e.floatShares || '—'}</div></div>
      <div class="wf-ds"><div class="wf-ds-label">Market Cap</div><div class="wf-ds-val">${e.marketCapFmt || '—'}</div></div>
      <div class="wf-ds"><div class="wf-ds-label">Drug Type</div><div class="wf-ds-val">${e.drugType || '—'}</div></div>
    </div>
    ${e.dilutionRisk ? '<div class="dilution-warning">⚠ Dilution Risk — estimated less than 4 months cash runway.</div>' : ''}
    ${confData.length >= 2 ? `<div class="section"><div class="section-title">Confidence History</div><div class="chart-wrap" style="padding:13px"><canvas id="confChart" style="width:100%;height:110px;display:block"></canvas></div></div>` : ''}
    <div class="section"><div class="section-title">Analyst Sentiment</div><div class="reasoning-box">${e.analystSentiment || 'No analyst sentiment recorded yet.'}</div></div>
    <div class="section"><div class="section-title">Intelligence — News</div>${newsHtml}</div>
    <div class="section"><div class="section-title">Intelligence — Options Activity</div>${optsHtml}</div>
    <div class="section"><div class="section-title">Intelligence — Insider Activity</div>${insHtml}</div>
    ${e.status !== 'resolved' ? `<div class="section"><div class="section-title">Record Decision Outcome</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-outcome btn-approved" onclick="recordOutcomeUI('${e.id}','approved')">✓ FDA Approved</button>
        <button class="btn-outcome btn-rejected" onclick="recordOutcomeUI('${e.id}','rejected')">✗ FDA Rejected</button>
        <button class="btn-outcome btn-delayed"  onclick="recordOutcomeUI('${e.id}','delayed')">⏸ Delayed</button>
      </div>
      <div class="settings-hint" style="margin-top:8px">Recording the outcome teaches VERTEX patterns for future predictions.</div>
    </div>` : `<div class="section"><div class="reasoning-box">Outcome recorded: <strong style="color:${e.outcome === 'approved' ? 'var(--green)' : 'var(--red)'}">${(e.outcome || '').toUpperCase()}</strong></div></div>`}
    <div class="section"><div class="section-title">Price Chart (1 Month)</div>
      <div class="chart-wrap"><div class="chart-canvas-wrap" id="wfChartWrap">
        <div class="chart-loading" id="wfChartLoading">⟳ Loading...</div>
        <canvas id="wfChartCanvas" class="chart-canvas" style="display:none"></canvas>
      </div></div>
    </div>
  </div>`;

  detail.scrollTop = 0;

  if (confData.length >= 2) setTimeout(() => {
    const c = document.getElementById('confChart'); if (!c) return;
    const w = c.offsetWidth || 300; c.width = w; c.height = 110; c.style.width = w + 'px'; c.style.height = '110px';
    drawConfidenceChart(c.getContext('2d'), confData, w, 110);
  }, 50);

  loadWatchfileChart(e.ticker);
};

window.triggerManualDeepCheck = async function(id) {
  showToast('Refreshing intel...', 'info');
  await manualWatchfileDeepCheck(id);
  window.openWatchfileDetail(id);
};

// Phase 5: custom confirm for iOS PWA
window.confirmDeleteWatchfile = async function(id, ticker) {
  const ok = await showConfirm(`Remove ${ticker} from watchfile?`);
  if (!ok) return;
  await deleteWatchfileEntry(id);
};

window.recordOutcomeUI = async function(id, outcome) {
  const ok = await showConfirm(`Record outcome as "${outcome}"?`);
  if (!ok) return;
  await recordFDAOutcome(id, outcome);
  showToast('Outcome recorded — VERTEX is learning', 'success');
  window.openWatchfileDetail(id);
};

async function loadWatchfileChart(ticker) {
  const loading = document.getElementById('wfChartLoading'), canvas = document.getElementById('wfChartCanvas');
  if (!loading || !canvas) return;
  const data = await fetchOHLCV(ticker, '1mo', '1d');
  if (!data || !data.length) { loading.textContent = 'Chart unavailable'; return; }
  loading.style.display = 'none'; canvas.style.display = 'block';
  const wrap = document.getElementById('wfChartWrap'), w = (wrap ? wrap.offsetWidth : canvas.offsetWidth) || 300, h = 148;
  canvas.width = w; canvas.height = h; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  drawLineChart(canvas.getContext('2d'), data, w, h);
}

function drawConfidenceChart(ctx, data, w, h) {
  const p = { t: 8, r: 8, b: 20, l: 36 }, pw = w - p.l - p.r, ph = h - p.t - p.b;
  const scores = data.map(d => d.score), mn = Math.max(0, Math.min(...scores) - 10), mx = Math.min(100, Math.max(...scores) + 10), range = mx - mn || 1;
  ctx.clearRect(0, 0, w, h);
  [0, 25, 50, 75, 100].forEach(v => {
    if (v < mn || v > mx) return;
    const y = p.t + ((mx - v) / range) * ph;
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(p.l + pw, y); ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,230,.3)'; ctx.font = '8px IBM Plex Mono'; ctx.fillText(v + '%', 0, y + 3);
  });
  const last = scores[scores.length - 1], color = last >= 50 ? getCssVar('green') : getCssVar('red');
  const grad = ctx.createLinearGradient(0, p.t, 0, p.t + ph);
  grad.addColorStop(0, `${color}33`); grad.addColorStop(1, `${color}00`);
  ctx.beginPath();
  data.forEach((d, i) => { const x = p.l + (i / (data.length - 1)) * pw, y = p.t + ((mx - d.score) / range) * ph; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.lineTo(p.l + pw, p.t + ph); ctx.lineTo(p.l, p.t + ph); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((d, i) => { const x = p.l + (i / (data.length - 1)) * pw, y = p.t + ((mx - d.score) / range) * ph; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.stroke();
  if (data.length >= 2) { ctx.fillStyle = 'rgba(200,210,230,.3)'; ctx.font = '8px IBM Plex Mono'; ctx.fillText(data[0].daysUntil + 'd', p.l, h - 4); ctx.fillText(data[data.length - 1].daysUntil + 'd', p.l + pw - 18, h - 4); }
}

// ============================================================
//  SIGNALS FEED
// ============================================================
window.renderSignalsFeed = async function() {
  const detail = getDetail();
  detail.innerHTML = skeletonHTML(3);
  const signals = await loadSignalsToday();
  const badge = document.getElementById('signalsBadge');
  if (badge) badge.textContent = signals.length;

  if (!signals.length) { detail.innerHTML = buildEmptySignalsHTML(); return; }

  renderSignalSidebar(signals);
  if (!window.activeSignalId || !signals.find(s => s.id === window.activeSignalId))
    window.activeSignalId = signals[0].id;
  window.renderDetail(window.activeSignalId);
};

function buildEmptySignalsHTML() {
  const info = window.lastScanInfo;
  let diag = '';
  if (info?.type === 'error')     diag = `<div class="diag-card diag-error"><div class="diag-icon">⚠</div><div><div class="diag-title">Last scan failed</div><div class="diag-msg">${info.msg}</div></div></div>`;
  else if (info?.type === 'empty')diag = `<div class="diag-card diag-info"><div class="diag-icon">📡</div><div><div class="diag-title">Scan ran — no qualifying signals</div><div class="diag-fix">→ Try lowering min confidence in Settings</div></div></div>`;
  else if (info?.type === 'duplicate') diag = `<div class="diag-card diag-info"><div class="diag-icon">♻</div><div><div class="diag-title">Same tickers found recently</div><div class="diag-fix">→ 1-hour dedup window active</div></div></div>`;
  return `<div class="empty-signals-wrap slide-up"><div class="empty-signals-title">No signals today</div><div class="empty-signals-sub">${isMarketOpen() ? 'Market open · scanning automatically' : isPreMarket() ? 'Pre-market · next scan soon' : 'Market closed'}</div>${diag}<button class="btn-accent" style="margin-top:16px" onclick="document.getElementById('scanBtn').click()">▶ Scan Now</button></div>`;
}

function renderSignalSidebar(signals) {
  const sb = document.getElementById('signalSidebar'); if (!sb) return;
  const order = { critical: 0, high: 1, medium: 2 };
  const sorted = [...signals].sort((a, b) => order[a.urgency] - order[b.urgency]);
  sb.innerHTML = sorted.map(s => `
    <div class="ticker-item urg-${s.urgency} ${s.id === window.activeSignalId ? 'active' : ''}" data-id="${s.id}" onclick="selectSignal('${s.id}')">
      <div class="t-name">${s.ticker}</div>
      <div class="t-move ${s.move >= 0 ? 'move-up' : 'move-dn'}">${s.move >= 0 ? '+' : ''}${s.move}%</div>
      <div class="t-type-mini">${s.type === 'fda_watchfile' ? 'FDA' : s.type === 'squeeze' ? 'SQZ' : s.type === 'ma' ? 'M&A' : 'CAT'}</div>
    </div>`).join('');
}

window.flashNewSignals = ids => {
  ids.forEach(id => {
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  });
};
window.selectSignal = id => { haptic('light'); window.activeSignalId = id; window.renderDetail(id); };

// ============================================================
//  SIGNAL DETAIL  (Phase 4: back button on mobile)
// ============================================================
window.renderDetail = function(id) {
  dbGet('signals', id).then(sig => {
    if (!sig) return;
    window.activeSignalId = id;
    const detail = getDetail(); if (!detail) return;
    const confClass = sig.urgency === 'critical' ? 'fill-red' : sig.urgency === 'high' ? 'fill-amber' : 'fill-green';
    const moveClass = sig.move >= 0 ? 'val-green' : 'val-red';
    const icon = sig.urgency === 'critical' ? '⚡' : sig.urgency === 'high' ? '▲' : '●';

    const typeBanners = {
      fda_watchfile: `<div class="type-banner type-fda"><span>💊</span><div><div class="tb-title">FDA Watchfile Signal</div><div class="tb-sub">Generated from active FDA monitoring</div></div></div>`,
      squeeze:       `<div class="type-banner type-squeeze"><span>🔥</span><div><div class="tb-title">Short Squeeze Setup</div><div class="tb-sub">Setup forming — not yet squeezing</div></div></div>`,
      ma:            `<div class="type-banner type-ma"><span>🤝</span><div><div class="tb-title">M&A Accumulation</div><div class="tb-sub">Informed accumulation pattern detected</div></div></div>`,
    };
    const banner = typeBanners[sig.type] || '';

    const sourcesHtml = (sig.sources || []).map(s =>
      `<a class="source-card" href="${s.url}" target="_blank" rel="noopener noreferrer">
        <div class="source-icon">${s.icon || '📰'}</div>
        <div class="source-body">
          <div class="source-pub-row"><div class="source-pub">${s.pub}</div><div class="source-time-label">${s.time}</div></div>
          <div class="source-hl">${s.headline}</div>
          <span class="source-url">${s.url}</span>
        </div>
        <div class="source-arrow">→</div>
      </a>`
    ).join('');

    let outcomeHtml;
    if (sig.outcome === 'hit')         outcomeHtml = `<div class="outcome-card"><div class="outcome-msg">${sig.outcomeMsg}</div><span class="badge-hit">HIT ✓</span></div>`;
    else if (sig.outcome === 'miss')   outcomeHtml = `<div class="outcome-card"><div class="outcome-msg">${sig.outcomeMsg}</div><span class="badge-miss">MISS ✗</span></div>`;
    else if (sig.outcome === 'unverified') outcomeHtml = `<div class="outcome-card"><div class="outcome-msg">${sig.outcomeMsg}</div><a href="https://finance.yahoo.com/quote/${sig.ticker}" target="_blank" style="font-size:10px;color:var(--accent)">Verify →</a></div>`;
    else if (isOutcomeCheckReady(sig)) outcomeHtml = `<div class="outcome-card"><div class="outcome-msg">Ready to check outcome.</div><button class="btn-check" onclick="checkOutcome('${sig.id}').then(()=>window.renderDetail('${sig.id}'))">Check Outcome</button></div>`;
    else { const rem = Math.max(0, 60 - Math.floor((Date.now() - new Date(sig.scannedAt).getTime()) / 60000)); outcomeHtml = `<div class="outcome-card"><div class="outcome-msg"><span class="badge-pend">PENDING</span> Check in ${rem} min.</div></div>`; }

    // Phase 4: mobile back button — only shows when coming from signals list
    const mobileBackBtn = `<button class="back-btn mobile-only" onclick="window.renderSignalsFeed()" style="margin-bottom:10px">← Signals</button>`;

    // Phase 3: fix double-negative in detail if shown
    const rejDisplay = sig.expectedMoveDown != null ? `-${Math.abs(sig.expectedMoveDown)}%` : null;

    detail.innerHTML = `<div class="slide-up">
      ${mobileBackBtn}
      ${banner}
      <div class="signal-hero">
        <div class="hero-badge badge-${sig.urgency}"><div class="badge-icon">${icon}</div>${sig.urgency.toUpperCase()}</div>
        <div class="hero-info">
          <div class="hero-row"><div class="hero-ticker">${sig.ticker}</div><div class="hero-company">${sig.company}</div></div>
          <div class="hero-headline">${sig.headline}</div>
          <div class="hero-tags"><span class="tag ${sig.catalystTag}">${sig.catalyst}</span><span class="tag tag-macro">${sig.time}</span><span class="tag tag-macro">Vol ${sig.volume}</span><span class="tag tag-macro">${sig.marketCap}</span></div>
        </div>
        <div class="hero-metrics">
          <div class="metric-card"><div class="metric-label">Move</div><div class="metric-val ${moveClass}">${sig.move >= 0 ? '+' : ''}${sig.move}%</div><div class="metric-sub">Current</div></div>
          <div class="metric-card"><div class="metric-label">Upside</div><div class="metric-val val-accent">${sig.upside}</div><div class="metric-sub">AI est.</div></div>
          <div class="metric-card" style="grid-column:span 2"><div class="metric-label">Confidence — ${sig.confidence}%</div><div class="conf-track"><div class="conf-fill ${confClass}" style="width:${sig.confidence}%"></div></div></div>
        </div>
      </div>
      <div class="quick-actions">
        <button class="qa-btn" onclick="archiveSignalUI('${sig.id}')">✕ Dismiss</button>
        ${sig.type === 'fda_watchfile' && sig.watchfileId ? `<button class="qa-btn" onclick="window.openWatchfileDetail('${sig.watchfileId}')">💊 Watchfile</button>` : ''}
        <button class="qa-btn" onclick="goToPortfolioAdd('${sig.ticker}')">💼 Portfolio</button>
      </div>
      <div class="section"><div class="section-title">Price Chart</div>
        <div class="chart-wrap">
          <div class="chart-header">
            <div class="chart-title">${sig.ticker}</div>
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
      <div class="section"><div class="section-title">Claude's Reasoning</div><div class="reasoning-box">${sig.reasoning}</div></div>
      ${(sig.sources || []).length ? `<div class="section"><div class="section-title">${sig.sources.length} Source${sig.sources.length !== 1 ? 's' : ''} — Tap to verify</div><div class="sources-grid">${sourcesHtml}</div></div>` : ''}
      <div class="section"><div class="section-title">Prediction Outcome</div>${outcomeHtml}</div>
    </div>`;

    detail.scrollTop = 0;

    // Phase 3 fix: load chart only once, cache data
    loadSignalChart(sig.id, sig.ticker, sig.scannedAt);
  });
};

window.archiveSignalUI = async id => { await updateSignal(id, { archived: true }); haptic('light'); window.renderSignalsFeed(); };
window.goToPortfolioAdd = ticker => {
  window.activeTab = 'portfolio';
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelector('[data-tab="portfolio"]')?.classList.add('active');
  renderPortfolio(ticker);
};

// ============================================================
//  CHARTS  (Phase 3: cache chart data, fix re-fetch on toggle)
// ============================================================
let _chartDataCache = {};
let _chartLockMap   = new Map(); // Phase 3: proper Map instead of object

window.switchChart = (id, mode, btn) => {
  window.activeChartMode = mode;
  document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  // Phase 3: use cached data if available
  if (_chartDataCache[id]) {
    const canvas = document.getElementById(`chartCanvas-${id}`);
    const loading = document.getElementById(`chartLoading-${id}`);
    if (canvas && loading) {
      loading.style.display = 'none'; canvas.style.display = 'block';
      const wrap = document.getElementById(`chartWrap-${id}`);
      const w = (wrap ? wrap.offsetWidth : canvas.offsetWidth) || 320, h = 148;
      canvas.width = w; canvas.height = h; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      mode === 'candle'
        ? drawCandlestick(canvas.getContext('2d'), _chartDataCache[id], w, h)
        : drawLineChart(canvas.getContext('2d'), _chartDataCache[id], w, h);
    }
  } else {
    dbGet('signals', id).then(s => { if (s) loadSignalChart(id, s.ticker, s.scannedAt); });
  }
};

async function loadSignalChart(id, ticker, scannedAt) {
  if (_chartLockMap.has(id)) return;
  _chartLockMap.set(id, true);
  const loading = document.getElementById(`chartLoading-${id}`), canvas = document.getElementById(`chartCanvas-${id}`);
  if (!loading || !canvas) { _chartLockMap.delete(id); return; }
  loading.style.display = 'flex'; canvas.style.display = 'none';
  try {
    // Use cached if available
    let plotData = _chartDataCache[id];
    if (!plotData) {
      const data = await fetchOHLCV(ticker, '1d', '5m');
      if (!data || !data.length) { loading.textContent = 'Chart unavailable'; return; }
      const sigTime = new Date(scannedAt).getTime();
      const filtered = data.filter(d => d.t >= sigTime - 5 * 60 * 1000);
      plotData = filtered.length >= 3 ? filtered : data.slice(-40);
      _chartDataCache[id] = plotData;
    }
    loading.style.display = 'none'; canvas.style.display = 'block';
    const wrap = document.getElementById(`chartWrap-${id}`), w = (wrap ? wrap.offsetWidth : canvas.offsetWidth) || 320, h = 148;
    canvas.width = w; canvas.height = h; canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    window.activeChartMode === 'candle'
      ? drawCandlestick(canvas.getContext('2d'), plotData, w, h)
      : drawLineChart(canvas.getContext('2d'), plotData, w, h);
  } catch (_) { loading.textContent = 'Chart unavailable'; }
  finally { _chartLockMap.delete(id); } // Phase 3: clean up properly
}

function drawLineChart(ctx, data, w, h) {
  const p = { t: 8, r: 6, b: 20, l: 44 }, pw = w - p.l - p.r, ph = h - p.t - p.b;
  const prices = data.map(d => d.c), minP = Math.min(...prices), maxP = Math.max(...prices), range = maxP - minP || 0.01;
  const isUp = prices[prices.length - 1] >= prices[0], color = isUp ? getCssVar('green') : getCssVar('red');
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i <= 4; i++) {
    const y = p.t + (ph / 4) * i;
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(p.l + pw, y); ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,230,.28)'; ctx.font = '8px IBM Plex Mono';
    ctx.fillText('$' + (maxP - (range / 4) * i).toFixed(2), 0, y + 3);
  }
  const grad = ctx.createLinearGradient(0, p.t, 0, p.t + ph);
  grad.addColorStop(0, `${color}33`); grad.addColorStop(1, `${color}00`);
  ctx.beginPath();
  data.forEach((d, i) => { const x = p.l + (i / (data.length - 1)) * pw, y = p.t + ((maxP - d.c) / range) * ph; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.lineTo(p.l + pw, p.t + ph); ctx.lineTo(p.l, p.t + ph); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  data.forEach((d, i) => { const x = p.l + (i / (data.length - 1)) * pw, y = p.t + ((maxP - d.c) / range) * ph; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,210,230,.28)'; ctx.font = '8px IBM Plex Mono';
  [0, Math.floor(data.length / 2), data.length - 1].forEach(i => {
    if (!data[i]) return;
    const x = p.l + (i / (data.length - 1)) * pw;
    ctx.fillText(new Date(data[i].t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }), x - 14, h - 4);
  });
}

function drawCandlestick(ctx, data, w, h) {
  const p = { t: 8, r: 6, b: 20, l: 44 }, pw = w - p.l - p.r, ph = h - p.t - p.b;
  const maxP = Math.max(...data.map(d => d.h)), minP = Math.min(...data.map(d => d.l)), range = maxP - minP || 0.01;
  const green = getCssVar('green'), red = getCssVar('red');
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i <= 4; i++) {
    const y = p.t + (ph / 4) * i;
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.l, y); ctx.lineTo(p.l + pw, y); ctx.stroke();
    ctx.fillStyle = 'rgba(200,210,230,.28)'; ctx.font = '8px IBM Plex Mono';
    ctx.fillText('$' + (maxP - (range / 4) * i).toFixed(2), 0, y + 3);
  }
  const cw = Math.max(2, (pw / data.length) - 1);
  data.forEach((d, i) => {
    const x = p.l + (i / data.length) * pw + cw / 2;
    const yH = p.t + ((maxP - d.h) / range) * ph, yL = p.t + ((maxP - d.l) / range) * ph;
    const yO = p.t + ((maxP - d.o) / range) * ph, yC = p.t + ((maxP - d.c) / range) * ph;
    const up = d.c >= d.o, col = up ? green : red;
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();
    ctx.fillStyle = up ? `${col}88` : col;
    const bt = Math.min(yO, yC), bh = Math.max(1, Math.abs(yC - yO));
    ctx.fillRect(x - cw / 2, bt, cw, bh);
    ctx.strokeRect(x - cw / 2, bt, cw, bh);
  });
}

// ============================================================
//  HISTORY  (Phase 3: fixed back button)
// ============================================================
async function renderHistory() {
  const detail = getDetail();
  detail.innerHTML = `<div class="history-toolbar">
    <div style="display:flex;gap:5px">${['24h','7d','all'].map(r => `<div class="range-btn ${window.historyRange === r ? 'on' : ''}" onclick="setHistoryRange('${r}')">${r}</div>`).join('')}</div>
    <div style="display:flex;gap:5px;margin-left:auto">${[['time','Time'],['move','Move'],['conf','Conf']].map(([k,v]) => `<div class="sort-btn ${window.historySortBy === k ? 'on' : ''}" onclick="setHistorySort('${k}')">${v}</div>`).join('')}</div>
    <button class="export-btn" onclick="exportCSV()">↓ CSV</button>
  </div>
  <div id="histList">${skeletonHTML(4)}</div>`;

  let sigs = window.historyRange === '24h' ? await loadSignalsLast24h() : window.historyRange === '7d' ? await loadSignalsLast7d() : await loadSignals();
  sigs = sigs.filter(s => !s.archived);
  if (window.historySortBy === 'move')      sigs.sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
  else if (window.historySortBy === 'conf') sigs.sort((a, b) => b.confidence - a.confidence);
  else                                      sigs.sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt));

  const el = document.getElementById('histList'); if (!el) return;
  if (!sigs.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">📂</div><div class="empty-title">No signals in this range</div></div>'; return; }

  const typeColors = { fda_watchfile: 'var(--purple)', catalyst: 'var(--accent)', squeeze: 'var(--red)', momentum: 'var(--green)', ma: 'var(--amber)' };
  el.innerHTML = sigs.map(s => {
    const b = s.outcome === 'hit' ? '<span class="srm-badge badge-hit">HIT</span>' : s.outcome === 'miss' ? '<span class="srm-badge badge-miss">MISS</span>' : '<span class="srm-badge badge-pend">PEND</span>';
    const dt = new Date(s.scannedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
    return `<div class="signal-row-mini urg-${s.urgency}" onclick="openHistoryDetail('${s.id}')"><div class="srm-ticker" style="color:${typeColors[s.type] || 'var(--text)'}">${s.ticker}</div><div class="srm-headline">${s.headline}</div><div class="srm-move ${s.move >= 0 ? 'move-up' : 'move-dn'}">${s.move >= 0 ? '+' : ''}${s.move}%</div>${b}<span style="font-size:9px;color:var(--muted);flex-shrink:0">${dt}</span></div>`;
  }).join('');
}

window.setHistoryRange = r => { window.historyRange = r; renderHistory(); };
window.setHistorySort  = s => { window.historySortBy = s; renderHistory(); };

// Phase 3 fix: proper back button — sets state before renderDetail runs
window.openHistoryDetail = id => {
  window.activeSignalId = id;
  window._historyDetailActive = true;
  window.renderDetail(id);
  // Insert back button after render completes
  requestAnimationFrame(() => {
    const detail = getDetail();
    if (!detail) return;
    const existing = detail.querySelector('.history-back-btn');
    if (existing) return;
    const btn = document.createElement('button');
    btn.className = 'back-btn history-back-btn';
    btn.textContent = '← History';
    btn.onclick = () => { window._historyDetailActive = false; renderHistory(); };
    detail.insertBefore(btn, detail.firstChild);
  });
};

// ============================================================
//  PORTFOLIO  (Phase 3: cached prices)
// ============================================================
async function renderPortfolio(prefillTicker='') {
  const p = loadPortfolio();
  const prices = await Promise.allSettled(p.positions.map(x => fetchPortfolioPrice(x.ticker)));
  let totalCur = p.cashBalance || 0, totalCost = p.cashBalance || 0;
  const enriched = p.positions.map((pos, i) => {
    const cur = prices[i].status === 'fulfilled' ? prices[i].value : null;
    const curVal = cur ? pos.shares * cur : pos.shares * pos.buyPrice;
    totalCur  += curVal;
    totalCost += pos.shares * pos.buyPrice;
    const gl = cur ? parseFloat((curVal - pos.shares * pos.buyPrice).toFixed(2)) : null;
    return { ...pos, currentPrice: cur, gl, glPct: gl !== null ? (gl / (pos.shares * pos.buyPrice) * 100).toFixed(2) : null };
  });
  const totalGL = totalCur - totalCost, glColor = totalGL >= 0 ? 'var(--green)' : 'var(--red)';

  getDetail().innerHTML = `<div class="portfolio-wrap slide-up">
    <div class="portfolio-total">
      <div class="portfolio-total-label">Portfolio Value</div>
      <div class="portfolio-total-val">$${totalCur.toFixed(2)}</div>
      ${totalGL !== 0 ? `<div style="font-size:13px;font-weight:600;color:${glColor};margin-top:3px">${totalGL >= 0 ? '+' : ''}$${Math.abs(totalGL).toFixed(2)} (${totalGL >= 0 ? '+' : ''}${(totalGL / Math.max(totalCost, .01) * 100).toFixed(2)}%)</div>` : ''}
    </div>
    <div class="portfolio-add">
      <div class="settings-field-label">Add Position</div>
      <div class="portfolio-add-row">
        <input class="portfolio-input" id="posTickerInput" placeholder="Ticker" maxlength="5" oninput="this.value=this.value.toUpperCase()" value="${prefillTicker}"/>
        <input class="portfolio-input" id="posSharesInput" placeholder="Shares" type="number" min="0" step="any"/>
        <input class="portfolio-input" id="posPriceInput"  placeholder="Buy $"  type="number" min="0" step="any"/>
        <button class="btn-accent" onclick="addPositionFromUI()">+ Add</button>
      </div>
    </div>
    ${!p.positions.length ? '<div class="empty-state" style="height:20vh"><div class="empty-icon">💼</div><div class="empty-title">No positions yet</div></div>' :
      `<div class="section-title" style="margin-bottom:9px">Positions</div>
      ${enriched.map(pos => {
        const glC = pos.gl != null ? (pos.gl >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--muted)';
        return `<div class="position-row">
          <div class="pos-ticker">${pos.ticker}</div>
          <div class="pos-shares">${pos.shares}sh</div>
          <div class="pos-cost">$${pos.buyPrice}→${pos.currentPrice ? '$' + pos.currentPrice.toFixed(2) : '—'}</div>
          <div class="pos-gl" style="color:${glC}">${pos.gl != null ? `${pos.gl >= 0 ? '+' : ''}$${Math.abs(pos.gl).toFixed(0)}<br><span style="font-size:9px">${pos.gl >= 0 ? '+' : ''}${pos.glPct}%</span>` : '—'}</div>
          <button class="pos-remove" onclick="removePositionFromUI('${pos.ticker}')">✕</button>
        </div>`;
      }).join('')}`}
    <div style="margin-top:14px">
      <div class="settings-field-label">Cash balance</div>
      <div style="display:flex;gap:7px;margin-top:5px">
        <input class="portfolio-input" id="cashInput" placeholder="$0.00" type="number" min="0" step="any" value="${p.cashBalance || ''}"/>
        <button class="btn-accent" onclick="saveCashFromUI()">Save</button>
      </div>
    </div>
  </div>`;

  if (prefillTicker) fetchPortfolioPrice(prefillTicker).then(pr => { const el = document.getElementById('posPriceInput'); if (pr && el) el.value = pr; });
}

window.addPositionFromUI = () => {
  const t = document.getElementById('posTickerInput')?.value.trim().toUpperCase();
  const s = parseFloat(document.getElementById('posSharesInput')?.value);
  const pr = parseFloat(document.getElementById('posPriceInput')?.value);
  if (!t || !s || !pr || s <= 0 || pr <= 0) { showToast('Fill in ticker, shares and price', 'warn'); return; }
  addPosition(t, s, pr); haptic('light'); renderPortfolio();
};
window.removePositionFromUI = async ticker => {
  const ok = await showConfirm(`Remove ${ticker}?`);
  if (!ok) return;
  removePosition(ticker); haptic('light'); renderPortfolio();
};
window.saveCashFromUI = () => { const v = parseFloat(document.getElementById('cashInput')?.value) || 0; updatePortfolioCash(v); haptic('light'); renderPortfolio(); };

// ============================================================
//  ANALYTICS
// ============================================================
window.renderAnalytics = async function() {
  const detail = getDetail(); detail.innerHTML = skeletonHTML(3);
  const analytics = await getAnalytics();
  const data = analytics[window.analyticsPeriod] || analytics.allTime;
  const labels = { allTime: 'All Time', h24: '24h', d7: '7 Days' };

  let html = `<div class="analytics-wrap slide-up"><div class="period-toggle">${Object.entries(labels).map(([k,v]) => `<div class="period-btn ${window.analyticsPeriod === k ? 'on' : ''}" onclick="setAnalyticsPeriod('${k}')">${v}</div>`).join('')}</div>`;

  if (!data) {
    html += '<div class="no-data">No outcomes recorded yet.<br>Outcomes are checked 1 hour after each signal fires.</div>';
  } else {
    html += `<div class="stat-grid">
      <div class="stat-card"><div class="stat-card-label">Hit Rate</div><div class="stat-card-val val-green" id="analyticsHR">—</div><div class="stat-card-sub">${data.total} checked</div></div>
      <div class="stat-card"><div class="stat-card-label">Hits</div><div class="stat-card-val val-green">${data.hits}</div></div>
      <div class="stat-card"><div class="stat-card-label">Misses</div><div class="stat-card-val val-red">${data.misses}</div></div>
      <div class="stat-card"><div class="stat-card-label">Pending</div><div class="stat-card-val val-accent">${data.pending}</div></div>
    </div>`;
    const typeColors = { catalyst: 'var(--accent)', fda_watchfile: 'var(--purple)', squeeze: 'var(--red)', ma: 'var(--amber)' };
    if (Object.keys(data.byType || {}).length) {
      html += '<div class="analytics-section"><div class="analytics-title">By Signal Type</div>';
      for (const [type, d] of Object.entries(data.byType)) html += `<div class="bar-row"><div class="bar-label">${type}</div><div class="bar-track"><div class="bar-fill" style="width:${d.pct}%;background:${typeColors[type] || 'var(--accent)'}"></div></div><div class="bar-pct" style="color:${typeColors[type] || 'var(--accent)'}">${d.pct}%</div><div class="bar-count">${d.total}</div></div>`;
      html += '</div>';
    }
    if (Object.keys(data.byUrgency || {}).length) {
      html += '<div class="analytics-section"><div class="analytics-title">By Confidence Tier</div>';
      const uc = { critical: 'var(--red)', high: 'var(--amber)', medium: 'var(--green)' };
      for (const [tier, d] of Object.entries(data.byUrgency)) {
        if (!d) continue;
        html += `<div class="bar-row"><div class="bar-label">${tier}</div><div class="bar-track"><div class="bar-fill" style="width:${d.pct}%;background:${uc[tier]}"></div></div><div class="bar-pct" style="color:${uc[tier]}">${d.pct}%</div><div class="bar-count">${d.total}</div></div>`;
      }
      html += '</div>';
    }
    const L = window._fdaLearningCache;
    if (L && L.totalResolved >= 3) {
      html += '<div class="analytics-section"><div class="analytics-title">FDA Learning Patterns</div>';
      for (const [ind, d] of Object.entries(L.byIndication)) {
        if (d.total < 2) continue;
        const pct = Math.round(d.correct / d.total * 100);
        const color = pct >= 60 ? 'var(--green)' : pct >= 40 ? 'var(--amber)' : 'var(--red)';
        html += `<div class="bar-row"><div class="bar-label">${ind}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div><div class="bar-pct" style="color:${color}">${pct}%</div><div class="bar-count">${d.total}</div></div>`;
      }
      if (L.patternNotes?.length) {
        html += '<div style="margin-top:10px">';
        L.patternNotes.slice(-5).forEach(p => html += `<div class="pattern-note">• ${p.note}</div>`);
        html += '</div>';
      }
      html += '</div>';
    }
    if (data.best || data.worst) {
      html += '<div class="analytics-section"><div class="analytics-title">Highlights</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
      if (data.best)  { const mv = ((data.best.checkPrice - data.best.basePrice) / data.best.basePrice * 100).toFixed(1); html += `<div class="highlight-card"><div class="highlight-label">🏆 Best</div><div class="highlight-ticker">${data.best.ticker}</div><div class="highlight-detail">+${mv}%<br>${data.best.catalyst}</div></div>`; }
      if (data.worst) { const mv = ((data.worst.checkPrice - data.worst.basePrice) / data.worst.basePrice * 100).toFixed(1); html += `<div class="highlight-card"><div class="highlight-label">⚠ Worst</div><div class="highlight-ticker">${data.worst.ticker}</div><div class="highlight-detail">${mv}%<br>${data.worst.catalyst}</div></div>`; }
      html += '</div></div>';
    }
    // Scan log section
    const scanLog = await loadScanLog(10);
    if (scanLog.length) {
      html += '<div class="analytics-section"><div class="analytics-title">Recent Scans</div>';
      scanLog.forEach(l => {
        const t = new Date(l.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
        const d = new Date(l.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const status = l.error ? `<span style="color:var(--red);font-size:9px">✗ ${l.error.slice(0, 40)}</span>` : `<span style="color:var(--green);font-size:9px">✓ ${l.signalCount} signal${l.signalCount !== 1 ? 's' : ''}</span>`;
        html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:10px"><span style="color:var(--muted);width:80px;flex-shrink:0">${d} ${t}</span><span style="color:var(--muted2);flex-shrink:0">${l.session || ''}</span>${status}</div>`;
      });
      html += '</div>';
    }
  }

  html += '</div>';
  detail.innerHTML = html;
  if (data) { const el = document.getElementById('analyticsHR'); if (el) animateCount(el, data.overall, '%'); }
};
window.setAnalyticsPeriod = p => { window.analyticsPeriod = p; window.renderAnalytics(); };

// ============================================================
//  LEARN TAB
// ============================================================
function renderLearn() {
  const sections = [
    { icon: '💊', title: 'What is the FDA?', body: `The Food and Drug Administration (FDA) is the U.S. government agency that approves drugs before they can be sold to the public. For investors, this matters enormously: a single FDA decision can move a small biotech stock 100–500% in a single day.\n\nThe FDA approves drugs through different pathways depending on the drug type and condition being treated. The most common are:\n\n• NDA (New Drug Application) — for new small-molecule drugs\n• BLA (Biologics License Application) — for biologics like antibodies\n• sNDA / sBLA — supplemental applications for new uses of existing drugs` },
    { icon: '📅', title: 'What is a PDUFA Date?', body: `PDUFA stands for Prescription Drug User Fee Act. Under this law, the FDA commits to making a decision on a drug application by a specific deadline — the PDUFA date.\n\nThis makes FDA decisions schedulable in advance. You can know weeks or months ahead of time that a biotech company will get a yes or no on a specific date. This is what makes FDA plays uniquely predictable compared to other catalysts.\n\nVERTEX tracks all upcoming PDUFA dates and monitors each company's stock, options activity, and insider buying as the date approaches.` },
    { icon: '🔥', title: 'What is a Short Squeeze?', body: `Short selling is when investors borrow a stock and sell it, hoping to buy it back cheaper later. A short squeeze happens when a heavily shorted stock gets a positive catalyst — short sellers rush to cover, driving the price up rapidly.\n\nThe ingredients for a squeeze: high short float (>20%), low float size (thin = easier to squeeze), and a positive catalyst. VERTEX screens for all three together.` },
    { icon: '📊', title: 'Float Size & Short Float', body: `Float shares is the number of shares available for public trading. Small float + positive catalyst = explosive move potential.\n\nShort float (or short interest %) is what fraction of the float is currently sold short. Above 20% is elevated. Above 30% is extreme and indicates a potential squeeze setup.` },
    { icon: '📈', title: 'What is Options Flow?', body: `Unusual options activity means someone is buying a large, unusual amount of calls or puts on a stock — often before news breaks. This is frequently a sign that informed money expects a significant move.\n\nWhen VERTEX detects unusual call buying on a stock with an upcoming FDA date, it significantly increases the confidence score.` },
    { icon: '📋', title: 'What is Insider Buying?', body: `Corporate insiders must report their stock purchases to the SEC via Form 4 filings within 2 business days. Insider buying — especially when multiple executives buy simultaneously — is a strong signal they believe the stock will go up.\n\nVERTEX monitors OpenInsider and SEC EDGAR for Form 4 filings on every watched stock.` },
    { icon: '📄', title: 'What is an 8-K Filing?', body: `An 8-K is a "current report" filed with the SEC when a material event occurs: FDA decisions, earnings, M&A, major contracts, executive changes, bankruptcy.\n\nSEC EDGAR publishes 8-K filings in a real-time RSS feed. VERTEX polls this feed on every scan to catch material events the moment they're filed.` },
    { icon: '🤝', title: 'What are M&A Signals?', body: `Mergers and acquisitions typically happen at a 20–50% premium to the current stock price. Signs of informed accumulation beforehand: unusual call options weeks before, insiders buying across multiple executives, activist investors disclosing large stakes (13D/13G filings), unexplained volume.\n\nVERTEX flags stocks showing 2 or more of these signals simultaneously.` },
    { icon: '🧠', title: 'How VERTEX Learns', body: `Every time a prediction is made and the outcome is recorded, VERTEX updates its learning model. It tracks accuracy by drug indication, company size, short float level, whether unusual options activity was present, and whether insider buying was present.\n\nAfter every 5 resolved predictions, Claude writes a pattern note that gets injected into future scans.` },
    { icon: '📖', title: 'Glossary', body: `PDUFA Date — FDA decision deadline, known in advance\nShort Float — % of float shares sold short\nFloat Shares — shares available for public trading\nForm 4 — SEC filing for insider stock transactions\n8-K — SEC filing for material corporate events\n13D/13G — SEC filings when investor acquires >5% stake\nNDA — New Drug Application (small molecule drugs)\nBLA — Biologics License Application (antibody drugs)\nCatalyst — an event that triggers a significant stock move\nBinary Event — outcome is one of two possibilities\nVolume Ratio — today's volume vs. average daily volume\nDilution Risk — company may issue new shares` },
  ];

  getDetail().innerHTML = `<div class="learn-wrap slide-up">
    <div class="learn-header"><div class="learn-title">VERTEX Knowledge Base</div><div class="learn-sub">Everything you need to understand what VERTEX tracks and why</div></div>
    ${sections.map((s, i) => `
      <div class="learn-card" onclick="toggleLearnCard(${i})">
        <div class="learn-card-header"><span class="learn-icon">${s.icon}</span><div class="learn-card-title">${s.title}</div><div class="learn-chevron" id="lc-chevron-${i}">▼</div></div>
        <div class="learn-card-body" id="lc-body-${i}" style="display:none">${s.body.replace(/\n\n/g,'</p><p>').replace(/^/,'<p>').replace(/$/,'</p>').replace(/\n• /g,'</p><li>').replace(/<\/p><li>/g,'</p><ul><li>').replace(/<li>([^<]*)<\/p>/g,'<li>$1</li>').replace(/<li>([^<]*)\n/g,'<li>$1</li>')}</div>
      </div>`).join('')}
  </div>`;
}

window.toggleLearnCard = i => {
  const body = document.getElementById(`lc-body-${i}`), chevron = document.getElementById(`lc-chevron-${i}`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (chevron) chevron.textContent = open ? '▼' : '▲';
};

// ============================================================
//  SETTINGS  (Phase 4/5: test key, pause toggle, scan log, theme fix)
// ============================================================
async function renderSettings() {
  const s = loadSettings(), apiKey = getApiKey(), isConn = !!apiKey;
  const meta = JSON.parse(localStorage.getItem(LS.SCAN_META) || '{}');
  const lastScan = meta.lastScan ? new Date(meta.lastScan).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : 'Never';
  const scanCount = meta.scanCount || 0;
  const fdaCount = (window._fdaCalendarCache || []).length;

  getDetail().innerHTML = `<div class="settings-wrap slide-up">

    <div class="settings-section"><div class="settings-label">API Connection</div>
      <div class="settings-card">
        <div class="settings-field"><div class="settings-field-label">Anthropic API Key</div>
          <input class="settings-input" id="apiKeyInput" type="password" placeholder="sk-ant-api03-••••••••" autocomplete="off" value="${isConn ? '••••••••••••••••••••' : ''}"/>
        </div>
        <div style="display:flex;gap:7px;margin-top:6px">
          <button class="btn-connect-full" id="connectBtn" onclick="connectFromSettings()" style="flex:1">${isConn ? '✓ Connected — update' : 'Connect'}</button>
          <button class="btn-secondary" onclick="testApiKey()" style="width:auto;padding:10px 14px;font-size:10px">Test Key</button>
        </div>
        <div class="connect-status" id="connectStatus">${isConn ? 'Connected.' : ''}</div>
        <div class="settings-meta" style="margin-top:10px">Model: <span>Haiku (scans) + Sonnet (discovery)</span> · Last scan: <span>${lastScan}</span> · Total: <span>${scanCount}</span></div>
        <div class="settings-hint">Get your key at <a href="https://console.anthropic.com" target="_blank" style="color:var(--accent)">console.anthropic.com</a>. Stored only on this device.</div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Scanning</div>
      <div class="settings-card">
        <div class="settings-field"><div class="settings-field-label">Scan Status</div>
          <div class="preset-group">
            <div class="preset-btn ${!s.scanPaused ? 'on' : ''}" onclick="updateSetting('scanPaused',false);renderSettings()">▶ Active</div>
            <div class="preset-btn ${s.scanPaused ? 'on' : ''}" onclick="updateSetting('scanPaused',true);renderSettings()">⏸ Paused</div>
          </div>
        </div>
        <div class="settings-hint">Pause stops all automatic scanning. Manual scan still works.</div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">FDA Watchfile</div>
      <div class="settings-card">
        <div class="settings-meta">Currently tracking: <span>${fdaCount} upcoming event${fdaCount !== 1 ? 's' : ''}</span></div>
        <button class="btn-secondary" style="margin-top:10px" onclick="refreshFDACalendarManual()">↺ Refresh FDA Calendar</button>
        <div class="settings-hint">FDA calendar refreshes automatically once per day. Manual refresh fetches latest PDUFA dates now.</div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Scan Modules</div>
      <div class="settings-card">
        ${[['fdaEnabled','Catalyst Scanner (FDA-aware)'],['squeezeEnabled','Short Squeeze Setup Scanner'],['maEnabled','M&A Accumulation Scanner']].map(([k,label]) => `
          <div class="settings-field"><div class="settings-field-label">${label}</div>
            <div class="preset-group">
              <div class="preset-btn ${s[k] !== false ? 'on' : ''}" onclick="updateSetting('${k}',true);renderSettings()">On</div>
              <div class="preset-btn ${s[k] === false ? 'on' : ''}" onclick="updateSetting('${k}',false);renderSettings()">Off</div>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Signal Filters</div>
      <div class="settings-card">
        <div class="settings-field"><div class="settings-field-label">Market cap range</div>
          <div class="preset-group">${MCAP_PRESETS.map(p => `<div class="preset-btn ${s.mcapPreset === p.id ? 'on' : ''}" onclick="updateSetting('mcapPreset','${p.id}');renderSettings()">${p.label}</div>`).join('')}</div>
        </div>
        <div class="settings-field"><div class="settings-field-label">Min confidence: <strong style="color:var(--accent)" id="confVal">${s.minConfidence}%</strong></div>
          <input class="settings-slider" type="range" min="40" max="95" step="5" value="${s.minConfidence}" oninput="document.getElementById('confVal').textContent=this.value+'%'" onchange="updateSetting('minConfidence',parseInt(this.value))"/>
        </div>
        <div class="settings-field"><div class="settings-field-label">Min move: <strong style="color:var(--accent)" id="moveVal">${s.minMove}%</strong></div>
          <input class="settings-slider" type="range" min="3" max="25" step="1" value="${s.minMove}" oninput="document.getElementById('moveVal').textContent=this.value+'%'" onchange="updateSetting('minMove',parseInt(this.value))"/>
        </div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Display</div>
      <div class="settings-card">
        <div class="settings-field"><div class="settings-field-label">Theme</div>
          <button class="btn-secondary" id="themeToggleBtn" onclick="toggleTheme();renderSettings()">${getTheme() === 'dark' ? '☀ Light Mode' : '☾ Dark Mode'}</button>
        </div>
        <div class="settings-field"><div class="settings-field-label">Accent color</div>
          <div class="color-group">${[['blue','#3EC9FF'],['green','#20E090'],['purple','#B06EFF'],['gold','#FFB020']].map(([name,hex]) => `<div class="color-swatch ${s.accentColor === name ? 'on' : ''}" onclick="updateSetting('accentColor','${name}');renderSettings()" title="${name}" style="background:${hex}"></div>`).join('')}</div>
        </div>
        <div class="settings-field"><div class="settings-field-label">Font size</div>
          <div class="preset-group">${['small','medium','large'].map(f => `<div class="preset-btn ${s.fontSize === f ? 'on' : ''}" onclick="updateSetting('fontSize','${f}');renderSettings()">${f.charAt(0).toUpperCase() + f.slice(1)}</div>`).join('')}</div>
        </div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Notifications</div>
      <div class="settings-card">
        <button class="btn-secondary" onclick="enableNotifications()">🔔 ${getSetting('notificationsEnabled') ? '✓ Notifications enabled' : 'Enable Notifications'}</button>
        <div class="settings-hint">Alerts for FDA decision day, critical signals, unusual options on watched stocks.</div>
      </div>
    </div>

    <div class="settings-section"><div class="settings-label">Data</div>
      <div class="settings-card">
        <button class="btn-danger" onclick="confirmClearData()">🗑 Clear all data</button>
        <button class="btn-secondary" style="margin-top:8px" onclick="confirmResetSettings()">↺ Reset settings</button>
        <div class="settings-hint" style="margin-top:8px">VERTEX v${VERTEX_VERSION} · IndexedDB storage · No backend</div>
      </div>
    </div>
  </div>`;

  const inp = document.getElementById('apiKeyInput');
  if (inp) inp.addEventListener('focus', () => { if (inp.value.startsWith('•')) inp.value = ''; });
}

window.connectFromSettings = () => {
  const inp = document.getElementById('apiKeyInput'); if (!inp) return;
  const val = inp.value.trim();
  if (!val || val.startsWith('•')) { const st = document.getElementById('connectStatus'); if (st) { st.textContent = 'Paste your API key first.'; st.style.color = 'var(--red)'; } return; }
  saveApiKey(val);
  const btn = document.getElementById('connectBtn'); if (btn) { btn.textContent = '✓ Connected'; btn.style.background = 'var(--green)'; btn.style.color = '#080a10'; }
  const st = document.getElementById('connectStatus'); if (st) { st.textContent = 'API key saved.'; st.style.color = 'var(--green)'; }
  haptic('medium');
};

window.refreshFDACalendarManual = async () => {
  showToast('Refreshing FDA calendar...', 'info');
  try {
    await fetchFDACalendar();
    showToast(`FDA calendar updated — ${(window._fdaCalendarCache || []).length} events`, 'success');
    if (typeof window.renderWatchfile === 'function') window.renderWatchfile();
  } catch (e) { showToast('Refresh failed: ' + e.message, 'error'); }
};

window.enableNotifications = async () => {
  const granted = await requestNotificationPermission();
  if (granted) { updateSetting('notificationsEnabled', true); showToast('Notifications enabled', 'success'); }
  else showToast('Permission denied — check browser settings', 'warn');
  renderSettings();
};

window.confirmClearData = async () => {
  const ok = await showConfirm('Clear ALL data including signals, watchfile, and portfolio? This cannot be undone.');
  if (!ok) return;
  await clearAllData(); showToast('All data cleared', 'success'); renderSettings();
};
window.confirmResetSettings = async () => {
  const ok = await showConfirm('Reset all settings to default?');
  if (!ok) return;
  resetSettings(); renderSettings(); showToast('Settings reset', 'success');
};

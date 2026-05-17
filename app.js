// ============================================================
//  SIGNAL — app.js  (Complete)
// ============================================================
'use strict';

// ── Storage Keys ─────────────────────────────────────────────
const API_KEY_STORAGE    = 'signal_api_key';
const SIGNALS_KEY        = 'signal_history';
const SETTINGS_KEY       = 'signal_settings';
const THEME_KEY          = 'signal_theme';
const SCAN_COUNT_KEY     = 'signal_scan_count';
const LAST_SCAN_KEY      = 'signal_last_scan';
const PINS_KEY           = 'signal_pins';
const NOTES_KEY          = 'signal_notes';
const ARCHIVE_KEY        = 'signal_archive';
const WATCHLIST_KEY      = 'signal_watchlist';
const PORTFOLIO_KEY      = 'signal_portfolio';
const PORTFOLIO_HIST_KEY = 'signal_portfolio_history';
const ONE_MONTH_MS       = 30 * 24 * 60 * 60 * 1000;
const OUTCOME_DELAY_MS   = 60 * 60 * 1000;
const HIT_THRESHOLD      = 5;

// ── Market Cap Presets ────────────────────────────────────────
const MCAP_PRESETS = [
  { label: '$50M – $500M',  id: 'micro',  min: 50,    max: 500   },
  { label: '$500M – $2B',   id: 'small',  min: 500,   max: 2000  },
  { label: '$2B – $10B',    id: 'mid',    min: 2000,  max: 10000 },
  { label: '$10B – $50B',   id: 'large',  min: 10000, max: 50000 },
  { label: 'All ($50M+)',   id: 'all',    min: 50,    max: 50000 }
];

// ── Market Hours Presets ──────────────────────────────────────
const HOURS_PRESETS = [
  { id: 'market',   label: 'Market Hours',   open: { h:9,  m:30 }, close: { h:16, m:0  }, allDays: false },
  { id: 'extended', label: 'Extended Hours', open: { h:4,  m:0  }, close: { h:20, m:0  }, allDays: false },
  { id: '24h',      label: '24 Hours',       open: { h:0,  m:0  }, close: { h:23, m:59 }, allDays: true  },
  { id: 'custom',   label: 'Custom',         open: null,            close: null,           allDays: false }
];

// ── Default Settings ─────────────────────────────────────────
const DEFAULT_SETTINGS = {
  scanInterval:    5,
  hoursPreset:     'market',
  marketOpenHour:  9,
  marketOpenMin:   30,
  marketCloseHour: 16,
  marketCloseMin:  0,
  catalysts:       { fda: true, earn: true, ma: true, short: true, k8: true, macro: true },
  minConfidence:   50,
  minMove:         5,
  mcapPreset:      'small',
  accentColor:     'blue',
  fontSize:        'medium',
  compactMode:     false,
  notifications:   false
};

// ── Runtime State ─────────────────────────────────────────────
let isScanning     = false;
let schedulerTimer = null;
let nextScanAt     = null;

// ============================================================
//  SETTINGS
// ============================================================
function loadSettings() {
  try { const raw = localStorage.getItem(SETTINGS_KEY); return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {} }
function getSetting(key) { return loadSettings()[key]; }
function updateSetting(key, val) { const s = loadSettings(); s[key] = val; saveSettings(s); applySettingsToApp(s); }

function getMcapPreset() {
  return MCAP_PRESETS.find(p => p.id === (getSetting('mcapPreset') || 'small')) || MCAP_PRESETS[1];
}

function getHoursPreset() {
  return HOURS_PRESETS.find(p => p.id === (getSetting('hoursPreset') || 'market')) || HOURS_PRESETS[0];
}

function applyHoursPreset(id) {
  const s = loadSettings();
  const preset = HOURS_PRESETS.find(p => p.id === id);
  if (!preset) return;
  s.hoursPreset = id;
  if (preset.open && preset.close) {
    s.marketOpenHour  = preset.open.h;
    s.marketOpenMin   = preset.open.m;
    s.marketCloseHour = preset.close.h;
    s.marketCloseMin  = preset.close.m;
  }
  saveSettings(s);
  applySettingsToApp(s);
}

function applySettingsToApp(s) {
  const colors = {
    blue:   { main:'#3EC9FF', dim:'rgba(62,201,255,.10)',   glow:'rgba(62,201,255,.20)'  },
    green:  { main:'#20E090', dim:'rgba(32,224,144,.10)',   glow:'rgba(32,224,144,.20)'  },
    purple: { main:'#B06EFF', dim:'rgba(176,110,255,.10)',  glow:'rgba(176,110,255,.20)' },
    gold:   { main:'#FFB020', dim:'rgba(255,176,32,.10)',   glow:'rgba(255,176,32,.20)'  }
  };
  const c = colors[s.accentColor] || colors.blue;
  document.documentElement.style.setProperty('--blue',      c.main);
  document.documentElement.style.setProperty('--blue-dim',  c.dim);
  document.documentElement.style.setProperty('--blue-glow', c.glow);
  const sizes = { small:'11px', medium:'13px', large:'15px' };
  document.documentElement.style.setProperty('--base-font', sizes[s.fontSize] || '13px');
  document.documentElement.setAttribute('data-compact', s.compactMode ? '1' : '0');
}

function resetSettings() { saveSettings({ ...DEFAULT_SETTINGS }); applySettingsToApp(DEFAULT_SETTINGS); applyTheme('dark'); }
function clearAllData() {
  [SIGNALS_KEY, PINS_KEY, NOTES_KEY, ARCHIVE_KEY, SCAN_COUNT_KEY, LAST_SCAN_KEY]
    .forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
}

// ============================================================
//  THEME
// ============================================================
function getTheme() { try { return localStorage.getItem(THEME_KEY) || 'dark'; } catch { return 'dark'; } }
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = t === 'dark' ? '☀ Switch to Light Mode' : '☾ Switch to Dark Mode';
}
function toggleTheme() { applyTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

// ============================================================
//  MARKET HOURS
// ============================================================
function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isMarketOpen() {
  const s = loadSettings();
  const preset = getHoursPreset();
  const et = getNowET();
  const day = et.getDay();

  // 24h preset scans all 7 days
  if (!preset.allDays && (day === 0 || day === 6)) return false;

  const mins  = et.getHours() * 60 + et.getMinutes();
  const open  = (s.marketOpenHour  || 9)  * 60 + (s.marketOpenMin  || 30);
  const close = (s.marketCloseHour || 16) * 60 + (s.marketCloseMin || 0);

  // 24h preset: always open on valid days
  if (preset.id === '24h') return true;

  return mins >= open && mins < close;
}

function msUntilNextMarketOpen() {
  const s = loadSettings();
  const preset = getHoursPreset();
  const et = getNowET();
  const day = et.getDay();
  const sec = et.getHours() * 3600 + et.getMinutes() * 60 + et.getSeconds();
  const openSec  = (s.marketOpenHour  || 9)  * 3600 + (s.marketOpenMin  || 30) * 60;
  const closeSec = (s.marketCloseHour || 16) * 3600 + (s.marketCloseMin || 0)  * 60;

  if (preset.id === '24h') return 0; // always open

  let daysAhead = 0;
  if (day === 6) daysAhead = 2;
  else if (day === 0) daysAhead = 1;
  else if (sec >= closeSec) daysAhead = (day === 5) ? 3 : 1;

  const su = daysAhead === 0
    ? openSec - sec
    : (86400 - sec) + (daysAhead - 1) * 86400 + openSec;
  return Math.max(0, su * 1000);
}

function formatTime12(h, m) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ============================================================
//  HAPTIC FEEDBACK
// ============================================================
function haptic(type = 'light') {
  if (!navigator.vibrate) return;
  const patterns = { light: [10], medium: [20], heavy: [30, 10, 30], signal: [50, 30, 50, 30, 100] };
  navigator.vibrate(patterns[type] || patterns.light);
}

// ============================================================
//  PWA BADGE
// ============================================================
async function setBadge(count) {
  try {
    if ('setAppBadge' in navigator) {
      if (count > 0) await navigator.setAppBadge(count);
      else await navigator.clearAppBadge();
    }
  } catch (_) {}
}

// ============================================================
//  LOCK
// ============================================================
function acquireScanLock() {
  try {
    const raw = localStorage.getItem('signal_scan_lock');
    if (raw) { const l = JSON.parse(raw); if (Date.now() - l.ts < 90000) return false; }
    localStorage.setItem('signal_scan_lock', JSON.stringify({ ts: Date.now() }));
    return true;
  } catch { return true; }
}
function releaseScanLock() { try { localStorage.removeItem('signal_scan_lock'); } catch (_) {} }

// ============================================================
//  API KEY
// ============================================================
function getApiKey() { try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch { return ''; } }

// ============================================================
//  SCHEDULER
// ============================================================
function calcNextScanTime() {
  const interval = (getSetting('scanInterval') || 5) * 60 * 1000;
  return isMarketOpen()
    ? new Date(Date.now() + interval)
    : new Date(Date.now() + msUntilNextMarketOpen());
}

function startScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (!nextScanAt) nextScanAt = calcNextScanTime();
  schedulerTimer = setInterval(() => {
    const msLeft = nextScanAt - Date.now();
    updateCountdownDisplay(msLeft);
    updateMarketStatusDisplay();
    if (msLeft <= 30000 && msLeft > 0 && !isScanning && isMarketOpen()) triggerScan({ isPreload: true });
    if (msLeft <= 0 && !isScanning) { nextScanAt = calcNextScanTime(); if (isMarketOpen()) triggerScan(); }
  }, 500);
}

// ============================================================
//  TRIGGER SCAN
// ============================================================
async function triggerScan({ isPreload = false, isManual = false } = {}) {
  if (isScanning) return;
  const apiKey = getApiKey();
  if (!apiKey) { showScanError('Enter your API key in Settings first.'); return; }
  if (!isManual && !isMarketOpen()) { nextScanAt = calcNextScanTime(); return; }
  if (!acquireScanLock()) return;

  isScanning = true;
  setScanningState(true, isPreload);
  try {
    await runScan(apiKey);
    try { localStorage.setItem(LAST_SCAN_KEY, new Date().toISOString()); } catch (_) {}
    try { localStorage.setItem(SCAN_COUNT_KEY, String((parseInt(localStorage.getItem(SCAN_COUNT_KEY) || '0')) + 1)); } catch (_) {}
    if (!isManual) nextScanAt = calcNextScanTime();
  } catch (err) {
    console.error('[SIGNAL]', err);
    showScanError(err.message || 'Scan failed — will retry.');
  } finally {
    isScanning = false;
    releaseScanLock();
    setScanningState(false);
  }
}

function triggerManualScan() { haptic('medium'); triggerScan({ isManual: true }); }

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resyncScheduler(); });
window.addEventListener('pageshow', resyncScheduler);
window.addEventListener('focus', resyncScheduler);

function resyncScheduler() {
  if (nextScanAt && Date.now() > nextScanAt) {
    nextScanAt = calcNextScanTime();
    if (isMarketOpen() && !isScanning) triggerScan();
  }
  startScheduler();
}

// ============================================================
//  PULL TO REFRESH
// ============================================================
function initPullToRefresh() {
  let startY = 0, pulling = false;
  const detail = document.getElementById('detailArea');
  if (!detail) return;

  detail.addEventListener('touchstart', e => {
    if (detail.scrollTop === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });

  detail.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 60) {
      const ind = document.getElementById('pullIndicator');
      if (ind) ind.style.opacity = '1';
    }
  }, { passive: true });

  detail.addEventListener('touchend', e => {
    if (!pulling) return;
    pulling = false;
    const dy = e.changedTouches[0].clientY - startY;
    const ind = document.getElementById('pullIndicator');
    if (ind) ind.style.opacity = '0';
    if (dy > 60) { haptic('light'); triggerManualScan(); }
  });
}

// ============================================================
//  UI HELPERS
// ============================================================
function pad(n) { return String(n).padStart(2, '0'); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function updateCountdownDisplay(msLeft) {
  const ms = isMarketOpen() ? Math.max(0, msLeft) : msUntilNextMarketOpen();
  const tot = Math.floor(ms / 1000);
  const hh = Math.floor(tot / 3600), mm = Math.floor((tot % 3600) / 60), ss = tot % 60;
  const str = hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  setText('countdown', str); setText('countdown-mobile', str);
}

function updateMarketStatusDisplay() {
  const el = document.getElementById('marketStatus');
  if (!el) return;
  el.innerHTML = isMarketOpen()
    ? '<span class="stat-dot dot-green"></span> Market Open'
    : '<span class="stat-dot dot-amber"></span> Market Closed';
}

function setScanningState(scanning, isPreload = false) {
  const btn = document.getElementById('scanBtn');
  if (btn) { btn.disabled = scanning; btn.textContent = scanning ? (isPreload ? '⟳ Preparing...' : '⟳ Scanning...') : '▶ Scan Now'; }
  setText('scanStatus', scanning ? 'Scanning 12 sources...' : '');
}

function showScanError(msg) {
  const el = document.getElementById('scanStatus');
  if (el) { el.textContent = `⚠ ${msg}`; el.style.color = 'var(--red)'; setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 8000); }
}

// ── Skeleton loader ───────────────────────────────────────────
function skeletonHTML(rows = 3) {
  return Array.from({ length: rows }, () =>
    `<div class="skeleton-row"><div class="skeleton-ticker skel"></div><div class="skeleton-body skel"></div><div class="skeleton-badge skel"></div></div>`
  ).join('');
}

// ── Count-up animation ────────────────────────────────────────
function animateCount(el, target, suffix = '', duration = 800) {
  if (!el) return;
  const start = 0;
  const step  = target / (duration / 16);
  let   cur   = start;
  const timer = setInterval(() => {
    cur = Math.min(cur + step, target);
    el.textContent = parseFloat(cur.toFixed(1)) + suffix;
    if (cur >= target) clearInterval(timer);
  }, 16);
}

// ============================================================
//  NOTIFICATIONS + HAPTIC ON NEW SIGNAL
// ============================================================
async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

function fireNotification(signals) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  signals.forEach(s => {
    const emoji = s.urgency === 'critical' ? '⚡' : s.urgency === 'high' ? '▲' : '●';
    const n = new Notification(`${emoji} ${s.ticker} — SIGNAL`, {
      body: `${s.move >= 0 ? '+' : ''}${s.move}% · ${s.catalyst} · ${s.headline.slice(0, 80)}`,
      icon: '/icon-192.png', tag: `signal-${s.id}`, requireInteraction: s.urgency === 'critical'
    });
    n.onclick = () => { window.focus(); n.close(); };
  });
}

// ============================================================
//  PINS, NOTES, ARCHIVE
// ============================================================
function getPins()      { try { return JSON.parse(localStorage.getItem(PINS_KEY)    || '[]'); } catch { return []; } }
function getNotes()     { try { return JSON.parse(localStorage.getItem(NOTES_KEY)   || '{}'); } catch { return {}; } }
function getArchive()   { try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]'); } catch { return []; } }
function savePins(p)    { try { localStorage.setItem(PINS_KEY,    JSON.stringify(p)); } catch (_) {} }
function saveNotes(n)   { try { localStorage.setItem(NOTES_KEY,   JSON.stringify(n)); } catch (_) {} }
function saveArchive(a) { try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(a)); } catch (_) {} }
function isPinned(id)   { return getPins().includes(id); }
function isArchived(id) { return getArchive().includes(id); }
function togglePin(id)  { const p = getPins(); const i = p.indexOf(id); i === -1 ? p.push(id) : p.splice(i, 1); savePins(p); }
function archiveSignal(id) { const a = getArchive(); if (!a.includes(id)) a.push(id); saveArchive(a); }
function getNote(id)    { return getNotes()[id] || ''; }
function saveNote(id, text) { const n = getNotes(); text.trim() ? n[id] = text.trim() : delete n[id]; saveNotes(n); }

// ============================================================
//  WATCHLIST
// ============================================================
function loadWatchlist() { try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]'); } catch { return []; } }
function saveWatchlist(w) { try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(w)); } catch (_) {} }

function addToWatchlist(ticker) {
  const w = loadWatchlist(), t = ticker.toUpperCase().trim();
  if (!t || !/^[A-Z]{1,5}$/.test(t) || w.find(x => x.ticker === t)) return false;
  w.push({ ticker: t, addedAt: new Date().toISOString(), addedPrice: null });
  saveWatchlist(w); return true;
}
function removeFromWatchlist(ticker) { saveWatchlist(loadWatchlist().filter(x => x.ticker !== ticker.toUpperCase())); }
function isOnWatchlist(ticker) { return !!loadWatchlist().find(x => x.ticker === ticker.toUpperCase()); }

async function fetchWatchlistNews(ticker, apiKey) {
  if (!apiKey) return [];
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 600,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
        messages: [{ role: 'user', content: `Find up to 3 recent news headlines about ${ticker} stock today. Return ONLY a JSON array, no markdown: [{"headline":"...","source":"...","url":"...","time":"..."}]. Return [] if nothing found.` }]
      })
    });
    if (!res.ok) return [];
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const a = text.indexOf('['), z = text.lastIndexOf(']');
    if (a === -1 || z < a) return [];
    return JSON.parse(text.slice(a, z + 1));
  } catch { return []; }
}

// ============================================================
//  AI SEARCH
// ============================================================
async function aiSearch(query, apiKey) {
  if (!apiKey || !query.trim()) return null;
  const all = loadSignals();
  if (!all.length) return { signals: [], explanation: 'No signals in history yet.' };

  const summary = all.slice(0, 50).map(s =>
    `${s.id}|${s.ticker}|${s.urgency}|${s.catalyst}|${s.move}%|${s.confidence}%|${s.outcome}|${new Date(s.scannedAt).toLocaleDateString()}`
  ).join('\n');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: 600,
        messages: [{ role: 'user', content: `You are a stock signal search assistant. The user is searching their signal history.\n\nUser query: "${query}"\n\nSignal history (id|ticker|urgency|catalyst|move|confidence|outcome|date):\n${summary}\n\nReturn ONLY a JSON object, no markdown:\n{"ids":["list of matching signal ids"],"explanation":"one short sentence explaining what you found"}\n\nMatch based on ticker name, catalyst type, urgency, outcome, move size, or date. Return up to 10 best matches.` }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const a = text.indexOf('{'), z = text.lastIndexOf('}');
    if (a === -1 || z < a) return null;
    const parsed = JSON.parse(text.slice(a, z + 1));
    const matched = all.filter(s => (parsed.ids || []).includes(s.id));
    return { signals: matched, explanation: parsed.explanation || '' };
  } catch { return null; }
}

// ============================================================
//  PORTFOLIO
// ============================================================
function loadPortfolio() {
  try { return JSON.parse(localStorage.getItem(PORTFOLIO_KEY) || '{"positions":[],"cashBalance":0}'); }
  catch { return { positions: [], cashBalance: 0 }; }
}
function savePortfolio(p) { try { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(p)); } catch (_) {} }
function loadPortfolioHistory() { try { return JSON.parse(localStorage.getItem(PORTFOLIO_HIST_KEY) || '[]'); } catch { return []; } }
function savePortfolioHistory(h) { try { localStorage.setItem(PORTFOLIO_HIST_KEY, JSON.stringify(h)); } catch (_) {} }

function addPosition(ticker, shares, buyPrice) {
  const p = loadPortfolio(), t = ticker.toUpperCase().trim();
  const existing = p.positions.find(x => x.ticker === t);
  if (existing) {
    const total = existing.shares + shares;
    existing.buyPrice = parseFloat(((existing.shares * existing.buyPrice + shares * buyPrice) / total).toFixed(4));
    existing.shares   = total;
  } else {
    p.positions.push({ ticker: t, shares: parseFloat(shares), buyPrice: parseFloat(buyPrice), addedAt: new Date().toISOString() });
  }
  savePortfolio(p); snapshotPortfolio();
}

function removePosition(ticker) {
  const p = loadPortfolio();
  p.positions = p.positions.filter(x => x.ticker !== ticker.toUpperCase());
  savePortfolio(p);
}

function updatePortfolioCash(amount) { const p = loadPortfolio(); p.cashBalance = parseFloat(amount) || 0; savePortfolio(p); }

async function snapshotPortfolio() {
  const p = loadPortfolio(); if (!p.positions.length) return;
  const prices = await Promise.allSettled(p.positions.map(x => fetchStockPrice(x.ticker)));
  let total = p.cashBalance || 0;
  p.positions.forEach((pos, i) => {
    const pr = prices[i].status === 'fulfilled' ? prices[i].value : null;
    total += pr ? pos.shares * pr : pos.shares * pos.buyPrice;
  });
  const hist = loadPortfolioHistory();
  hist.push({ t: Date.now(), v: parseFloat(total.toFixed(2)) });
  savePortfolioHistory(hist.filter(h => h.t > Date.now() - 90 * 24 * 60 * 60 * 1000));
}

function isInPortfolio(ticker) { return !!loadPortfolio().positions.find(x => x.ticker === ticker.toUpperCase()); }
function getPosition(ticker) { return loadPortfolio().positions.find(x => x.ticker === ticker.toUpperCase()) || null; }

// ============================================================
//  PORTFOLIO ALERT BANNER
// ============================================================
function showPortfolioAlertBanner(signals) {
  const portfolio = loadPortfolio();
  const tickers   = new Set(portfolio.positions.map(x => x.ticker));
  const matches   = signals.filter(s => tickers.has(s.ticker));
  if (!matches.length) return;

  matches.forEach(s => {
    const pos = getPosition(s.ticker);
    const banner = document.createElement('div');
    banner.className = 'portfolio-alert-banner';
    banner.innerHTML = `
      <div class="pab-icon">💼</div>
      <div class="pab-body">
        <div class="pab-title">Signal fired for ${s.ticker} — you own ${pos.shares} shares</div>
        <div class="pab-sub">${s.move >= 0 ? '+' : ''}${s.move}% · ${s.catalyst} · ${s.headline.slice(0, 60)}...</div>
      </div>
      <button class="pab-view" onclick="selectSignal('${s.id}');this.parentElement.remove()">View →</button>
      <button class="pab-close" onclick="this.parentElement.remove()">✕</button>`;
    document.body.appendChild(banner);
    setTimeout(() => { banner.style.opacity = '0'; setTimeout(() => banner.remove(), 400); }, 8000);
  });

  haptic('signal');
}

// ============================================================
//  PORTFOLIO P&L COLOR
// ============================================================
async function updatePortfolioPnlHeader() {
  const p = loadPortfolio();
  if (!p.positions.length) return;
  const prices = await Promise.allSettled(p.positions.map(x => fetchStockPrice(x.ticker)));
  let curVal = p.cashBalance || 0, costVal = p.cashBalance || 0;
  p.positions.forEach((pos, i) => {
    const pr = prices[i].status === 'fulfilled' ? prices[i].value : null;
    curVal  += pr ? pos.shares * pr : pos.shares * pos.buyPrice;
    costVal += pos.shares * pos.buyPrice;
  });
  const gl = curVal - costVal;
  const tab = document.querySelector('[data-tab="portfolio"]');
  if (tab) {
    tab.style.color = gl >= 0 ? 'var(--green)' : 'var(--red)';
    tab.style.borderBottomColor = gl >= 0 ? 'var(--green)' : 'var(--red)';
  }
}

// ============================================================
//  CLAUDE PROMPT
// ============================================================
const BASE_SYSTEM_PROMPT = `You are an expert stock market signal scanner identifying stocks with potential for large single-day price moves.

RULES:
- Only return signals with a REAL verifiable source URL you actually found
- Never return long-term thesis plays
- Never pad — return [] if nothing qualifies
- Reject catalysts older than 4 hours
- Short squeezes require >15% short float AND confirmed unusual options activity

CONFIDENCE:
85-100 = Hard binary catalyst + volume confirmation → urgency: critical
70-84  = Strong catalyst, partial confirmation      → urgency: high
50-69  = Developing situation                       → urgency: medium
Below user minimum = DO NOT RETURN

SOURCES (search in order):
1. SEC EDGAR (sec.gov) 2. Benzinga (benzinga.com) 3. Finviz (finviz.com)
4. PR Newswire (prnewswire.com) 5. BusinessWire (businesswire.com)
6. Seeking Alpha (seekingalpha.com) 7. StockAnalysis (stockanalysis.com)
8. OTC Markets (otcmarkets.com) 9. MarketWatch (marketwatch.com)
10. Reuters (reuters.com) 11. Motley Fool (fool.com) 12. Yahoo Finance (finance.yahoo.com)

Return ONLY a raw JSON array. No markdown. No explanation.

Each signal MUST have ALL fields:
{"ticker":"","company":"","urgency":"critical|high|medium","move":0,"volume":"","confidence":0,"upside":"","marketCap":"","time":"","headline":"","catalyst":"","catalystTag":"tag-fda|tag-earn|tag-ma|tag-short|tag-8k|tag-macro","reasoning":"","sources":[{"pub":"","icon":"","time":"","headline":"","url":""}]}

If nothing qualifies: []`;

function buildSystemPrompt() {
  const s = loadSettings(), mc = getMcapPreset();
  const enabled = Object.entries(s.catalysts || {}).filter(([, v]) => v).map(([k]) => k === 'k8' ? 'tag-8k' : `tag-${k}`);
  const watchlist = loadWatchlist().map(x => x.ticker);
  return BASE_SYSTEM_PROMPT
    + `\n\nUSER SETTINGS:\n`
    + `- Market cap: $${mc.min >= 1000 ? (mc.min / 1000) + 'B' : mc.min + 'M'} to $${mc.max >= 1000 ? (mc.max / 1000) + 'B' : mc.max + 'M'}\n`
    + `- Min confidence: ${s.minConfidence || 50}%\n`
    + `- Min move: ${s.minMove || 5}%+\n`
    + `- Enabled catalysts: ${enabled.join(', ')}\n`
    + (watchlist.length ? `- PRIORITY WATCHLIST (pay extra attention to these tickers): ${watchlist.join(', ')}\n` : '');
}

function buildUserPrompt() {
  const et = getNowET(), s = loadSettings(), mc = getMcapPreset();
  const t = et.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const d = et.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `Current time: ${t} ET, ${d}\n\nSearch all 12 sources for stocks $${mc.min >= 1000 ? (mc.min / 1000) + 'B' : mc.min + 'M'} to $${mc.max >= 1000 ? (mc.max / 1000) + 'B' : mc.max + 'M'} market cap with hard catalysts confirmed in the last 4 hours.\n\nMin confidence: ${s.minConfidence || 50}%. Min move: ${s.minMove || 5}%.\n\nReturn [] if nothing qualifies.`;
}

// ============================================================
//  CLAUDE API
// ============================================================
async function callClaude(apiKey, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4000, system: buildSystemPrompt(), tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }], messages: [{ role: 'user', content: userPrompt }] })
  });
  if (!res.ok) { const b = await res.text(); throw new Error(`Claude API ${res.status}: ${b}`); }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// ============================================================
//  PARSER
// ============================================================
function parseSignals(raw) {
  if (!raw) return [];
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('['), z = s.lastIndexOf(']');
  if (a === -1 || z < a) return [];
  let parsed; try { parsed = JSON.parse(s.slice(a, z + 1)); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(validateSignal).filter(Boolean);
}

function validateSignal(r) {
  if (!r || typeof r !== 'object') return null;
  const ticker = String(r.ticker || '').toUpperCase().trim();
  if (!/^[A-Z]{1,5}$/.test(ticker)) return null;
  for (const f of ['company', 'headline', 'reasoning', 'sources']) if (!r[f]) return null;
  const sources = (Array.isArray(r.sources) ? r.sources : [])
    .filter(s => { if (!s?.url) return false; try { new URL(s.url); return true; } catch { return false; } })
    .map(s => ({ pub: String(s.pub || '').trim(), icon: String(s.icon || '📰').trim(), time: String(s.time || '').trim(), headline: String(s.headline || '').trim(), url: String(s.url).trim() }));
  if (!sources.length) return null;
  const confidence = Math.min(100, Math.max(50, parseInt(r.confidence) || 50));
  if (confidence < (getSetting('minConfidence') || 50)) return null;
  let urgency = r.urgency;
  if (!['critical', 'high', 'medium'].includes(urgency)) urgency = confidence >= 85 ? 'critical' : confidence >= 70 ? 'high' : 'medium';
  const validTags = ['tag-fda', 'tag-earn', 'tag-ma', 'tag-short', 'tag-8k', 'tag-macro'];
  const catalystTag = validTags.includes(r.catalystTag) ? r.catalystTag : 'tag-macro';
  const defaultTime = getNowET().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  return {
    id: `${ticker}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ticker, company: String(r.company || '').trim(), urgency,
    move: parseFloat(r.move) || 0, volume: String(r.volume || '—').trim(),
    confidence, upside: String(r.upside || '—').trim(), marketCap: String(r.marketCap || '—').trim(),
    time: String(r.time || defaultTime).trim(), headline: String(r.headline || '').trim(),
    catalyst: String(r.catalyst || 'Unknown').trim(), catalystTag,
    reasoning: String(r.reasoning || '').trim(), sources,
    scannedAt: new Date().toISOString(),
    outcome: 'pending', outcomeMsg: 'Outcome check available 1 hour after signal.',
    basePrice: null, checkPrice: null
  };
}

// ============================================================
//  PRICE FETCHING
// ============================================================
async function fetchStockPrice(ticker) {
  const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
  const proxies = [`https://corsproxy.io/?${encodeURIComponent(yUrl)}`, `https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json();
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      if (!Array.isArray(closes)) continue;
      for (let i = closes.length - 1; i >= 0; i--) if (closes[i] != null) return parseFloat(closes[i].toFixed(4));
    } catch (e) { console.warn(`[SIGNAL] Price proxy failed (${ticker}):`, e.message); }
  }
  return null;
}

async function fetchOHLCV(ticker, range = '1d', interval = '5m') {
  const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  const proxy = `https://corsproxy.io/?${encodeURIComponent(yUrl)}`;
  try {
    const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.chart?.result?.[0]; if (!r) return null;
    const ts = r.timestamp || [], q = r.indicators?.quote?.[0] || {};
    return ts.map((t, i) => q.open[i] == null ? null : { t: t * 1000, o: +(q.open[i] || 0).toFixed(4), h: +(q.high[i] || 0).toFixed(4), l: +(q.low[i] || 0).toFixed(4), c: +(q.close[i] || 0).toFixed(4), v: q.volume[i] || 0 }).filter(Boolean);
  } catch { return null; }
}

async function fetchBasePrice(signal) {
  const price = await fetchStockPrice(signal.ticker);
  if (price !== null) {
    updateSignalInStorage(signal.id, { basePrice: price });
    const w = loadWatchlist(), wi = w.find(x => x.ticker === signal.ticker);
    if (wi && !wi.addedPrice) { wi.addedPrice = price; saveWatchlist(w); }
  }
}

// ============================================================
//  OUTCOME TRACKER
// ============================================================
async function checkOutcome(signalId) {
  const all = loadSignals(), signal = all.find(s => s.id === signalId);
  if (!signal || signal.outcome !== 'pending') return;
  setOutcomeBtnState(signalId, 'loading');
  const current = await fetchStockPrice(signal.ticker);
  if (current === null) { updateSignalInStorage(signalId, { outcome: 'unverified', outcomeMsg: `Price unavailable — verify at finance.yahoo.com/quote/${signal.ticker}` }); refreshDetailIfActive(signalId); return; }
  if (!signal.basePrice) { updateSignalInStorage(signalId, { outcome: 'unverified', outcomeMsg: `Base price not recorded. Current: $${current}`, checkPrice: current }); refreshDetailIfActive(signalId); return; }
  const actual = parseFloat((((current - signal.basePrice) / signal.basePrice) * 100).toFixed(2));
  const isHit = (signal.move >= 0 ? actual >= 0 : actual <= 0) && Math.abs(actual) >= HIT_THRESHOLD;
  updateSignalInStorage(signalId, { outcome: isHit ? 'hit' : 'miss', outcomeMsg: `${signal.move >= 0 ? '+' : ''}${signal.move}% signal → ${actual >= 0 ? '+' : ''}${actual}% actual. ${isHit ? 'HIT ✓' : 'MISS ✗'} (Base $${signal.basePrice} → Now $${current})`, checkPrice: current });
  refreshDetailIfActive(signalId);
  if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
}

function isOutcomeCheckReady(signal) { return signal.outcome === 'pending' && Date.now() - new Date(signal.scannedAt).getTime() >= OUTCOME_DELAY_MS; }
function setOutcomeBtnState(id, state) { const btn = document.getElementById(`outcome-btn-${id}`); if (btn && state === 'loading') { btn.textContent = '⟳ Checking...'; btn.disabled = true; } }

// ============================================================
//  STORAGE
// ============================================================
function saveSignals(signals) {
  const cutoff = Date.now() - ONE_MONTH_MS;
  const trimmed = signals.filter(s => new Date(s.scannedAt).getTime() > cutoff);
  try { localStorage.setItem(SIGNALS_KEY, JSON.stringify(trimmed)); }
  catch { try { localStorage.setItem(SIGNALS_KEY, JSON.stringify(trimmed.slice(0, Math.floor(trimmed.length * 0.8)))); } catch (_) {} }
}
function loadSignals() { try { const raw = localStorage.getItem(SIGNALS_KEY); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a : []; } catch { return []; } }
function updateSignalInStorage(id, updates) { const all = loadSignals(); const idx = all.findIndex(s => s.id === id); if (idx !== -1) { all[idx] = { ...all[idx], ...updates }; saveSignals(all); } }

// ============================================================
//  SIGNAL FILTERS
// ============================================================
function getSignalsToday() { const today = getNowET().toDateString(); return loadSignals().filter(s => !isArchived(s.id) && new Date(s.scannedAt).toDateString() === today); }
function getSignalsLast24h() { const cut = Date.now() - 86400000; return loadSignals().filter(s => !isArchived(s.id) && new Date(s.scannedAt).getTime() > cut); }
function getSignalsLast7d() { const cut = Date.now() - 7 * 86400000; return loadSignals().filter(s => new Date(s.scannedAt).getTime() > cut); }
function getSignalsLast30d() { return loadSignals(); }
function getSignalsFor24hTab() {
  const et = getNowET(), day = et.getDay();
  if (day === 6 || day === 0) {
    const db = day === 6 ? 1 : 2, fs = new Date(et); fs.setDate(fs.getDate() - db); fs.setHours(0, 0, 0, 0);
    const fe = new Date(fs); fe.setHours(23, 59, 59, 999);
    return loadSignals().filter(s => { const t = new Date(s.scannedAt).getTime(); return t >= fs.getTime() && t <= fe.getTime(); });
  }
  return getSignalsLast24h();
}
function getSortedTodaySignals() {
  const pins = getPins(), sigs = getSignalsToday(), order = { critical: 0, high: 1, medium: 2 };
  return [...sigs.filter(s => pins.includes(s.id)), ...sigs.filter(s => !pins.includes(s.id))].sort((a, b) => order[a.urgency] - order[b.urgency]);
}

// ============================================================
//  DEDUPLICATION
// ============================================================
function deduplicateSignals(newSignals, existing) {
  const cut = Date.now() - 30 * 60 * 1000;
  const recent = new Set(existing.filter(s => new Date(s.scannedAt).getTime() > cut).map(s => s.ticker));
  return newSignals.filter(s => !recent.has(s.ticker));
}

// ============================================================
//  ANALYTICS
// ============================================================
function calcAccuracy(signals) {
  const checked = signals.filter(s => s.outcome === 'hit' || s.outcome === 'miss');
  if (!checked.length) return null;
  const hits = checked.filter(s => s.outcome === 'hit').length;
  const overall = parseFloat(((hits / checked.length) * 100).toFixed(1));
  const byUrgency = {};
  for (const tier of ['critical', 'high', 'medium']) { const t = checked.filter(s => s.urgency === tier); byUrgency[tier] = t.length ? { pct: parseFloat(((t.filter(s => s.outcome === 'hit').length / t.length) * 100).toFixed(1)), total: t.length } : null; }
  const byCatalyst = {};
  for (const cat of [...new Set(checked.map(s => s.catalyst))]) { const c = checked.filter(s => s.catalyst === cat); byCatalyst[cat] = { pct: parseFloat(((c.filter(s => s.outcome === 'hit').length / c.length) * 100).toFixed(1)), total: c.length }; }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDay = {};
  for (let d = 0; d < 7; d++) { const ds = checked.filter(s => new Date(s.scannedAt).getDay() === d); if (ds.length) byDay[days[d]] = { pct: parseFloat(((ds.filter(s => s.outcome === 'hit').length / ds.length) * 100).toFixed(1)), total: ds.length }; }
  const byHourMap = {};
  for (const s of checked) { const h = new Date(new Date(s.scannedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours(); if (!byHourMap[h]) byHourMap[h] = { hits: 0, total: 0 }; byHourMap[h].total++; if (s.outcome === 'hit') byHourMap[h].hits++; }
  const byHour = {}; for (const [h, v] of Object.entries(byHourMap)) byHour[h] = { pct: parseFloat(((v.hits / v.total) * 100).toFixed(1)), total: v.total };
  const movePct = s => s.basePrice && s.checkPrice ? Math.abs(((s.checkPrice - s.basePrice) / s.basePrice) * 100) : null;
  const avg = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
  const withActual = checked.filter(s => s.basePrice && s.checkPrice);
  const sorted = withActual.slice().sort((a, b) => { const am = ((a.checkPrice - a.basePrice) / a.basePrice) * 100, bm = ((b.checkPrice - b.basePrice) / b.basePrice) * 100; return bm - am; });
  const best = sorted[0] || null, worst = sorted[sorted.length - 1] || null;
  const withPred = checked.filter(s => s.move && s.basePrice && s.checkPrice);
  let trend = null;
  if (checked.length >= 6) { const half = Math.floor(checked.length / 2); const r1 = checked.slice(half).filter(s => s.outcome === 'hit').length / (checked.length - half) * 100; const r2 = checked.slice(0, half).filter(s => s.outcome === 'hit').length / half * 100; trend = parseFloat((r2 - r1).toFixed(1)); }
  return { overall, total: checked.length, hits, misses: checked.length - hits, pending: signals.filter(s => s.outcome === 'pending').length, byUrgency, byCatalyst, byDay, byHour, avgHitMove: avg(checked.filter(s => s.outcome === 'hit' && movePct(s) != null).map(movePct)), avgMissMove: avg(checked.filter(s => s.outcome === 'miss' && movePct(s) != null).map(movePct)), avgPredicted: avg(withPred.map(s => Math.abs(s.move))), avgActual: avg(withPred.map(s => Math.abs(((s.checkPrice - s.basePrice) / s.basePrice) * 100))), best, worst, trend };
}

function getAnalytics() { return { allTime: calcAccuracy(loadSignals()), today: calcAccuracy(getSignalsToday()), h24: calcAccuracy(getSignalsLast24h()), d7: calcAccuracy(getSignalsLast7d()), d30: calcAccuracy(getSignalsLast30d()) }; }

// ============================================================
//  CSV EXPORT
// ============================================================
function exportCSV(signals) {
  const h = ['Ticker', 'Company', 'Date', 'Time', 'Urgency', 'Catalyst', 'Move%', 'Confidence', 'Upside', 'MarketCap', 'Outcome', 'BasePrice', 'CheckPrice', 'Headline'];
  const rows = signals.map(s => [s.ticker, `"${(s.company || '').replace(/"/g, '""')}"`, new Date(s.scannedAt).toLocaleDateString(), s.time, s.urgency, s.catalyst, s.move, s.confidence, s.upside, s.marketCap, s.outcome, s.basePrice || '', s.checkPrice || '', `"${(s.headline || '').replace(/"/g, '""')}"`]);
  const csv = [h.join(','), ...rows.map(r => r.join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  Object.assign(document.createElement('a'), { href: url, download: `signal_${new Date().toISOString().slice(0, 10)}.csv` }).click();
  URL.revokeObjectURL(url);
}

// ============================================================
//  EMPTY STATE
// ============================================================
async function buildEmptyStateContent() {
  const past = getSignalsLast7d().slice(0, 8), acc = calcAccuracy(getSignalsLast7d());
  if (!past.length) return { priceRows: '', acc: null, count: 0 };
  const prices = await Promise.allSettled(past.map(s => fetchStockPrice(s.ticker)));
  const priceRows = past.map((s, i) => {
    const cur = prices[i].status === 'fulfilled' ? prices[i].value : null;
    const ms = cur && s.basePrice ? ((cur - s.basePrice) / s.basePrice * 100).toFixed(1) : null;
    const color = ms === null ? 'var(--muted)' : ms >= 0 ? 'var(--green)' : 'var(--red)';
    const dt = new Date(s.scannedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
    const outcome = s.outcome === 'hit' ? '<span style="color:var(--green)">✓</span>' : s.outcome === 'miss' ? '<span style="color:var(--red)">✗</span>' : '';
    return `<div class="es-row" onclick="selectSignal&&selectSignal('${s.id}')"><div class="es-ticker">${s.ticker}</div><span class="tag ${s.catalystTag} es-catalyst">${s.catalyst}</span><div class="es-date">${dt}</div><div class="es-move" style="color:${color}">${ms !== null ? (ms >= 0 ? '+' : '') + ms + '%' : '—'}</div><div class="es-outcome">${outcome}</div></div>`;
  }).join('');
  return { priceRows, acc, count: past.length };
}

// ============================================================
//  MAIN SCAN RUNNER
// ============================================================
async function runScan(apiKey) {
  console.log('[SIGNAL] Scan started:', new Date().toISOString());
  const raw = await callClaude(apiKey, buildUserPrompt());
  const newSignals = parseSignals(raw);
  if (!newSignals.length) { console.log('[SIGNAL] No qualifying signals.'); updateScanCompleteUI(0); return; }
  const existing = loadSignals(), unique = deduplicateSignals(newSignals, existing);
  if (!unique.length) { console.log('[SIGNAL] All duplicates.'); updateScanCompleteUI(0); return; }
  unique.forEach(s => fetchBasePrice(s));
  saveSignals([...unique, ...existing]);
  updateScanCompleteUI(unique.length, unique);
  console.log(`[SIGNAL] ${unique.length} signal(s) saved.`);
}

// ============================================================
//  UI HOOKS
// ============================================================
function updateScanCompleteUI(count, newSignals = []) {
  const n = getSignalsToday().length;
  setText('signalCount', n);
  const mc = document.getElementById('signalCountMobile'); if (mc) mc.textContent = `${n} signals`;
  if (typeof window.renderFeed === 'function') window.renderFeed();
  if (typeof window.renderSidebar === 'function') window.renderSidebar();
  if (typeof window.flashNewSignals === 'function' && newSignals.length) window.flashNewSignals(newSignals.map(s => s.id));
  if (newSignals.length) {
    fireNotification(newSignals);
    haptic('signal');
    setBadge(getSignalsToday().length);
    showPortfolioAlertBanner(newSignals);
  }
  updatePortfolioPnlHeader();
}

function refreshDetailIfActive(signalId) {
  if (window.activeSignalId === signalId && typeof window.renderDetail === 'function') window.renderDetail(signalId);
}

// ============================================================
//  INIT
// ============================================================
function initScanner() {
  isScanning = false;
  releaseScanLock();
  applyTheme(getTheme());
  applySettingsToApp(loadSettings());

  const scanBtn = document.getElementById('scanBtn');
  if (scanBtn) scanBtn.addEventListener('click', triggerManualScan);

  updateMarketStatusDisplay();
  nextScanAt = calcNextScanTime();
  startScheduler();
  setTimeout(() => { initPullToRefresh(); snapshotPortfolio(); updatePortfolioPnlHeader(); }, 500);

  console.log('[SIGNAL] Ready | Market:', isMarketOpen() ? 'OPEN' : 'CLOSED', '| Next:', nextScanAt.toLocaleTimeString());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScanner);
} else {
  initScanner();
}

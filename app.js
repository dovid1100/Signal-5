'use strict';
// ============================================================
//  VERTEX — Pre-Event Intelligence  v3.0
//  app.js — Core logic, storage, scanning, API
// ============================================================

const VERTEX_VERSION = '3.0.0';

// ============================================================
//  INDEXEDDB  (Phase 1 — safe migration)
// ============================================================
const DB_NAME = 'vertex_db', DB_VERSION = 2;
let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // Safe: only create stores that don't exist yet
      if (!db.objectStoreNames.contains('watchfile')) {
        const ws = db.createObjectStore('watchfile', { keyPath: 'id' });
        ws.createIndex('type',   'type',   { unique: false });
        ws.createIndex('ticker', 'ticker', { unique: false });
        ws.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('signals')) {
        const ss = db.createObjectStore('signals', { keyPath: 'id' });
        ss.createIndex('ticker',    'ticker',    { unique: false });
        ss.createIndex('scannedAt', 'scannedAt', { unique: false });
        ss.createIndex('type',      'type',      { unique: false });
      }
      if (!db.objectStoreNames.contains('learning'))     db.createObjectStore('learning',     { keyPath: 'id' });
      if (!db.objectStoreNames.contains('fda_calendar')) db.createObjectStore('fda_calendar', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('scan_log'))     db.createObjectStore('scan_log',     { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = e => rej(e.target.error);
  });
}
async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(value);
    req.onsuccess = () => res(req.result);
    req.onerror   = e => { console.error(`[VERTEX] dbPut failed: ${store}`, e.target.error); rej(e.target.error); };
  });
}
async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}
async function dbGetAll(store, indexName, indexValue) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const os  = db.transaction(store, 'readonly').objectStore(store);
    const req = indexName ? os.index(indexName).getAll(indexValue) : os.getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = e => rej(e.target.error);
  });
}
async function dbClear(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).clear();
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}

// ============================================================
//  SETTINGS  (localStorage)
// ============================================================
const LS = { API_KEY: 'vertex_api_key', SETTINGS: 'vertex_settings', THEME: 'vertex_theme', SCAN_META: 'vertex_scan_meta' };

const DEFAULT_SETTINGS = {
  preMarketScans: true, marketScans: true, afterHoursScans: true,
  fdaEnabled: true, squeezeEnabled: true, maEnabled: true,
  minConfidence: 50, minMove: 5, mcapPreset: 'small',
  accentColor: 'blue', fontSize: 'medium', compactMode: false,
  notificationsEnabled: false, scanPaused: false,
};

function loadSettings()     { try { const r = localStorage.getItem(LS.SETTINGS); return r ? { ...DEFAULT_SETTINGS, ...JSON.parse(r) } : { ...DEFAULT_SETTINGS }; } catch { return { ...DEFAULT_SETTINGS }; } }
function saveSettings(s)    { try { localStorage.setItem(LS.SETTINGS, JSON.stringify(s)); } catch (_) {} }
function getSetting(k)      { return loadSettings()[k]; }
function updateSetting(k,v) { const s = loadSettings(); s[k] = v; saveSettings(s); applySettingsToApp(s); }
function getApiKey()        { try { return localStorage.getItem(LS.API_KEY) || ''; } catch { return ''; } }
function saveApiKey(k)      { try { localStorage.setItem(LS.API_KEY, k); } catch (_) {} }

function applySettingsToApp(s) {
  const C = {
    blue:   { main: '#3EC9FF', dim: 'rgba(62,201,255,.10)',  glow: 'rgba(62,201,255,.20)'  },
    green:  { main: '#20E090', dim: 'rgba(32,224,144,.10)',  glow: 'rgba(32,224,144,.20)'  },
    purple: { main: '#B06EFF', dim: 'rgba(176,110,255,.10)', glow: 'rgba(176,110,255,.20)' },
    gold:   { main: '#FFB020', dim: 'rgba(255,176,32,.10)',  glow: 'rgba(255,176,32,.20)'  },
  };
  const c = C[s.accentColor] || C.blue;
  document.documentElement.style.setProperty('--accent',      c.main);
  document.documentElement.style.setProperty('--accent-dim',  c.dim);
  document.documentElement.style.setProperty('--accent-glow', c.glow);
  document.documentElement.style.setProperty('--base-font', { small: '11px', medium: '13px', large: '15px' }[s.fontSize] || '13px');
  document.documentElement.setAttribute('data-compact', s.compactMode ? '1' : '0');
}

function getTheme()    { try { return localStorage.getItem(LS.THEME) || 'dark'; } catch { return 'dark'; } }
function toggleTheme() { applyTheme(getTheme() === 'dark' ? 'light' : 'dark'); }
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(LS.THEME, t); } catch (_) {}
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = t === 'dark' ? '☀ Light Mode' : '☾ Dark Mode';
}
function resetSettings() { saveSettings({ ...DEFAULT_SETTINGS }); applySettingsToApp(DEFAULT_SETTINGS); applyTheme('dark'); }

async function clearAllData() {
  for (const store of ['watchfile', 'signals', 'learning', 'fda_calendar', 'scan_log']) {
    try { await dbClear(store); } catch (_) {}
  }
  // Phase 1 fix: also clear portfolio
  try { localStorage.removeItem('vertex_portfolio'); } catch (_) {}
  try { localStorage.removeItem(LS.SCAN_META); } catch (_) {}
}

const MCAP_PRESETS = [
  { label: '$50M–$500M', id: 'micro', min: 50,   max: 500   },
  { label: '$500M–$2B',  id: 'small', min: 500,  max: 2000  },
  { label: '$2B–$10B',   id: 'mid',   min: 2000, max: 10000 },
  { label: 'All ($50M+)',id: 'all',   min: 50,   max: 50000 },
];
function getMcapPreset() { return MCAP_PRESETS.find(p => p.id === (getSetting('mcapPreset') || 'small')) || MCAP_PRESETS[1]; }

const SECTOR_ETFS = [
  { sym: 'XBI',  label: 'Biotech'     },
  { sym: 'XLV',  label: 'Healthcare'  },
  { sym: 'XLK',  label: 'Technology'  },
  { sym: 'XLE',  label: 'Energy'      },
  { sym: 'XLF',  label: 'Financials'  },
  { sym: 'ARKK', label: 'Innovation'  },
  { sym: 'IWM',  label: 'Small-Cap'   },
  { sym: 'QQQ',  label: 'Nasdaq-100'  },
  { sym: 'SPY',  label: 'S&P 500'     },
];

// ============================================================
//  MARKET HOURS
// ============================================================
function getNowET() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })); }

function getMarketSession() {
  const et = getNowET(), day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
  if (day === 0 || day === 6) return 'weekend';
  if (mins >= 4 * 60 && mins < 9 * 60 + 30)  return 'premarket';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'market';
  if (mins >= 16 * 60 && mins < 20 * 60)     return 'afterhours';
  return 'closed';
}
function isMarketOpen()   { return getMarketSession() === 'market'; }
function isPreMarket()    { return getMarketSession() === 'premarket'; }
function isAfterHours()   { return getMarketSession() === 'afterhours'; }
function isActivePeriod() { const s = getMarketSession(); return s === 'premarket' || s === 'market' || s === 'afterhours'; }
function isMarketDay()    { const d = getNowET().getDay(); return d >= 1 && d <= 5; }

function msUntilNextScan() {
  const et = getNowET(), day = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
  if (day === 0 || day === 6) {
    const d = day === 6 ? 2 : 1, mLeft = (24 * 60 - mins) * 60000;
    return mLeft + (d - 1) * 86400000 + 4 * 60 * 60000;
  }
  const schedule = [4*60, 4*60+30, 5*60+30, 6*60+30, 7*60+30, 8*60+30, 9*60+15, 9*60+45, 10*60+45, 11*60+45, 12*60+45, 13*60+45, 14*60+45, 15*60+45, 16*60+15, 18*60];
  const next = schedule.find(m => m > mins);
  if (next) return (next - mins) * 60000;
  const dAhead = day === 5 ? 3 : 1;
  return (24 * 60 - mins) * 60000 + (dAhead - 1) * 86400000 + 4 * 60 * 60000;
}

// ============================================================
//  HELPERS
// ============================================================
function pad(n)        { return String(n).padStart(2, '0'); }
function setText(id,v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function fmt$(n)       { return n ? '$' + (n >= 1e9 ? (n/1e9).toFixed(1)+'B' : n >= 1e6 ? (n/1e6).toFixed(0)+'M' : n.toFixed(0)) : '—'; }
function fmtPct(n,d=2) { return n != null ? (n >= 0 ? '+' : '') + n.toFixed(d) + '%' : '—'; }
function haptic(t='light') { if (!navigator.vibrate) return; const p = { light:[10], medium:[20], heavy:[30,10,30], signal:[50,30,50,30,100] }; navigator.vibrate(p[t] || p.light); }

// Phase 5 — custom modal replacing confirm() for iOS PWA compatibility
function showConfirm(msg) {
  return new Promise(resolve => {
    let overlay = document.getElementById('vxConfirmOverlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'vxConfirmOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = `<div style="background:var(--surface2);border:1px solid var(--border2);border-radius:14px;padding:22px 20px;max-width:300px;width:100%;font-size:13px;color:var(--text);line-height:1.6">
      <div style="margin-bottom:18px">${msg}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="vxConfirmNo"  style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;background:var(--surface3);color:var(--muted2);border:1px solid var(--border2);border-radius:6px;padding:8px 14px;cursor:pointer">Cancel</button>
        <button id="vxConfirmYes" style="font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;background:var(--red-dim);color:var(--red);border:1px solid rgba(255,69,96,.3);border-radius:6px;padding:8px 14px;cursor:pointer">Confirm</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    document.getElementById('vxConfirmYes').onclick = () => { overlay.remove(); resolve(true);  };
    document.getElementById('vxConfirmNo').onclick  = () => { overlay.remove(); resolve(false); };
  });
}

function showToast(msg, type='info', ms=4000) {
  let t = document.getElementById('vxToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'vxToast';
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:700;padding:10px 18px;border-radius:8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;pointer-events:none;transition:opacity .3s';
    document.body.appendChild(t);
  }
  const C = {
    info:    'background:var(--surface3);color:var(--text2);border:1px solid var(--border2)',
    success: 'background:var(--green-dim);color:var(--green);border:1px solid rgba(32,224,144,.3)',
    error:   'background:var(--red-dim);color:var(--red);border:1px solid rgba(255,69,96,.3)',
    warn:    'background:var(--amber-dim);color:var(--amber);border:1px solid rgba(255,176,32,.3)',
  };
  t.style.cssText += (';' + (C[type] || C.info));
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => t.style.opacity = '0', ms);
}

function skeletonHTML(rows=3) {
  return Array.from({ length: rows }, () =>
    '<div class="skeleton-row"><div class="skeleton-ticker skel"></div><div class="skeleton-body skel"></div><div class="skeleton-badge skel"></div></div>'
  ).join('');
}

function animateCount(el, target, suffix='', dur=800) {
  if (!el) return;
  const step = target / (dur / 16); let cur = 0;
  const t = setInterval(() => {
    cur = Math.min(cur + step, target);
    el.textContent = parseFloat(cur.toFixed(1)) + suffix;
    if (cur >= target) clearInterval(t);
  }, 16);
}

function updateMarketStatusDisplay() {
  const el = document.getElementById('marketStatus'); if (!el) return;
  const m = { premarket: { label: 'Pre-Market', cls: 'dot-amber' }, market: { label: 'Market Open', cls: 'dot-green' }, afterhours: { label: 'After Hours', cls: 'dot-amber' }, closed: { label: 'Closed', cls: 'dot-red' }, weekend: { label: 'Weekend', cls: 'dot-red' } };
  const s = getMarketSession(), x = m[s] || m.closed;
  el.innerHTML = `<span class="stat-dot ${x.cls}"></span>${x.label}`;
}

function setScanningState(scanning, label='') {
  const btn = document.getElementById('scanBtn');
  if (btn) { btn.disabled = scanning; btn.textContent = scanning ? ('⟳ ' + (label || 'Scanning...')) : '▶ Scan'; }
  setText('scanStatus', scanning ? (label || 'Scanning...') : '');
}

function updateCountdownDisplay() {
  if (!nextScanAt) return;
  const ms = Math.max(0, nextScanAt - Date.now()), tot = Math.floor(ms / 1000);
  const hh = Math.floor(tot / 3600), mm = Math.floor((tot % 3600) / 60), ss = tot % 60;
  const str = hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  setText('countdown', str);
  setText('countdownMobile', str);
}

// ============================================================
//  NOTIFICATIONS
// ============================================================
async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied')  return false;
  return (await Notification.requestPermission()) === 'granted';
}
function fireNotification(title, body, tag='vertex') {
  if (!getSetting('notificationsEnabled')) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  const n = new Notification(title, { body, icon: '/icon-192.png', tag, requireInteraction: true });
  n.onclick = () => { window.focus(); n.close(); };
}

// ============================================================
//  SCAN LOCK
// ============================================================
function acquireScanLock()  { try { const r = localStorage.getItem('vertex_lock'); if (r) { const l = JSON.parse(r); if (Date.now() - l.ts < 120000) return false; } localStorage.setItem('vertex_lock', JSON.stringify({ ts: Date.now() })); return true; } catch { return true; } }
function releaseScanLock()  { try { localStorage.removeItem('vertex_lock'); } catch (_) {} }

// ============================================================
//  RUNTIME STATE
// ============================================================
let isScanning = false, schedulerTimer = null, nextScanAt = null;
window.lastScanInfo = null;
window._fdaCalendarCache  = [];
window._fdaLearningCache  = null;

// Phase 2 — sector ETF cache (15 min)
let _sectorCache = null, _sectorCacheTs = 0;
const SECTOR_CACHE_MS = 15 * 60 * 1000;

// ============================================================
//  PRICE / MARKET DATA  (Phase 1 — combined quote+fundamentals)
// ============================================================
const PROXIES = [
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

async function fetchWithProxy(url, timeout=10000) {
  for (const p of PROXIES) {
    try {
      const r = await fetch(p(url), { signal: AbortSignal.timeout(timeout) });
      if (r.ok) return r;
    } catch (_) {}
  }
  return null;
}

async function fetchStockPrice(ticker) {
  const res = await fetchWithProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`);
  if (!res) return null;
  try {
    const data = await res.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closes)) return null;
    for (let i = closes.length - 1; i >= 0; i--) if (closes[i] != null) return parseFloat(closes[i].toFixed(4));
  } catch (_) {}
  return null;
}

// Phase 1 fix: combined extended quote — single Yahoo call for price + fundamentals
async function fetchQuoteAndFundamentals(ticker) {
  const [chartRes, fundRes] = await Promise.allSettled([
    fetchWithProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&prePost=true`, 10000),
    fetchWithProxy(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,summaryDetail,financialData,calendarEvents`, 10000),
  ]);

  let quote = null;
  if (chartRes.status === 'fulfilled' && chartRes.value) {
    try {
      const data = await chartRes.value.json();
      const r = data?.chart?.result?.[0]; if (r) {
        const m = r.meta || {};
        const price = m.regularMarketPrice || null, prev = m.chartPreviousClose || m.previousClose || null;
        const pre = m.preMarketPrice || null, post = m.postMarketPrice || null;
        const vol = m.regularMarketVolume || null, avg = m.averageDailyVolume10Day || null;
        const ext = pre || post;
        quote = { price, prevClose: prev, prePrice: pre, postPrice: post,
          changeExt: ext && prev ? parseFloat(((ext - prev) / prev * 100).toFixed(2)) : null,
          changeDay: price && prev ? parseFloat(((price - prev) / prev * 100).toFixed(2)) : null,
          vol, avgVol: avg, volRatio: vol && avg && avg > 0 ? parseFloat((vol / avg).toFixed(2)) : null,
          fetchedAt: Date.now(),
        };
      }
    } catch (_) {}
  }

  let fund = {};
  if (fundRes.status === 'fulfilled' && fundRes.value) {
    try {
      const data = await fundRes.value.json();
      const r = data?.quoteSummary?.result?.[0];
      const ks = r?.defaultKeyStatistics || {}, sd = r?.summaryDetail || {}, fd = r?.financialData || {}, ce = r?.calendarEvents || {};
      const ea = ce?.earnings?.earningsDate;
      let earningsDate = null;
      if (Array.isArray(ea) && ea.length) earningsDate = new Date(ea[0].raw * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const cash = fd.totalCash?.raw || null, burn = fd.operatingCashflow?.raw || null;
      const cashMonths = cash && burn && burn < 0 ? parseFloat(Math.abs(cash / burn * 12).toFixed(1)) : null;
      fund = {
        shortPct: ks.shortPercentOfFloat?.fmt || null, shortRatio: ks.shortRatio?.fmt || null,
        floatShares: ks.floatShares?.raw || null, floatSharesFmt: ks.floatShares?.fmt || null,
        sharesOutstanding: ks.sharesOutstanding?.fmt || null, beta: ks.beta?.fmt || null,
        week52High: sd.fiftyTwoWeekHigh?.raw || null, week52Low: sd.fiftyTwoWeekLow?.raw || null,
        week52HighFmt: sd.fiftyTwoWeekHigh?.fmt || null, week52LowFmt: sd.fiftyTwoWeekLow?.fmt || null,
        avgVol3m: sd.averageVolume?.fmt || null, marketCap: sd.marketCap?.raw || null,
        marketCapFmt: sd.marketCap?.fmt || null, earningsDate, cashMonths,
        dilutionRisk: cashMonths !== null && cashMonths < 4,
      };
    } catch (_) {}
  }

  return { quote, fund };
}

// Keep individual fetchers for backward compat where needed
async function fetchExtendedQuote(ticker)  { const { quote } = await fetchQuoteAndFundamentals(ticker); return quote; }
async function fetchFundamentals(ticker)   { const { fund }  = await fetchQuoteAndFundamentals(ticker); return fund;  }

async function fetchPreviousClose(ticker) {
  const res = await fetchWithProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`);
  if (!res) return null;
  try {
    const data = await res.json();
    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!Array.isArray(closes) || closes.length < 2) return null;
    for (let i = closes.length - 2; i >= 0; i--) if (closes[i] != null) return parseFloat(closes[i].toFixed(4));
  } catch (_) {}
  return null;
}

// Phase 2 — cached sector ETF fetch
async function fetchSectorContext() {
  if (_sectorCache && Date.now() - _sectorCacheTs < SECTOR_CACHE_MS) return _sectorCache;
  const results = await Promise.allSettled(SECTOR_ETFS.map(async etf => {
    const res = await fetchWithProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(etf.sym)}?interval=1d&range=2d`, 8000);
    if (!res) return null;
    try {
      const data = await res.json();
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      if (!Array.isArray(closes) || closes.length < 2) return null;
      const prev = closes[closes.length - 2], cur = closes[closes.length - 1];
      if (!prev || !cur) return null;
      return { sym: etf.sym, label: etf.label, pct: parseFloat(((cur - prev) / prev * 100).toFixed(2)), price: cur.toFixed(2) };
    } catch (_) { return null; }
  }));
  const data = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
  _sectorCache = data; _sectorCacheTs = Date.now();
  return data;
}

async function fetchTopGainers(minPct=5) {
  const res = await fetchWithProxy('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=25&start=0', 12000);
  if (!res) return [];
  try {
    const data = await res.json();
    const qs = data?.finance?.result?.[0]?.quotes || [];
    return qs.filter(q => q.regularMarketChangePercent >= minPct && (q.marketCap || 0) > 50e6)
      .map(q => ({ ticker: q.symbol, company: q.shortName || q.symbol, changeDay: parseFloat((q.regularMarketChangePercent || 0).toFixed(2)), price: q.regularMarketPrice, prevClose: q.regularMarketPreviousClose, volume: q.regularMarketVolume, avgVolume: q.averageDailyVolume3Month, marketCap: q.marketCap, volRatio: q.averageDailyVolume3Month > 0 ? parseFloat((q.regularMarketVolume / q.averageDailyVolume3Month).toFixed(2)) : null }));
  } catch (_) { return []; }
}

let _chartFetchId = 0;
async function fetchOHLCV(ticker, range='1d', interval='5m') {
  const fid = ++_chartFetchId;
  const res = await fetchWithProxy(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`, 12000);
  if (!res) return null;
  try {
    const data = await res.json();
    const r = data?.chart?.result?.[0]; if (!r) return null;
    const ts = r.timestamp || [], q = r.indicators?.quote?.[0] || {};
    const result = ts.map((t, i) => q.open[i] == null ? null : { t: t * 1000, o: +(q.open[i] || 0).toFixed(4), h: +(q.high[i] || 0).toFixed(4), l: +(q.low[i] || 0).toFixed(4), c: +(q.close[i] || 0).toFixed(4), v: q.volume[i] || 0 }).filter(Boolean);
    if (fid !== _chartFetchId) return null;
    return result.length ? result : null;
  } catch (_) { return null; }
}

async function fetchEdgarRSS() {
  const res = await fetchWithProxy('https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=20&output=atom', 12000);
  if (!res) return [];
  try {
    const text = await res.text();
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    return Array.from(xml.querySelectorAll('entry')).map(e => ({
      title: e.querySelector('title')?.textContent || '',
      summary: e.querySelector('summary')?.textContent || '',
      link: e.querySelector('link')?.getAttribute('href') || '',
      updated: e.querySelector('updated')?.textContent || '',
    }));
  } catch (_) { return []; }
}

// ============================================================
//  CLAUDE API  (Phase 2 — Sonnet for Pass 1, Haiku for rest)
// ============================================================
async function callClaude({ system, messages, maxTokens=1500, webSearchUses=0, useSonnet=false }) {
  const apiKey = getApiKey(); if (!apiKey) throw new Error('No API key configured');
  const model = useSonnet ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001';
  const body = { model, max_tokens: maxTokens, messages };
  if (system) body.system = system;
  if (webSearchUses) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: webSearchUses }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try { const b = await res.json(); if (b?.error?.message) msg += `: ${b.error.message}`; } catch (_) {}
    throw new Error(msg);
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// Phase 1 fix: robust JSON extractor
function extractJSON(raw, type='array') {
  if (!raw) return type === 'array' ? [] : null;
  // Strip markdown fences
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Try direct parse first
  try {
    const parsed = JSON.parse(s);
    if (type === 'array') return Array.isArray(parsed) ? parsed : (parsed && typeof parsed === 'object' ? Object.values(parsed).filter(Array.isArray)[0] || [] : []);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {}
  // Bracket extraction fallback
  if (type === 'array') {
    const a = s.indexOf('['), z = s.lastIndexOf(']');
    if (a === -1 || z < a) return [];
    try { const p = JSON.parse(s.slice(a, z + 1)); return Array.isArray(p) ? p : []; } catch (_) { return []; }
  } else {
    const a = s.indexOf('{'), z = s.lastIndexOf('}');
    if (a === -1 || z < a) return null;
    try { return JSON.parse(s.slice(a, z + 1)); } catch (_) { return null; }
  }
}

// ============================================================
//  FDA CALENDAR  (Phase 3 — dynamic daysUntil)
// ============================================================
async function shouldRefreshFDACalendar() {
  try { const m = await dbGet('fda_calendar', 'meta'); if (!m) return true; return Date.now() - m.fetchedAt > 23 * 3600 * 1000; } catch (_) { return true; }
}

// Phase 3: calculate daysUntil dynamically, never from stored value
function calcDaysUntil(pdufaDate) {
  if (!pdufaDate) return 999;
  return Math.ceil((new Date(pdufaDate) - new Date()) / 86400000);
}

async function fetchFDACalendar() {
  console.log('[VERTEX] Fetching FDA calendar...');
  setScanningState(true, 'Fetching FDA calendar...');
  const dateStr = getNowET().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const raw = await callClaude({
    system: `You are an FDA calendar researcher. Find ALL upcoming PDUFA dates and FDA binary events for publicly traded biotech/pharma companies in the next 30 days.

Search: BioPharma Catalyst (biopharmacatalyst.com), FDA.gov PDUFA dates, Seeking Alpha biotech calendar, Fierce Pharma, BioPharmaDive.

IMPORTANT: Include events as close as 1-2 days away. Do not skip near-term events.

Return ONLY JSON array, no markdown:
[{"ticker":"","company":"","drugName":"","indication":"","pdufaDate":"YYYY-MM-DD","drugType":"","approvalProbability":0,"expectedMoveUp":0,"expectedMoveDown":0,"analystSentiment":"","reasoning":"","sources":["url"]}]
Return [] if nothing found.`,
    messages: [{ role: 'user', content: `Today is ${dateStr}. Search all sources for upcoming FDA PDUFA dates in the next 30 days. INCLUDE events 1-2 days away. Find as many as possible.` }],
    maxTokens: 3000, webSearchUses: 8,
  });
  const events = extractJSON(raw)
    .filter(e => e.ticker && e.pdufaDate)
    .map(e => ({
      ...e,
      ticker: String(e.ticker).toUpperCase().trim(),
      daysUntil: calcDaysUntil(e.pdufaDate),
      approvalProbability: Math.min(100, Math.max(0, parseInt(e.approvalProbability) || 50)),
      fetchedAt: Date.now(),
    }));
  for (const ev of events) {
    await dbPut('fda_calendar', { id: ev.ticker + '_' + ev.pdufaDate, ...ev });
    await ensureFDAWatchfileEntry(ev);
  }
  await dbPut('fda_calendar', { id: 'meta', fetchedAt: Date.now(), count: events.length });
  window._fdaCalendarCache = events;
  console.log(`[VERTEX] FDA calendar: ${events.length} events`);
  return events;
}

async function loadFDACalendar() {
  const all = await dbGetAll('fda_calendar');
  // Phase 3: recalculate daysUntil at load time
  return all
    .filter(e => e.id !== 'meta' && e.pdufaDate)
    .map(e => ({ ...e, daysUntil: calcDaysUntil(e.pdufaDate) }))
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

// ============================================================
//  FDA WATCHFILE
// ============================================================
function getFDAIntensity(days) {
  if (days <= 0)  return 'decision_day';
  if (days <= 1)  return 'critical';
  if (days <= 3)  return 'high';
  if (days <= 7)  return 'medium';
  if (days <= 14) return 'low';
  return 'watching';
}

async function ensureFDAWatchfileEntry(ev) {
  const id = 'fda_' + ev.ticker + '_' + ev.pdufaDate;
  const existing = await dbGet('watchfile', id);
  const days = calcDaysUntil(ev.pdufaDate);
  if (existing) {
    await dbPut('watchfile', { ...existing, daysUntil: days, intensity: getFDAIntensity(days), lastUpdated: Date.now() });
    return;
  }
  await dbPut('watchfile', {
    id, type: 'fda', status: 'watching', intensity: getFDAIntensity(days),
    ticker: ev.ticker, company: ev.company, drugName: ev.drugName, indication: ev.indication,
    pdufaDate: ev.pdufaDate, daysUntil: days, drugType: ev.drugType || '',
    approvalProbability: ev.approvalProbability, expectedMoveUp: ev.expectedMoveUp || 0,
    expectedMoveDown: ev.expectedMoveDown || 0,
    analystSentiment: ev.analystSentiment || '', reasoning: ev.reasoning || '', sources: ev.sources || [],
    priceHistory: [], newsHistory: [], optionsActivity: [], insiderActivity: [], confidenceHistory: [], shortHistory: [],
    basePrice: null, currentPrice: null, currentShortPct: null, currentVolRatio: null,
    addedAt: Date.now(), lastUpdated: Date.now(), lastChecked: null,
    outcome: null, outcomeDate: null, signalsFired: [], dilutionRisk: false,
    floatShares: null, marketCapFmt: null,
  });
  console.log(`[VERTEX] Watchfile: added ${ev.ticker} FDA (${days}d away)`);
}

async function addManualFDAWatch(ticker) {
  ticker = ticker.toUpperCase().trim();
  setScanningState(true, `Looking up ${ticker}...`);
  try {
    const raw = await callClaude({
      system: 'Find upcoming FDA PDUFA date for this ticker. Return ONLY JSON object: {"ticker":"","company":"","drugName":"","indication":"","pdufaDate":"YYYY-MM-DD","drugType":"","approvalProbability":0,"expectedMoveUp":0,"expectedMoveDown":0,"analystSentiment":"","reasoning":"","sources":["url"]}. Return null if no upcoming FDA event.',
      messages: [{ role: 'user', content: `Find upcoming FDA PDUFA date or binary event for ${ticker}. Search BioPharma Catalyst, FDA.gov, recent news.` }],
      maxTokens: 1000, webSearchUses: 4,
    });
    const ev = extractJSON(raw, 'object');
    if (!ev || !ev.pdufaDate) { showToast(`No upcoming FDA event found for ${ticker}`, 'warn'); return false; }
    ev.ticker = ticker;
    await dbPut('fda_calendar', { id: ticker + '_' + ev.pdufaDate, ...ev, fetchedAt: Date.now() });
    await ensureFDAWatchfileEntry(ev);
    showToast(`${ticker} added to watchfile`, 'success');
    if (typeof window.renderWatchfile === 'function') window.renderWatchfile();
    return true;
  } catch (e) { showToast(`Error: ${e.message}`, 'error'); return false; }
  finally { setScanningState(false); }
}

async function deleteWatchfileEntry(id) {
  await dbDelete('watchfile', id);
  showToast('Removed from watchfile', 'info');
  if (typeof window.renderWatchfile === 'function') window.renderWatchfile();
}

// Phase 2 — watchfile deep check: gated to market days, max 2 per tick
let _wfCheckQueue = [];
let _wfChecksThisTick = 0;
const MAX_WF_CHECKS_PER_TICK = 2;

async function runFDADeepCheck(entry) {
  // Phase 2: gate to market days only
  if (!isMarketDay()) return;

  const now = Date.now();
  // Phase 3: always recalculate days dynamically
  const days = calcDaysUntil(entry.pdufaDate);
  const intensity = getFDAIntensity(days);

  const intervals = { watching: 24*3600*1000, low: 12*3600*1000, medium: 4*3600*1000, high: 3600*1000, critical: 30*60*1000, decision_day: 10*60*1000 };
  if (entry.lastChecked && (now - entry.lastChecked) < (intervals[intensity] || 3600*1000)) return;

  // Phase 2: skip deep intel for watching-level entries (saves cost)
  if (intensity === 'watching') {
    // Just update days and intensity, no API calls
    const updated = { ...entry, daysUntil: days, intensity, lastChecked: now, lastUpdated: now };
    await dbPut('watchfile', updated);
    return;
  }

  const { quote: q, fund: f } = await fetchQuoteAndFundamentals(entry.ticker);

  let newConf = entry.approvalProbability;
  if (q?.volRatio > 2)   newConf = Math.min(95, newConf + 5);
  if (f?.dilutionRisk)   newConf = Math.max(20, newConf - 15);

  let newsItems = [], optItems = [], insItems = [], anomalies = [];
  if (['high', 'critical', 'decision_day'].includes(intensity)) {
    const sr = await runFDAIntelSearch(entry);
    newsItems = sr.news || []; optItems = sr.options || []; insItems = sr.insider || []; anomalies = sr.anomalies || [];
    if (optItems.some(o => o.type === 'unusual_calls'))  newConf = Math.min(95, newConf + 10);
    if (insItems.some(i => i.type === 'buying'))         newConf = Math.min(95, newConf + 8);
  } else if (intensity === 'medium') {
    newsItems = await runFDANewsSearch(entry);
  }

  const updated = {
    ...entry, intensity, daysUntil: days,
    currentPrice: q?.price || entry.currentPrice,
    currentShortPct: f?.shortPct || entry.currentShortPct,
    currentVolRatio: q?.volRatio || entry.currentVolRatio,
    approvalProbability: newConf,
    dilutionRisk: f?.dilutionRisk || false,
    floatShares: f?.floatSharesFmt || entry.floatShares,
    marketCapFmt: f?.marketCapFmt || entry.marketCapFmt,
    lastChecked: now, lastUpdated: now,
    priceHistory: [...(entry.priceHistory || []).slice(-30), { ts: now, price: q?.price, changeDay: q?.changeDay, changeExt: q?.changeExt, volRatio: q?.volRatio, daysUntil: days }],
    newsHistory:      [...(entry.newsHistory     || []).slice(-20), ...newsItems],
    optionsActivity:  [...(entry.optionsActivity || []).slice(-20), ...optItems],
    insiderActivity:  [...(entry.insiderActivity || []).slice(-10), ...insItems],
    confidenceHistory:[...(entry.confidenceHistory||[]).slice(-30), { ts: now, score: newConf, daysUntil: days }],
    shortHistory: f?.shortPct ? [...(entry.shortHistory || []).slice(-30), { ts: now, pct: f.shortPct }] : entry.shortHistory,
  };
  await dbPut('watchfile', updated);

  for (const a of anomalies) await fireWatchfileSignal(updated, a);

  if (intensity === 'decision_day' && !(entry.signalsFired || []).includes('decision_day')) {
    await fireWatchfileSignal(updated, { type: 'decision_day', urgency: 'critical', headline: `${entry.ticker} FDA decision expected TODAY — ${entry.drugName} for ${entry.indication}`, confidence: newConf });
    updated.signalsFired = [...(updated.signalsFired || []), 'decision_day'];
    await dbPut('watchfile', updated);
    fireNotification(`⚡ ${entry.ticker} — FDA Decision Day`, `${entry.drugName} for ${entry.indication}. ${newConf}% approval probability.`, `fda_${entry.ticker}_decision`);
  }
  if (intensity === 'critical' && !(entry.signalsFired || []).includes('critical')) {
    fireNotification(`▲ ${entry.ticker} — FDA Decision Tomorrow`, `${entry.drugName}. ${newConf}% approval probability.`, `fda_${entry.ticker}_critical`);
    updated.signalsFired = [...(updated.signalsFired || []), 'critical'];
    await dbPut('watchfile', updated);
  }
  return updated;
}

// Phase 2: reduced web searches
async function runFDANewsSearch(entry) {
  try {
    const raw = await callClaude({
      system: 'Find recent news about an FDA drug application. Return ONLY JSON array: [{"headline":"","source":"","url":"","sentiment":"positive|negative|neutral"}]. Return [] if nothing.',
      messages: [{ role: 'user', content: `Find news last 48h about ${entry.ticker} (${entry.company}) drug ${entry.drugName} for ${entry.indication}. PDUFA: ${entry.pdufaDate}.` }],
      maxTokens: 600, webSearchUses: 2, // Phase 2: reduced from 3
    });
    return extractJSON(raw).map(n => ({ ...n, ts: Date.now() }));
  } catch (_) { return []; }
}

async function runFDAIntelSearch(entry) {
  try {
    const raw = await callClaude({
      system: `FDA event intelligence analyst. Search for signals around upcoming FDA decision.
Look for: 1) Recent news (48h) 2) Options — Unusual Whales for unusual calls/puts 3) Insider activity — OpenInsider, SEC Form 4 4) Anomalies
Return ONLY JSON: {"news":[{"headline":"","source":"","url":"","sentiment":"positive|negative|neutral"}],"options":[{"type":"unusual_calls|unusual_puts|normal","description":"","source":"","url":""}],"insider":[{"type":"buying|selling","name":"","role":"","shares":0,"value":0,"date":"","url":""}],"anomalies":[{"type":"unusual_options|insider_buying|volume_spike|short_increase","urgency":"critical|high|medium","headline":"","confidence":0}]}`,
      messages: [{ role: 'user', content: `Analyze ${entry.ticker} (${entry.company}), drug: ${entry.drugName}, indication: ${entry.indication}, PDUFA: ${entry.pdufaDate} (${calcDaysUntil(entry.pdufaDate)}d). Find all intel signals.` }],
      maxTokens: 1500, webSearchUses: 4, // Phase 2: reduced from 6
    });
    return extractJSON(raw, 'object') || { news: [], options: [], insider: [], anomalies: [] };
  } catch (_) { return { news: [], options: [], insider: [], anomalies: [] }; }
}

// Manual deep check trigger (Phase 5 UX)
async function manualWatchfileDeepCheck(id) {
  const entry = await dbGet('watchfile', id); if (!entry) return;
  // Force check by clearing lastChecked
  await dbPut('watchfile', { ...entry, lastChecked: null });
  const updated = await runFDADeepCheck({ ...entry, lastChecked: null });
  showToast(`${entry.ticker} deep check complete`, 'success');
  return updated;
}

// ============================================================
//  FDA LEARNING SYSTEM
// ============================================================
async function loadFDALearning() {
  return await dbGet('learning', 'fda_patterns') || {
    id: 'fda_patterns', byIndication: {}, byCompanySize: {}, byShortFloat: {},
    byOptionsFlow: {}, byInsiderActivity: {}, patternNotes: [], totalResolved: 0, updatedAt: null,
  };
}

async function recordFDAOutcome(watchfileId, outcome) {
  const entry = await dbGet('watchfile', watchfileId);
  if (!entry || entry.type !== 'fda') return;
  await dbPut('watchfile', { ...entry, status: 'resolved', outcome, outcomeDate: Date.now() });
  const price = await fetchStockPrice(entry.ticker);
  const actualMove = price && entry.basePrice ? parseFloat(((price - entry.basePrice) / entry.basePrice * 100).toFixed(2)) : null;
  const correct = (outcome === 'approved' && entry.approvalProbability >= 50) || (outcome === 'rejected' && entry.approvalProbability < 50);
  const L = await loadFDALearning();
  const bump = (obj, key) => { if (!obj[key]) obj[key] = { correct: 0, total: 0 }; obj[key].total++; if (correct) obj[key].correct++; };
  bump(L.byIndication, entry.indication || 'unknown');
  const mcap = entry.marketCap || 0;
  bump(L.byCompanySize, mcap > 2e9 ? 'large' : mcap > 500e6 ? 'mid' : mcap > 100e6 ? 'small' : 'micro');
  const sp = parseFloat(entry.currentShortPct) || 0;
  bump(L.byShortFloat, sp > 30 ? 'very_high' : sp > 15 ? 'high' : sp > 5 ? 'medium' : 'low');
  const hadOpts = (entry.optionsActivity || []).some(o => o.type === 'unusual_calls' || o.type === 'unusual_puts');
  bump(L.byOptionsFlow, hadOpts ? 'unusual' : 'normal');
  const hadIns = (entry.insiderActivity || []).some(i => i.type === 'buying');
  bump(L.byInsiderActivity, hadIns ? 'buying' : 'none');
  L.totalResolved++; L.updatedAt = Date.now();
  if (L.totalResolved % 5 === 0) {
    const note = await generatePatternNote(entry, outcome, correct, actualMove, L);
    if (note) L.patternNotes = [...(L.patternNotes || []).slice(-20), note];
  }
  await dbPut('learning', L);
  window._fdaLearningCache = L;
}

async function generatePatternNote(entry, outcome, correct, actualMove, L) {
  try {
    const raw = await callClaude({
      system: 'You analyze FDA prediction outcomes. Write ONE concise pattern note (max 2 sentences) capturing what can be learned. Focus on actionable patterns. Return ONLY plain text.',
      messages: [{ role: 'user', content: `Ticker: ${entry.ticker}, Drug: ${entry.drugName}, Indication: ${entry.indication}\nOutcome: ${outcome}, Correct: ${correct}, Actual move: ${actualMove !== null ? actualMove + '%' : 'unknown'}\nShort float: ${entry.currentShortPct || 'unknown'}, Had unusual options: ${(entry.optionsActivity || []).some(o => o.type === 'unusual_calls')}, Had insider buying: ${(entry.insiderActivity || []).some(i => i.type === 'buying')}\nCurrent accuracy by indication: ${JSON.stringify(L.byIndication)}` }],
      maxTokens: 150,
    });
    return { note: raw.trim(), ts: Date.now(), ticker: entry.ticker };
  } catch (_) { return null; }
}

function buildFDAContextForPrompt() {
  const events = window._fdaCalendarCache || [];
  const upcoming = events.filter(e => e.daysUntil >= 0 && e.daysUntil <= 7);
  if (!upcoming.length) return '';
  return '\n\nUPCOMING FDA EVENTS (next 7 days):\n' + upcoming.map(e => `• ${e.ticker} (${e.company}): ${e.drugName} for ${e.indication} — PDUFA ${e.pdufaDate} (${calcDaysUntil(e.pdufaDate)}d) — ${e.approvalProbability}% approval probability`).join('\n');
}

function buildLearningContextForPrompt() {
  const L = window._fdaLearningCache;
  if (!L || L.totalResolved < 3) return '';
  const lines = [`\n\nYOUR FDA PREDICTION HISTORY (${L.totalResolved} resolved):`];
  for (const [ind, d] of Object.entries(L.byIndication)) if (d.total >= 2) lines.push(`• ${ind}: ${Math.round(d.correct / d.total * 100)}% correct (${d.total} cases)`);
  if (L.byOptionsFlow?.unusual?.total >= 2) { const d = L.byOptionsFlow.unusual; lines.push(`• Unusual options present: ${Math.round(d.correct / d.total * 100)}% correct`); }
  if (L.byInsiderActivity?.buying?.total >= 2) { const d = L.byInsiderActivity.buying; lines.push(`• Insider buying present: ${Math.round(d.correct / d.total * 100)}% correct`); }
  if (L.patternNotes?.length) { lines.push('\nLEARNED PATTERNS:'); L.patternNotes.slice(-5).forEach(p => lines.push(`• ${p.note}`)); }
  return lines.join('\n');
}

// ============================================================
//  SQUEEZE SCANNER  (Phase 2 — reduced searches)
// ============================================================
async function runSqueezeScanner(sectorData) {
  const raw = await callClaude({
    system: `Short squeeze SETUP detector. Find stocks where squeeze is FORMING, not already happening.

Requirements: short float >15%, float <20M shares, fresh positive catalyst today, volume starting to increase.
DO NOT include stocks already up >20% today.

Search: Finviz short float screener, HighShortInterest.com, MarketBeat short interest, recent news, float data.

Return ONLY JSON array:
[{"ticker":"","company":"","shortFloat":"","floatSharesFmt":"","catalyst":"","urgency":"critical|high|medium","confidence":0,"expectedMove":0,"reasoning":"","sources":[{"pub":"","url":"","headline":""}]}]
Return [] if no clean setups.`,
    messages: [{ role: 'user', content: `Time: ${getNowET().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} ET. Session: ${getMarketSession().toUpperCase()}. Find short squeeze SETUPS forming now. Sector: ${sectorData.map(s => `${s.sym} ${fmtPct(s.pct)}`).join(', ')}. Need short float >15% AND fresh catalyst today.` }],
    maxTokens: 2000, webSearchUses: 5, // Phase 2: reduced from 8
  });
  return extractJSON(raw)
    .filter(c => c.ticker && /^[A-Z]{1,5}$/.test(c.ticker) && (parseInt(c.confidence) || 0) >= (getSetting('minConfidence') || 50))
    .map(c => buildSignal(c, 'squeeze'))
    .filter(Boolean);
}

// ============================================================
//  M&A SCANNER  (Phase 2 — reduced searches)
// ============================================================
async function runMAScanner(edgarEntries) {
  const edgarStr = edgarEntries.slice(0, 10).map(e => `${e.title}: ${e.summary?.slice(0, 100)}`).join('\n');
  const raw = await callClaude({
    system: `M&A signal detector. Find stocks showing INFORMED ACCUMULATION before an acquisition.

Signals: unusual call options, insider buying across multiple executives, activist investor stake (13D/13G), unusual volume with no news, hired investment bankers.
Only flag if 2+ signals present.

Search: SEC EDGAR recent 13D/13G/Form4 filings, Unusual Whales M&A options, recent acquisition news.

Return ONLY JSON array:
[{"ticker":"","company":"","signals":["signal1","signal2"],"urgency":"critical|high|medium","confidence":0,"expectedMove":0,"reasoning":"","sources":[{"pub":"","url":"","headline":""}]}]
Return [] if nothing convincing.`,
    messages: [{ role: 'user', content: `Time: ${getNowET().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} ET.\n\nRecent EDGAR filings:\n${edgarStr}\n\nFind M&A accumulation signals. Focus on recent 13D/13G and unusual options.` }],
    maxTokens: 1500, webSearchUses: 4, // Phase 2: reduced from 6
  });
  return extractJSON(raw)
    .filter(c => c.ticker && /^[A-Z]{1,5}$/.test(c.ticker) && (parseInt(c.confidence) || 0) >= (getSetting('minConfidence') || 50))
    .map(c => buildSignal(c, 'ma'))
    .filter(Boolean);
}

// ============================================================
//  CATALYST SCANNER  (Phase 2 — optimized, Sonnet for Pass 1)
// ============================================================
async function runCatalystScanner(sectorData, edgarEntries) {
  const s = loadSettings(), mc = getMcapPreset(), session = getMarketSession().toUpperCase();
  const fdaCtx = buildFDAContextForPrompt(), histCtx = buildLearningContextForPrompt();
  const edgarStr = edgarEntries.slice(0, 8).map(e => `• ${e.title}`).join('\n');

  // Pass 1 — candidates (Sonnet for better discovery, Phase 2)
  const p1raw = await callClaude({
    system: `Pre-market catalyst scanner. Find stocks with CONFIRMED hard catalysts from last 8 hours.

SEARCH: SEC EDGAR, PRNewswire, BusinessWire, GlobeNewswire, Benzinga, FDA.gov, StockAnalysis, Seeking Alpha, Reuters, Bloomberg.

PRIORITY: FDA approval/rejection > Earnings beat >10% > M&A announcement > Short squeeze with catalyst > Material 8-K
MCap: $${mc.min >= 1000 ? mc.min / 1000 + 'B' : mc.min + 'M'} to $${mc.max >= 1000 ? mc.max / 1000 + 'B' : mc.max + 'M'}
Min move: ${s.minMove || 5}%${fdaCtx}${histCtx}

Return ALL candidates 40%+ confident:
[{"ticker":"","company":"","catalyst":"","catalystTag":"tag-fda|tag-earn|tag-ma|tag-short|tag-8k","headline":"","reasoning":"","move":0,"sources":[{"pub":"","icon":"","time":"","headline":"","url":""}]}]
Return [] if nothing.`,
    messages: [{ role: 'user', content: `Time: ${getNowET().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} ET [${session}]\n${isPreMarket() ? 'PRE-MARKET: Include anything moving with catalyst from last 8 hours.\n' : ''}\nRecent EDGAR:\n${edgarStr}\n\nSearch all sources.` }],
    maxTokens: 2000, webSearchUses: 7, useSonnet: true, // Phase 2: Sonnet, reduced from 10
  });

  const candidates = extractJSON(p1raw).filter(c => c.ticker && /^[A-Z]{1,5}$/.test(String(c.ticker).toUpperCase()));
  if (!candidates.length) return [];

  // Enrich — Phase 1: combined call
  const tickers = [...new Set(candidates.map(c => c.ticker.toUpperCase()))];
  const enriched = await Promise.allSettled(tickers.map(t => fetchQuoteAndFundamentals(t)));
  const quotes = {}, fundamentals = {};
  tickers.forEach((t, i) => {
    const r = enriched[i].status === 'fulfilled' ? enriched[i].value : { quote: null, fund: {} };
    quotes[t] = r.quote; fundamentals[t] = r.fund;
  });

  // Pass 2 — JS scoring (Phase 2: moved logic to JS, no web searches needed)
  const scored = candidates.map(c => {
    const t = c.ticker.toUpperCase(), q = quotes[t] || {}, f = fundamentals[t] || {};
    let score = parseInt(c.confidence) || 50;

    // Price movement scoring
    const pm = q.changeExt;
    if (pm != null) {
      if (pm > 10 && q.volRatio >= 2) score += 25;
      else if (pm >= 5)  score += 15;
      else if (pm >= 2)  score += 10;
      else if (pm < 1)   score -= 20;
    }

    // Short float
    const sp = parseFloat(f.shortPct) || 0;
    if (sp > 30)       score += 20;
    else if (sp > 15)  score += 10;

    // Float size
    const fl = f.floatShares || 0;
    if (fl > 0 && fl < 5e6)   score += 15;
    else if (fl < 20e6)        score += 10;
    else if (fl > 200e6)       score -= 10;

    // Volume
    if (q.volRatio > 3)        score += 15;
    else if (q.volRatio >= 1.5)score += 8;
    else if (q.volRatio < 1)   score -= 10;

    // Dilution risk
    if (f.dilutionRisk)        score -= 20;

    // Sector context
    const sectorMatch = sectorData.find(x => {
      if (c.catalystTag === 'tag-fda') return x.sym === 'XBI' || x.sym === 'XLV';
      if (c.catalystTag === 'tag-earn') return x.sym === 'QQQ' || x.sym === 'SPY';
      return false;
    });
    if (sectorMatch?.pct > 1)  score += 10;
    if (sectorMatch?.pct < -1) score -= 5;

    score = Math.min(99, Math.max(30, score));
    return { ...c, ticker: t, confidence: score, preMarketChange: pm, shortFloat: f.shortPct, floatSize: f.floatSharesFmt, volRatio: q.volRatio, dilutionRisk: f.dilutionRisk, marketCap: f.marketCapFmt || c.marketCap };
  });

  return scored
    .filter(c => c.confidence >= (s.minConfidence || 50))
    .sort((a, b) => b.confidence - a.confidence)
    .map(c => buildSignal(c, 'catalyst'))
    .filter(Boolean);
}

// ============================================================
//  SIGNAL BUILDER  (Phase 3 — sanitized icon, fixed double-negative)
// ============================================================
function buildSignal(r, type='catalyst') {
  if (!r || typeof r !== 'object') return null;
  const ticker = String(r.ticker || '').toUpperCase().trim();
  if (!/^[A-Z]{1,5}$/.test(ticker)) return null;
  if (!r.headline && !r.reasoning) return null;

  const sources = (Array.isArray(r.sources) ? r.sources : [])
    .filter(s => { if (!s?.url) return false; try { new URL(s.url); return true; } catch { return false; } })
    .map(s => ({
      pub: String(s.pub || '').trim(),
      // Phase 3: sanitize icon — only allow emoji or empty
      icon: /^\p{Emoji}/u.test(String(s.icon || '')) ? String(s.icon).trim() : '📰',
      time: String(s.time || '').trim(),
      headline: String(s.headline || '').trim(),
      url: String(s.url).trim(),
    }));

  const confidence = Math.min(100, Math.max(50, parseInt(r.confidence) || 50));
  if (confidence < (getSetting('minConfidence') || 50)) return null;

  const urgency = ['critical', 'high', 'medium'].includes(r.urgency) ? r.urgency : confidence >= 85 ? 'critical' : confidence >= 70 ? 'high' : 'medium';
  const validTags = ['tag-fda', 'tag-earn', 'tag-ma', 'tag-short', 'tag-8k', 'tag-macro', 'tag-squeeze'];
  const catalystTag = validTags.includes(r.catalystTag) ? r.catalystTag : type === 'squeeze' ? 'tag-short' : type === 'ma' ? 'tag-ma' : 'tag-macro';
  const defaultTime = getNowET().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  let reasoning = String(r.reasoning || r.catalystDetails || '').trim();
  const extras = [];
  if (r.preMarketChange != null) extras.push(`PM: ${fmtPct(r.preMarketChange)}`);
  if (r.shortFloat && r.shortFloat !== 'N/A') extras.push(`Short: ${r.shortFloat}`);
  if (r.floatSize  && r.floatSize  !== 'N/A') extras.push(`Float: ${r.floatSize}`);
  if (r.volRatio > 0) extras.push(`Vol: ${r.volRatio}x avg`);
  if (extras.length) reasoning += `\n\n📊 ${extras.join(' · ')}`;

  // Phase 3: fix double-negative on rejection move
  const expectedMoveDown = r.expectedMoveDown != null ? Math.abs(parseFloat(r.expectedMoveDown)) : null;

  return {
    id: `${ticker}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ticker, type, urgency, confidence, catalystTag,
    company: String(r.company || '').trim(),
    move: parseFloat(r.move) || 0,
    volume: String(r.volume || '—').trim(),
    upside: String(r.upside || '—').trim(),
    marketCap: String(r.marketCap || '—').trim(),
    time: String(r.time || defaultTime).trim(),
    headline: String(r.headline || r.signals?.join(', ') || '').trim(),
    catalyst: String(r.catalyst || r.signals?.join(', ') || 'Unknown').trim(),
    reasoning, sources,
    preMarketChange: r.preMarketChange || null,
    shortFloat: r.shortFloat || null,
    floatSize: r.floatSize || null,
    volRatio: r.volRatio || null,
    expectedMoveDown,
    scannedAt: new Date().toISOString(),
    outcome: 'pending',
    outcomeMsg: 'Outcome check available 1 hour after signal.',
    basePrice: null, checkPrice: null,
  };
}

async function fireWatchfileSignal(entry, anomaly) {
  const signal = {
    id: `${entry.ticker}_wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ticker: entry.ticker, type: 'fda_watchfile', urgency: anomaly.urgency || 'high',
    confidence: anomaly.confidence || 70, catalystTag: 'tag-fda',
    company: entry.company, move: 0, volume: '—',
    upside: `+${entry.expectedMoveUp || '?'}% on approval`,
    marketCap: entry.marketCapFmt || '—',
    time: getNowET().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }),
    headline: anomaly.headline,
    catalyst: `FDA ${entry.drugName}`,
    reasoning: `${anomaly.headline}\n\nPDUFA: ${entry.pdufaDate} (${calcDaysUntil(entry.pdufaDate)}d). Approval probability: ${entry.approvalProbability}%. Drug: ${entry.drugName} for ${entry.indication}.`,
    sources: [], scannedAt: new Date().toISOString(),
    outcome: 'pending', outcomeMsg: 'Outcome check available after FDA decision.',
    basePrice: null, checkPrice: null, watchfileId: entry.id,
  };
  await dbPut('signals', signal);
  updateScanCompleteUI(1, [signal]);
}

// ============================================================
//  SIGNAL STORAGE
// ============================================================
async function saveSignal(sig)     { await dbPut('signals', sig); }
async function loadSignals()       { return await dbGetAll('signals'); }
async function loadSignalsToday()  { const all = await loadSignals(), today = getNowET().toDateString(); return all.filter(s => new Date(s.scannedAt).toDateString() === today).sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt)); }
async function loadSignalsLast24h(){ const cut = Date.now() - 86400000; return (await loadSignals()).filter(s => new Date(s.scannedAt).getTime() > cut); }
async function loadSignalsLast7d() { const cut = Date.now() - 7 * 86400000; return (await loadSignals()).filter(s => new Date(s.scannedAt).getTime() > cut); }
async function updateSignal(id, updates) { const s = await dbGet('signals', id); if (!s) return; await dbPut('signals', { ...s, ...updates }); }

// Phase 3 fix: dedup by ticker+type combo, not ticker alone
function deduplicateSignals(newSigs, existing) {
  const cut = Date.now() - 60 * 60 * 1000;
  const recent = new Set(existing.filter(s => new Date(s.scannedAt).getTime() > cut).map(s => `${s.ticker}_${s.type}`));
  return newSigs.filter(s => !recent.has(`${s.ticker}_${s.type}`));
}

// ============================================================
//  OUTCOME TRACKER
// ============================================================
const HIT_THRESHOLD = 5;

async function checkOutcome(signalId) {
  const signal = await dbGet('signals', signalId);
  if (!signal || signal.outcome !== 'pending') return;
  const cur = await fetchStockPrice(signal.ticker);
  if (!cur) {
    await updateSignal(signalId, { outcome: 'unverified', outcomeMsg: `Price unavailable — verify at finance.yahoo.com/quote/${signal.ticker}` });
    refreshDetailIfActive(signalId); return;
  }
  if (!signal.basePrice) {
    await updateSignal(signalId, { outcome: 'unverified', outcomeMsg: `Base price not recorded. Current: $${cur}`, checkPrice: cur });
    refreshDetailIfActive(signalId); return;
  }
  const actual = parseFloat((((cur - signal.basePrice) / signal.basePrice) * 100).toFixed(2));
  const isHit = (signal.move >= 0 ? actual >= 0 : actual <= 0) && Math.abs(actual) >= HIT_THRESHOLD;
  await updateSignal(signalId, {
    outcome: isHit ? 'hit' : 'miss',
    outcomeMsg: `${signal.move >= 0 ? '+' : ''}${signal.move}% signal → ${actual >= 0 ? '+' : ''}${actual}% actual. ${isHit ? 'HIT ✓' : 'MISS ✗'} (Base $${signal.basePrice} → Now $${cur})`,
    checkPrice: cur,
  });
  refreshDetailIfActive(signalId);
  if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
}

function isOutcomeCheckReady(signal) { return signal.outcome === 'pending' && Date.now() - new Date(signal.scannedAt).getTime() >= 60 * 60 * 1000; }

// Phase 3 fix: fetchBasePrice with error handling and retry
async function fetchBasePrice(signal) {
  let attempts = 0;
  const tryFetch = async () => {
    attempts++;
    const p = await fetchStockPrice(signal.ticker);
    if (p !== null) {
      await updateSignal(signal.id, { basePrice: p });
      return;
    }
    if (attempts < 3) setTimeout(tryFetch, 30000); // retry after 30s
    else await updateSignal(signal.id, { outcome: 'unverified', outcomeMsg: `Could not fetch base price after ${attempts} attempts. Verify manually.` });
  };
  tryFetch();
}

// ============================================================
//  ANALYTICS
// ============================================================
async function calcAccuracy(signals) {
  const checked = signals.filter(s => s.outcome === 'hit' || s.outcome === 'miss');
  if (!checked.length) return null;
  const hits = checked.filter(s => s.outcome === 'hit').length;
  const overall = parseFloat((hits / checked.length * 100).toFixed(1));
  const avg = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
  const movePct = s => s.basePrice && s.checkPrice ? Math.abs((s.checkPrice - s.basePrice) / s.basePrice * 100) : null;
  const byType = {};
  for (const t of ['catalyst', 'squeeze', 'ma', 'fda_watchfile']) {
    const x = checked.filter(s => s.type === t);
    if (x.length) byType[t] = { pct: parseFloat((x.filter(s => s.outcome === 'hit').length / x.length * 100).toFixed(1)), total: x.length };
  }
  const byUrgency = {};
  for (const u of ['critical', 'high', 'medium']) {
    const x = checked.filter(s => s.urgency === u);
    byUrgency[u] = x.length ? { pct: parseFloat((x.filter(s => s.outcome === 'hit').length / x.length * 100).toFixed(1)), total: x.length } : null;
  }
  const byCatalyst = {};
  for (const cat of [...new Set(checked.map(s => s.catalyst))]) {
    const c = checked.filter(s => s.catalyst === cat);
    byCatalyst[cat] = { pct: parseFloat((c.filter(s => s.outcome === 'hit').length / c.length * 100).toFixed(1)), total: c.length };
  }
  const withActual = checked.filter(s => s.basePrice && s.checkPrice).sort((a, b) => ((b.checkPrice - b.basePrice) / b.basePrice) - ((a.checkPrice - a.basePrice) / a.basePrice));
  return {
    overall, total: checked.length, hits, misses: checked.length - hits,
    pending: signals.filter(s => s.outcome === 'pending').length,
    byType, byUrgency, byCatalyst,
    avgHitMove:  avg(checked.filter(s => s.outcome === 'hit'  && movePct(s) != null).map(movePct)),
    avgMissMove: avg(checked.filter(s => s.outcome === 'miss' && movePct(s) != null).map(movePct)),
    best:  withActual[0] || null,
    worst: withActual[withActual.length - 1] || null,
  };
}
async function getAnalytics() {
  const [all, h24, d7] = await Promise.all([loadSignals(), loadSignalsLast24h(), loadSignalsLast7d()]);
  return { allTime: await calcAccuracy(all), h24: await calcAccuracy(h24), d7: await calcAccuracy(d7) };
}

// ============================================================
//  PORTFOLIO
// ============================================================
const PORTFOLIO_KEY = 'vertex_portfolio';
function loadPortfolio()       { try { return JSON.parse(localStorage.getItem(PORTFOLIO_KEY) || '{"positions":[],"cashBalance":0}'); } catch { return { positions: [], cashBalance: 0 }; } }
function savePortfolio(p)      { try { localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(p)); } catch (_) {} }
function isInPortfolio(ticker) { return !!loadPortfolio().positions.find(x => x.ticker === ticker.toUpperCase()); }
function getPosition(ticker)   { return loadPortfolio().positions.find(x => x.ticker === ticker.toUpperCase()) || null; }

function addPosition(ticker, shares, buyPrice) {
  const p = loadPortfolio(), t = ticker.toUpperCase().trim();
  const ex = p.positions.find(x => x.ticker === t);
  if (ex) { const tot = ex.shares + shares; ex.buyPrice = parseFloat(((ex.shares * ex.buyPrice + shares * buyPrice) / tot).toFixed(4)); ex.shares = tot; }
  else p.positions.push({ ticker: t, shares: parseFloat(shares), buyPrice: parseFloat(buyPrice), addedAt: new Date().toISOString() });
  savePortfolio(p);
}
function removePosition(ticker)       { const p = loadPortfolio(); p.positions = p.positions.filter(x => x.ticker !== ticker.toUpperCase()); savePortfolio(p); }
function updatePortfolioCash(amount)  { const p = loadPortfolio(); p.cashBalance = parseFloat(amount) || 0; savePortfolio(p); }

// Phase 3 fix: portfolio price cache
let _portfolioPriceCache = {}, _portfolioPriceCacheTs = {};
const PORTFOLIO_CACHE_MS = 3 * 60 * 1000; // 3 min

async function fetchPortfolioPrice(ticker) {
  const now = Date.now();
  if (_portfolioPriceCache[ticker] && now - (_portfolioPriceCacheTs[ticker] || 0) < PORTFOLIO_CACHE_MS) {
    return _portfolioPriceCache[ticker];
  }
  const p = await fetchStockPrice(ticker);
  if (p !== null) { _portfolioPriceCache[ticker] = p; _portfolioPriceCacheTs[ticker] = now; }
  return p;
}

// ============================================================
//  CSV EXPORT  (Phase 3 fix: proper URL revocation on iOS)
// ============================================================
async function exportCSV() {
  const signals = await loadSignals();
  const h = ['Ticker','Company','Date','Time','Type','Urgency','Catalyst','Move%','Confidence','Upside','MarketCap','Outcome','BasePrice','CheckPrice','PreMarketChange%','ShortFloat','FloatSize','VolRatio','Headline'];
  const rows = signals.map(s => [
    s.ticker, `"${(s.company || '').replace(/"/g, '""')}"`,
    new Date(s.scannedAt).toLocaleDateString(), s.time, s.type, s.urgency, s.catalyst, s.move, s.confidence,
    s.upside, s.marketCap, s.outcome, s.basePrice || '', s.checkPrice || '',
    s.preMarketChange || '', s.shortFloat || '', s.floatSize || '', s.volRatio || '',
    `"${(s.headline || '').replace(/"/g, '""')}"`,
  ]);
  const csv = [h.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `vertex_${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.appendChild(a);
  a.click();
  // Phase 3 fix: delay revoke for iOS
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 2000);
}

// ============================================================
//  SCAN LOG
// ============================================================
async function writeScanLog(entry) {
  try {
    await dbPut('scan_log', {
      ts: Date.now(),
      session: getMarketSession(),
      signalCount: entry.signalCount || 0,
      type: entry.type || 'auto',
      error: entry.error || null,
      duration: entry.duration || 0,
    });
  } catch (_) {}
}
async function loadScanLog(limit=50) {
  const all = await dbGetAll('scan_log');
  return all.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

// ============================================================
//  SCHEDULER  (Phase 2 — batched watchfile checks)
// ============================================================
function startScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  let _tickCount = 0;
  schedulerTimer = setInterval(async () => {
    _tickCount++;
    updateMarketStatusDisplay();
    updateCountdownDisplay();

    if (nextScanAt && nextScanAt - Date.now() <= 0 && !isScanning && isActivePeriod() && !getSetting('scanPaused')) {
      nextScanAt = new Date(Date.now() + msUntilNextScan());
      triggerScan();
    }

    // Phase 2: watchfile checks batched — max 2 per tick, market days only
    if (isMarketDay() && _tickCount % 2 === 0) { // every 30s
      try {
        const entries = await dbGetAll('watchfile');
        const due = entries
          .filter(e => e.status !== 'resolved')
          .sort((a, b) => {
            const ord = { decision_day: 0, critical: 1, high: 2, medium: 3, low: 4, watching: 5 };
            return (ord[a.intensity] || 5) - (ord[b.intensity] || 5);
          })
          .slice(0, MAX_WF_CHECKS_PER_TICK);
        for (const e of due) {
          try { await runFDADeepCheck(e); } catch (_) {}
        }
      } catch (_) {}
    }
  }, 15000);
}

// ============================================================
//  ERROR DISPLAY
// ============================================================
function showScanError(msg) {
  window.lastScanInfo = { type: 'error', msg, ts: Date.now() };
  showToast(msg.slice(0, 80), 'error', 8000);
  let b = document.getElementById('errorBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'errorBanner';
    b.style.cssText = 'position:fixed;bottom:80px;left:12px;right:12px;z-index:600;background:#1a0808;border:1px solid var(--red);border-radius:10px;padding:13px 15px;font-size:11px;color:var(--red);line-height:1.7;box-shadow:0 4px 24px rgba(255,69,96,.2);animation:slide-up .3s ease both';
    document.body.appendChild(b);
  }
  let help = '→ Tap Settings and verify your API key.';
  if (msg.includes('401') || msg.includes('API key')) help = '→ Go to Settings → re-paste API key → tap Connect.';
  else if (msg.includes('429')) help = '→ Rate limited. Wait a minute then scan again.';
  else if (msg.includes('529')) help = '→ Anthropic servers busy. Try again shortly.';
  b.innerHTML = `<div style="display:flex;align-items:flex-start;gap:10px"><div style="font-size:18px">⚠</div><div style="flex:1"><div style="font-weight:600;margin-bottom:3px">Scan Failed</div><div style="color:rgba(255,100,100,.8);font-size:10px;margin-bottom:5px;word-break:break-all">${msg}</div><div style="color:var(--amber);font-size:10px">${help}</div></div><button onclick="document.getElementById('errorBanner').remove()" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:0">✕</button></div>`;
}
function clearErrorBanner() { const b = document.getElementById('errorBanner'); if (b) b.remove(); }

// ============================================================
//  MAIN SCAN RUNNER  (Phase 2 — sequential after-hours, skip catalyst after 6pm)
// ============================================================
async function triggerScan({ isManual=false } = {}) {
  if (isScanning) return;
  if (getSetting('scanPaused') && !isManual) return;
  const apiKey = getApiKey();
  if (!apiKey) { showScanError('No API key — go to Settings and paste your key.'); return; }
  if (!isManual && !isActivePeriod()) { nextScanAt = new Date(Date.now() + msUntilNextScan()); return; }
  if (!acquireScanLock()) return;
  clearErrorBanner();
  isScanning = true;
  setScanningState(true, 'Starting...');
  const scanStart = Date.now();
  try {
    const count = await runFullScan();
    const prev = JSON.parse(localStorage.getItem(LS.SCAN_META) || '{}');
    localStorage.setItem(LS.SCAN_META, JSON.stringify({ lastScan: new Date().toISOString(), scanCount: (prev.scanCount || 0) + 1 }));
    if (!isManual) nextScanAt = new Date(Date.now() + msUntilNextScan());
    // Phase 5: reset countdown immediately after manual scan
    if (isManual) nextScanAt = new Date(Date.now() + msUntilNextScan());
    await writeScanLog({ signalCount: count, type: isManual ? 'manual' : 'auto', duration: Date.now() - scanStart });
  } catch (err) {
    console.error('[VERTEX] Scan error:', err);
    showScanError(err.message || 'Unknown error');
    await writeScanLog({ type: isManual ? 'manual' : 'auto', error: err.message, duration: Date.now() - scanStart });
  } finally {
    isScanning = false;
    releaseScanLock();
    setScanningState(false);
  }
}

async function runFullScan() {
  const s = loadSettings();
  const et = getNowET();
  const hourET = et.getHours();

  setScanningState(true, 'Loading intelligence...');
  if (await shouldRefreshFDACalendar()) await fetchFDACalendar();
  window._fdaCalendarCache = await loadFDACalendar();
  window._fdaLearningCache = await loadFDALearning();

  setScanningState(true, 'Fetching market data...');
  const [sectorData, edgarEntries] = await Promise.all([fetchSectorContext(), fetchEdgarRSS()]);

  setScanningState(true, 'Analyzing signals...');

  const isAfterSixPM = hourET >= 18;
  const session = getMarketSession();
  let allNew = [];

  if (session === 'afterhours' || session === 'closed') {
    // Phase 2: sequential after-hours, skip catalyst after 6pm
    if (!isAfterSixPM && s.fdaEnabled !== false) {
      const r = await runCatalystScanner(sectorData, edgarEntries).catch(() => []);
      allNew.push(...r);
    }
    if (s.maEnabled !== false) {
      const r = await runMAScanner(edgarEntries).catch(() => []);
      allNew.push(...r);
    }
    // Only run squeeze if catalyst found something critical, or explicitly enabled
    if (s.squeezeEnabled !== false && !isAfterSixPM) {
      const r = await runSqueezeScanner(sectorData).catch(() => []);
      allNew.push(...r);
    }
  } else {
    // Pre-market and market: parallel for speed
    const scanners = [];
    if (s.fdaEnabled   !== false) scanners.push(runCatalystScanner(sectorData, edgarEntries));
    if (s.squeezeEnabled !== false) scanners.push(runSqueezeScanner(sectorData));
    if (s.maEnabled    !== false) scanners.push(runMAScanner(edgarEntries));
    const results = await Promise.allSettled(scanners);
    allNew = results.flatMap(r => r.status === 'fulfilled' ? r.value.filter(Boolean) : []);
  }

  console.log(`[VERTEX] Scan: ${allNew.length} raw signals`);
  if (!allNew.length) { window.lastScanInfo = { type: 'empty', ts: Date.now() }; updateScanCompleteUI(0); return 0; }

  const existing = await loadSignals();
  const unique = deduplicateSignals(allNew, existing);
  if (!unique.length) { window.lastScanInfo = { type: 'duplicate', ts: Date.now() }; updateScanCompleteUI(0); return 0; }

  for (const sig of unique) { await saveSignal(sig); fetchBasePrice(sig); }

  window.lastScanInfo = { type: 'success', count: unique.length, ts: Date.now() };
  updateScanCompleteUI(unique.length, unique);

  for (const sig of unique.filter(s => s.urgency === 'critical'))
    fireNotification(`⚡ ${sig.ticker} — ${sig.catalyst}`, sig.headline.slice(0, 100), `sig_${sig.id}`);

  console.log(`[VERTEX] ${unique.length} signal(s) saved`);
  return unique.length;
}

// ============================================================
//  UI HOOKS
// ============================================================
function updateScanCompleteUI(count, newSignals=[]) {
  // Phase 5: update badge in real time
  loadSignalsToday().then(sigs => {
    const badge = document.getElementById('signalsBadge');
    if (badge) badge.textContent = sigs.length;
  });
  if (typeof window.renderActiveTab === 'function') window.renderActiveTab(true);
  if (typeof window.flashNewSignals === 'function' && newSignals.length) window.flashNewSignals(newSignals.map(s => s.id));
  // Phase 5: update sidebar in real time if on signals tab
  if (window.activeTab === 'signals' && typeof window.refreshSignalSidebarOnly === 'function') window.refreshSignalSidebarOnly();
  if (newSignals.length) haptic('signal');
}

function refreshDetailIfActive(signalId) {
  if (window.activeSignalId === signalId && typeof window.renderDetail === 'function') window.renderDetail(signalId);
}

// ============================================================
//  TEST API KEY
// ============================================================
async function testApiKey() {
  const apiKey = getApiKey(); if (!apiKey) { showToast('No API key saved', 'warn'); return false; }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.ok) { showToast('API key valid ✓', 'success'); return true; }
    const b = await res.json().catch(() => ({}));
    showToast(`Key invalid: ${b?.error?.message || res.status}`, 'error'); return false;
  } catch (e) { showToast(`Test failed: ${e.message}`, 'error'); return false; }
}

// ============================================================
//  PULL TO REFRESH  (Phase 4 fix: reloads tab, not scan)
// ============================================================
function initPullToRefresh() {
  let sy = 0, sx = 0, pulling = false;
  const detail = document.getElementById('detailArea'); if (!detail) return;
  detail.addEventListener('touchstart', e => {
    if (detail.scrollTop === 0) { sy = e.touches[0].clientY; sx = e.touches[0].clientX; pulling = true; }
  }, { passive: true });
  detail.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - sy, dx = e.touches[0].clientX - sx;
    if (Math.abs(dx) > Math.abs(dy)) { pulling = false; return; }
    if (dy > 60) {
      const i = document.getElementById('pullIndicator');
      // Phase 4: only show on scrollable content tabs
      const scrollableTabs = ['watchfile', 'signals', 'history', 'portfolio', 'analytics'];
      if (i && scrollableTabs.includes(window.activeTab)) i.style.opacity = '1';
    }
  }, { passive: true });
  detail.addEventListener('touchend', e => {
    if (!pulling) return;
    pulling = false;
    const dy = e.changedTouches[0].clientY - sy, dx = e.changedTouches[0].clientX - sx;
    const i = document.getElementById('pullIndicator');
    if (i) i.style.opacity = '0';
    // Phase 4 fix: reload tab, not scan
    if (dy > 60 && Math.abs(dx) < Math.abs(dy)) {
      haptic('light');
      if (typeof window.renderActiveTab === 'function') window.renderActiveTab();
    }
  });
}

// ============================================================
//  INIT
// ============================================================
async function initVertex() {
  await openDB();
  applyTheme(getTheme());
  applySettingsToApp(loadSettings());

  const btn = document.getElementById('scanBtn');
  if (btn) btn.addEventListener('click', () => { haptic('medium'); triggerScan({ isManual: true }); });

  updateMarketStatusDisplay();
  nextScanAt = new Date(Date.now() + msUntilNextScan());
  startScheduler();
  setTimeout(initPullToRefresh, 500);

  try {
    window._fdaCalendarCache = await loadFDACalendar();
    window._fdaLearningCache = await loadFDALearning();
  } catch (_) {}

  // Phase 4: refresh stale data when app comes back to foreground
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      updateMarketStatusDisplay();
      if (nextScanAt && Date.now() > nextScanAt && !isScanning) triggerScan();
      // Refresh current tab data
      if (typeof window.renderActiveTab === 'function') window.renderActiveTab();
    }
  });

  console.log(`[VERTEX] v${VERTEX_VERSION} ready | ${getMarketSession()} | Next: ${nextScanAt.toLocaleTimeString()}`);
}

if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initVertex); } else { initVertex(); }

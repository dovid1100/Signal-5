// ============================================================
//  SIGNAL — app.js
//  Scan Engine · Claude Prompt · Parser · Price Fetcher
//  Outcome Tracker · Storage · Analytics · CSV Export
// ============================================================
'use strict';

// ── Constants ────────────────────────────────────────────────
const SCAN_INTERVAL_MS  = 5 * 60 * 1000;
const PRELOAD_OFFSET_MS = 30 * 1000;
const MARKET_OPEN_HOUR  = 9;
const MARKET_CLOSE_HOUR = 20;
const LOCK_KEY          = 'signal_scan_lock';
const LOCK_TTL_MS       = 90 * 1000;
const API_KEY_STORAGE   = 'signal_api_key';
const SIGNALS_KEY       = 'signal_history';
const ONE_MONTH_MS      = 30 * 24 * 60 * 60 * 1000;
const OUTCOME_DELAY_MS  = 60 * 60 * 1000;
const HIT_THRESHOLD_PCT = 5;

// ── State ────────────────────────────────────────────────────
let isScanning    = false;
let schedulerTimer = null;
let nextScanAt    = null;
let lastScanAt    = null;

// ============================================================
//  MARKET HOURS  (DST-safe via Intl)
// ============================================================
function getNowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isMarketOpen() {
  const et  = getNowET();
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= MARKET_OPEN_HOUR * 60 && mins < MARKET_CLOSE_HOUR * 60;
}

function msUntilNextMarketOpen() {
  const et  = getNowET();
  const day = et.getDay();
  const sec = et.getHours() * 3600 + et.getMinutes() * 60 + et.getSeconds();
  const openSec = MARKET_OPEN_HOUR * 3600;
  let daysAhead = 0;
  if (day === 6) daysAhead = 2;
  else if (day === 0) daysAhead = 1;
  else if (et.getHours() >= MARKET_CLOSE_HOUR) daysAhead = (day === 5) ? 3 : 1;
  const secsUntil = daysAhead === 0
    ? openSec - sec
    : (86400 - sec) + (daysAhead - 1) * 86400 + openSec;
  return Math.max(0, secsUntil * 1000);
}

// ============================================================
//  CROSS-TAB LOCK
// ============================================================
function acquireScanLock() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if (raw) {
      const lock = JSON.parse(raw);
      if (Date.now() - lock.ts < LOCK_TTL_MS) return false;
    }
    localStorage.setItem(LOCK_KEY, JSON.stringify({ ts: Date.now() }));
    return true;
  } catch { return true; }
}
function releaseScanLock() { try { localStorage.removeItem(LOCK_KEY); } catch (_) {} }

// ============================================================
//  API KEY
// ============================================================
function getApiKey() {
  const el  = document.getElementById('apiKeyInput');
  const val = el ? el.value.trim() : '';
  if (val) { try { localStorage.setItem(API_KEY_STORAGE, val); } catch (_) {} return val; }
  try { return localStorage.getItem(API_KEY_STORAGE) || ''; } catch { return ''; }
}

// ============================================================
//  SCHEDULER
// ============================================================
function calcNextScanTime() {
  return isMarketOpen()
    ? new Date(Date.now() + SCAN_INTERVAL_MS)
    : new Date(Date.now() + msUntilNextMarketOpen());
}

function startScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (!nextScanAt) nextScanAt = calcNextScanTime();
  schedulerTimer = setInterval(() => {
    const msLeft = nextScanAt - Date.now();
    updateCountdownDisplay(msLeft);
    updateMarketStatusDisplay();
    if (msLeft <= PRELOAD_OFFSET_MS && msLeft > 0 && !isScanning && isMarketOpen()) {
      triggerScan({ isPreload: true });
    }
    if (msLeft <= 0 && !isScanning) {
      nextScanAt = calcNextScanTime();
      if (isMarketOpen()) triggerScan();
    }
  }, 500);
}

// ============================================================
//  TRIGGER SCAN
// ============================================================
async function triggerScan({ isPreload = false, isManual = false } = {}) {
  if (isScanning) return;
  const apiKey = getApiKey();
  if (!apiKey) { showScanError('Enter your Anthropic API key first.'); return; }
  if (!acquireScanLock()) return;
  if (!isManual && !isMarketOpen()) { releaseScanLock(); nextScanAt = calcNextScanTime(); return; }

  isScanning = true;
  setScanningState(true, isPreload);
  try {
    await runScan(apiKey);
    lastScanAt = new Date();
    updateLastScanDisplay(lastScanAt);
    if (!isManual) nextScanAt = calcNextScanTime();
  } catch (err) {
    console.error('[SIGNAL]', err);
    showScanError(err.message || 'Scan failed — will retry next cycle.');
  } finally {
    isScanning = false;
    releaseScanLock();
    setScanningState(false);
  }
}
function triggerManualScan() { triggerScan({ isManual: true }); }

// ============================================================
//  VISIBILITY RECOVERY  (mobile background)
// ============================================================
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') resyncScheduler();
});
window.addEventListener('pageshow', resyncScheduler);
window.addEventListener('focus',    resyncScheduler);
function resyncScheduler() {
  if (nextScanAt && Date.now() > nextScanAt) {
    nextScanAt = calcNextScanTime();
    if (isMarketOpen() && !isScanning) triggerScan();
  }
  startScheduler();
}

// ============================================================
//  UI HELPERS
// ============================================================
function pad(n) { return String(n).padStart(2, '0'); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function updateCountdownDisplay(msLeft) {
  const ms  = isMarketOpen() ? Math.max(0, msLeft) : msUntilNextMarketOpen();
  const tot = Math.floor(ms / 1000);
  const hh  = Math.floor(tot / 3600);
  const mm  = Math.floor((tot % 3600) / 60);
  const ss  = tot % 60;
  const str = hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
  setText('countdown', str);
  setText('countdown-mobile', str);
}

function updateLastScanDisplay(date) {
  if (!date) return;
  const t = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  setText('lastScanTime', `Last: ${t} ET`);
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
  if (btn) {
    btn.disabled    = scanning;
    btn.textContent = scanning ? (isPreload ? '⟳ Preparing...' : '⟳ Scanning...') : '▶ Scan Now';
  }
  setText('scanStatus', scanning ? 'Scanning 12 sources...' : '');
}

function showScanError(msg) {
  const el = document.getElementById('scanStatus');
  if (el) {
    el.textContent = `⚠ ${msg}`;
    el.style.color = 'var(--red)';
    setTimeout(() => { el.textContent = ''; el.style.color = ''; }, 8000);
  }
  console.warn('[SIGNAL]', msg);
}

// ============================================================
//  CLAUDE PROMPT
// ============================================================
const SYSTEM_PROMPT = `You are an expert stock market signal scanner specializing in small and mid-cap stocks ($50M–$2B market cap) with potential for 20%+ single-day price moves.

TARGET CRITERIA:
- Market cap $50M–$2B ONLY. Exclude large caps (AAPL, MSFT, GOOGL, AMZN etc.) — they rarely move 20%+ in one day.
- Hard catalyst confirmed TODAY within the last 4 hours: FDA decision, earnings surprise, M&A deal, SEC 8-K material event, short squeeze, clinical trial result, contract win, regulatory ruling, bankruptcy filing.
- Price already moving 3%+ OR volume 3x+ above average right now.
- Realistic 20%+ upside potential within the same trading day.

STRICT RULES:
- Only return signals with a REAL verifiable source URL you actually found.
- Never return long-term investment thesis plays ("stock could rise over the next months").
- Never pad results — if 1 qualifies return 1, if 0 qualify return [].
- Reject catalysts older than 4 hours.
- Short squeezes: require short interest >15% float AND confirmed unusual options activity.
- Ignore stocks already up 30%+ today (move likely exhausted).

CATALYST PRIORITY (highest to lowest):
FDA approval/rejection > M&A definitive agreement > Earnings surprise + guidance change > 8-K material event > Short squeeze > Regulatory ruling

CONFIDENCE:
85-100 = Hard binary catalyst + volume confirmation → urgency: critical
70-84  = Strong catalyst, partial confirmation      → urgency: high
50-69  = Developing situation                       → urgency: medium
Below 50 = DO NOT RETURN

SOURCES (search in this order):
1. SEC EDGAR (sec.gov) — 8-K filings last 4 hours
2. Benzinga (benzinga.com) — breaking small cap news
3. Finviz (finviz.com) — unusual volume, gap ups
4. PR Newswire (prnewswire.com) — press releases
5. BusinessWire (businesswire.com) — small cap announcements
6. Seeking Alpha (seekingalpha.com) — catalyst alerts, squeeze setups
7. StockAnalysis (stockanalysis.com) — earnings surprises
8. OTC Markets (otcmarkets.com) — micro/small cap filings
9. MarketWatch (marketwatch.com) — move confirmation
10. Reuters (reuters.com) — hard news verification
11. Motley Fool (fool.com) — catalyst context
12. Yahoo Finance (finance.yahoo.com) — volume and price confirmation

Return ONLY a raw JSON array. No markdown. No explanation. No preamble.

Every signal object MUST have ALL these fields:
{
  "ticker": "uppercase 1-5 letter symbol",
  "company": "full company name",
  "urgency": "critical|high|medium",
  "move": number (positive=up e.g. 18.4, negative=down e.g. -9.3),
  "volume": "e.g. 8.2x",
  "confidence": number 50-100,
  "upside": "e.g. +24% or -15%",
  "marketCap": "e.g. $340M",
  "time": "e.g. 09:47 ET",
  "headline": "one sentence describing exactly what happened",
  "catalyst": "e.g. FDA Approval",
  "catalystTag": "tag-fda|tag-earn|tag-ma|tag-short|tag-8k|tag-macro",
  "reasoning": "2-4 sentences. Use <em> tags around key numbers and facts.",
  "sources": [{"pub":"name","icon":"emoji","time":"09:41 ET","headline":"exact headline","url":"full real URL"}]
}

If nothing qualifies: []`;

function buildUserPrompt() {
  const et = getNowET();
  const t  = et.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const d  = et.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `Current time: ${t} ET, ${d}

Search all 12 sources RIGHT NOW for small/mid cap stocks ($50M–$2B) with hard catalysts confirmed in the last 4 hours.

Look specifically for:
- SEC EDGAR 8-K filings from the last 4 hours for small cap companies
- FDA decisions, PDUFA dates, clinical trial results announced today
- Earnings releases showing surprise beats or misses with guidance changes
- M&A announcements, definitive merger agreements, acquisition offers at a premium
- Stocks showing 3x+ normal volume with a confirmed news catalyst
- Short squeeze setups: confirmed short interest >15% float AND unusual call option activity today

Return only signals with genuine 20%+ single-day move potential. Small/mid cap only. Hard catalysts confirmed today only. Return [] if nothing qualifies.`;
}

// ============================================================
//  CLAUDE API CALL
// ============================================================
async function callClaude(apiKey, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system:     SYSTEM_PROMPT,
      tools:      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      messages:   [{ role: 'user', content: userPrompt }]
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body}`);
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

// ============================================================
//  RESPONSE PARSER
// ============================================================
function parseSignals(raw) {
  if (!raw) return [];
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const a = s.indexOf('['), z = s.lastIndexOf(']');
  if (a === -1 || z === -1 || z < a) { console.warn('[SIGNAL] No JSON array in response'); return []; }
  let parsed;
  try { parsed = JSON.parse(s.slice(a, z + 1)); } catch (e) { console.error('[SIGNAL] Parse error:', e.message); return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(validateSignal).filter(Boolean);
}

function validateSignal(r) {
  if (!r || typeof r !== 'object') return null;
  const ticker = String(r.ticker || '').toUpperCase().trim();
  if (!/^[A-Z]{1,5}$/.test(ticker)) return null;
  for (const f of ['company', 'headline', 'reasoning', 'sources']) {
    if (!r[f]) { console.warn(`[SIGNAL] ${ticker} missing ${f}`); return null; }
  }
  const sources = (Array.isArray(r.sources) ? r.sources : [])
    .filter(s => { if (!s?.url) return false; try { new URL(s.url); return true; } catch { return false; } })
    .map(s => ({
      pub: String(s.pub || 'Unknown').trim(),
      icon: String(s.icon || '📰').trim(),
      time: String(s.time || '').trim(),
      headline: String(s.headline || '').trim(),
      url: String(s.url).trim()
    }));
  if (sources.length === 0) { console.warn(`[SIGNAL] ${ticker} no valid URLs`); return null; }

  const confidence = Math.min(100, Math.max(50, parseInt(r.confidence) || 50));
  let urgency = r.urgency;
  if (!['critical', 'high', 'medium'].includes(urgency))
    urgency = confidence >= 85 ? 'critical' : confidence >= 70 ? 'high' : 'medium';

  const validTags = ['tag-fda', 'tag-earn', 'tag-ma', 'tag-short', 'tag-8k', 'tag-macro'];
  const catalystTag = validTags.includes(r.catalystTag) ? r.catalystTag : 'tag-macro';
  const defaultTime = getNowET().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  return {
    id:          `${ticker}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ticker,
    company:     String(r.company   || '').trim(),
    urgency,
    move:        parseFloat(r.move) || 0,
    volume:      String(r.volume    || '—').trim(),
    confidence,
    upside:      String(r.upside    || '—').trim(),
    marketCap:   String(r.marketCap || '—').trim(),
    time:        String(r.time      || defaultTime).trim(),
    headline:    String(r.headline  || '').trim(),
    catalyst:    String(r.catalyst  || 'Unknown').trim(),
    catalystTag,
    reasoning:   String(r.reasoning || '').trim(),
    sources,
    scannedAt:   new Date().toISOString(),
    outcome:     'pending',
    outcomeMsg:  'Outcome check available 1 hour after signal.',
    basePrice:   null,
    checkPrice:  null
  };
}

// ============================================================
//  PRICE FETCHING
// ============================================================
async function fetchStockPrice(ticker) {
  const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(yUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data   = await res.json();
      const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
      if (!Array.isArray(closes)) continue;
      for (let i = closes.length - 1; i >= 0; i--)
        if (closes[i] != null) return parseFloat(closes[i].toFixed(4));
    } catch (e) { console.warn(`[SIGNAL] Price proxy failed (${ticker}):`, e.message); }
  }
  return null;
}

async function fetchBasePrice(signal) {
  const price = await fetchStockPrice(signal.ticker);
  if (price !== null) {
    updateSignalInStorage(signal.id, { basePrice: price });
    console.log(`[SIGNAL] Base price ${signal.ticker}: $${price}`);
  }
}

// ============================================================
//  OUTCOME TRACKER
// ============================================================
async function checkOutcome(signalId) {
  const all    = loadSignals();
  const signal = all.find(s => s.id === signalId);
  if (!signal || signal.outcome !== 'pending') return;

  setOutcomeBtnState(signalId, 'loading');
  const current = await fetchStockPrice(signal.ticker);

  if (current === null) {
    updateSignalInStorage(signalId, {
      outcome:    'unverified',
      outcomeMsg: `Price unavailable — verify at finance.yahoo.com/quote/${signal.ticker}`
    });
    refreshDetailIfActive(signalId);
    return;
  }
  if (!signal.basePrice) {
    updateSignalInStorage(signalId, {
      outcome:    'unverified',
      outcomeMsg: `Base price not recorded. Current: $${current}`,
      checkPrice: current
    });
    refreshDetailIfActive(signalId);
    return;
  }

  const actualPct = ((current - signal.basePrice) / signal.basePrice) * 100;
  const actual    = parseFloat(actualPct.toFixed(2));
  const isHit     = (signal.move >= 0 ? actual >= 0 : actual <= 0) && Math.abs(actual) >= HIT_THRESHOLD_PCT;
  const pSign     = signal.move >= 0 ? '+' : '';
  const aSign     = actual >= 0 ? '+' : '';

  updateSignalInStorage(signalId, {
    outcome:    isHit ? 'hit' : 'miss',
    outcomeMsg: `${pSign}${signal.move}% signal → ${aSign}${actual}% actual. ${isHit ? 'HIT ✓' : 'MISS ✗'} (Base $${signal.basePrice} → Now $${current})`,
    checkPrice: current
  });
  refreshDetailIfActive(signalId);
  if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
  console.log(`[SIGNAL] Outcome ${signal.ticker}: ${isHit ? 'HIT' : 'MISS'}`);
}

function isOutcomeCheckReady(signal) {
  if (signal.outcome !== 'pending') return false;
  return Date.now() - new Date(signal.scannedAt).getTime() >= OUTCOME_DELAY_MS;
}

function setOutcomeBtnState(signalId, state) {
  const btn = document.getElementById(`outcome-btn-${signalId}`);
  if (!btn) return;
  if (state === 'loading') { btn.textContent = '⟳ Checking...'; btn.disabled = true; }
}

// ============================================================
//  STORAGE
// ============================================================
function saveSignals(signals) {
  const cutoff  = Date.now() - ONE_MONTH_MS;
  const trimmed = signals.filter(s => new Date(s.scannedAt).getTime() > cutoff);
  try {
    localStorage.setItem(SIGNALS_KEY, JSON.stringify(trimmed));
  } catch (e) {
    const shorter = trimmed.slice(0, Math.floor(trimmed.length * 0.8));
    try { localStorage.setItem(SIGNALS_KEY, JSON.stringify(shorter)); } catch (_) {}
  }
}

function loadSignals() {
  try {
    const raw = localStorage.getItem(SIGNALS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function updateSignalInStorage(id, updates) {
  const all = loadSignals();
  const idx = all.findIndex(s => s.id === id);
  if (idx !== -1) { all[idx] = { ...all[idx], ...updates }; saveSignals(all); }
}

// ============================================================
//  SIGNAL FILTERS
// ============================================================
function getSignalsToday() {
  const today = getNowET().toDateString();
  return loadSignals().filter(s => new Date(s.scannedAt).toDateString() === today);
}
function getSignalsLast24h() {
  const cut = Date.now() - 24 * 60 * 60 * 1000;
  return loadSignals().filter(s => new Date(s.scannedAt).getTime() > cut);
}
function getSignalsLast7d() {
  const cut = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return loadSignals().filter(s => new Date(s.scannedAt).getTime() > cut);
}
function getSignalsLast30d() { return loadSignals(); }

// ============================================================
//  DEDUPLICATION
// ============================================================
function deduplicateSignals(newSignals, existing) {
  const cut = Date.now() - 30 * 60 * 1000;
  const recentTickers = new Set(
    existing.filter(s => new Date(s.scannedAt).getTime() > cut).map(s => s.ticker)
  );
  return newSignals.filter(s => {
    if (recentTickers.has(s.ticker)) { console.log(`[SIGNAL] Deduped ${s.ticker}`); return false; }
    return true;
  });
}

// ============================================================
//  ANALYTICS
// ============================================================
function calcAccuracy(signals) {
  const checked = signals.filter(s => s.outcome === 'hit' || s.outcome === 'miss');
  if (checked.length === 0) return null;
  const hits    = checked.filter(s => s.outcome === 'hit').length;
  const overall = parseFloat(((hits / checked.length) * 100).toFixed(1));

  const byUrgency = {};
  for (const tier of ['critical', 'high', 'medium']) {
    const t = checked.filter(s => s.urgency === tier);
    byUrgency[tier] = t.length
      ? { pct: parseFloat(((t.filter(s => s.outcome === 'hit').length / t.length) * 100).toFixed(1)), total: t.length }
      : null;
  }
  const byCatalyst = {};
  for (const cat of [...new Set(checked.map(s => s.catalyst))]) {
    const c = checked.filter(s => s.catalyst === cat);
    byCatalyst[cat] = { pct: parseFloat(((c.filter(s => s.outcome === 'hit').length / c.length) * 100).toFixed(1)), total: c.length };
  }
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDay = {};
  for (let d = 0; d < 7; d++) {
    const ds = checked.filter(s => new Date(s.scannedAt).getDay() === d);
    if (ds.length) byDay[days[d]] = { pct: parseFloat(((ds.filter(s => s.outcome === 'hit').length / ds.length) * 100).toFixed(1)), total: ds.length };
  }
  const byHourMap = {};
  for (const s of checked) {
    const h = new Date(new Date(s.scannedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
    if (!byHourMap[h]) byHourMap[h] = { hits: 0, total: 0 };
    byHourMap[h].total++;
    if (s.outcome === 'hit') byHourMap[h].hits++;
  }
  const byHour = {};
  for (const [h, v] of Object.entries(byHourMap))
    byHour[h] = { pct: parseFloat(((v.hits / v.total) * 100).toFixed(1)), total: v.total };

  const movePct = s => s.basePrice && s.checkPrice ? Math.abs(((s.checkPrice - s.basePrice) / s.basePrice) * 100) : null;
  const avg = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
  const hMoves = checked.filter(s => s.outcome === 'hit'  && movePct(s) !== null).map(movePct);
  const mMoves = checked.filter(s => s.outcome === 'miss' && movePct(s) !== null).map(movePct);

  return { overall, total: checked.length, hits, misses: checked.length - hits,
    pending: signals.filter(s => s.outcome === 'pending').length,
    byUrgency, byCatalyst, byDay, byHour, avgHitMove: avg(hMoves), avgMissMove: avg(mMoves) };
}

function getAnalytics() {
  return {
    allTime: calcAccuracy(loadSignals()),
    today:   calcAccuracy(getSignalsToday()),
    h24:     calcAccuracy(getSignalsLast24h()),
    d7:      calcAccuracy(getSignalsLast7d()),
    d30:     calcAccuracy(getSignalsLast30d())
  };
}

// ============================================================
//  CSV EXPORT
// ============================================================
function exportCSV(signals) {
  const headers = ['Ticker','Company','Date','Time','Urgency','Catalyst','Move%','Confidence','Upside','MarketCap','Outcome','BasePrice','CheckPrice','Headline'];
  const rows = signals.map(s => [
    s.ticker, `"${(s.company||'').replace(/"/g,'""')}"`,
    new Date(s.scannedAt).toLocaleDateString(), s.time, s.urgency, s.catalyst,
    s.move, s.confidence, s.upside, s.marketCap, s.outcome,
    s.basePrice||'', s.checkPrice||'',
    `"${(s.headline||'').replace(/"/g,'""')}"`
  ]);
  const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `signal_${new Date().toISOString().slice(0,10)}.csv` });
  a.click(); URL.revokeObjectURL(url);
}

// ============================================================
//  MAIN SCAN RUNNER
// ============================================================
async function runScan(apiKey) {
  console.log('[SIGNAL] Scan started:', new Date().toISOString());
  const raw        = await callClaude(apiKey, buildUserPrompt());
  const newSignals = parseSignals(raw);
  if (newSignals.length === 0) { console.log('[SIGNAL] No qualifying signals.'); updateScanCompleteUI(0); return; }
  const existing = loadSignals();
  const unique   = deduplicateSignals(newSignals, existing);
  if (unique.length === 0) { console.log('[SIGNAL] All duplicates.'); updateScanCompleteUI(0); return; }
  unique.forEach(s => fetchBasePrice(s));
  saveSignals([...unique, ...existing]);
  updateScanCompleteUI(unique.length, unique);
  console.log(`[SIGNAL] ${unique.length} signal(s) saved.`);
}

// ============================================================
//  UI HOOKS
// ============================================================
function updateScanCompleteUI(count, newSignals = []) {
  const todayCount = getSignalsToday().length;
  setText('signalCount', todayCount);
  const mc = document.getElementById('signalCountMobile');
  if (mc) mc.textContent = `${todayCount} signals`;
  if (typeof window.renderFeed      === 'function') window.renderFeed();
  if (typeof window.renderSidebar   === 'function') window.renderSidebar();
  if (typeof window.flashNewSignals === 'function' && newSignals.length)
    window.flashNewSignals(newSignals.map(s => s.id));
}

function refreshDetailIfActive(signalId) {
  if (window.activeSignalId === signalId && typeof window.renderDetail === 'function')
    window.renderDetail(signalId);
}

// ============================================================
//  INIT
// ============================================================
function initScanner() {
  const saved = (() => { try { return localStorage.getItem(API_KEY_STORAGE); } catch { return ''; } })();
  const inp   = document.getElementById('apiKeyInput');
  if (saved && inp) inp.value = saved;

  const connectBtn = document.getElementById('connectBtn');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      const key = getApiKey();
      if (key) {
        connectBtn.textContent      = '✓ Connected';
        connectBtn.style.background = 'var(--green)';
        connectBtn.style.color      = '#0a0c11';
        setTimeout(() => { connectBtn.textContent = 'Connect'; connectBtn.style.background = ''; connectBtn.style.color = ''; }, 2000);
      }
    });
  }

  const scanBtn = document.getElementById('scanBtn');
  if (scanBtn) scanBtn.addEventListener('click', triggerManualScan);

  updateMarketStatusDisplay();
  nextScanAt = calcNextScanTime();
  startScheduler();
  console.log('[SIGNAL] Ready | Market:', isMarketOpen() ? 'OPEN' : 'CLOSED', '| Next scan:', nextScanAt.toLocaleTimeString());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initScanner);
} else {
  initScanner();
}

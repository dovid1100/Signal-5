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

// ── Sector ETFs ───────────────────────────────────────────────
const SECTOR_ETFS = [
  { sym: 'XBI',  label: 'Biotech'    },
  { sym: 'XLV',  label: 'Healthcare' },
  { sym: 'XLK',  label: 'Technology' },
  { sym: 'XLE',  label: 'Energy'     },
  { sym: 'XLF',  label: 'Financials' },
  { sym: 'ARKK', label: 'Innovation' },
  { sym: 'IWM',  label: 'Small-Cap'  },
  { sym: 'QQQ',  label: 'Nasdaq-100' },
  { sym: 'SPY',  label: 'S&P 500'    },
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
  notifications:   false,
  momentumEnabled: true,
  momentumMinMove: 5,
};

// ── Runtime State ─────────────────────────────────────────────
let isScanning     = false;
let schedulerTimer = null;
let nextScanAt     = null;
let lastScanError  = null;
window.lastScanDiagnostic = null;

// ============================================================
//  SETTINGS
// ============================================================
function loadSettings() {
  try { const raw = localStorage.getItem(SETTINGS_KEY); return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s)        { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch(_){} }
function getSetting(key)        { return loadSettings()[key]; }
function updateSetting(key,val) { const s=loadSettings(); s[key]=val; saveSettings(s); applySettingsToApp(s); }
function getMcapPreset()        { return MCAP_PRESETS.find(p=>p.id===(getSetting('mcapPreset')||'small'))||MCAP_PRESETS[1]; }
function getHoursPreset()       { return HOURS_PRESETS.find(p=>p.id===(getSetting('hoursPreset')||'market'))||HOURS_PRESETS[0]; }

function applyHoursPreset(id) {
  const s=loadSettings(), preset=HOURS_PRESETS.find(p=>p.id===id); if (!preset) return;
  s.hoursPreset=id;
  if (preset.open&&preset.close) { s.marketOpenHour=preset.open.h; s.marketOpenMin=preset.open.m; s.marketCloseHour=preset.close.h; s.marketCloseMin=preset.close.m; }
  saveSettings(s); applySettingsToApp(s);
}

function applySettingsToApp(s) {
  const colors = { blue:{main:'#3EC9FF',dim:'rgba(62,201,255,.10)',glow:'rgba(62,201,255,.20)'}, green:{main:'#20E090',dim:'rgba(32,224,144,.10)',glow:'rgba(32,224,144,.20)'}, purple:{main:'#B06EFF',dim:'rgba(176,110,255,.10)',glow:'rgba(176,110,255,.20)'}, gold:{main:'#FFB020',dim:'rgba(255,176,32,.10)',glow:'rgba(255,176,32,.20)'} };
  const c=colors[s.accentColor]||colors.blue;
  document.documentElement.style.setProperty('--blue',     c.main);
  document.documentElement.style.setProperty('--blue-dim', c.dim);
  document.documentElement.style.setProperty('--blue-glow',c.glow);
  const sizes={small:'11px',medium:'13px',large:'15px'};
  document.documentElement.style.setProperty('--base-font',sizes[s.fontSize]||'13px');
  document.documentElement.setAttribute('data-compact',s.compactMode?'1':'0');
}

function resetSettings() { saveSettings({...DEFAULT_SETTINGS}); applySettingsToApp(DEFAULT_SETTINGS); applyTheme('dark'); }
function clearAllData()   { [SIGNALS_KEY,PINS_KEY,NOTES_KEY,ARCHIVE_KEY,SCAN_COUNT_KEY,LAST_SCAN_KEY].forEach(k=>{try{localStorage.removeItem(k);}catch(_){}}); }

// ============================================================
//  THEME
// ============================================================
function getTheme()    { try { return localStorage.getItem(THEME_KEY)||'dark'; } catch { return 'dark'; } }
function toggleTheme() { applyTheme(getTheme()==='dark'?'light':'dark'); }
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme',t);
  try { localStorage.setItem(THEME_KEY,t); } catch(_){}
  const btn=document.getElementById('themeToggleBtn');
  if (btn) btn.textContent=t==='dark'?'☀ Switch to Light Mode':'☾ Switch to Dark Mode';
}

// ============================================================
//  MARKET HOURS
// ============================================================
function getNowET() { return new Date(new Date().toLocaleString('en-US',{timeZone:'America/New_York'})); }

function isMarketOpen() {
  const s=loadSettings(), preset=getHoursPreset(), et=getNowET(), day=et.getDay();
  if (!preset.allDays&&(day===0||day===6)) return false;
  const mins=(et.getHours()*60+et.getMinutes()), open=(s.marketOpenHour||9)*60+(s.marketOpenMin||30), close=(s.marketCloseHour||16)*60+(s.marketCloseMin||0);
  if (preset.id==='24h') return true;
  return mins>=open&&mins<close;
}

function msUntilNextMarketOpen() {
  const s=loadSettings(), preset=getHoursPreset(), et=getNowET(), day=et.getDay();
  const sec=et.getHours()*3600+et.getMinutes()*60+et.getSeconds();
  const openSec=(s.marketOpenHour||9)*3600+(s.marketOpenMin||30)*60;
  const closeSec=(s.marketCloseHour||16)*3600+(s.marketCloseMin||0)*60;
  if (preset.id==='24h') return 0;
  let daysAhead=0;
  if (day===6) daysAhead=2; else if (day===0) daysAhead=1; else if (sec>=closeSec) daysAhead=(day===5)?3:1;
  const su=daysAhead===0?openSec-sec:(86400-sec)+(daysAhead-1)*86400+openSec;
  return Math.max(0,su*1000);
}

function isPreMarket() {
  const et=getNowET(), day=et.getDay();
  if (day===0||day===6) return false;
  const mins=et.getHours()*60+et.getMinutes();
  return mins>=4*60&&mins<9*60+30;
}
function isAfterHours() {
  const et=getNowET(), day=et.getDay();
  if (day===0||day===6) return false;
  const mins=et.getHours()*60+et.getMinutes();
  return mins>=16*60&&mins<20*60;
}

// ============================================================
//  HAPTIC / PWA
// ============================================================
function haptic(type='light') { if (!navigator.vibrate) return; const p={light:[10],medium:[20],heavy:[30,10,30],signal:[50,30,50,30,100]}; navigator.vibrate(p[type]||p.light); }
async function setBadge(count) { try { if ('setAppBadge' in navigator) { if (count>0) await navigator.setAppBadge(count); else await navigator.clearAppBadge(); } } catch(_){} }

// ============================================================
//  LOCK
// ============================================================
function acquireScanLock() {
  try { const raw=localStorage.getItem('signal_scan_lock'); if (raw){const l=JSON.parse(raw);if(Date.now()-l.ts<90000)return false;} localStorage.setItem('signal_scan_lock',JSON.stringify({ts:Date.now()})); return true; }
  catch { return true; }
}
function releaseScanLock() { try { localStorage.removeItem('signal_scan_lock'); } catch(_){} }
function getApiKey()       { try { return localStorage.getItem(API_KEY_STORAGE)||''; } catch { return ''; } }

// ============================================================
//  ERROR DISPLAY
// ============================================================
function showScanError(msg) {
  lastScanError=msg; window.lastScanDiagnostic={type:'error',msg,ts:Date.now()};
  const el=document.getElementById('scanStatus');
  if (el) { el.textContent=`⚠ ${msg.slice(0,60)}`; el.style.color='var(--red)'; setTimeout(()=>{el.textContent='';el.style.color='';},10000); }
  showErrorBanner(msg);
  if (typeof window.renderFeed==='function'&&window.activeTab==='feed') window.renderFeed();
}

function showErrorBanner(msg) {
  let b=document.getElementById('errorBanner');
  if (!b) { b=document.createElement('div'); b.id='errorBanner'; b.style.cssText='position:fixed;bottom:80px;left:12px;right:12px;z-index:600;background:#1a0808;border:1px solid var(--red);border-radius:10px;padding:13px 15px;font-size:11px;color:var(--red);line-height:1.7;box-shadow:0 4px 24px rgba(255,69,96,.2);animation:slide-up .3s ease both'; document.body.appendChild(b); }
  let help='→ Tap Settings and verify your API key is correct.';
  if (msg.includes('401')||msg.includes('authentication')||msg.includes('API key')) help='→ Go to Settings and re-paste your API key, then tap Connect.';
  else if (msg.includes('429')||msg.includes('rate')) help='→ Rate limited. Wait 1–2 minutes then scan again.';
  else if (msg.includes('529')||msg.includes('overloaded')) help='→ Anthropic servers are busy. Try again in a minute.';
  else if (msg.includes('400')) help='→ Bad request. Check your API key has web search access.';
  else if (msg.includes('network')||msg.includes('fetch')||msg.includes('Failed')) help='→ Network error. Check your internet connection.';
  b.innerHTML=`<div style="display:flex;align-items:flex-start;gap:10px"><div style="font-size:18px;flex-shrink:0">⚠</div><div style="flex:1"><div style="font-weight:600;margin-bottom:3px">Scan Failed</div><div style="color:rgba(255,100,100,.8);font-size:10px;margin-bottom:5px;word-break:break-all">${msg}</div><div style="color:var(--amber);font-size:10px">${help}</div></div><button onclick="document.getElementById('errorBanner').remove()" style="background:none;border:none;color:var(--muted);font-size:16px;cursor:pointer;padding:0;flex-shrink:0;line-height:1">✕</button></div>`;
}

function clearErrorBanner() { const b=document.getElementById('errorBanner'); if(b)b.remove(); lastScanError=null; window.lastScanDiagnostic=null; }

// ============================================================
//  SCHEDULER
// ============================================================
function calcNextScanTime() { const i=(getSetting('scanInterval')||5)*60*1000; return isMarketOpen()?new Date(Date.now()+i):new Date(Date.now()+msUntilNextMarketOpen()); }

function startScheduler() {
  if (schedulerTimer) clearInterval(schedulerTimer);
  if (!nextScanAt) nextScanAt=calcNextScanTime();
  schedulerTimer=setInterval(()=>{
    const msLeft=nextScanAt-Date.now();
    updateCountdownDisplay(msLeft); updateMarketStatusDisplay();
    if (msLeft<=30000&&msLeft>0&&!isScanning&&isMarketOpen()) triggerScan({isPreload:true});
    if (msLeft<=0&&!isScanning) { nextScanAt=calcNextScanTime(); if (isMarketOpen()) triggerScan(); }
  },500);
}

// ============================================================
//  TRIGGER SCAN
// ============================================================
async function triggerScan({isPreload=false,isManual=false}={}) {
  if (isScanning) return;
  const apiKey=getApiKey();
  if (!apiKey) { showScanError('No API key — go to Settings and paste your key.'); return; }
  if (!isManual&&!isMarketOpen()) { nextScanAt=calcNextScanTime(); return; }
  if (!acquireScanLock()) return;
  clearErrorBanner(); isScanning=true; setScanningState(true,isPreload);
  try {
    await runScan(apiKey);
    try { localStorage.setItem(LAST_SCAN_KEY,new Date().toISOString()); } catch(_){}
    try { localStorage.setItem(SCAN_COUNT_KEY,String((parseInt(localStorage.getItem(SCAN_COUNT_KEY)||'0'))+1)); } catch(_){}
    if (!isManual) nextScanAt=calcNextScanTime();
  } catch(err) { console.error('[SIGNAL] Scan error:',err); showScanError(err.message||'Unknown error'); }
  finally { isScanning=false; releaseScanLock(); setScanningState(false); }
}

function triggerManualScan() { haptic('medium'); triggerScan({isManual:true}); }

document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') resyncScheduler(); });
window.addEventListener('pageshow',resyncScheduler);
window.addEventListener('focus',resyncScheduler);

function resyncScheduler() {
  if (nextScanAt&&Date.now()>nextScanAt) { nextScanAt=calcNextScanTime(); if(isMarketOpen()&&!isScanning) triggerScan(); }
  startScheduler();
}

// ============================================================
//  PULL TO REFRESH
// ============================================================
function initPullToRefresh() {
  let startY=0,startX=0,pulling=false;
  const detail=document.getElementById('detailArea'); if (!detail) return;
  detail.addEventListener('touchstart',e=>{ if(detail.scrollTop===0){startY=e.touches[0].clientY;startX=e.touches[0].clientX;pulling=true;} },{passive:true});
  detail.addEventListener('touchmove',e=>{ if(!pulling)return; const dy=e.touches[0].clientY-startY,dx=e.touches[0].clientX-startX; if(Math.abs(dx)>Math.abs(dy)){pulling=false;return;} if(dy>60){const ind=document.getElementById('pullIndicator');if(ind)ind.style.opacity='1';} },{passive:true});
  detail.addEventListener('touchend',e=>{ if(!pulling)return; pulling=false; const dy=e.changedTouches[0].clientY-startY,dx=e.changedTouches[0].clientX-startX; const ind=document.getElementById('pullIndicator'); if(ind)ind.style.opacity='0'; if(dy>60&&Math.abs(dx)<Math.abs(dy)){ haptic('light'); if(window.activeTab==='watchlist'){if(typeof window.renderWatchlist==='function')window.renderWatchlist();}else triggerManualScan(); } });
}

// ============================================================
//  UI HELPERS
// ============================================================
function pad(n) { return String(n).padStart(2,'0'); }
function setText(id,val) { const el=document.getElementById(id); if(el)el.textContent=val; }

function updateCountdownDisplay(msLeft) {
  const ms=isMarketOpen()?Math.max(0,msLeft):msUntilNextMarketOpen(), tot=Math.floor(ms/1000);
  const hh=Math.floor(tot/3600),mm=Math.floor((tot%3600)/60),ss=tot%60;
  const str=hh>0?`${pad(hh)}:${pad(mm)}:${pad(ss)}`:`${pad(mm)}:${pad(ss)}`;
  setText('countdown',str); setText('countdown-mobile',str);
}

function updateMarketStatusDisplay() {
  const el=document.getElementById('marketStatus'); if(!el) return;
  const label=isPreMarket()?'Pre-Market':isAfterHours()?'After Hours':isMarketOpen()?'Market Open':'Market Closed';
  const cls=isMarketOpen()?'dot-green':(isPreMarket()||isAfterHours())?'dot-amber':'dot-red';
  el.innerHTML=`<span class="stat-dot ${cls}"></span> ${label}`;
}

function setScanningState(scanning,isPreload=false) {
  const btn=document.getElementById('scanBtn');
  if(btn){ btn.disabled=scanning; btn.textContent=scanning?(isPreload?'⟳ Preparing...':'⟳ Scanning...'):'▶ Scan Now'; }
}

function skeletonHTML(rows=3) { return Array.from({length:rows},()=>'<div class="skeleton-row"><div class="skeleton-ticker skel"></div><div class="skeleton-body skel"></div><div class="skeleton-badge skel"></div></div>').join(''); }

function animateCount(el,target,suffix='',duration=800) {
  if(!el)return; const step=target/(duration/16); let cur=0;
  const t=setInterval(()=>{ cur=Math.min(cur+step,target); el.textContent=parseFloat(cur.toFixed(1))+suffix; if(cur>=target)clearInterval(t); },16);
}

// ============================================================
//  NOTIFICATIONS
// ============================================================
async function requestNotificationPermission() {
  if(!('Notification' in window))return false; if(Notification.permission==='granted')return true; if(Notification.permission==='denied')return false;
  return (await Notification.requestPermission())==='granted';
}
function fireNotification(signals) {
  if(!('Notification' in window)||Notification.permission!=='granted')return; if(document.visibilityState==='visible')return;
  signals.forEach(s=>{ const e=s.urgency==='critical'?'⚡':s.urgency==='high'?'▲':'●'; const n=new Notification(`${e} ${s.ticker} — SIGNAL`,{body:`${s.move>=0?'+':''}${s.move}% · ${s.catalyst} · ${s.headline.slice(0,80)}`,icon:'/icon-192.png',tag:`signal-${s.id}`,requireInteraction:s.urgency==='critical'}); n.onclick=()=>{window.focus();n.close();}; });
}

// ============================================================
//  PINS / NOTES / ARCHIVE
// ============================================================
function getPins()     { try{return JSON.parse(localStorage.getItem(PINS_KEY)||'[]');}catch{return[];} }
function getNotes()    { try{return JSON.parse(localStorage.getItem(NOTES_KEY)||'{}');}catch{return{};} }
function getArchive()  { try{return JSON.parse(localStorage.getItem(ARCHIVE_KEY)||'[]');}catch{return[];} }
function savePins(p)   { try{localStorage.setItem(PINS_KEY,JSON.stringify(p));}catch(_){} }
function saveNotes(n)  { try{localStorage.setItem(NOTES_KEY,JSON.stringify(n));}catch(_){} }
function saveArchive(a){ try{localStorage.setItem(ARCHIVE_KEY,JSON.stringify(a));}catch(_){} }
function isPinned(id)  { return getPins().includes(id); }
function isArchived(id){ return getArchive().includes(id); }
function togglePin(id) { const p=getPins(),i=p.indexOf(id); i===-1?p.push(id):p.splice(i,1); savePins(p); }
function archiveSignal(id){ const a=getArchive(); if(!a.includes(id))a.push(id); saveArchive(a); }
function getNote(id)   { return getNotes()[id]||''; }
function saveNote(id,text){ const n=getNotes(); text.trim()?n[id]=text.trim():delete n[id]; saveNotes(n); }

// ============================================================
//  WATCHLIST
// ============================================================
function loadWatchlist()  { try{return JSON.parse(localStorage.getItem(WATCHLIST_KEY)||'[]');}catch{return[];} }
function saveWatchlist(w) { try{localStorage.setItem(WATCHLIST_KEY,JSON.stringify(w));}catch(_){} }

function addToWatchlist(ticker) {
  const w=loadWatchlist(),t=ticker.toUpperCase().trim();
  if(!t||!/^[A-Z]{1,5}$/.test(t)||w.find(x=>x.ticker===t))return false;
  w.push({ticker:t,addedAt:new Date().toISOString(),addedPrice:null}); saveWatchlist(w); return true;
}
function removeFromWatchlist(ticker){ saveWatchlist(loadWatchlist().filter(x=>x.ticker!==ticker.toUpperCase())); }
function isOnWatchlist(ticker)      { return !!loadWatchlist().find(x=>x.ticker===ticker.toUpperCase()); }

async function fetchPreviousClose(ticker) {
  const yUrl=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
  const proxies=[`https://corsproxy.io/?${encodeURIComponent(yUrl)}`,`https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`];
  for (const proxy of proxies) {
    try { const res=await fetch(proxy,{signal:AbortSignal.timeout(10000)});if(!res.ok)continue; const data=await res.json(); const closes=data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close; if(!Array.isArray(closes)||closes.length<2)continue; for(let i=closes.length-2;i>=0;i--)if(closes[i]!=null)return parseFloat(closes[i].toFixed(4)); } catch(e){console.warn('[SIGNAL] PrevClose:',e.message);}
  }
  return null;
}

async function fetchStockMeta(ticker) {
  const yUrl=`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,calendarEvents`;
  const proxy=`https://corsproxy.io/?${encodeURIComponent(yUrl)}`;
  try { const res=await fetch(proxy,{signal:AbortSignal.timeout(10000)});if(!res.ok)return{}; const data=await res.json(); const stats=data?.quoteSummary?.result?.[0]; const shortPct=stats?.defaultKeyStatistics?.shortPercentOfFloat?.fmt||null; const earningsArr=stats?.calendarEvents?.earnings?.earningsDate; let earningsDate=null; if(Array.isArray(earningsArr)&&earningsArr.length>0) earningsDate=new Date(earningsArr[0].raw*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'}); return{shortPct,earningsDate}; } catch{return{};}
}

function loadPriceAlerts()  { try{return JSON.parse(localStorage.getItem('signal_price_alerts')||'{}');}catch{return{};} }
function savePriceAlerts(a) { try{localStorage.setItem('signal_price_alerts',JSON.stringify(a));}catch(_){} }
function setPriceAlert(ticker,targetPrice,direction){ const a=loadPriceAlerts(); a[ticker]={targetPrice:parseFloat(targetPrice),direction,createdAt:new Date().toISOString()}; savePriceAlerts(a); }
function removePriceAlert(ticker){ const a=loadPriceAlerts(); delete a[ticker]; savePriceAlerts(a); }
function checkPriceAlerts(ticker,currentPrice){ const alert=loadPriceAlerts()[ticker]; if(!alert||!currentPrice)return; const triggered=alert.direction==='above'?currentPrice>=alert.targetPrice:currentPrice<=alert.targetPrice; if(triggered){fireNotification([{ticker,urgency:'high',move:0,catalyst:'Price Alert',headline:`${ticker} hit your target of $${alert.targetPrice}`,id:`alert_${ticker}_${Date.now()}`}]);haptic('signal');removePriceAlert(ticker);} }

async function fetchWatchlistNews(ticker,apiKey) {
  if(!apiKey)return[];
  try { const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:600,tools:[{type:'web_search_20250305',name:'web_search',max_uses:2}],messages:[{role:'user',content:`Find up to 3 recent news headlines about ${ticker} stock today. Return ONLY a JSON array, no markdown: [{"headline":"...","source":"...","url":"...","time":"..."}]. Return [] if nothing found.`}]})}); if(!res.ok)return[]; const data=await res.json(); const text=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''); const a=text.indexOf('['),z=text.lastIndexOf(']'); if(a===-1||z<a)return[]; return JSON.parse(text.slice(a,z+1)); } catch{return[];}
}

// ============================================================
//  AI SEARCH
// ============================================================
async function aiSearch(query,apiKey) {
  if(!apiKey||!query.trim())return{signals:[],explanation:'No query provided.'};
  const all=loadSignals(); if(!all.length)return{signals:[],explanation:'No signals in history yet.'};
  const summary=all.slice(0,50).map(s=>`${s.id}|${s.ticker}|${s.urgency}|${s.catalyst}|${s.move}%|${s.confidence}%|${s.outcome}|${new Date(s.scannedAt).toLocaleDateString()}`).join('\n');
  try {
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:600,messages:[{role:'user',content:`You are a stock signal search assistant.\n\nUser query: "${query}"\n\nSignal history:\n${summary}\n\nReturn ONLY JSON, no markdown:\n{"ids":["matching signal ids"],"explanation":"one short sentence"}\n\nReturn up to 10 best matches.`}]})});
    if(!res.ok){const t=await res.text();return{signals:[],explanation:`Search failed: API ${res.status}. ${t.slice(0,80)}`};}
    const data=await res.json(); const text=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''); const a=text.indexOf('{'),z=text.lastIndexOf('}'); if(a===-1||z<a)return{signals:[],explanation:'Could not parse search results.'};
    const parsed=JSON.parse(text.slice(a,z+1)); return{signals:all.filter(s=>(parsed.ids||[]).includes(s.id)),explanation:parsed.explanation||''};
  } catch(e){return{signals:[],explanation:`Search error: ${e.message}`};}
}

// ============================================================
//  PORTFOLIO
// ============================================================
function loadPortfolio()        { try{return JSON.parse(localStorage.getItem(PORTFOLIO_KEY)||'{"positions":[],"cashBalance":0}');}catch{return{positions:[],cashBalance:0};} }
function savePortfolio(p)       { try{localStorage.setItem(PORTFOLIO_KEY,JSON.stringify(p));}catch(_){} }
function loadPortfolioHistory() { try{return JSON.parse(localStorage.getItem(PORTFOLIO_HIST_KEY)||'[]');}catch{return[];} }
function savePortfolioHistory(h){ try{localStorage.setItem(PORTFOLIO_HIST_KEY,JSON.stringify(h));}catch(_){} }

function addPosition(ticker,shares,buyPrice) {
  const p=loadPortfolio(),t=ticker.toUpperCase().trim(),ex=p.positions.find(x=>x.ticker===t);
  if(ex){const tot=ex.shares+shares;ex.buyPrice=parseFloat(((ex.shares*ex.buyPrice+shares*buyPrice)/tot).toFixed(4));ex.shares=tot;}
  else p.positions.push({ticker:t,shares:parseFloat(shares),buyPrice:parseFloat(buyPrice),addedAt:new Date().toISOString()});
  savePortfolio(p); snapshotPortfolio();
}
function removePosition(ticker)       { const p=loadPortfolio();p.positions=p.positions.filter(x=>x.ticker!==ticker.toUpperCase());savePortfolio(p); }
function updatePortfolioCash(amount)  { const p=loadPortfolio();p.cashBalance=parseFloat(amount)||0;savePortfolio(p); }
function isInPortfolio(ticker)        { return !!loadPortfolio().positions.find(x=>x.ticker===ticker.toUpperCase()); }
function getPosition(ticker)          { return loadPortfolio().positions.find(x=>x.ticker===ticker.toUpperCase())||null; }

async function snapshotPortfolio() {
  const p=loadPortfolio(); if(!p.positions.length)return;
  const prices=await Promise.allSettled(p.positions.map(x=>fetchStockPrice(x.ticker)));
  let total=p.cashBalance||0;
  p.positions.forEach((pos,i)=>{const pr=prices[i].status==='fulfilled'?prices[i].value:null;total+=pr?pos.shares*pr:pos.shares*pos.buyPrice;});
  const hist=loadPortfolioHistory();
  hist.push({t:Date.now(),v:parseFloat(total.toFixed(2))});
  savePortfolioHistory(hist.filter(h=>h.t>Date.now()-90*24*60*60*1000));
}

function showPortfolioAlertBanner(signals) {
  const tickers=new Set(loadPortfolio().positions.map(x=>x.ticker));
  signals.filter(s=>tickers.has(s.ticker)).forEach(s=>{
    const pos=getPosition(s.ticker); const banner=document.createElement('div'); banner.className='portfolio-alert-banner';
    banner.innerHTML=`<div class="pab-icon">💼</div><div class="pab-body"><div class="pab-title">Signal fired for ${s.ticker} — you own ${pos.shares} shares</div><div class="pab-sub">${s.move>=0?'+':''}${s.move}% · ${s.catalyst} · ${s.headline.slice(0,60)}...</div></div><button class="pab-view" onclick="selectSignal('${s.id}');this.parentElement.remove()">View →</button><button class="pab-close" onclick="this.parentElement.remove()">✕</button>`;
    document.body.appendChild(banner); setTimeout(()=>{banner.style.opacity='0';setTimeout(()=>banner.remove(),400);},8000);
  });
  if (signals.some(s=>tickers.has(s.ticker))) haptic('signal');
}

async function updatePortfolioPnlHeader() {
  const p=loadPortfolio(); if(!p.positions.length)return;
  const prices=await Promise.allSettled(p.positions.map(x=>fetchStockPrice(x.ticker)));
  let curVal=p.cashBalance||0,costVal=p.cashBalance||0;
  p.positions.forEach((pos,i)=>{const pr=prices[i].status==='fulfilled'?prices[i].value:null;curVal+=pr?pos.shares*pr:pos.shares*pos.buyPrice;costVal+=pos.shares*pos.buyPrice;});
  const gl=curVal-costVal; const tab=document.querySelector('[data-tab="portfolio"]');
  if(tab){tab.style.color=gl>=0?'var(--green)':'var(--red)';tab.style.borderBottomColor=gl>=0?'var(--green)':'var(--red)';}
}

// ============================================================
//  ★ MARKET INTELLIGENCE — DATA ENRICHMENT
// ============================================================

async function fetchExtendedQuote(ticker) {
  const yUrl=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&prePost=true`;
  const proxies=[`https://corsproxy.io/?${encodeURIComponent(yUrl)}`,`https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`];
  for (const proxy of proxies) {
    try {
      const res=await fetch(proxy,{signal:AbortSignal.timeout(8000)});if(!res.ok)continue;
      const data=await res.json(); const result=data?.chart?.result?.[0]; if(!result)continue;
      const meta=result.meta||{};
      const price=meta.regularMarketPrice||null, prevClose=meta.chartPreviousClose||meta.previousClose||null;
      const prePrice=meta.preMarketPrice||null, postPrice=meta.postMarketPrice||null;
      const vol=meta.regularMarketVolume||null, avgVol=meta.averageDailyVolume10Day||null;
      const changeExt=(prePrice||postPrice)&&prevClose?parseFloat((((prePrice||postPrice)-prevClose)/prevClose*100).toFixed(2)):null;
      const volRatio=vol&&avgVol&&avgVol>0?parseFloat((vol/avgVol).toFixed(2)):null;
      // Also compute intraday change if regular market
      const changeToday=price&&prevClose?parseFloat(((price-prevClose)/prevClose*100).toFixed(2)):null;
      return{price,prevClose,prePrice,postPrice,changeExt,changeToday,vol,avgVol,volRatio};
    } catch(e){console.warn(`[SIGNAL] ExtQuote (${ticker}):`,e.message);}
  }
  return null;
}

async function fetchFundamentals(ticker) {
  const yUrl=`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=defaultKeyStatistics,summaryDetail,financialData`;
  const proxy=`https://corsproxy.io/?${encodeURIComponent(yUrl)}`;
  try {
    const res=await fetch(proxy,{signal:AbortSignal.timeout(10000)});if(!res.ok)return{};
    const data=await res.json(); const r=data?.quoteSummary?.result?.[0];
    const ks=r?.defaultKeyStatistics||{},sd=r?.summaryDetail||{},fd=r?.financialData||{};
    return{shortPct:ks.shortPercentOfFloat?.fmt||null,shortRatio:ks.shortRatio?.fmt||null,floatShares:ks.floatShares?.fmt||null,sharesOutstanding:ks.sharesOutstanding?.fmt||null,beta:ks.beta?.fmt||null,week52High:sd.fiftyTwoWeekHigh?.fmt||null,week52Low:sd.fiftyTwoWeekLow?.fmt||null,avgVol10d:sd.averageVolume10days?.fmt||null,avgVol3m:sd.averageVolume?.fmt||null,marketCap:sd.marketCap?.fmt||null};
  } catch{return{};}
}

async function fetchSectorContext() {
  const results=await Promise.allSettled(SECTOR_ETFS.map(async etf=>{
    const yUrl=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(etf.sym)}?interval=1d&range=2d`;
    const proxy=`https://corsproxy.io/?${encodeURIComponent(yUrl)}`;
    try{const res=await fetch(proxy,{signal:AbortSignal.timeout(8000)});if(!res.ok)return null;const data=await res.json();const closes=data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;if(!Array.isArray(closes)||closes.length<2)return null;const prev=closes[closes.length-2],cur=closes[closes.length-1];if(!prev||!cur)return null;return{sym:etf.sym,label:etf.label,pct:parseFloat(((cur-prev)/prev*100).toFixed(2)),cur:cur.toFixed(2)};}catch{return null;}
  }));
  return results.map(r=>r.status==='fulfilled'?r.value:null).filter(Boolean);
}

// ============================================================
//  ★ MOMENTUM SCANNER — fetch live top movers from Yahoo
// ============================================================

// Fetch top gainers using Yahoo Finance screener via proxy
async function fetchTopGainers(minChangePct = 5) {
  // Yahoo Finance top gainers endpoint
  const yUrl = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=25&start=0`;
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(yUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data = await res.json();
      const quotes = data?.finance?.result?.[0]?.quotes || [];
      if (!quotes.length) continue;
      return quotes
        .filter(q => q.regularMarketChangePercent >= minChangePct && q.marketCap > 50e6)
        .map(q => ({
          ticker:           q.symbol,
          company:          q.shortName || q.longName || q.symbol,
          changeToday:      parseFloat(q.regularMarketChangePercent.toFixed(2)),
          price:            q.regularMarketPrice,
          prevClose:        q.regularMarketPreviousClose,
          volume:           q.regularMarketVolume,
          avgVolume:        q.averageDailyVolume3Month || q.averageDailyVolume10Day,
          marketCap:        q.marketCap,
          high52w:          q.fiftyTwoWeekHigh,
          low52w:           q.fiftyTwoWeekLow,
          volRatio:         q.averageDailyVolume3Month > 0 ? parseFloat((q.regularMarketVolume / q.averageDailyVolume3Month).toFixed(2)) : null
        }));
    } catch(e) { console.warn('[SIGNAL] TopGainers fetch failed:', e.message); }
  }
  return [];
}

// Also fetch pre-market movers
async function fetchPreMarketMovers(minChangePct = 5) {
  const yUrl = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=day_gainers&count=25`;
  // For pre-market we pull regular day_gainers but look at preMarketChangePercent field
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(yUrl)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data = await res.json();
      const quotes = data?.finance?.result?.[0]?.quotes || [];
      if (!quotes.length) continue;
      // Filter those with significant pre-market moves
      return quotes
        .filter(q => {
          const pmChg = q.preMarketChangePercent;
          return pmChg && Math.abs(pmChg) >= minChangePct && q.marketCap > 50e6;
        })
        .map(q => ({
          ticker:           q.symbol,
          company:          q.shortName || q.longName || q.symbol,
          changeToday:      parseFloat((q.preMarketChangePercent||0).toFixed(2)),
          price:            q.preMarketPrice || q.regularMarketPrice,
          prevClose:        q.regularMarketPreviousClose,
          volume:           q.regularMarketVolume,
          avgVolume:        q.averageDailyVolume3Month,
          marketCap:        q.marketCap,
          high52w:          q.fiftyTwoWeekHigh,
          low52w:           q.fiftyTwoWeekLow,
          volRatio:         q.averageDailyVolume3Month > 0 ? parseFloat((q.regularMarketVolume / q.averageDailyVolume3Month).toFixed(2)) : null,
          isPreMarket:      true
        }));
    } catch(e) { console.warn('[SIGNAL] PreMarketMovers fetch failed:', e.message); }
  }
  return [];
}

// ============================================================
//  ★ MOMENTUM CONTINUATION ANALYSIS — Claude judges if move continues
// ============================================================

async function analyzeMomentumContinuation(apiKey, movers, sectorData) {
  if (!movers.length) return [];

  const sectorStr = sectorData.length
    ? sectorData.map(x=>`${x.sym}(${x.label}): ${x.pct>0?'+':''}${x.pct}%`).join(', ')
    : 'N/A';

  const moversStr = movers.map(m =>
    `${m.ticker} (${m.company}): ${m.changeToday>0?'+':''}${m.changeToday}% today | Price: $${m.price} | Vol: ${m.volRatio!=null?m.volRatio+'x avg':'N/A'} | MCap: ${m.marketCap?'$'+(m.marketCap/1e6).toFixed(0)+'M':'N/A'} | 52w High: ${m.high52w||'N/A'}${m.isPreMarket?' [PRE-MARKET]':''}`
  ).join('\n');

  const systemPrompt = `You are a momentum continuation analyst for stocks. You are given stocks that are already moving significantly today.

Your ONLY job: determine if each move is likely to CONTINUE higher, and by how much.

CONTINUATION SIGNALS (bullish):
- Volume 2x+ above average = strong confirmation, move likely continues
- Move breaking above 52-week high = breakout, high continuation probability
- Short squeeze setup (will fetch short data) = can accelerate rapidly
- Pre-market move with no pullback at open = sustained buying interest
- Sector ETF trending up = macro tailwind
- Small float (<10M shares) = small buying can continue to move price
- Move started <2 hours ago = early stage, likely has room

FADE SIGNALS (bearish, move likely reverses):
- Volume at or below average = weak move, likely fades
- Move already >50% in one day = usually exhaustion
- Stock near 52-week high with high volume BUT no catalyst = "air pocket" trade
- Gap up >30% with no fundamental catalyst = usually fades by EOD
- Broader market selling off = macro headwind

OUTPUT RULES:
- Only return stocks where you judge continuation probability >60%
- You MUST search for the catalyst/reason for each move before judging
- If you cannot find a catalyst, LOWER the confidence — moves without findable reasons are riskier
- If catalyst is FDA approval, earnings beat, M&A → HIGH continuation probability
- If catalyst is just "momentum/technical" → LOWER confidence

Return ONLY a JSON array:
[{"ticker":"","company":"","urgency":"critical|high|medium","move":0,"confidence":0,"upside":"","marketCap":"","volume":"","time":"","headline":"","catalyst":"","catalystTag":"tag-fda|tag-earn|tag-ma|tag-short|tag-8k|tag-macro|tag-momentum","continuationReason":"why move will continue","fadeRisks":"what could reverse it","reasoning":"","sources":[{"pub":"","icon":"","time":"","headline":"","url":""}]}]

If none qualify: []`;

  const userPrompt = `Current time: ${getNowET().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true})} ET
Session: ${isPreMarket()?'PRE-MARKET':isAfterHours()?'AFTER-HOURS':'REGULAR MARKET'}

Sector ETFs today: ${sectorStr}

STOCKS ALREADY MOVING — analyze each for continuation:
${moversStr}

For each stock:
1. Search for WHY it's moving (news, filing, catalyst)
2. Judge: will this continue or fade?
3. Only include in output if continuation probability >60%

Min confidence threshold: ${getSetting('minConfidence')||50}%`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: systemPrompt,
        tools: [{ type:'web_search_20250305', name:'web_search', max_uses: 8 }],
        messages: [{ role:'user', content: userPrompt }]
      })
    });
    if (!res.ok) { console.warn('[SIGNAL] Momentum API error:', res.status); return []; }
    const data = await res.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
    const a=text.indexOf('['),z=text.lastIndexOf(']');
    if (a===-1||z<a) return [];
    const parsed = JSON.parse(text.slice(a,z+1));
    return Array.isArray(parsed) ? parsed.map(r=>validateMomentumSignal(r)).filter(Boolean) : [];
  } catch(e) { console.warn('[SIGNAL] Momentum analysis failed:', e.message); return []; }
}

function validateMomentumSignal(r) {
  if (!r||typeof r!=='object') return null;
  const ticker = String(r.ticker||'').toUpperCase().trim();
  if (!/^[A-Z]{1,5}$/.test(ticker)) return null;
  if (!r.headline||!r.reasoning) return null;
  const sources = (Array.isArray(r.sources)?r.sources:[])
    .filter(s=>{if(!s?.url)return false;try{new URL(s.url);return true;}catch{return false;}})
    .map(s=>({pub:String(s.pub||'').trim(),icon:String(s.icon||'📰').trim(),time:String(s.time||'').trim(),headline:String(s.headline||'').trim(),url:String(s.url).trim()}));
  if (!sources.length) return null;
  const confidence = Math.min(100,Math.max(50,parseInt(r.confidence)||50));
  if (confidence<(getSetting('minConfidence')||50)) return null;
  const urgency = confidence>=85?'critical':confidence>=70?'high':'medium';
  const validTags=['tag-fda','tag-earn','tag-ma','tag-short','tag-8k','tag-macro','tag-momentum'];
  const catalystTag = validTags.includes(r.catalystTag)?r.catalystTag:'tag-momentum';
  const defaultTime = getNowET().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});

  // Build reasoning with continuation/fade context
  let enrichedReasoning = String(r.reasoning||'').trim();
  if (r.continuationReason) enrichedReasoning += `\n\n🟢 Continuation case: ${r.continuationReason}`;
  if (r.fadeRisks) enrichedReasoning += `\n\n🔴 Fade risks: ${r.fadeRisks}`;

  return {
    id: `${ticker}_mom_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    ticker, company:String(r.company||'').trim(), urgency,
    move: parseFloat(r.move)||0,
    volume: String(r.volume||'—').trim(),
    confidence, upside:String(r.upside||'—').trim(),
    marketCap:String(r.marketCap||'—').trim(),
    time:String(r.time||defaultTime).trim(),
    headline:String(r.headline||'').trim(),
    catalyst:String(r.catalyst||'Momentum').trim(),
    catalystTag,
    reasoning: enrichedReasoning,
    continuationReason: String(r.continuationReason||'').trim(),
    fadeRisks:          String(r.fadeRisks||'').trim(),
    sources,
    signalType:    'momentum', // distinguish from catalyst signals
    scannedAt:     new Date().toISOString(),
    outcome:       'pending',
    outcomeMsg:    'Outcome check available 1 hour after signal.',
    basePrice:     null,
    checkPrice:    null
  };
}

// ============================================================
//  ★ CATALYST SCANNER — two-pass with enrichment
// ============================================================

function buildHistoricalContext() {
  const signals=loadSignals(); if(signals.length<3)return null;
  const checked=signals.filter(s=>s.outcome==='hit'||s.outcome==='miss'); if(checked.length<3)return null;
  const byCatalyst={};
  for(const s of checked){if(!byCatalyst[s.catalyst])byCatalyst[s.catalyst]={hits:0,total:0};byCatalyst[s.catalyst].total++;if(s.outcome==='hit')byCatalyst[s.catalyst].hits++;}
  const catalystStats=Object.entries(byCatalyst).filter(([,v])=>v.total>=2).map(([cat,v])=>({cat,pct:Math.round(v.hits/v.total*100),total:v.total})).sort((a,b)=>b.pct-a.pct);
  const byHour={};
  for(const s of checked){const h=new Date(new Date(s.scannedAt).toLocaleString('en-US',{timeZone:'America/New_York'})).getHours();if(!byHour[h])byHour[h]={hits:0,total:0};byHour[h].total++;if(s.outcome==='hit')byHour[h].hits++;}
  const bestHour=Object.entries(byHour).filter(([,v])=>v.total>=2).sort((a,b)=>(b[1].hits/b[1].total)-(a[1].hits/a[1].total))[0];
  const recent10=checked.slice(0,10), recentHR=recent10.length?Math.round(recent10.filter(s=>s.outcome==='hit').length/recent10.length*100):null;
  return{catalystStats,bestHour:bestHour?{h:parseInt(bestHour[0]),pct:Math.round(bestHour[1].hits/bestHour[1].total*100)}:null,recentHitRate:recentHR,totalChecked:checked.length};
}

async function callClaudeFirstPass(apiKey, userPrompt) {
  const s=loadSettings(),mc=getMcapPreset();
  const enabled=Object.entries(s.catalysts||{}).filter(([,v])=>v).map(([k])=>k==='k8'?'8-K filing':`${k} catalyst`);
  const watchlist=loadWatchlist().map(x=>x.ticker);
  const systemPrompt=`You are a pre-market stock catalyst scanner. Find stocks with CONFIRMED hard catalysts from the last 8 hours likely to move significantly.

MARKET CAP: $${mc.min>=1000?(mc.min/1000)+'B':mc.min+'M'} to $${mc.max>=1000?(mc.max/1000)+'B':mc.max+'M'}
CATALYST TYPES: ${enabled.join(', ')}
${watchlist.length?`PRIORITY WATCHLIST: ${watchlist.join(', ')}\n`:''}

SEARCH SOURCES:
1. SEC EDGAR (edgar.sec.gov) — 8-K filings last 8 hours
2. PRNewswire, BusinessWire, GlobeNewswire — press releases
3. Benzinga, MarketWatch, Yahoo Finance — pre-market movers
4. FDA.gov — drug approvals, clinical trial results
5. Finviz — unusual volume
6. StockAnalysis — earnings surprises
7. Seeking Alpha, Motley Fool — breaking analysis
8. OTC Markets — small cap filings
9. Reuters, Bloomberg — M&A, deals
10. Twitter/X financial — breaking news

CATALYST PRIORITY: FDA approval/rejection > Earnings beat >10% > M&A at premium > Short squeeze (>20% short + catalyst) > 8-K material event > Other

Return JSON array of ALL candidates even if uncertain — second pass filters with live data:
[{"ticker":"","company":"","catalyst":"","catalystTag":"tag-fda|tag-earn|tag-ma|tag-short|tag-8k|tag-macro","headline":"","reasoning":"","move":0,"sources":[{"pub":"","icon":"","time":"","headline":"","url":""}]}]

Return [] only if absolutely nothing found.`;

  const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:2000,system:systemPrompt,tools:[{type:'web_search_20250305',name:'web_search',max_uses:10}],messages:[{role:'user',content:userPrompt}]})});
  if (!res.ok){let e=`Claude API ${res.status}`;try{const b=await res.json();if(b?.error?.message)e+=`: ${b.error.message}`;}catch{}throw new Error(e);}
  const data=await res.json(); return(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
}

async function callClaudeSecondPass(apiKey,candidates,enrichment) {
  const {sectorData,fundamentals,quotes,historicalContext}=enrichment;
  const s=loadSettings();

  const sectorStr=sectorData.length?`UP: ${sectorData.filter(x=>x.pct>0).map(x=>`${x.sym}(${x.label})+${x.pct}%`).join(',')||'none'} | DOWN: ${sectorData.filter(x=>x.pct<=0).map(x=>`${x.sym}(${x.label})${x.pct}%`).join(',')||'none'}`:'Unavailable';
  const histStr=historicalContext?`Recent hit rate: ${historicalContext.recentHitRate!==null?historicalContext.recentHitRate+'%':'N/A'} | By catalyst: ${historicalContext.catalystStats.map(c=>`${c.cat}: ${c.pct}% (${c.total})`).join(', ')||'N/A'}`:'No historical data yet';

  const enrichedStr=candidates.map(c=>{
    const q=quotes[c.ticker]||{},f=fundamentals[c.ticker]||{};
    const sector=sectorData.find(x=>c.catalystTag==='tag-fda'?['XBI','XLV'].includes(x.sym):x.sym==='SPY');
    return `--- ${c.ticker} ---\nCatalyst: ${c.catalyst} | ${c.headline}\nPre-market change: ${q.changeExt!=null?q.changeExt+'%':'N/A'} | Intraday: ${q.changeToday!=null?q.changeToday+'%':'N/A'}\nVolume: ${q.vol!=null?q.vol.toLocaleString():'N/A'} vs avg ${q.avgVol!=null?q.avgVol.toLocaleString():'N/A'} (${q.volRatio!=null?q.volRatio+'x':'N/A'})\nShort float: ${f.shortPct||'N/A'} | Float: ${f.floatShares||'N/A'} | Beta: ${f.beta||'N/A'}\n52w: Low ${f.week52Low||'N/A'} → High ${f.week52High||'N/A'}\nSector ETF: ${sector?`${sector.sym} ${sector.pct>0?'+':''}${sector.pct}%`:'N/A'}`;
  }).join('\n\n');

  const systemPrompt=`Score stock signal candidates using market data. Adjust confidence by:
Pre-market >10%+vol>2x: +25 | PM 5-10%: +15 | PM 2-5%: +10 | PM <1%: -20
Short float >30%: +20 | 15-30%: +10 | 10-15%: +5
Float <5M: +15 | 5-20M: +10 | >200M: -10
Vol >3x avg: +15 | 1.5-3x: +8 | below avg: -10
Sector ETF up >1%: +10 | flat: +5 | down >1%: -5
Historical catalyst hit >60%: +10 | <40%: -10
Return ONLY JSON: [{"ticker":"","company":"","urgency":"critical|high|medium","move":0,"volume":"","confidence":0,"upside":"","marketCap":"","time":"","headline":"","catalyst":"","catalystTag":"tag-fda|tag-earn|tag-ma|tag-short|tag-8k|tag-macro","reasoning":"","preMarketChange":0,"shortFloat":"","floatSize":"","volRatio":0,"sources":[{"pub":"","icon":"","time":"","headline":"","url":""}]}]
If nothing meets MIN_CONFIDENCE: []`;

  const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:4000,system:systemPrompt,messages:[{role:'user',content:`MIN_CONFIDENCE: ${s.minConfidence||50}%\n\nSECTOR TODAY:\n${sectorStr}\n\nYOUR HISTORY:\n${histStr}\n\nCANDIDATES:\n${enrichedStr}\n\nScore each. Return signals above MIN_CONFIDENCE only.`}]})});
  if (!res.ok){let e=`Claude API ${res.status}`;try{const b=await res.json();if(b?.error?.message)e+=`: ${b.error.message}`;}catch{}throw new Error(e);}
  const data=await res.json(); return(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
}

async function fetchEnrichmentData(candidates) {
  const tickers=[...new Set(candidates.map(c=>c.ticker))];
  if (!tickers.length) return{sectorData:[],fundamentals:{},quotes:{},historicalContext:buildHistoricalContext()};
  const statusEl=document.getElementById('scanStatus'); if(statusEl)statusEl.textContent=`Enriching ${tickers.length} candidates...`;
  const [sectorResult,...rest]=await Promise.allSettled([fetchSectorContext(),...tickers.map(t=>fetchExtendedQuote(t)),...tickers.map(t=>fetchFundamentals(t))]);
  const quotes={},fundamentals={};
  tickers.forEach((t,i)=>{quotes[t]=rest[i].status==='fulfilled'?rest[i].value:null;fundamentals[t]=rest[tickers.length+i].status==='fulfilled'?rest[tickers.length+i].value:{};});
  return{sectorData:sectorResult.status==='fulfilled'?sectorResult.value:[],fundamentals,quotes,historicalContext:buildHistoricalContext()};
}

// ============================================================
//  PARSER
// ============================================================
function parseSignals(raw) {
  if(!raw)return[];
  let s=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'');
  const a=s.indexOf('['),z=s.lastIndexOf(']'); if(a===-1||z<a)return[];
  let parsed; try{parsed=JSON.parse(s.slice(a,z+1));}catch{return[];}
  if(!Array.isArray(parsed))return[];
  return parsed.map(validateCatalystSignal).filter(Boolean);
}

function parseCandidates(raw) {
  if(!raw)return[];
  let s=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'');
  const a=s.indexOf('['),z=s.lastIndexOf(']'); if(a===-1||z<a)return[];
  try{const p=JSON.parse(s.slice(a,z+1));return Array.isArray(p)?p.filter(r=>r&&r.ticker&&/^[A-Z]{1,5}$/.test(String(r.ticker).toUpperCase())):[]; }catch{return[];}
}

function validateCatalystSignal(r) {
  if(!r||typeof r!=='object')return null;
  const ticker=String(r.ticker||'').toUpperCase().trim();
  if(!/^[A-Z]{1,5}$/.test(ticker))return null;
  for(const f of['company','headline','reasoning','sources'])if(!r[f])return null;
  const sources=(Array.isArray(r.sources)?r.sources:[]).filter(s=>{if(!s?.url)return false;try{new URL(s.url);return true;}catch{return false;}}).map(s=>({pub:String(s.pub||'').trim(),icon:String(s.icon||'📰').trim(),time:String(s.time||'').trim(),headline:String(s.headline||'').trim(),url:String(s.url).trim()}));
  if(!sources.length)return null;
  const confidence=Math.min(100,Math.max(50,parseInt(r.confidence)||50));
  if(confidence<(getSetting('minConfidence')||50))return null;
  const urgency=(!['critical','high','medium'].includes(r.urgency))?confidence>=85?'critical':confidence>=70?'high':'medium':r.urgency;
  const validTags=['tag-fda','tag-earn','tag-ma','tag-short','tag-8k','tag-macro'];
  const catalystTag=validTags.includes(r.catalystTag)?r.catalystTag:'tag-macro';
  const defaultTime=getNowET().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/New_York'});
  let enrichedReasoning=String(r.reasoning||'').trim();
  const extras=[];
  if(r.preMarketChange!=null&&r.preMarketChange!==0)extras.push(`Pre-market: ${r.preMarketChange>0?'+':''}${r.preMarketChange}%`);
  if(r.shortFloat&&r.shortFloat!=='N/A')extras.push(`Short float: ${r.shortFloat}`);
  if(r.floatSize&&r.floatSize!=='N/A')extras.push(`Float: ${r.floatSize}`);
  if(r.volRatio&&r.volRatio>0)extras.push(`Volume: ${r.volRatio}x avg`);
  if(extras.length)enrichedReasoning+=`\n\n📊 Market data: ${extras.join(' · ')}`;
  return{id:`${ticker}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,ticker,company:String(r.company||'').trim(),urgency,move:parseFloat(r.move)||0,volume:String(r.volume||'—').trim(),confidence,upside:String(r.upside||'—').trim(),marketCap:String(r.marketCap||'—').trim(),time:String(r.time||defaultTime).trim(),headline:String(r.headline||'').trim(),catalyst:String(r.catalyst||'Unknown').trim(),catalystTag,reasoning:enrichedReasoning,preMarketChange:r.preMarketChange||null,shortFloat:r.shortFloat||null,floatSize:r.floatSize||null,volRatio:r.volRatio||null,sources,signalType:'catalyst',scannedAt:new Date().toISOString(),outcome:'pending',outcomeMsg:'Outcome check available 1 hour after signal.',basePrice:null,checkPrice:null};
}

// ============================================================
//  PRICE FETCHING
// ============================================================
async function fetchStockPrice(ticker) {
  const yUrl=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;
  const proxies=[`https://corsproxy.io/?${encodeURIComponent(yUrl)}`,`https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`];
  for(const proxy of proxies){
    try{const res=await fetch(proxy,{signal:AbortSignal.timeout(10000)});if(!res.ok)continue;const data=await res.json();const closes=data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;if(!Array.isArray(closes))continue;for(let i=closes.length-1;i>=0;i--)if(closes[i]!=null)return parseFloat(closes[i].toFixed(4));}catch(e){console.warn(`[SIGNAL] Price (${ticker}):`,e.message);}
  }
  return null;
}

let _chartFetchId=0;
async function fetchOHLCV(ticker,range='1d',interval='5m') {
  const fetchId=++_chartFetchId;
  const yUrl=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;
  const proxies=[`https://corsproxy.io/?${encodeURIComponent(yUrl)}`,`https://api.allorigins.win/raw?url=${encodeURIComponent(yUrl)}`];
  for(const proxy of proxies){
    try{const res=await fetch(proxy,{signal:AbortSignal.timeout(12000)});if(!res.ok)continue;const data=await res.json();const r=data?.chart?.result?.[0];if(!r)continue;const ts=r.timestamp||[],q=r.indicators?.quote?.[0]||{};const result=ts.map((t,i)=>q.open[i]==null?null:{t:t*1000,o:+(q.open[i]||0).toFixed(4),h:+(q.high[i]||0).toFixed(4),l:+(q.low[i]||0).toFixed(4),c:+(q.close[i]||0).toFixed(4),v:q.volume[i]||0}).filter(Boolean);if(result.length&&fetchId===_chartFetchId)return result;if(fetchId!==_chartFetchId)return null;}catch(e){console.warn('[SIGNAL] OHLCV:',e.message);}
  }
  return null;
}

async function fetchBasePrice(signal) {
  const price=await fetchStockPrice(signal.ticker);
  if(price!==null){updateSignalInStorage(signal.id,{basePrice:price});const w=loadWatchlist(),wi=w.find(x=>x.ticker===signal.ticker);if(wi&&!wi.addedPrice){wi.addedPrice=price;saveWatchlist(w);}}
}

// ============================================================
//  OUTCOME TRACKER
// ============================================================
async function checkOutcome(signalId) {
  const all=loadSignals(),signal=all.find(s=>s.id===signalId);
  if(!signal||signal.outcome!=='pending')return;
  setOutcomeBtnState(signalId,'loading');
  const current=await fetchStockPrice(signal.ticker);
  if(current===null){updateSignalInStorage(signalId,{outcome:'unverified',outcomeMsg:`Price unavailable — verify at finance.yahoo.com/quote/${signal.ticker}`});refreshDetailIfActive(signalId);return;}
  if(!signal.basePrice){updateSignalInStorage(signalId,{outcome:'unverified',outcomeMsg:`Base price not recorded. Current: $${current}`,checkPrice:current});refreshDetailIfActive(signalId);return;}
  const actual=parseFloat((((current-signal.basePrice)/signal.basePrice)*100).toFixed(2));
  const isHit=(signal.move>=0?actual>=0:actual<=0)&&Math.abs(actual)>=HIT_THRESHOLD;
  updateSignalInStorage(signalId,{outcome:isHit?'hit':'miss',outcomeMsg:`${signal.move>=0?'+':''}${signal.move}% signal → ${actual>=0?'+':''}${actual}% actual. ${isHit?'HIT ✓':'MISS ✗'} (Base $${signal.basePrice} → Now $${current})`,checkPrice:current});
  refreshDetailIfActive(signalId);
  if(typeof window.renderAnalytics==='function')window.renderAnalytics();
}
function isOutcomeCheckReady(signal){return signal.outcome==='pending'&&Date.now()-new Date(signal.scannedAt).getTime()>=OUTCOME_DELAY_MS;}
function setOutcomeBtnState(id,state){const btn=document.getElementById(`outcome-btn-${id}`);if(btn&&state==='loading'){btn.textContent='⟳ Checking...';btn.disabled=true;}}

// ============================================================
//  STORAGE
// ============================================================
function saveSignals(signals){const cutoff=Date.now()-ONE_MONTH_MS,trimmed=signals.filter(s=>new Date(s.scannedAt).getTime()>cutoff);try{localStorage.setItem(SIGNALS_KEY,JSON.stringify(trimmed));}catch{try{localStorage.setItem(SIGNALS_KEY,JSON.stringify(trimmed.slice(0,Math.floor(trimmed.length*0.8))));}catch(_){}}}
function loadSignals(){try{const raw=localStorage.getItem(SIGNALS_KEY);const a=raw?JSON.parse(raw):[];return Array.isArray(a)?a:[];}catch{return[];}}
function updateSignalInStorage(id,updates){const all=loadSignals(),idx=all.findIndex(s=>s.id===id);if(idx!==-1){all[idx]={...all[idx],...updates};saveSignals(all);}}

// ============================================================
//  SIGNAL FILTERS
// ============================================================
function getSignalsToday()  {const today=getNowET().toDateString();return loadSignals().filter(s=>!isArchived(s.id)&&new Date(s.scannedAt).toDateString()===today);}
function getSignalsLast24h(){const cut=Date.now()-86400000;return loadSignals().filter(s=>!isArchived(s.id)&&new Date(s.scannedAt).getTime()>cut);}
function getSignalsLast7d() {const cut=Date.now()-7*86400000;return loadSignals().filter(s=>new Date(s.scannedAt).getTime()>cut);}
function getSignalsLast30d(){return loadSignals();}

function getSignalsFor24hTab(){
  const et=getNowET(),day=et.getDay();
  if(day===6||day===0){const db=day===6?1:2,fs=new Date(et);fs.setDate(fs.getDate()-db);fs.setHours(0,0,0,0);const fe=new Date(fs);fe.setHours(23,59,59,999);return loadSignals().filter(s=>{const t=new Date(s.scannedAt).getTime();return t>=fs.getTime()&&t<=fe.getTime();});}
  return getSignalsLast24h();
}

function getSortedTodaySignals(){
  const pins=getPins(),sigs=getSignalsToday(),order={critical:0,high:1,medium:2};
  return[...sigs.filter(s=>pins.includes(s.id)),...sigs.filter(s=>!pins.includes(s.id))].sort((a,b)=>order[a.urgency]-order[b.urgency]);
}

function deduplicateSignals(newSignals,existing){
  const cut=Date.now()-60*60*1000;
  const recent=new Set(existing.filter(s=>new Date(s.scannedAt).getTime()>cut).map(s=>s.ticker));
  return newSignals.filter(s=>!recent.has(s.ticker));
}

// ============================================================
//  ANALYTICS
// ============================================================
function calcAccuracy(signals){
  const checked=signals.filter(s=>s.outcome==='hit'||s.outcome==='miss');if(!checked.length)return null;
  const hits=checked.filter(s=>s.outcome==='hit').length,overall=parseFloat((hits/checked.length*100).toFixed(1));
  const byUrgency={};for(const tier of['critical','high','medium']){const t=checked.filter(s=>s.urgency===tier);byUrgency[tier]=t.length?{pct:parseFloat((t.filter(s=>s.outcome==='hit').length/t.length*100).toFixed(1)),total:t.length}:null;}
  const byCatalyst={};for(const cat of[...new Set(checked.map(s=>s.catalyst))]){const c=checked.filter(s=>s.catalyst===cat);byCatalyst[cat]={pct:parseFloat((c.filter(s=>s.outcome==='hit').length/c.length*100).toFixed(1)),total:c.length};}
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],byDay={};for(let d=0;d<7;d++){const ds=checked.filter(s=>new Date(s.scannedAt).getDay()===d);if(ds.length)byDay[days[d]]={pct:parseFloat((ds.filter(s=>s.outcome==='hit').length/ds.length*100).toFixed(1)),total:ds.length};}
  const byHourMap={};for(const s of checked){const h=new Date(new Date(s.scannedAt).toLocaleString('en-US',{timeZone:'America/New_York'})).getHours();if(!byHourMap[h])byHourMap[h]={hits:0,total:0};byHourMap[h].total++;if(s.outcome==='hit')byHourMap[h].hits++;}
  const byHour={};for(const[h,v]of Object.entries(byHourMap))byHour[h]={pct:parseFloat((v.hits/v.total*100).toFixed(1)),total:v.total};
  const movePct=s=>s.basePrice&&s.checkPrice?Math.abs((s.checkPrice-s.basePrice)/s.basePrice*100):null;
  const avg=arr=>arr.length?parseFloat((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1)):null;
  const withActual=checked.filter(s=>s.basePrice&&s.checkPrice).sort((a,b)=>((b.checkPrice-b.basePrice)/b.basePrice)-((a.checkPrice-a.basePrice)/a.basePrice));
  const best=withActual[0]||null,worst=withActual[withActual.length-1]||null;
  const withPred=checked.filter(s=>s.move&&s.basePrice&&s.checkPrice);
  let trend=null;if(checked.length>=6){const half=Math.floor(checked.length/2);const r1=checked.slice(half).filter(s=>s.outcome==='hit').length/(checked.length-half)*100;const r2=checked.slice(0,half).filter(s=>s.outcome==='hit').length/half*100;trend=parseFloat((r2-r1).toFixed(1));}
  const confTrend=checked.length>=4?(()=>{const half=Math.floor(checked.length/2);const c1=avg(checked.slice(half).map(s=>s.confidence));const c2=avg(checked.slice(0,half).map(s=>s.confidence));return c1&&c2?parseFloat((c2-c1).toFixed(1)):null;})():null;
  const sigsByHour={};for(const s of signals){const h=new Date(new Date(s.scannedAt).toLocaleString('en-US',{timeZone:'America/New_York'})).getHours();sigsByHour[h]=(sigsByHour[h]||0)+1;}
  const bestScanHour=Object.keys(sigsByHour).length?parseInt(Object.entries(sigsByHour).sort((a,b)=>b[1]-a[1])[0][0]):null;

  // Split by signal type
  const catalystAcc = checked.filter(s=>s.signalType!=='momentum').length
    ? parseFloat((checked.filter(s=>s.signalType!=='momentum'&&s.outcome==='hit').length / checked.filter(s=>s.signalType!=='momentum').length * 100).toFixed(1)) : null;
  const momentumAcc = checked.filter(s=>s.signalType==='momentum').length
    ? parseFloat((checked.filter(s=>s.signalType==='momentum'&&s.outcome==='hit').length / checked.filter(s=>s.signalType==='momentum').length * 100).toFixed(1)) : null;

  return{overall,total:checked.length,hits,misses:checked.length-hits,pending:signals.filter(s=>s.outcome==='pending').length,byUrgency,byCatalyst,byDay,byHour,avgHitMove:avg(checked.filter(s=>s.outcome==='hit'&&movePct(s)!=null).map(movePct)),avgMissMove:avg(checked.filter(s=>s.outcome==='miss'&&movePct(s)!=null).map(movePct)),avgPredicted:avg(withPred.map(s=>Math.abs(s.move))),avgActual:avg(withPred.map(s=>Math.abs((s.checkPrice-s.basePrice)/s.basePrice*100))),best,worst,trend,confTrend,bestScanHour,catalystAcc,momentumAcc};
}

function getAnalytics(){return{allTime:calcAccuracy(loadSignals()),today:calcAccuracy(getSignalsToday()),h24:calcAccuracy(getSignalsLast24h()),d7:calcAccuracy(getSignalsLast7d()),d30:calcAccuracy(getSignalsLast30d())};}

// ============================================================
//  CSV EXPORT
// ============================================================
function exportCSV(signals){
  const h=['Ticker','Company','Date','Time','Type','Urgency','Catalyst','Move%','Confidence','Upside','MarketCap','Outcome','BasePrice','CheckPrice','PreMarketChange%','ShortFloat','FloatSize','VolRatio','Headline'];
  const rows=signals.map(s=>[s.ticker,`"${(s.company||'').replace(/"/g,'""')}"`,new Date(s.scannedAt).toLocaleDateString(),s.time,s.signalType||'catalyst',s.urgency,s.catalyst,s.move,s.confidence,s.upside,s.marketCap,s.outcome,s.basePrice||'',s.checkPrice||'',s.preMarketChange||'',s.shortFloat||'',s.floatSize||'',s.volRatio||'',`"${(s.headline||'').replace(/"/g,'""')}"`]);
  const csv=[h.join(','),...rows.map(r=>r.join(','))].join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  Object.assign(document.createElement('a'),{href:url,download:`signal_${new Date().toISOString().slice(0,10)}.csv`}).click();
  URL.revokeObjectURL(url);
}

// ============================================================
//  EMPTY STATE
// ============================================================
async function buildEmptyStateContent(){
  const past=getSignalsLast7d().slice(0,8),acc=calcAccuracy(getSignalsLast7d());
  if(!past.length)return{priceRows:'',acc:null,count:0};
  const prices=await Promise.allSettled(past.map(s=>fetchStockPrice(s.ticker)));
  const priceRows=past.map((s,i)=>{
    const cur=prices[i].status==='fulfilled'?prices[i].value:null;
    const ms=cur&&s.basePrice?((cur-s.basePrice)/s.basePrice*100).toFixed(1):null;
    const color=ms===null?'var(--muted)':ms>=0?'var(--green)':'var(--red)';
    const dt=new Date(s.scannedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'America/New_York'});
    const outcome=s.outcome==='hit'?'<span style="color:var(--green)">✓</span>':s.outcome==='miss'?'<span style="color:var(--red)">✗</span>':'';
    const typeBadge=s.signalType==='momentum'?`<span style="font-size:8px;color:var(--purple);margin-right:3px">MOM</span>`:'';
    return`<div class="es-row" onclick="selectSignal&&selectSignal('${s.id}')"><div class="es-ticker">${typeBadge}${s.ticker}</div><span class="tag ${s.catalystTag} es-catalyst">${s.catalyst}</span><div class="es-date">${dt}</div><div class="es-move" style="color:${color}">${ms!==null?(ms>=0?'+':'')+ms+'%':'—'}</div><div class="es-outcome">${outcome}</div></div>`;
  }).join('');
  return{priceRows,acc,count:past.length};
}

// ============================================================
//  ★ MAIN SCAN RUNNER — CATALYST + MOMENTUM (PARALLEL)
// ============================================================
async function runScan(apiKey) {
  console.log('[SIGNAL] Full scan started:', new Date().toISOString());
  const s = loadSettings();
  const statusEl = document.getElementById('scanStatus');
  const momentumEnabled = s.momentumEnabled !== false;

  // ── Run catalyst scan + momentum scan in parallel ────────────
  if (statusEl) statusEl.textContent = 'Scanning catalysts & live movers...';

  const [catalystResult, momentumResult] = await Promise.allSettled([
    runCatalystScan(apiKey, statusEl),
    momentumEnabled ? runMomentumScan(apiKey) : Promise.resolve([])
  ]);

  const catalystSignals = catalystResult.status === 'fulfilled' ? catalystResult.value : [];
  const momentumSignals = momentumResult.status === 'fulfilled' ? momentumResult.value : [];

  // Log any failures
  if (catalystResult.status === 'rejected') console.warn('[SIGNAL] Catalyst scan failed:', catalystResult.reason);
  if (momentumResult.status === 'rejected') console.warn('[SIGNAL] Momentum scan failed:', momentumResult.reason);

  const allNew = [...catalystSignals, ...momentumSignals];

  if (!allNew.length) {
    window.lastScanDiagnostic = {
      type: 'empty', ts: Date.now(),
      settings: { mcap:getMcapPreset().label, minConf:s.minConfidence, minMove:s.minMove, marketOpen:isMarketOpen() }
    };
    updateScanCompleteUI(0); return;
  }

  const existing = loadSignals();
  const unique   = deduplicateSignals(allNew, existing);

  if (!unique.length) {
    window.lastScanDiagnostic = { type:'duplicate', ts:Date.now() };
    updateScanCompleteUI(0); return;
  }

  window.lastScanDiagnostic = {
    type: 'success', count: unique.length, ts: Date.now(),
    catalystCount: unique.filter(s=>s.signalType!=='momentum').length,
    momentumCount: unique.filter(s=>s.signalType==='momentum').length
  };

  unique.forEach(s => fetchBasePrice(s));
  saveSignals([...unique, ...existing]);
  updateScanCompleteUI(unique.length, unique);
  console.log(`[SIGNAL] Done — ${unique.filter(s=>s.signalType!=='momentum').length} catalyst, ${unique.filter(s=>s.signalType==='momentum').length} momentum signal(s).`);
}

async function runCatalystScan(apiKey, statusEl) {
  const s=loadSettings(), mc=getMcapPreset();
  const session=isPreMarket()?'PRE-MARKET':isAfterHours()?'AFTER-HOURS':'REGULAR MARKET';
  const userPrompt=`Current time: ${getNowET().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true})} ET, ${getNowET().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} [${session}]\n\nSearch ALL sources for stocks $${mc.min>=1000?(mc.min/1000)+'B':mc.min+'M'} to $${mc.max>=1000?(mc.max/1000)+'B':mc.max+'M'} with HARD CONFIRMED catalysts from the last 8 hours.\n\n${isPreMarket()?'PRE-MARKET: Include anything already moving >5% with a catalyst from overnight.\n':isAfterHours()?'AFTER-HOURS: Earnings releases, FDA decisions, M&A announcements are priority.\n':''}Min move: ${s.minMove||5}%. Cast a wide net — include candidates 40%+ sure. Return [] only if nothing found.`;

  if (statusEl) statusEl.textContent = 'Pass 1: Searching news...';
  const rawCandidates = await callClaudeFirstPass(apiKey, userPrompt);
  const candidates    = parseCandidates(rawCandidates);
  console.log(`[SIGNAL] Catalyst pass 1: ${candidates.length} candidate(s)`);
  if (!candidates.length) return [];

  if (statusEl) statusEl.textContent = `Pass 2: Enriching ${candidates.length} candidates...`;
  const enrichment = await fetchEnrichmentData(candidates);

  if (statusEl) statusEl.textContent = 'Pass 3: Scoring with market data...';
  const rawScored  = await callClaudeSecondPass(apiKey, candidates, enrichment);
  const signals    = parseSignals(rawScored);
  console.log(`[SIGNAL] Catalyst pass 3: ${signals.length} signal(s) qualified`);
  return signals;
}

async function runMomentumScan(apiKey) {
  const s = loadSettings();
  const minMove = s.momentumMinMove || 5;

  console.log('[SIGNAL] Momentum scan starting...');
  const statusEl = document.getElementById('scanStatus');

  // Fetch movers and sector context in parallel
  const [moversResult, preMarketResult, sectorResult] = await Promise.allSettled([
    fetchTopGainers(minMove),
    isPreMarket() ? fetchPreMarketMovers(minMove) : Promise.resolve([]),
    fetchSectorContext()
  ]);

  const regularMovers  = moversResult.status    === 'fulfilled' ? moversResult.value    : [];
  const preMarketMovers= preMarketResult.status  === 'fulfilled' ? preMarketResult.value  : [];
  const sectorData     = sectorResult.status     === 'fulfilled' ? sectorResult.value     : [];

  // Merge, deduplicate by ticker, sort by move size
  const seenTickers = new Set();
  const allMovers   = [...preMarketMovers, ...regularMovers]
    .filter(m => { if (seenTickers.has(m.ticker)) return false; seenTickers.add(m.ticker); return true; })
    .sort((a, b) => Math.abs(b.changeToday) - Math.abs(a.changeToday))
    .slice(0, 15); // cap at 15 to limit API calls

  console.log(`[SIGNAL] Momentum: ${allMovers.length} mover(s) found`);
  if (!allMovers.length) return [];

  if (statusEl) statusEl.textContent = `Momentum: analyzing ${allMovers.length} live movers...`;

  const momentumSignals = await analyzeMomentumContinuation(apiKey, allMovers, sectorData);
  console.log(`[SIGNAL] Momentum: ${momentumSignals.length} continuation signal(s)`);
  return momentumSignals;
}

// ============================================================
//  UI HOOKS
// ============================================================
function updateScanCompleteUI(count,newSignals=[]) {
  const n=getSignalsToday().length;
  setText('signalCount',n);
  const mc=document.getElementById('signalCountMobile'); if(mc)mc.textContent=`${n} signals`;
  if(typeof window.renderFeed==='function')window.renderFeed();
  if(typeof window.renderSidebar==='function')window.renderSidebar();
  if(typeof window.flashNewSignals==='function'&&newSignals.length)window.flashNewSignals(newSignals.map(s=>s.id));
  if(newSignals.length){fireNotification(newSignals);haptic('signal');setBadge(getSignalsToday().length);showPortfolioAlertBanner(newSignals);}
  updatePortfolioPnlHeader();
}

function refreshDetailIfActive(signalId){if(window.activeSignalId===signalId&&typeof window.renderDetail==='function')window.renderDetail(signalId);}

// ============================================================
//  INIT
// ============================================================
function initScanner() {
  isScanning=false; releaseScanLock(); applyTheme(getTheme()); applySettingsToApp(loadSettings());
  const scanBtn=document.getElementById('scanBtn'); if(scanBtn)scanBtn.addEventListener('click',triggerManualScan);
  updateMarketStatusDisplay(); nextScanAt=calcNextScanTime(); startScheduler();
  setTimeout(()=>{initPullToRefresh();snapshotPortfolio();updatePortfolioPnlHeader();},500);
  console.log('[SIGNAL] Ready (catalyst+momentum) | Market:',isMarketOpen()?'OPEN':'CLOSED','| Next:',nextScanAt.toLocaleTimeString());
}

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initScanner);}
else{initScanner();}

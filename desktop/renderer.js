/* ArchitectureV1 — renderer logic
 * Handles:
 *  - Local PC (default): browser detection via Electron IPC, opens locally
 *  - Remote PC: WebSocket to relay, send open_url, receive frames
 */

const HISTORY_KEY = 'arch_v1_history';
const SELECTED_BROWSER_KEY = 'arch_v1_selected_browser';
const SELECTED_PC_KEY = 'arch_v1_selected_pc';
const HISTORY_OPEN_KEY = 'arch_v1_history_open';
const LIVEVIEW_OPEN_KEY = 'arch_v1_liveview_open';
const BHISTORY_OPEN_KEY = 'arch_v1_bhistory_open';
const BHISTORY_BROWSER_KEY = 'arch_v1_bhistory_browser';
const HISTORY_CAPABLE_ICONS = new Set(['chrome', 'chromium', 'edge', 'brave', 'opera', 'vivaldi', 'arc', 'yandex', 'firefox']);
const MAX_HISTORY = 50;

const LOCAL_PC = { pc_id: '__local__', hostname: 'This PC (Local)', os: 'local', browsers: [], online: true, isLocal: true };

// State
let serverUrl = null;
let ws = null;
let wsState = 'connecting';
let pcs = []; // remote PCs
let selectedPc = LOCAL_PC; // currently controlling
let selectedBrowser = null;
let pingTimer = null;

// Browsing-history state
let bhistBrowser = null;       // {name, path, icon} - which browser's history we are viewing
let bhistEntries = [];         // last fetched entries
let bhistFilter = '';
let bhistLoading = false;
let bhistRequestId = null;
const bhistPending = new Map(); // request_id -> { resolve, reject, timeout }

const $ = (id) => document.getElementById(id);

// --- Helpers ---
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function browserSvg(icon) {
  const ic = (icon || 'globe').toLowerCase();
  const wrap = (inner) => `<span class="browser-ic">${inner}</span>`;
  switch (ic) {
    case 'chrome':    return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 8.8h8M8.4 13.9 4.5 7.2M15.6 13.9l-3.9 6.7"/></svg>`);
    case 'chromium':  return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/></svg>`);
    case 'firefox':   return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M7 9c2-2 5-2 7 0M16 7c1 2 0 5-2 6"/></svg>`);
    case 'edge':      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12c4-4 12-4 18 2"/></svg>`);
    case 'brave':     return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l4 2 4-1-2 4 2 4-4 6-4 3-4-3-4-6 2-4-2-4 4 1z"/></svg>`);
    case 'opera':     return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="6" ry="9"/></svg>`);
    case 'vivaldi':   return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M7 9l5 8 5-8"/></svg>`);
    case 'safari':    return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>`);
    case 'arc':       return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18 12 4l9 14"/><path d="M7 18h10"/></svg>`);
    case 'zen':       return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 6h14L5 18h14"/></svg>`);
    case 'tor':       return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M6 7l12 10M18 7 6 17"/></svg>`);
    case 'yandex':    return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M14 7l-4 10M9 7h5"/></svg>`);
    default:          return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`);
  }
}

function readHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
function writeHistory(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY))); }
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}
function showError(msg) {
  const eb = $('errorBanner');
  eb.textContent = '!! ' + msg;
  eb.hidden = false;
  setTimeout(() => { eb.hidden = true; }, 4500);
}

// --- WebSocket ---

function wsControllerUrl(httpUrl) {
  const u = httpUrl.replace(/\/$/, '');
  if (u.startsWith('https://')) return 'wss://' + u.slice(8) + '/api/ws/controller';
  if (u.startsWith('http://')) return 'ws://' + u.slice(7) + '/api/ws/controller';
  return u + '/api/ws/controller';
}

function setConnState(state) {
  wsState = state;
  const el = $('connState');
  el.dataset.state = state;
  el.textContent = 'RELAY: ' + state.toUpperCase();
}

function wsSend(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connectWs() {
  if (!serverUrl) return;
  const url = wsControllerUrl(serverUrl);
  setConnState('connecting');
  try { ws = new WebSocket(url); }
  catch (e) { setConnState('disconnected'); setTimeout(connectWs, 3000); return; }

  ws.onopen = () => {
    setConnState('connected');
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => wsSend({ type: 'ping' }), 25000);
    if (selectedPc && !selectedPc.isLocal) wsSend({ type: 'subscribe', pc_id: selectedPc.pc_id });
  };
  ws.onmessage = (evt) => {
    let m; try { m = JSON.parse(evt.data); } catch { return; }
    if (m.type === 'pcs') {
      pcs = m.pcs || [];
      renderPcSelector();
      // If current selection is a remote PC that went offline, mark
      if (selectedPc && !selectedPc.isLocal) {
        const still = pcs.find(p => p.pc_id === selectedPc.pc_id);
        if (still) { selectedPc = { ...still, isLocal: false }; renderSelectedPc(); renderBrowserListForCurrentPc(); }
        else { setLiveTag('offline'); }
      }
    } else if (m.type === 'frame' && selectedPc && m.pc_id === selectedPc.pc_id) {
      const img = $('liveviewImg');
      const empty = $('liveviewEmpty');
      img.src = `data:image/${m.encoding || 'png'};base64,${m.data}`;
      img.hidden = false;
      empty.style.display = 'none';
      setLiveTag('streaming');
    } else if (m.type === 'pc_offline') {
      if (selectedPc && m.pc_id === selectedPc.pc_id) setLiveTag('offline');
    } else if (m.type === 'open_result') {
      if (!m.ok) showError('REMOTE: ' + (m.error || 'failed'));
    } else if (m.type === 'history_result') {
      const pending = bhistPending.get(m.request_id);
      if (pending) {
        clearTimeout(pending.timeout);
        bhistPending.delete(m.request_id);
        if (m.ok) pending.resolve(m.entries || []);
        else pending.reject(new Error(m.error || 'failed'));
      }
    }
  };
  ws.onclose = () => {
    setConnState('disconnected');
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    setTimeout(connectWs, 3000);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

// --- PC Selector ---

function allPcsForList() { return [LOCAL_PC, ...pcs.map(p => ({ ...p, isLocal: false }))]; }

function renderPcSelector() {
  const list = $('pcSelectList');
  const items = allPcsForList();
  list.innerHTML = items.map(p => {
    const active = p.pc_id === selectedPc.pc_id;
    const dotClass = p.isLocal ? 'local' : (p.online ? 'online' : '');
    const meta = p.isLocal
      ? (`${(localPlatform || 'unknown').toUpperCase()} · ${(localBrowsers.length)} browser${localBrowsers.length === 1 ? '' : 's'}`)
      : `${(p.os || '').toUpperCase()} · ${(p.browsers || []).length} browser${(p.browsers || []).length === 1 ? '' : 's'}`;
    return `<li role="option" data-pc-id="${escapeAttr(p.pc_id)}" data-active="${active}" data-testid="pc-option-${escapeAttr(p.pc_id)}">
      <span class="pc-dot ${dotClass}" aria-hidden="true"></span>
      <span class="pc-text">
        <span class="pc-text-name">${escapeHtml(p.hostname)}</span>
        <span class="pc-text-meta">${escapeHtml(meta)}</span>
      </span>
    </li>`;
  }).join('');
  $('pcCount').textContent = `${pcs.length} remote`;
}

function renderSelectedPc() {
  const dot = document.querySelector('#pcCurrent .pc-dot');
  $('pcCurrentName').textContent = selectedPc.hostname;
  if (selectedPc.isLocal) {
    dot.className = 'pc-dot local';
    $('pcCurrentMeta').textContent = `LOCAL · ${(localPlatform || 'unknown').toUpperCase()}`;
  } else {
    dot.className = 'pc-dot online';
    $('pcCurrentMeta').textContent = `REMOTE · ${(selectedPc.os || '').toUpperCase()}`;
  }
  // Toggle live view section
  $('liveviewSection').hidden = !!selectedPc.isLocal;
  if (selectedPc.isLocal) {
    setLiveTag('offline');
    $('liveviewImg').hidden = true;
    $('liveviewImg').removeAttribute('src');
    $('liveviewEmpty').style.display = '';
  }
  $('footStatus').textContent = selectedPc.isLocal ? 'LOCAL MODE' : `REMOTE: ${selectedPc.hostname}`;
}

function setLiveTag(state) {
  const tag = $('liveTag');
  tag.dataset.state = state;
  tag.textContent = state === 'streaming' ? 'LIVE' : 'OFFLINE';
}

function pickPc(pc_id) {
  const all = allPcsForList();
  const match = all.find(p => p.pc_id === pc_id) || LOCAL_PC;
  // Unsubscribe from previous remote
  if (!selectedPc.isLocal && selectedPc.pc_id !== match.pc_id) {
    wsSend({ type: 'subscribe', pc_id: null });
  }
  selectedPc = match;
  localStorage.setItem(SELECTED_PC_KEY, match.pc_id);
  renderPcSelector();
  renderSelectedPc();
  renderBrowserListForCurrentPc();
  // Reset browsing-history state for the new PC
  bhistBrowser = null;
  bhistEntries = [];
  bhistFilter = '';
  const filterEl = $('bhistoryFilter');
  if (filterEl) filterEl.value = '';
  renderBhistBrowserSelector();
  renderBhistList();
  setBhistStatus('', '');
  // Subscribe to new remote
  if (!match.isLocal) {
    wsSend({ type: 'subscribe', pc_id: match.pc_id });
    setLiveTag('offline');
    $('liveviewImg').hidden = true;
    $('liveviewImg').removeAttribute('src');
    $('liveviewEmpty').style.display = '';
  }
}

// --- Browser dropdown (depends on selected PC) ---

let localBrowsers = [];
let localPlatform = '';

function currentPcBrowsers() {
  return selectedPc.isLocal ? localBrowsers : (selectedPc.browsers || []);
}

function renderBrowserListForCurrentPc() {
  const list = currentPcBrowsers();
  // Pick reasonable selection: remember per-pc-key or fall back to first
  const key = `${SELECTED_BROWSER_KEY}::${selectedPc.pc_id}`;
  const savedPath = localStorage.getItem(key);
  const found = list.find(b => b.path === savedPath);
  selectedBrowser = found || list[0] || null;
  renderSelectList();
  renderSelectCurrent();
}

function renderSelectList() {
  const list = $('selectList');
  const items = currentPcBrowsers();
  if (items.length === 0) {
    list.innerHTML = '<li class="empty" data-testid="browser-empty">// NO BROWSERS DETECTED</li>';
    return;
  }
  list.innerHTML = items.map(b => {
    const active = selectedBrowser && b.path === selectedBrowser.path;
    return `<li role="option" data-path="${escapeAttr(b.path)}" data-active="${active}" data-testid="browser-option-${escapeAttr(b.icon || 'globe')}">${browserSvg(b.icon)}<span>${escapeHtml(b.name)}</span></li>`;
  }).join('');
}

function renderSelectCurrent() {
  const cur = $('selectCurrent');
  if (selectedBrowser) {
    cur.innerHTML = `${browserSvg(selectedBrowser.icon)}<span>${escapeHtml(selectedBrowser.name)}</span>`;
  } else {
    cur.innerHTML = `${browserSvg('globe')}<span>${currentPcBrowsers().length === 0 ? 'No browsers found' : 'Select a browser'}</span>`;
  }
}

function setSelectedBrowser(b) {
  selectedBrowser = b;
  if (b) localStorage.setItem(`${SELECTED_BROWSER_KEY}::${selectedPc.pc_id}`, b.path);
  renderSelectCurrent();
  renderSelectList();
}

function toggleSelect(force) {
  const btn = $('selectButton');
  const list = $('selectList');
  const open = force !== undefined ? force : list.dataset.open !== 'true';
  list.dataset.open = open ? 'true' : 'false';
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function togglePcSelect(force) {
  const btn = $('pcSelectButton');
  const list = $('pcSelectList');
  const open = force !== undefined ? force : list.dataset.open !== 'true';
  list.dataset.open = open ? 'true' : 'false';
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// --- Open URL ---

async function openSite(rawUrl, browserPathOverride, browserMetaOverride) {
  const url = (rawUrl || '').trim();
  if (!url) { showError('URL IS EMPTY'); return; }
  const useBrowser = browserPathOverride
    ? (currentPcBrowsers().find(b => b.path === browserPathOverride) || browserMetaOverride || selectedBrowser)
    : selectedBrowser;
  const useBrowserPath = browserPathOverride || (selectedBrowser ? selectedBrowser.path : null);

  if (!useBrowserPath && !selectedPc.isLocal) {
    showError('NO BROWSER ON REMOTE PC');
    return;
  }

  if (selectedPc.isLocal) {
    if (!useBrowserPath) { showError('NO BROWSER SELECTED'); return; }
    const result = await window.arch.openUrl(useBrowserPath, url);
    if (!result.ok) { showError(result.error || 'FAILED TO OPEN'); return; }
    addHistory({
      url: result.url, browserPath: useBrowserPath,
      browserName: useBrowser ? useBrowser.name : 'Default',
      browserIcon: useBrowser ? useBrowser.icon : 'globe',
      pcId: selectedPc.pc_id, pcName: selectedPc.hostname,
      timestamp: Date.now(),
    });
  } else {
    if (wsState !== 'connected') { showError('RELAY NOT CONNECTED'); return; }
    wsSend({ type: 'open_url', pc_id: selectedPc.pc_id, url, browser_path: useBrowserPath });
    addHistory({
      url: /^https?:\/\//i.test(url) ? url : 'https://' + url,
      browserPath: useBrowserPath,
      browserName: useBrowser ? useBrowser.name : 'Default',
      browserIcon: useBrowser ? useBrowser.icon : 'globe',
      pcId: selectedPc.pc_id, pcName: selectedPc.hostname,
      timestamp: Date.now(),
    });
  }
}

// --- History ---

function addHistory(entry) {
  const list = readHistory();
  list.unshift(entry);
  writeHistory(list);
  renderHistory();
}
function clearHistory() { localStorage.removeItem(HISTORY_KEY); renderHistory(); }

function renderHistory() {
  const list = readHistory();
  const container = $('historyList');
  $('historyCount').textContent = String(list.length);
  $('clearHistoryBtn').hidden = list.length === 0;
  if (list.length === 0) {
    container.innerHTML = '<div class="history-empty" data-testid="history-empty">// NO ENTRIES</div>';
    return;
  }
  container.innerHTML = list.map((h, i) => {
    const browsers = currentPcBrowsers();
    const browserOptions = browsers.map(b => {
      const sel = b.path === h.browserPath ? 'selected' : '';
      return `<option value="${escapeAttr(b.path)}" ${sel}>${escapeHtml(b.name)}</option>`;
    }).join('');
    return `
      <div class="history-item" data-idx="${i}" data-testid="history-item-${i}">
        <span class="history-url" data-action="open" title="${escapeAttr(h.url)}">${escapeHtml(h.url)}</span>
        <select class="history-mini-select" data-action="change-browser" data-testid="history-browser-${i}">
          ${browsers.length === 0 ? '<option>no browsers</option>' : browserOptions}
        </select>
        <span class="history-time" title="${escapeAttr(h.pcName || '')}">${timeAgo(h.timestamp)}</span>
        <button class="history-go" data-action="open" data-testid="history-go-${i}">GO →</button>
      </div>
    `;
  }).join('');
}

function toggleHistoryPanel(force) {
  const head = $('historyToggle'); const list = $('historyList');
  const open = force !== undefined ? force : list.hidden;
  list.hidden = !open;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  localStorage.setItem(HISTORY_OPEN_KEY, open ? 'true' : 'false');
}
function toggleLiveviewPanel(force) {
  const head = $('liveviewToggle'); const body = $('liveviewBody');
  const open = force !== undefined ? force : body.hidden;
  body.hidden = !open;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  localStorage.setItem(LIVEVIEW_OPEN_KEY, open ? 'true' : 'false');
}
function toggleBhistoryPanel(force) {
  const head = $('bhistoryToggle'); const body = $('bhistoryBody');
  const open = force !== undefined ? force : body.hidden;
  body.hidden = !open;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  localStorage.setItem(BHISTORY_OPEN_KEY, open ? 'true' : 'false');
  if (open && bhistBrowser && bhistEntries.length === 0 && !bhistLoading) {
    fetchBrowsingHistory();
  }
}

// --- Browsing History (per-browser real history) ---

function bhistCapableBrowsers() {
  return currentPcBrowsers().filter(b => HISTORY_CAPABLE_ICONS.has((b.icon || '').toLowerCase()));
}

function setBhistStatus(state, text) {
  const el = $('bhistoryStatus');
  if (!state) { el.removeAttribute('data-state'); el.textContent = ''; return; }
  el.dataset.state = state;
  el.textContent = text || '';
}

function toggleBhistSelect(force) {
  const btn = $('bhistorySelectButton');
  const list = $('bhistorySelectList');
  const open = force !== undefined ? force : list.dataset.open !== 'true';
  list.dataset.open = open ? 'true' : 'false';
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function renderBhistBrowserSelector() {
  const list = $('bhistorySelectList');
  const cur = $('bhistorySelectCurrent');
  const items = bhistCapableBrowsers();
  if (items.length === 0) {
    list.innerHTML = '<li class="empty">// NO COMPATIBLE BROWSERS</li>';
    cur.innerHTML = `${browserSvg('globe')}<span>No compatible browsers</span>`;
    return;
  }
  // Auto-pick the first if none chosen, or restore from storage
  if (!bhistBrowser || !items.find(b => b.path === bhistBrowser.path)) {
    const key = `${BHISTORY_BROWSER_KEY}::${selectedPc.pc_id}`;
    const savedPath = localStorage.getItem(key);
    bhistBrowser = items.find(b => b.path === savedPath) || items[0];
  }
  list.innerHTML = items.map(b => {
    const active = bhistBrowser && b.path === bhistBrowser.path;
    return `<li role="option" data-path="${escapeAttr(b.path)}" data-icon="${escapeAttr(b.icon)}" data-name="${escapeAttr(b.name)}" data-active="${active}" data-testid="bhistory-option-${escapeAttr(b.icon)}">${browserSvg(b.icon)}<span>${escapeHtml(b.name)}</span></li>`;
  }).join('');
  cur.innerHTML = `${browserSvg(bhistBrowser.icon)}<span>${escapeHtml(bhistBrowser.name)}</span>`;
}

function bhistFormatTime(ms) {
  if (!ms) return '';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); if (d < 30) return d + 'd ago';
  return new Date(ms).toISOString().slice(0, 10);
}

function renderBhistList() {
  const container = $('bhistoryList');
  const countEl = $('bhistoryCount');

  if (!bhistBrowser) {
    container.innerHTML = '<div class="history-empty">// PICK A BROWSER TO LOAD HISTORY</div>';
    countEl.textContent = '0';
    return;
  }
  if (bhistLoading) {
    container.innerHTML = '<div class="history-empty">// LOADING...</div>';
    return;
  }

  const filter = bhistFilter.trim().toLowerCase();
  const visible = filter
    ? bhistEntries.filter(e =>
        (e.title || '').toLowerCase().includes(filter) ||
        (e.url || '').toLowerCase().includes(filter)
      )
    : bhistEntries;

  countEl.textContent = String(visible.length);

  if (bhistEntries.length === 0) {
    container.innerHTML = '<div class="history-empty">// NO HISTORY ENTRIES</div>';
    return;
  }
  if (visible.length === 0) {
    container.innerHTML = '<div class="history-empty">// NO MATCHES</div>';
    return;
  }

  container.innerHTML = visible.map((e, i) => {
    const time = bhistFormatTime(e.last_visit);
    const profile = e.profile && e.profile !== 'Default' ? `<span class="bhist-profile">${escapeHtml(e.profile)}</span>` : '';
    return `
      <div class="bhist-row" data-url="${escapeAttr(e.url)}" data-testid="bhist-row-${i}">
        <div class="bhist-main">
          <div class="bhist-title" data-action="open" title="${escapeAttr(e.title || e.url)}">${profile}${escapeHtml(e.title || e.url)}</div>
          <div class="bhist-url">${escapeHtml(e.url)}</div>
        </div>
        <span class="bhist-vc">${e.visit_count || 0}×</span>
        <span class="bhist-time">${time}</span>
        <button type="button" class="bhist-go" data-action="open" data-testid="bhist-go-${i}">GO →</button>
      </div>
    `;
  }).join('');
}

async function fetchBrowsingHistory() {
  if (!bhistBrowser) return;
  bhistLoading = true;
  setBhistStatus('loading', 'LOADING...');
  renderBhistList();

  try {
    let entries;
    if (selectedPc.isLocal) {
      const res = await window.arch.getLocalHistory(bhistBrowser.icon, 200);
      if (!res.ok) throw new Error(res.error || 'failed');
      entries = res.entries || [];
    } else {
      if (wsState !== 'connected') throw new Error('relay not connected');
      entries = await new Promise((resolve, reject) => {
        const reqId = Math.random().toString(36).slice(2);
        bhistRequestId = reqId;
        const timeout = setTimeout(() => {
          if (bhistPending.has(reqId)) {
            bhistPending.delete(reqId);
            reject(new Error('timeout'));
          }
        }, 15000);
        bhistPending.set(reqId, { resolve, reject, timeout });
        wsSend({
          type: 'get_history',
          pc_id: selectedPc.pc_id,
          browser_icon: bhistBrowser.icon,
          limit: 200,
          request_id: reqId,
        });
      });
    }
    bhistEntries = entries || [];
    setBhistStatus('ok', `${bhistEntries.length} ENTRIES`);
  } catch (e) {
    bhistEntries = [];
    setBhistStatus('error', (e.message || 'ERROR').toUpperCase());
  } finally {
    bhistLoading = false;
    renderBhistList();
  }
}

function setBhistBrowser(b) {
  bhistBrowser = b;
  if (b) localStorage.setItem(`${BHISTORY_BROWSER_KEY}::${selectedPc.pc_id}`, b.path);
  bhistEntries = [];
  renderBhistBrowserSelector();
  renderBhistList();
  fetchBrowsingHistory();
}

// --- Init ---

async function init() {
  const cfg = await window.arch.getConfig();
  serverUrl = cfg.overrideServerUrl || cfg.defaultServerUrl;

  // Detect local browsers
  const res = await window.arch.detectBrowsers();
  localBrowsers = res.browsers || [];
  localPlatform = res.platform || 'unknown';
  LOCAL_PC.hostname = res.hostname ? `This PC (${res.hostname})` : 'This PC (Local)';
  LOCAL_PC.os = localPlatform;

  // Restore selected PC
  const savedPcId = localStorage.getItem(SELECTED_PC_KEY);
  if (savedPcId && savedPcId !== '__local__') {
    // We'll match once `pcs` arrives via WS; for now stay on local
    selectedPc = LOCAL_PC;
  } else {
    selectedPc = LOCAL_PC;
  }

  renderPcSelector();
  renderSelectedPc();
  renderBrowserListForCurrentPc();
  renderBhistBrowserSelector();
  renderBhistList();

  // Live view + history collapsibles
  const liveOpen = localStorage.getItem(LIVEVIEW_OPEN_KEY);
  toggleLiveviewPanel(liveOpen === null ? true : liveOpen === 'true');
  toggleHistoryPanel(localStorage.getItem(HISTORY_OPEN_KEY) === 'true');
  toggleBhistoryPanel(localStorage.getItem(BHISTORY_OPEN_KEY) === 'true');
  renderHistory();

  // Wire events
  $('selectButton').addEventListener('click', (e) => { e.stopPropagation(); togglePcSelect(false); toggleSelect(); });
  $('selectList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-path]'); if (!li) return;
    const b = currentPcBrowsers().find(x => x.path === li.dataset.path);
    if (b) { setSelectedBrowser(b); toggleSelect(false); }
  });

  $('pcSelectButton').addEventListener('click', (e) => { e.stopPropagation(); toggleSelect(false); togglePcSelect(); });
  $('pcSelectList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-pc-id]'); if (!li) return;
    pickPc(li.dataset.pcId);
    togglePcSelect(false);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#selectWrap')) toggleSelect(false);
    if (!e.target.closest('#pcSelectWrap')) togglePcSelect(false);
  });

  $('urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); openSite($('urlInput').value); }
  });
  $('openBtn').addEventListener('click', () => openSite($('urlInput').value));

  $('historyToggle').addEventListener('click', () => toggleHistoryPanel());
  $('clearHistoryBtn').addEventListener('click', (e) => { e.stopPropagation(); clearHistory(); });
  $('historyList').addEventListener('click', (e) => {
    const item = e.target.closest('.history-item'); if (!item) return;
    const idx = parseInt(item.dataset.idx, 10);
    const h = readHistory()[idx]; if (!h) return;
    if (e.target.closest('[data-action="open"]')) {
      const sel = item.querySelector('.history-mini-select');
      const bp = sel ? sel.value : h.browserPath;
      openSite(h.url, bp);
    }
  });
  $('historyList').addEventListener('change', (e) => {
    if (!e.target.classList.contains('history-mini-select')) return;
    const item = e.target.closest('.history-item');
    const idx = parseInt(item.dataset.idx, 10);
    const list = readHistory(); if (!list[idx]) return;
    const newPath = e.target.value;
    const newBrowser = currentPcBrowsers().find(b => b.path === newPath);
    list[idx].browserPath = newPath;
    if (newBrowser) { list[idx].browserName = newBrowser.name; list[idx].browserIcon = newBrowser.icon; }
    writeHistory(list);
  });
  $('liveviewToggle').addEventListener('click', () => toggleLiveviewPanel());

  // Browsing-history events
  $('bhistoryToggle').addEventListener('click', () => toggleBhistoryPanel());
  $('bhistoryRefresh').addEventListener('click', (e) => { e.stopPropagation(); fetchBrowsingHistory(); });
  $('bhistorySelectButton').addEventListener('click', (e) => { e.stopPropagation(); toggleBhistSelect(); });
  $('bhistorySelectList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-path]'); if (!li) return;
    const items = bhistCapableBrowsers();
    const b = items.find(x => x.path === li.dataset.path);
    if (b) { setBhistBrowser(b); toggleBhistSelect(false); }
  });
  $('bhistoryFilter').addEventListener('input', (e) => {
    bhistFilter = e.target.value || '';
    renderBhistList();
  });
  $('bhistoryList').addEventListener('click', (e) => {
    const row = e.target.closest('.bhist-row'); if (!row) return;
    if (e.target.closest('[data-action="open"]')) {
      const url = row.dataset.url;
      if (!url || !bhistBrowser) return;
      // Open the URL in the same browser whose history we're viewing (on the selected PC)
      openSite(url, bhistBrowser.path);
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#bhistorySelectWrap')) toggleBhistSelect(false);
  });

  // After init, restore selected remote PC if present
  setTimeout(() => {
    const savedPcId = localStorage.getItem(SELECTED_PC_KEY);
    if (savedPcId && savedPcId !== '__local__') {
      const match = pcs.find(p => p.pc_id === savedPcId);
      if (match) pickPc(match.pc_id);
    }
  }, 1500);

  // Connect to relay
  connectWs();
}

document.addEventListener('DOMContentLoaded', init);

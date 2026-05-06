/* ArchitectureV1 — renderer logic */

const HISTORY_KEY = 'arch_v1_history';
const SELECTED_KEY = 'arch_v1_selected_browser';
const HISTORY_OPEN_KEY = 'arch_v1_history_open';
const MAX_HISTORY = 50;

let browsers = [];
let selectedBrowser = null;

const $ = (id) => document.getElementById(id);

// --- Browser SVG icons ---
function browserSvg(icon) {
  const ic = (icon || 'globe').toLowerCase();
  const wrap = (inner, color) => `<span class="browser-ic" style="color:${color}">${inner}</span>`;
  switch (ic) {
    case 'chrome':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 8.8h8M8.4 13.9 4.5 7.2M15.6 13.9l-3.9 6.7"/></svg>`, '#ff1f1f');
    case 'chromium':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/></svg>`, '#cc0000');
    case 'firefox':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M7 9c2-2 5-2 7 0M16 7c1 2 0 5-2 6"/></svg>`, '#ff1f1f');
    case 'edge':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12c4-4 12-4 18 2"/></svg>`, '#ff1f1f');
    case 'brave':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l4 2 4-1-2 4 2 4-4 6-4 3-4-3-4-6 2-4-2-4 4 1z"/></svg>`, '#ff1f1f');
    case 'opera':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="6" ry="9"/></svg>`, '#ff1f1f');
    case 'vivaldi':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M7 9l5 8 5-8"/></svg>`, '#ff1f1f');
    case 'safari':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 6v2M12 16v2M6 12h2M16 12h2M9 9l6 6M15 9l-6 6"/></svg>`, '#ff1f1f');
    case 'arc':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18 12 4l9 14"/><path d="M7 18h10"/></svg>`, '#ff1f1f');
    case 'zen':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 6h14L5 18h14"/></svg>`, '#ff1f1f');
    case 'tor':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M6 7l12 10M18 7 6 17"/></svg>`, '#ff1f1f');
    case 'yandex':
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M14 7l-4 10M9 7h5"/></svg>`, '#ff1f1f');
    default:
      return wrap(`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`, '#ff1f1f');
  }
}

// --- History ---
function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}
function writeHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}
function addHistory(entry) {
  const list = readHistory();
  list.unshift(entry);
  writeHistory(list);
  renderHistory();
}
function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d + 'd ago';
}

function renderHistory() {
  const list = readHistory();
  const container = $('historyList');
  const count = $('historyCount');
  const clearBtn = $('clearHistoryBtn');
  count.textContent = String(list.length);
  clearBtn.hidden = list.length === 0;

  if (list.length === 0) {
    container.innerHTML = '<div class="history-empty" data-testid="history-empty">// NO ENTRIES</div>';
    return;
  }
  container.innerHTML = list.map((h, i) => {
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
        <span class="history-time">${timeAgo(h.timestamp)}</span>
        <button class="history-go" data-action="open" data-testid="history-go-${i}">GO →</button>
      </div>
    `;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// --- Select dropdown ---
function renderSelectList() {
  const list = $('selectList');
  if (!browsers || browsers.length === 0) {
    list.innerHTML = '<li class="empty" data-testid="browser-empty">// NO BROWSERS DETECTED</li>';
    return;
  }
  list.innerHTML = browsers.map(b => {
    const active = selectedBrowser && b.path === selectedBrowser.path;
    return `<li role="option" data-path="${escapeAttr(b.path)}" data-active="${active}" data-testid="browser-option-${b.icon}">${browserSvg(b.icon)}<span>${escapeHtml(b.name)}</span></li>`;
  }).join('');
}

function renderSelectCurrent() {
  const cur = $('selectCurrent');
  if (selectedBrowser) {
    cur.innerHTML = `${browserSvg(selectedBrowser.icon)}<span>${escapeHtml(selectedBrowser.name)}</span>`;
  } else {
    cur.innerHTML = `${browserSvg('globe')}<span>${browsers.length === 0 ? 'No browsers found' : 'Select a browser'}</span>`;
  }
}

function setSelected(b) {
  selectedBrowser = b;
  if (b) localStorage.setItem(SELECTED_KEY, b.path);
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

// --- Errors ---
function showError(msg) {
  const eb = $('errorBanner');
  eb.textContent = '!! ' + msg;
  eb.hidden = false;
  setTimeout(() => { eb.hidden = true; }, 4500);
}

// --- Open URL ---
async function openSite(url, browserPath) {
  if (!url || !url.trim()) { showError('URL IS EMPTY'); return; }
  const target = browserPath || (selectedBrowser ? selectedBrowser.path : null);
  if (!target) { showError('NO BROWSER SELECTED'); return; }

  const result = await window.arch.openUrl(target, url.trim());
  if (!result.ok) { showError(result.error || 'FAILED TO OPEN'); return; }

  const usedBrowser = browsers.find(b => b.path === target) || selectedBrowser;
  addHistory({
    url: result.url,
    browserPath: target,
    browserName: usedBrowser ? usedBrowser.name : 'Unknown',
    browserIcon: usedBrowser ? usedBrowser.icon : 'globe',
    timestamp: Date.now(),
  });
}

// --- Init ---
async function init() {
  // Detect browsers
  const res = await window.arch.detectBrowsers();
  browsers = res.browsers || [];

  $('platformTag').textContent = (res.platform || 'unknown').toUpperCase();
  $('browserCount').textContent = `${browsers.length} browser${browsers.length === 1 ? '' : 's'}`;

  // Restore selection
  const savedPath = localStorage.getItem(SELECTED_KEY);
  const saved = browsers.find(b => b.path === savedPath);
  setSelected(saved || browsers[0] || null);

  renderSelectList();
  renderSelectCurrent();

  // History expand state
  const histOpen = localStorage.getItem(HISTORY_OPEN_KEY) === 'true';
  if (histOpen) toggleHistoryPanel(true);
  renderHistory();

  // Wire events
  $('selectButton').addEventListener('click', (e) => { e.stopPropagation(); toggleSelect(); });
  $('selectList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-path]');
    if (!li) return;
    const b = browsers.find(x => x.path === li.dataset.path);
    if (b) { setSelected(b); toggleSelect(false); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#selectWrap')) toggleSelect(false);
  });

  $('urlInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); openSite($('urlInput').value); }
  });
  $('openBtn').addEventListener('click', () => openSite($('urlInput').value));

  $('historyToggle').addEventListener('click', () => toggleHistoryPanel());
  $('clearHistoryBtn').addEventListener('click', (e) => { e.stopPropagation(); clearHistory(); });
  $('historyList').addEventListener('click', (e) => {
    const item = e.target.closest('.history-item');
    if (!item) return;
    const idx = parseInt(item.dataset.idx, 10);
    const h = readHistory()[idx];
    if (!h) return;
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
    const list = readHistory();
    if (!list[idx]) return;
    const newPath = e.target.value;
    const newBrowser = browsers.find(b => b.path === newPath);
    list[idx].browserPath = newPath;
    if (newBrowser) {
      list[idx].browserName = newBrowser.name;
      list[idx].browserIcon = newBrowser.icon;
    }
    writeHistory(list);
  });
}

function toggleHistoryPanel(force) {
  const head = $('historyToggle');
  const list = $('historyList');
  const open = force !== undefined ? force : list.hidden;
  list.hidden = !open;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  localStorage.setItem(HISTORY_OPEN_KEY, open ? 'true' : 'false');
}

document.addEventListener('DOMContentLoaded', init);

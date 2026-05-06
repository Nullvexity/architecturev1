import React, { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

// --- Static browser list for the web preview (web pages cannot detect installed browsers) ---
const WEB_BROWSERS = [
  { name: 'Google Chrome', icon: 'chrome', path: 'web:chrome' },
  { name: 'Mozilla Firefox', icon: 'firefox', path: 'web:firefox' },
  { name: 'Microsoft Edge', icon: 'edge', path: 'web:edge' },
  { name: 'Brave', icon: 'brave', path: 'web:brave' },
  { name: 'Opera', icon: 'opera', path: 'web:opera' },
  { name: 'Vivaldi', icon: 'vivaldi', path: 'web:vivaldi' },
  { name: 'Arc', icon: 'arc', path: 'web:arc' },
  { name: 'Zen Browser', icon: 'zen', path: 'web:zen' },
  { name: 'Safari', icon: 'safari', path: 'web:safari' },
  { name: 'Tor Browser', icon: 'tor', path: 'web:tor' },
];

const HISTORY_KEY = 'arch_v1_history';
const SELECTED_KEY = 'arch_v1_selected_browser';
const HISTORY_OPEN_KEY = 'arch_v1_history_open';

// --- Browser SVG icons ---
const BrowserIcon = ({ icon }) => {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2 };
  const wrap = (children) => (
    <span className="browser-ic">
      <svg viewBox="0 0 24 24" width="14" height="14" {...stroke}>{children}</svg>
    </span>
  );
  switch (icon) {
    case 'chrome': return wrap(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.2" /><path d="M12 8.8h8M8.4 13.9 4.5 7.2M15.6 13.9l-3.9 6.7" /></>);
    case 'firefox': return wrap(<><circle cx="12" cy="12" r="9" /><path d="M7 9c2-2 5-2 7 0M16 7c1 2 0 5-2 6" /></>);
    case 'edge': return wrap(<><circle cx="12" cy="12" r="9" /><path d="M3 12c4-4 12-4 18 2" /></>);
    case 'brave': return wrap(<><path d="M12 3l4 2 4-1-2 4 2 4-4 6-4 3-4-3-4-6 2-4-2-4 4 1z" /></>);
    case 'opera': return wrap(<><ellipse cx="12" cy="12" rx="6" ry="9" /></>);
    case 'vivaldi': return wrap(<><circle cx="12" cy="12" r="9" /><path d="M7 9l5 8 5-8" /></>);
    case 'safari': return wrap(<><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>);
    case 'arc': return wrap(<><path d="M3 18 12 4l9 14" /><path d="M7 18h10" /></>);
    case 'zen': return wrap(<><path d="M5 6h14L5 18h14" /></>);
    case 'tor': return wrap(<><circle cx="12" cy="12" r="9" /><path d="M12 3v18M6 7l12 10M18 7 6 17" /></>);
    default: return wrap(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>);
  }
};

const Caret = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const ArrowRight = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" strokeLinejoin="miter">
    <path d="M5 12h12M13 6l6 6-6 6" />
  </svg>
);

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function normalizeUrl(raw) {
  const t = (raw || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return 'https://' + t;
}

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }
  catch { return []; }
}
function writeHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
}

function BrowserSelect({ browsers, value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  return (
    <div className="select-wrap" ref={wrapRef}>
      <button
        type="button"
        className="select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="browser-select-button"
      >
        <span className="select-current">
          {value ? <BrowserIcon icon={value.icon} /> : <BrowserIcon icon="globe" />}
          <span>{value ? value.name : 'Select a browser'}</span>
        </span>
        <Caret className="caret" />
      </button>
      {open && (
        <ul className="select-list" role="listbox" data-testid="browser-select-list">
          {browsers.map((b) => (
            <li
              key={b.path}
              role="option"
              data-active={value && b.path === value.path}
              data-testid={`browser-option-${b.icon}`}
              onClick={() => { onChange(b); setOpen(false); }}
            >
              <BrowserIcon icon={b.icon} />
              <span>{b.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const browsers = WEB_BROWSERS;
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => {
    const savedPath = localStorage.getItem(SELECTED_KEY);
    return browsers.find((b) => b.path === savedPath) || browsers[0];
  });
  const [history, setHistory] = useState(readHistory());
  const [historyOpen, setHistoryOpen] = useState(localStorage.getItem(HISTORY_OPEN_KEY) === 'true');

  useEffect(() => { if (selected) localStorage.setItem(SELECTED_KEY, selected.path); }, [selected]);
  useEffect(() => { localStorage.setItem(HISTORY_OPEN_KEY, historyOpen ? 'true' : 'false'); }, [historyOpen]);
  useEffect(() => { writeHistory(history); }, [history]);

  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(''), 4500);
  };

  const openSite = (rawUrl, browser) => {
    const target = normalizeUrl(rawUrl);
    if (!target) { showError('URL IS EMPTY'); return; }
    const useBrowser = browser || selected;
    if (!useBrowser) { showError('NO BROWSER SELECTED'); return; }

    // Web preview: open in a new tab (we cannot pick which browser the user has)
    window.open(target, '_blank', 'noopener,noreferrer');

    setHistory((prev) => [
      { url: target, browserPath: useBrowser.path, browserName: useBrowser.name, browserIcon: useBrowser.icon, timestamp: Date.now() },
      ...prev,
    ].slice(0, 50));
  };

  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); openSite(url); } };

  const updateHistoryBrowser = (idx, browserPath) => {
    setHistory((prev) => {
      const next = [...prev];
      const b = browsers.find((x) => x.path === browserPath);
      if (!next[idx] || !b) return prev;
      next[idx] = { ...next[idx], browserPath: b.path, browserName: b.name, browserIcon: b.icon };
      return next;
    });
  };

  const platformTag = useMemo(() => {
    if (typeof navigator === 'undefined') return 'WEB';
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('windows')) return 'WEB · WIN';
    if (ua.includes('mac')) return 'WEB · MAC';
    if (ua.includes('linux')) return 'WEB · LINUX';
    return 'WEB';
  }, []);

  return (
    <>
      <div className="app-bg-grid" aria-hidden="true" />
      <div className="app-bg-glow" aria-hidden="true" />

      <main className="shell" data-testid="app-shell">
        <header>
          <div className="brand-row">
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter">
                <rect x="3" y="3" width="18" height="18" />
                <path d="M3 9h18M9 3v18" />
              </svg>
            </div>
            <span className="brand-tag">// ARCHITECTURE · V1</span>
            <span className="status-dot" data-testid="platform-tag">{platformTag}</span>
          </div>

          <h1 className="title" data-testid="app-title" style={{ marginTop: 14 }}>
            <span className="title-main">ArchitectureV1</span>
            <span className="title-shadow" aria-hidden="true">ArchitectureV1</span>
          </h1>
          <p className="subtitle" data-testid="app-subtitle" style={{ marginTop: 14 }}>
            created by <span className="accent">nullvexity</span>
          </p>
        </header>

        <div className="web-banner" data-testid="web-banner">
          <b>// PREVIEW</b>
          <span>This is the web demo. Get the desktop app for real installed-browser detection.</span>
        </div>

        <section className="card" data-testid="open-site-card">
          <div className="card-label">
            <span className="dash" />
            <span>OPEN A SITE</span>
          </div>

          <div className="row">
            <label className="field">
              <span className="field-label">URL</span>
              <div className="input-wrap">
                <svg className="input-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
                <input
                  data-testid="url-input"
                  type="text"
                  spellCheck="false"
                  autoComplete="off"
                  placeholder="example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={onKey}
                />
              </div>
            </label>

            <div className="field">
              <span className="field-label">BROWSER</span>
              <BrowserSelect browsers={browsers} value={selected} onChange={setSelected} />
            </div>
          </div>

          <button type="button" className="btn-3d" data-testid="open-site-button" onClick={() => openSite(url)}>
            <span className="btn-3d-front">
              <ArrowRight />
              <span>OPEN SITE</span>
            </span>
            <span className="btn-3d-shadow" aria-hidden="true" />
          </button>

          {error && <div className="error-banner" data-testid="error-banner">!! {error}</div>}
        </section>

        <section className="history" data-testid="history-section">
          <button
            type="button"
            className="history-head"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((o) => !o)}
            data-testid="history-toggle"
          >
            <span className="history-left">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              <span>HISTORY</span>
              <span className="history-count">{history.length}</span>
            </span>
            <span className="history-right">
              {history.length > 0 && (
                <span
                  className="link-btn"
                  data-testid="history-clear"
                  onClick={(e) => { e.stopPropagation(); setHistory([]); }}
                >CLEAR</span>
              )}
              <Caret className="history-caret" />
            </span>
          </button>

          {historyOpen && (
            <div className="history-list" data-testid="history-list">
              {history.length === 0 ? (
                <div className="history-empty" data-testid="history-empty">// NO ENTRIES</div>
              ) : (
                history.map((h, i) => (
                  <div className="history-item" key={`${h.timestamp}-${i}`} data-testid={`history-item-${i}`}>
                    <span className="history-url" title={h.url} onClick={() => openSite(h.url, browsers.find((b) => b.path === h.browserPath))}>
                      {h.url}
                    </span>
                    <select
                      className="history-mini-select"
                      data-testid={`history-browser-${i}`}
                      value={h.browserPath}
                      onChange={(e) => updateHistoryBrowser(i, e.target.value)}
                    >
                      {browsers.map((b) => <option key={b.path} value={b.path}>{b.name}</option>)}
                    </select>
                    <span className="history-time">{timeAgo(h.timestamp)}</span>
                    <button
                      type="button"
                      className="history-go"
                      data-testid={`history-go-${i}`}
                      onClick={() => openSite(h.url, browsers.find((b) => b.path === h.browserPath))}
                    >GO →</button>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        <footer className="foot">
          <span>nullvexity</span>
          <span className="foot-sep">·</span>
          <span>v1.0.0</span>
          <span className="foot-sep">·</span>
          <span>{browsers.length} browsers</span>
        </footer>
      </main>
    </>
  );
}

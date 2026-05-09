// Browser data reader: history, downloads, bookmarks.
// Chromium-based: SQLite "History" + JSON "Bookmarks" file
// Firefox-based: SQLite "places.sqlite" (history + bookmarks + download annotations)
// Uses sql.js (pure WASM, no native deps).

const fs = require('fs');
const path = require('path');
const os = require('os');

let _sqlPromise = null;
async function ensureSql() {
  if (!_sqlPromise) {
    const initSqlJs = require('sql.js');
    const wasmPath = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);
    _sqlPromise = initSqlJs({
      wasmBinary: wasmBinary
    });
  }
  return _sqlPromise;
}

const CHROMIUM_BROWSERS = ['chrome', 'chromium', 'edge', 'brave', 'opera', 'vivaldi', 'arc', 'yandex'];
const FIREFOX_BROWSERS = ['firefox'];
const SUPPORTED_KINDS = ['history', 'downloads', 'bookmarks'];

const CHROMIUM_EPOCH_DIFF_MS = 11644473600000; // 1601-01-01 → 1970-01-01

const DOWNLOAD_STATES = {
  0: 'IN_PROGRESS', 1: 'COMPLETE', 2: 'CANCELLED', 3: 'INTERRUPTED', 4: 'INTERRUPTED',
};

function smartBasename(p) {
  if (!p) return '';
  const s = String(p);
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

// ---------- Path helpers ----------

function chromiumUserDataDir(icon) {
  const home = os.homedir();
  const platform = process.platform;
  const map = {
    chrome: {
      win32: path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
      darwin: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      linux: path.join(home, '.config', 'google-chrome'),
    },
    chromium: {
      win32: path.join(home, 'AppData', 'Local', 'Chromium', 'User Data'),
      darwin: path.join(home, 'Library', 'Application Support', 'Chromium'),
      linux: path.join(home, '.config', 'chromium'),
    },
    edge: {
      win32: path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
      darwin: path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
      linux: path.join(home, '.config', 'microsoft-edge'),
    },
    brave: {
      win32: path.join(home, 'AppData', 'Local', 'BraveSoftware', 'Brave-Browser', 'User Data'),
      darwin: path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
      linux: path.join(home, '.config', 'BraveSoftware', 'Brave-Browser'),
    },
    opera: {
      win32: path.join(home, 'AppData', 'Roaming', 'Opera Software', 'Opera Stable'),
      darwin: path.join(home, 'Library', 'Application Support', 'com.operasoftware.Opera'),
      linux: path.join(home, '.config', 'opera'),
    },
    vivaldi: {
      win32: path.join(home, 'AppData', 'Local', 'Vivaldi', 'User Data'),
      darwin: path.join(home, 'Library', 'Application Support', 'Vivaldi'),
      linux: path.join(home, '.config', 'vivaldi'),
    },
    arc: {
      darwin: path.join(home, 'Library', 'Application Support', 'Arc', 'User Data'),
      win32: path.join(home, 'AppData', 'Local', 'Arc', 'User Data'),
    },
    yandex: {
      win32: path.join(home, 'AppData', 'Local', 'Yandex', 'YandexBrowser', 'User Data'),
      darwin: path.join(home, 'Library', 'Application Support', 'Yandex', 'YandexBrowser'),
      linux: path.join(home, '.config', 'yandex-browser'),
    },
  };
  return (map[icon] || {})[platform] || null;
}

function findChromiumProfileDirs(userDataDir) {
  if (!userDataDir || !fs.existsSync(userDataDir)) return [];
  let entries;
  try { entries = fs.readdirSync(userDataDir); } catch (e) { return []; }
  const profiles = [];
  for (const e of entries) {
    if (e === 'Default' || /^Profile[\s_]?\d+$/.test(e)) {
      profiles.push({ name: e, dir: path.join(userDataDir, e) });
    }
  }
  return profiles;
}

function firefoxProfilesDir() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles');
  return path.join(home, '.mozilla', 'firefox');
}

function firefoxProfiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  let entries; try { entries = fs.readdirSync(dir); } catch (e) { return []; }
  return entries
    .map(d => ({ name: d, file: path.join(dir, d, 'places.sqlite') }))
    .filter(p => fs.existsSync(p.file));
}

// ---------- SQLite ----------

async function openSqlite(file) {
  const SQL = await ensureSql();
  // Try copying first (so we don't fight with browser file locks).
  let buf;
  const tmp = path.join(os.tmpdir(), `arch-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  let copied = false;
  try {
    fs.copyFileSync(file, tmp);
    copied = true;
    buf = fs.readFileSync(tmp);
  } catch (e) {
    // Fallback: read the original file directly. This still works for most browsers
    // because the SQLite file is opened in shared mode.
    try { buf = fs.readFileSync(file); } catch (e2) { throw new Error('cannot read DB: ' + e2.message); }
  } finally {
    if (copied) { try { fs.unlinkSync(tmp); } catch (e) {} }
  }
  return new SQL.Database(buf);
}

// ---------- Chromium readers ----------

async function readChromiumHistory(file, limit) {
  const db = await openSqlite(file);
  try {
    const res = db.exec(
      `SELECT url, title, visit_count, last_visit_time FROM urls
       WHERE last_visit_time > 0
       ORDER BY last_visit_time DESC
       LIMIT ${limit}`
    );
    if (!res || !res[0]) return [];
    return res[0].values.map(([url, title, vc, t]) => ({
      type: 'history',
      url, title: title || url,
      visit_count: vc || 0,
      last_visit: t ? Math.round(Number(t) / 1000) - CHROMIUM_EPOCH_DIFF_MS : 0,
    }));
  } finally { try { db.close(); } catch (e) {} }
}

async function readChromiumDownloads(file, limit) {
  const db = await openSqlite(file);
  try {
    const res = db.exec(
      `SELECT
         d.id, d.target_path, d.start_time, d.received_bytes, d.total_bytes, d.state, d.mime_type,
         (SELECT url FROM downloads_url_chains c WHERE c.id = d.id ORDER BY c.chain_index DESC LIMIT 1) AS url
       FROM downloads d
       WHERE d.start_time > 0
       ORDER BY d.start_time DESC
       LIMIT ${limit}`
    );
    if (!res || !res[0]) return [];
    return res[0].values.map(([id, targetPath, startTime, receivedBytes, totalBytes, state, mime, url]) => ({
      type: 'download',
      url: url || '',
      title: (targetPath ? smartBasename(targetPath) : '') || url || 'Unknown',
      file_path: String(targetPath || ''),
      file_name: targetPath ? smartBasename(targetPath) : '',
      received_bytes: Number(receivedBytes || 0),
      total_bytes: Number(totalBytes || 0),
      state: DOWNLOAD_STATES[state] || 'UNKNOWN',
      mime: String(mime || ''),
      last_visit: startTime ? Math.round(Number(startTime) / 1000) - CHROMIUM_EPOCH_DIFF_MS : 0,
    }));
  } finally { try { db.close(); } catch (e) {} }
}

function readChromiumBookmarks(bookmarksFile, limit) {
  let data;
  try { data = JSON.parse(fs.readFileSync(bookmarksFile, 'utf8')); }
  catch (e) { return []; }
  const out = [];
  function walk(node, folderPath) {
    if (!node) return;
    if (node.type === 'url' && node.url) {
      out.push({
        type: 'bookmark',
        url: String(node.url),
        title: String(node.name || node.url),
        folder_path: folderPath,
        date_added: node.date_added ? Math.round(parseInt(String(node.date_added), 10) / 1000) - CHROMIUM_EPOCH_DIFF_MS : 0,
      });
    } else if (node.type === 'folder' && Array.isArray(node.children)) {
      const next = folderPath ? folderPath + ' / ' + (node.name || '') : (node.name || '');
      for (const child of node.children) walk(child, next);
    }
  }
  if (data && data.roots) {
    const labels = { bookmark_bar: 'Bookmarks Bar', other: 'Other Bookmarks', synced: 'Mobile Bookmarks' };
    for (const key of Object.keys(data.roots)) {
      const root = data.roots[key];
      if (root && Array.isArray(root.children)) {
        for (const child of root.children) walk(child, labels[key] || key);
      }
    }
  }
  out.sort((a, b) => (b.date_added || 0) - (a.date_added || 0));
  return out.slice(0, limit);
}

// ---------- Firefox readers ----------

async function readFirefoxHistory(file, limit) {
  const db = await openSqlite(file);
  try {
    const res = db.exec(
      `SELECT url, title, visit_count, last_visit_date FROM moz_places
       WHERE last_visit_date IS NOT NULL
       ORDER BY last_visit_date DESC
       LIMIT ${limit}`
    );
    if (!res || !res[0]) return [];
    return res[0].values.map(([url, title, vc, t]) => ({
      type: 'history',
      url, title: title || url,
      visit_count: vc || 0,
      last_visit: t ? Math.round(Number(t) / 1000) : 0,
    }));
  } finally { try { db.close(); } catch (e) {} }
}

async function readFirefoxDownloads(file, limit) {
  const db = await openSqlite(file);
  try {
    const res = db.exec(
      `SELECT p.url, p.title, p.last_visit_date, a.content AS dest_uri
       FROM moz_places p
       INNER JOIN moz_annos a ON p.id = a.place_id
       INNER JOIN moz_anno_attributes aa ON a.anno_attribute_id = aa.id
       WHERE aa.name = 'downloads/destinationFileURI'
       ORDER BY p.last_visit_date DESC
       LIMIT ${limit}`
    );
    if (!res || !res[0]) return [];
    return res[0].values.map(([url, title, lastVisit, destUri]) => {
      let filePath = '';
      const s = String(destUri || '');
      if (s.startsWith('file://')) {
        try { filePath = decodeURIComponent(s.replace(/^file:\/\//, '')); }
        catch (e) { filePath = s; }
      }
      return {
        type: 'download',
        url: String(url || ''),
        title: String(title || (filePath ? smartBasename(filePath) : 'Unknown')),
        file_path: filePath,
        file_name: filePath ? smartBasename(filePath) : '',
        received_bytes: 0, total_bytes: 0,
        state: 'COMPLETE', mime: '',
        last_visit: lastVisit ? Math.round(Number(lastVisit) / 1000) : 0,
      };
    });
  } finally { try { db.close(); } catch (e) {} }
}

async function readFirefoxBookmarks(file, limit) {
  const db = await openSqlite(file);
  try {
    const res = db.exec(
      `SELECT b.title, b.dateAdded, p.url, parent.title AS folder_name
       FROM moz_bookmarks b
       INNER JOIN moz_places p ON b.fk = p.id
       LEFT JOIN moz_bookmarks parent ON b.parent = parent.id
       WHERE b.type = 1 AND p.url IS NOT NULL
       ORDER BY b.dateAdded DESC
       LIMIT ${limit}`
    );
    if (!res || !res[0]) return [];
    return res[0].values.map(([title, dateAdded, url, folderName]) => ({
      type: 'bookmark',
      url: String(url || ''),
      title: String(title || url || 'Untitled'),
      folder_path: String(folderName || ''),
      date_added: dateAdded ? Math.round(Number(dateAdded) / 1000) : 0,
    }));
  } finally { try { db.close(); } catch (e) {} }
}

// ---------- Public API ----------

async function getBrowserData({ icon, kind = 'history', limit = 200 }) {
  const ic = String(icon || '').toLowerCase();
  const k = String(kind).toLowerCase();
  const lim = Math.max(1, Math.min(parseInt(limit, 10) || 200, 1000));

  if (!SUPPORTED_KINDS.includes(k)) throw new Error('Unknown kind: ' + k);

  if (CHROMIUM_BROWSERS.includes(ic)) {
    const dir = chromiumUserDataDir(ic);
    if (!dir) throw new Error(`Not supported: ${ic} on ${process.platform}`);
    if (!fs.existsSync(dir)) throw new Error(`Profile dir not found: ${dir}`);
    const profiles = findChromiumProfileDirs(dir);
    if (profiles.length === 0) throw new Error('No browser profiles detected');
    const all = [];
    const errs = [];
    for (const p of profiles) {
      try {
        let entries = [];
        if (k === 'history') {
          const f = path.join(p.dir, 'History');
          if (fs.existsSync(f)) entries = await readChromiumHistory(f, lim);
        } else if (k === 'downloads') {
          const f = path.join(p.dir, 'History');
          if (fs.existsSync(f)) entries = await readChromiumDownloads(f, lim);
        } else if (k === 'bookmarks') {
          const f = path.join(p.dir, 'Bookmarks');
          if (fs.existsSync(f)) entries = readChromiumBookmarks(f, lim);
        }
        for (const e of entries) all.push({ ...e, profile: p.name });
      } catch (err) { errs.push(`${p.name}: ${err.message}`); }
    }
    if (all.length === 0 && errs.length > 0) throw new Error(errs.join('; '));
    all.sort((a, b) => (b.last_visit || b.date_added || 0) - (a.last_visit || a.date_added || 0));
    return all.slice(0, lim);
  }

  if (FIREFOX_BROWSERS.includes(ic)) {
    const dir = firefoxProfilesDir();
    const profiles = firefoxProfiles(dir);
    if (profiles.length === 0) throw new Error('No Firefox profiles detected');
    const all = [];
    const errs = [];
    for (const p of profiles) {
      try {
        let entries = [];
        if (k === 'history') entries = await readFirefoxHistory(p.file, lim);
        else if (k === 'downloads') entries = await readFirefoxDownloads(p.file, lim);
        else if (k === 'bookmarks') entries = await readFirefoxBookmarks(p.file, lim);
        for (const e of entries) all.push({ ...e, profile: p.name });
      } catch (err) { errs.push(`${p.name}: ${err.message}`); }
    }
    if (all.length === 0 && errs.length > 0) throw new Error(errs.join('; '));
    all.sort((a, b) => (b.last_visit || b.date_added || 0) - (a.last_visit || a.date_added || 0));
    return all.slice(0, lim);
  }

  throw new Error(`Browser type "${ic}" not supported for ${k}`);
}

module.exports = {
  getBrowserData,
  // Backwards compat
  getBrowserHistory: (opts) => getBrowserData({ ...opts, kind: 'history' }),
  CHROMIUM_BROWSERS,
  FIREFOX_BROWSERS,
  SUPPORTED_KINDS,
};

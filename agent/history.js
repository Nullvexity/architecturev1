// Browser history reader — supports Chromium-based and Firefox-based browsers.
// Copies the SQLite file to temp (bypassing OS lock) then reads with sql.js (pure JS, no native deps).

const fs = require('fs');
const path = require('path');
const os = require('os');

let _sqlPromise = null;
async function ensureSql() {
  if (!_sqlPromise) {
    const initSqlJs = require('sql.js');
    _sqlPromise = initSqlJs();
  }
  return _sqlPromise;
}

const CHROMIUM_BROWSERS = ['chrome', 'chromium', 'edge', 'brave', 'opera', 'vivaldi', 'arc', 'yandex'];
const FIREFOX_BROWSERS = ['firefox'];

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

function chromiumProfiles(userDataDir) {
  if (!userDataDir || !fs.existsSync(userDataDir)) return [];
  const profiles = [];
  let entries;
  try { entries = fs.readdirSync(userDataDir); } catch (e) { return []; }
  for (const e of entries) {
    if (e === 'Default' || /^Profile[\s_]?\d+$/.test(e)) {
      const histFile = path.join(userDataDir, e, 'History');
      if (fs.existsSync(histFile)) profiles.push({ name: e, file: histFile });
    }
  }
  return profiles;
}

function firefoxProfilesDir() {
  const home = os.homedir();
  const platform = process.platform;
  if (platform === 'win32') return path.join(home, 'AppData', 'Roaming', 'Mozilla', 'Firefox', 'Profiles');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles');
  return path.join(home, '.mozilla', 'firefox');
}

function firefoxProfiles(profilesDir) {
  if (!profilesDir || !fs.existsSync(profilesDir)) return [];
  let entries;
  try { entries = fs.readdirSync(profilesDir); } catch (e) { return []; }
  return entries
    .map(d => ({ name: d, file: path.join(profilesDir, d, 'places.sqlite') }))
    .filter(p => fs.existsSync(p.file));
}

function copyToTemp(srcFile) {
  const tmp = path.join(os.tmpdir(), `arch-hist-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
  fs.copyFileSync(srcFile, tmp);
  return tmp;
}

async function readChromiumHistory(file, limit) {
  const SQL = await ensureSql();
  const tmp = copyToTemp(file);
  let db = null;
  try {
    const data = fs.readFileSync(tmp);
    db = new SQL.Database(data);
    const res = db.exec(
      `SELECT url, title, visit_count, last_visit_time FROM urls
       WHERE last_visit_time > 0
       ORDER BY last_visit_time DESC
       LIMIT ${Math.max(1, Math.min(limit, 1000))}`
    );
    if (!res || !res[0]) return [];
    // Chromium time is microseconds since 1601-01-01 UTC
    const EPOCH_DIFF_MS = 11644473600000;
    return res[0].values.map(([url, title, vc, t]) => ({
      url,
      title: title || url,
      visit_count: vc || 0,
      last_visit: t ? Math.round(Number(t) / 1000) - EPOCH_DIFF_MS : 0,
    }));
  } finally {
    if (db) try { db.close(); } catch (e) {}
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

async function readFirefoxHistory(file, limit) {
  const SQL = await ensureSql();
  const tmp = copyToTemp(file);
  let db = null;
  try {
    const data = fs.readFileSync(tmp);
    db = new SQL.Database(data);
    const res = db.exec(
      `SELECT url, title, visit_count, last_visit_date FROM moz_places
       WHERE last_visit_date IS NOT NULL
       ORDER BY last_visit_date DESC
       LIMIT ${Math.max(1, Math.min(limit, 1000))}`
    );
    if (!res || !res[0]) return [];
    // Firefox PRTime is microseconds since 1970-01-01 UTC
    return res[0].values.map(([url, title, vc, t]) => ({
      url,
      title: title || url,
      visit_count: vc || 0,
      last_visit: t ? Math.round(Number(t) / 1000) : 0,
    }));
  } finally {
    if (db) try { db.close(); } catch (e) {}
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

async function getBrowserHistory({ icon, limit = 200 }) {
  const ic = String(icon || '').toLowerCase();
  if (CHROMIUM_BROWSERS.includes(ic)) {
    const dir = chromiumUserDataDir(ic);
    if (!dir) throw new Error(`History not supported for ${ic} on ${process.platform}`);
    const profiles = chromiumProfiles(dir);
    if (profiles.length === 0) throw new Error('No browser profile data found');
    const all = [];
    for (const p of profiles) {
      try {
        const entries = await readChromiumHistory(p.file, limit);
        for (const e of entries) all.push({ ...e, profile: p.name });
      } catch (err) { /* skip locked/corrupt profile */ }
    }
    all.sort((a, b) => b.last_visit - a.last_visit);
    return all.slice(0, limit);
  }
  if (FIREFOX_BROWSERS.includes(ic)) {
    const dir = firefoxProfilesDir();
    const profiles = firefoxProfiles(dir);
    if (profiles.length === 0) throw new Error('No Firefox profile data found');
    const all = [];
    for (const p of profiles) {
      try {
        const entries = await readFirefoxHistory(p.file, limit);
        for (const e of entries) all.push({ ...e, profile: p.name });
      } catch (err) { /* skip */ }
    }
    all.sort((a, b) => b.last_visit - a.last_visit);
    return all.slice(0, limit);
  }
  throw new Error(`History reading not supported for browser type "${ic}"`);
}

module.exports = { getBrowserHistory, CHROMIUM_BROWSERS, FIREFOX_BROWSERS };

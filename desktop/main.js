const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const os = require('os');
const { getBrowserHistory } = require('./history');

// Pull in shared browser detection (duplicated locally so desktop has no cross-folder import)

const BROWSER_KEYS = {
  chrome: 'Google Chrome', 'google-chrome': 'Google Chrome', 'google chrome': 'Google Chrome',
  chromium: 'Chromium', firefox: 'Mozilla Firefox', 'mozilla firefox': 'Mozilla Firefox',
  edge: 'Microsoft Edge', 'microsoft edge': 'Microsoft Edge', msedge: 'Microsoft Edge',
  brave: 'Brave', 'brave-browser': 'Brave', opera: 'Opera', operagx: 'Opera GX',
  'opera-gx': 'Opera GX', vivaldi: 'Vivaldi', safari: 'Safari', arc: 'Arc',
  zen: 'Zen Browser', librewolf: 'LibreWolf', tor: 'Tor Browser', 'tor browser': 'Tor Browser',
  yandex: 'Yandex', ungoogled: 'Ungoogled Chromium',
};

function friendlyName(rawName) {
  const key = rawName.toLowerCase().trim();
  for (const k of Object.keys(BROWSER_KEYS)) if (key.includes(k)) return BROWSER_KEYS[k];
  return rawName.replace(/\.exe$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function detectIcon(name) {
  const n = name.toLowerCase();
  if (n.includes('chrome') && !n.includes('chromium')) return 'chrome';
  if (n.includes('chromium')) return 'chromium';
  if (n.includes('firefox') || n.includes('librewolf')) return 'firefox';
  if (n.includes('edge')) return 'edge';
  if (n.includes('brave')) return 'brave';
  if (n.includes('opera')) return 'opera';
  if (n.includes('vivaldi')) return 'vivaldi';
  if (n.includes('safari')) return 'safari';
  if (n.includes('arc')) return 'arc';
  if (n.includes('zen')) return 'zen';
  if (n.includes('tor')) return 'tor';
  if (n.includes('yandex')) return 'yandex';
  return 'globe';
}
function uniqueByName(list) {
  const seen = new Set();
  return list.filter(b => { const k = b.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

function detectWindows() {
  const found = [];
  const regPaths = [
    'HKLM\\SOFTWARE\\Clients\\StartMenuInternet',
    'HKLM\\SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet',
    'HKCU\\SOFTWARE\\Clients\\StartMenuInternet',
  ];
  for (const base of regPaths) {
    try {
      const out = execSync(`reg query "${base}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const subkeys = out.split('\n').map(l => l.trim()).filter(l => l.startsWith('HKEY'));
      for (const sub of subkeys) {
        try {
          const cmdKey = `${sub}\\shell\\open\\command`;
          const cmdOut = execSync(`reg query "${cmdKey}" /ve`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
          const match = cmdOut.match(/REG_SZ\s+(.+)/);
          if (!match) continue;
          let exe = match[1].trim().replace(/^"/, '').replace(/".*$/, '');
          if (!fs.existsSync(exe)) continue;
          const nameOut = execSync(`reg query "${sub}" /ve`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
          const nameMatch = nameOut.match(/REG_SZ\s+(.+)/);
          const rawName = (nameMatch ? nameMatch[1] : path.basename(exe)).trim();
          found.push({ name: friendlyName(rawName), path: exe, icon: detectIcon(rawName) });
        } catch (e) {}
      }
    } catch (e) {}
  }
  const commonPaths = [
    { name: 'Google Chrome', p: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { name: 'Google Chrome', p: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
    { name: 'Mozilla Firefox', p: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' },
    { name: 'Mozilla Firefox', p: 'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe' },
    { name: 'Microsoft Edge', p: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
    { name: 'Brave', p: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
    { name: 'Brave', p: 'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' },
    { name: 'Opera', p: path.join(os.homedir(), 'AppData\\Local\\Programs\\Opera\\opera.exe') },
    { name: 'Opera GX', p: path.join(os.homedir(), 'AppData\\Local\\Programs\\Opera GX\\opera.exe') },
    { name: 'Vivaldi', p: path.join(os.homedir(), 'AppData\\Local\\Vivaldi\\Application\\vivaldi.exe') },
    { name: 'Arc', p: path.join(os.homedir(), 'AppData\\Local\\Arc\\Application\\Arc.exe') },
    { name: 'Zen Browser', p: 'C:\\Program Files\\Zen Browser\\zen.exe' },
    { name: 'LibreWolf', p: 'C:\\Program Files\\LibreWolf\\librewolf.exe' },
    { name: 'Tor Browser', p: path.join(os.homedir(), 'Desktop\\Tor Browser\\Browser\\firefox.exe') },
    { name: 'Yandex', p: path.join(os.homedir(), 'AppData\\Local\\Yandex\\YandexBrowser\\Application\\browser.exe') },
  ];
  for (const c of commonPaths) if (fs.existsSync(c.p)) found.push({ name: c.name, path: c.p, icon: detectIcon(c.name) });
  return uniqueByName(found);
}
function detectMac() {
  const found = [];
  const apps = [
    { name: 'Google Chrome', p: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { name: 'Mozilla Firefox', p: '/Applications/Firefox.app/Contents/MacOS/firefox' },
    { name: 'Microsoft Edge', p: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    { name: 'Safari', p: '/Applications/Safari.app/Contents/MacOS/Safari' },
    { name: 'Brave', p: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
    { name: 'Opera', p: '/Applications/Opera.app/Contents/MacOS/Opera' },
    { name: 'Opera GX', p: '/Applications/Opera GX.app/Contents/MacOS/Opera' },
    { name: 'Vivaldi', p: '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi' },
    { name: 'Arc', p: '/Applications/Arc.app/Contents/MacOS/Arc' },
    { name: 'Zen Browser', p: '/Applications/Zen Browser.app/Contents/MacOS/zen' },
    { name: 'LibreWolf', p: '/Applications/LibreWolf.app/Contents/MacOS/librewolf' },
    { name: 'Tor Browser', p: '/Applications/Tor Browser.app/Contents/MacOS/firefox' },
    { name: 'Chromium', p: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
    { name: 'Yandex', p: '/Applications/Yandex.app/Contents/MacOS/Yandex' },
  ];
  for (const a of apps) if (fs.existsSync(a.p)) found.push({ name: a.name, path: a.p, icon: detectIcon(a.name) });
  if (!found.find(b => b.name === 'Safari') && fs.existsSync('/Applications/Safari.app')) {
    found.push({ name: 'Safari', path: '/Applications/Safari.app', icon: 'safari' });
  }
  return uniqueByName(found);
}
function detectLinux() {
  const found = [];
  const candidates = [
    { name: 'Google Chrome', cmd: 'google-chrome' },
    { name: 'Google Chrome', cmd: 'google-chrome-stable' },
    { name: 'Chromium', cmd: 'chromium' },
    { name: 'Chromium', cmd: 'chromium-browser' },
    { name: 'Mozilla Firefox', cmd: 'firefox' },
    { name: 'Microsoft Edge', cmd: 'microsoft-edge' },
    { name: 'Microsoft Edge', cmd: 'microsoft-edge-stable' },
    { name: 'Brave', cmd: 'brave' },
    { name: 'Brave', cmd: 'brave-browser' },
    { name: 'Opera', cmd: 'opera' },
    { name: 'Vivaldi', cmd: 'vivaldi' },
    { name: 'Vivaldi', cmd: 'vivaldi-stable' },
    { name: 'LibreWolf', cmd: 'librewolf' },
    { name: 'Tor Browser', cmd: 'torbrowser-launcher' },
    { name: 'Zen Browser', cmd: 'zen-browser' },
    { name: 'Yandex', cmd: 'yandex-browser' },
  ];
  for (const c of candidates) {
    try {
      const out = execSync(`which ${c.cmd}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (out && fs.existsSync(out)) found.push({ name: c.name, path: out, icon: detectIcon(c.name) });
    } catch (e) {}
  }
  return uniqueByName(found);
}
function detectBrowsers() {
  if (process.platform === 'win32') return detectWindows();
  if (process.platform === 'darwin') return detectMac();
  return detectLinux();
}
function openInBrowser(browserPath, url) {
  if (!url) throw new Error('No URL provided');
  let final = url.trim();
  if (!/^https?:\/\//i.test(final) && !/^file:\/\//i.test(final)) final = 'https://' + final;
  if (process.platform === 'darwin' && browserPath && browserPath.includes('.app')) {
    const appBundle = browserPath.split('.app')[0] + '.app';
    spawn('open', ['-a', appBundle, final], { detached: true, stdio: 'ignore' }).unref();
    return final;
  }
  spawn(browserPath, [final], { detached: true, stdio: 'ignore' }).unref();
  return final;
}

// ---------- Window ----------

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile('index.html');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- IPC ----------

ipcMain.handle('detect-browsers', async () => {
  try {
    return { ok: true, browsers: detectBrowsers(), platform: process.platform, hostname: os.hostname() };
  } catch (e) {
    return { ok: false, error: e.message, browsers: [], platform: process.platform, hostname: os.hostname() };
  }
});

ipcMain.handle('open-url', async (_evt, { browserPath, url }) => {
  try { return { ok: true, url: openInBrowser(browserPath, url) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('get-config', async () => {
  return {
    defaultServerUrl: 'https://cf5e2ccd-e392-4a4a-b533-a0129d1823eb.preview.emergentagent.com',
    overrideServerUrl: process.env.ARCH_SERVER_URL || null,
    hostname: os.hostname(),
    platform: process.platform,
  };
});

ipcMain.handle('get-local-history', async (_evt, { icon, limit }) => {
  try {
    const entries = await getBrowserHistory({ icon, limit: limit || 200 });
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

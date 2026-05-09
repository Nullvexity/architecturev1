// ArchitectureV1 Agent — runs silently in the background.
// Registers this PC with the relay and accepts open-site commands + screen streaming.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const WebSocket = require('ws');
const screenshot = require('screenshot-desktop');

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

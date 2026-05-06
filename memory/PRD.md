# ArchitectureV1 — PRD

## Original problem statement
> Build a PC app with a cool red squared themed UI like nullvexd.xyz. Title "ArchitectureV1", subtitle "created by nullvexity". A button that opens a site — has a URL textbox + browser selector dropdown ("BROWSERICON browsername"). Button hover/click should look 3D (overlapping shadow). Add icons. Use JetBrains Mono. Minimalist, no scanlines/grain. Real desktop browser detection. History of opened sites that's expandable, with per-row browser selector.

## Architecture
- **`/app/desktop/`** — Electron app (main.js, preload.js, index.html, styles.css, renderer.js, package.json) with cross-platform browser detection (Windows registry + common paths, macOS /Applications, Linux `which`) and `child_process.spawn` to open URLs.
- **`/app/frontend/`** — React web preview mirroring the same UI 1:1 with localStorage history, used in the Emergent preview pane.
- **`/app/backend/`** — untouched (no API needed; the app is fully local).

## What's implemented (Feb 2026)
- Title "ArchitectureV1" (3D shadow removed in v1.1)
- Subtitle "created by nullvexity"
- URL input + browser dropdown (icon + name format)
- 3D OPEN SITE button (red front + dark-red shadow that animates on hover/click)
- Browser detection for: Chrome, Chromium, Firefox, Edge, Brave, Opera, Opera GX, Vivaldi, Arc, Zen, LibreWolf, Tor, Safari, Yandex
- Collapsible history (last 50 entries) with per-row mini browser selector + GO button to re-open in chosen browser
- JetBrains Mono everywhere, dark/red minimalist aesthetic, sharp corners, red corner accents on cards
- electron-builder configured for Windows (NSIS), macOS (DMG), Linux (AppImage)
- Web preview clearly labeled `// PREVIEW` with explanation that desktop app is needed for real browser detection

### v1.1 — Multi-PC + Live View (added)
- **Backend WebSocket relay** at `/api/ws/agent` and `/api/ws/controller` (FastAPI)
- **`/app/agent/`** — Node.js background companion that registers a PC with the relay, executes open-URL commands, streams 1 fps screen frames. Includes Windows silent launcher (`start-silent.vbs`) and autostart installer (`install-startup.bat`)
- **PC switcher** in ArchitectureV1 — list of "This PC (Local)" + every connected agent (online dot, hostname, OS)
- **Remote open-site** — when a remote PC is selected, browser dropdown shows that PC's browsers, and OPEN SITE relays the command via WS to the agent which opens it locally on that PC
- **LIVE VIEW section** — collapsible canvas showing live screen frames from the selected remote PC
- **Connection state indicator** in header (`RELAY: CONNECTED/CONNECTING/DISCONNECTED` with animated pulse)
- **End-to-end verified**: register → list pcs → open_url → result → frame streaming → disconnect

### v1.2 — Real Browser History viewer (added)
- **`history.js`** module (in both `/app/agent/` and `/app/desktop/`) reads real browser history from the on-disk SQLite databases via `sql.js` (pure WASM, no native deps)
  - Chromium-based: Chrome, Edge, Brave, Opera, Vivaldi, Arc, Yandex, Chromium → reads `User Data/<Profile>/History` table `urls`
  - Firefox-based: Firefox, LibreWolf (treated as Firefox) → reads `places.sqlite` table `moz_places`
  - Multi-profile: scans `Default` + `Profile 1/2/...` for Chromium, all profile dirs for Firefox; merges + sorts by recency
  - Bypasses file lock by copying to OS temp before reading
- **New WS protocol**: `get_history` (controller→agent via server) and `history_result` (agent→controller); 15s timeout
- **New BROWSING HISTORY section** in ArchitectureV1
  - Collapsible panel with browser dropdown (only browsers capable of history reading), filter input, REFRESH button
  - Status badge (LOADING / OK / ERROR) and entry count
  - Each row: title, URL, visit count, time-ago, profile label, GO → button
  - Click row to open that URL on the same PC in the same browser
  - Works for both `This PC (Local)` (via Electron IPC → main process) and any remote PC (via WS relay)
- End-to-end relay verified (success path, offline-PC path, agent-error path)

## How to run desktop app (user)
```bash
cd desktop
npm install
npm start          # dev run
npm run build:win  # or build:mac / build:linux
```

## Backlog / future
- P1: Custom window frame (frameless) with custom titlebar drag region for fully native feel
- P1: Keyboard shortcut (Ctrl+L) to focus URL input from anywhere
- P2: Profile/incognito flags per browser (e.g., open Chrome in incognito)
- P2: Pin favorite sites at top of history
- P2: Tray-icon mode + global hotkey to summon the app
- P2: App icon (currently uses default Electron icon — needs custom asset)

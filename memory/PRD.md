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
- **`history.js`** module (in both `/app/agent/` and `/app/desktop/`) reads real browser data from on-disk databases via `sql.js` (pure WASM, no native deps)
  - Uses `locateFile` so the WASM resolves regardless of cwd / packaging
  - Falls back to direct file read if temp-copy fails (for shared-mode locks)
  - Cross-platform `smartBasename` so Windows `\` paths split correctly even if the controller is on Linux/Mac

### v1.3 — Downloads + Bookmarks tabs + bug fixes
- **Tabs in BROWSING HISTORY**: `HISTORY · DOWNLOADS · BOOKMARKS` — sharp red underline on active tab
- **Downloads** support
  - Chromium: `History` SQLite, table `downloads` joined with `downloads_url_chains` (final-redirect URL via `chain_index DESC LIMIT 1`); shows file name, total bytes, state badge (COMPLETE / IN_PROGRESS / CANCELLED / INTERRUPTED), MIME type
  - Firefox: `places.sqlite` annotations on `moz_annos` with `downloads/destinationFileURI` attribute → file path
- **Bookmarks** support
  - Chromium: JSON `Bookmarks` file walked recursively, folder path tracked (e.g. "Bookmarks Bar / Dev")
  - Firefox: `moz_bookmarks` joined with `moz_places`, shows parent folder
- **Per-(kind, browser) cache** in renderer to avoid refetches when switching tabs
- **Bug fix**: bumped fetch timeout 15s → 45s (sql.js WASM init can take a few seconds on first call)
- **Bug fix**: `sql.js` `locateFile` so WASM resolves cleanly when packaged
- **Bug fix**: graceful fallback to direct read if `copyFileSync` fails (locked files)
- **Verified**: full functional test against fake Chromium + Firefox profiles for all 3 kinds; WS relay verified for all 3 kinds

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

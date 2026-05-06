# ArchitectureV1 — PRD

## Original problem statement
> Build a PC app with a cool red squared themed UI like nullvexd.xyz. Title "ArchitectureV1", subtitle "created by nullvexity". A button that opens a site — has a URL textbox + browser selector dropdown ("BROWSERICON browsername"). Button hover/click should look 3D (overlapping shadow). Add icons. Use JetBrains Mono. Minimalist, no scanlines/grain. Real desktop browser detection. History of opened sites that's expandable, with per-row browser selector.

## Architecture
- **`/app/desktop/`** — Electron app (main.js, preload.js, index.html, styles.css, renderer.js, package.json) with cross-platform browser detection (Windows registry + common paths, macOS /Applications, Linux `which`) and `child_process.spawn` to open URLs.
- **`/app/frontend/`** — React web preview mirroring the same UI 1:1 with localStorage history, used in the Emergent preview pane.
- **`/app/backend/`** — untouched (no API needed; the app is fully local).

## What's implemented (Feb 2026)
- Title "ArchitectureV1" with red 3D shadow offset
- Subtitle "created by nullvexity"
- URL input + browser dropdown (icon + name format)
- 3D OPEN SITE button (red front + dark-red shadow that animates on hover/click)
- Browser detection for: Chrome, Chromium, Firefox, Edge, Brave, Opera, Opera GX, Vivaldi, Arc, Zen, LibreWolf, Tor, Safari, Yandex
- Collapsible history (last 50 entries) with per-row mini browser selector + GO button to re-open in chosen browser
- JetBrains Mono everywhere, dark/red minimalist aesthetic, sharp corners, red corner accents on cards
- electron-builder configured for Windows (NSIS), macOS (DMG), Linux (AppImage)
- Web preview clearly labeled `// PREVIEW` with explanation that desktop app is needed for real browser detection

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
